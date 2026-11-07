//! AI module map
//! Purpose: own SQLite commerce metadata, account-scoped talents, invitation history,
//! task summaries, and logs, with paged queries and streaming exports.
//! Entry: storage.rs calls open/load/save/query/delete/export after checking IPC access;
//! browser account removal reads the same metadata through account.
//! Flow: open imports runtime.json and errors.ndjson in the schema transaction, retaining
//! source files and marking completion only after every row has been imported. Migration
//! preserves talent primary keys; only new collection writes reconcile rows by UID.
//! Global diagnostic IDs survive matching task-log copies, which add missing task links.
//! Task summaries use (account_id, kind); startup returns account:kind keys so collection
//! and invitation progress coexist. Task log windows also match kind and start time.
//! State: assistant.sqlite3 is authoritative; writes use WAL/FULL transactions under
//! storage's operation lock. Streaming exports use their own read connection.
//! Batched writes reuse prepared statements; pages fetch talents and latest invitations
//! together, and exports resolve account names once instead of parsing them per record.
//! Invitation ID queries exclude any existing record for the same platform/account/talent;
//! ordinary talent queries retain their existing filter and export/delete scope.
//! Page size/offset are bound values so pagination can reuse cached query statements.
//! Invariants: data remains scoped by platform/account, unknown payload fields survive,
//! interrupted sending rows become review, and queries never replay platform requests.

use rusqlite::{params, params_from_iter, types::Value as SqlValue, Connection, OptionalExtension};
use serde_json::{json, Map, Value};
use std::{collections::{HashMap, HashSet}, fs, io::{BufRead, BufReader, Write}, path::Path};

type Result<T> = std::result::Result<T, String>;
fn error(value: impl ToString) -> String { value.to_string() }
fn text<'a>(value: &'a Value, field: &str) -> &'a str { value[field].as_str().unwrap_or("") }
fn required<'a>(value: &'a Value, field: &str) -> Result<&'a str> {
    value[field].as_str().filter(|value| !value.is_empty()).ok_or_else(|| format!("缺少 {field}"))
}
fn decode(raw: String) -> Result<Value> { serde_json::from_str(&raw).map_err(error) }
fn array(value: &Value) -> impl DoubleEndedIterator<Item = &Value> { value.as_array().into_iter().flatten() }

pub fn open(directory: &Path) -> Result<Connection> {
    let path = directory.join("assistant.sqlite3");
    // Database contains the same private account/history data as the source files.
    let mut options = fs::OpenOptions::new();
    options.create(true).append(true);
    #[cfg(unix)] {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    options.open(&path).map_err(error)?;
    let mut db = Connection::open(&path).map_err(error)?;
    db.execute_batch("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;").map_err(error)?;
    let version: i64 = db.query_row("PRAGMA user_version", [], |row| row.get(0)).map_err(error)?;
    if version == 0 {
        let transaction = db.transaction().map_err(error)?;
        transaction.execute_batch(
            "CREATE TABLE metadata (key TEXT PRIMARY KEY, payload TEXT NOT NULL);
             CREATE TABLE tasks (account_id TEXT NOT NULL, kind TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(account_id, kind));
             CREATE TABLE talents (
                platform TEXT NOT NULL, account_id TEXT NOT NULL, id TEXT NOT NULL,
                uid TEXT, name TEXT NOT NULL, search_name TEXT NOT NULL, fans REAL,
                source TEXT NOT NULL, gender TEXT NOT NULL, collected_at TEXT NOT NULL,
                has_sales30d INTEGER NOT NULL, has_sales7d INTEGER NOT NULL,
                has_settlement30d INTEGER NOT NULL, payload TEXT NOT NULL,
                PRIMARY KEY(platform, account_id, id));
             CREATE INDEX talents_uid ON talents(platform, account_id, uid);
             CREATE INDEX talents_date ON talents(platform, account_id, collected_at DESC);
             CREATE INDEX talents_account ON talents(account_id, collected_at);
             CREATE INDEX talents_source ON talents(platform, account_id, source);
             CREATE INDEX talents_fans ON talents(platform, account_id, fans);
             CREATE INDEX talents_sales30d ON talents(platform, account_id, has_sales30d);
             CREATE INDEX talents_sales7d ON talents(platform, account_id, has_sales7d);
             CREATE INDEX talents_settlement30d ON talents(platform, account_id, has_settlement30d);
             CREATE TABLE records (
                seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL,
                platform TEXT NOT NULL, account_id TEXT NOT NULL, talent_id TEXT NOT NULL,
                time TEXT NOT NULL, status TEXT NOT NULL, name TEXT NOT NULL,
                payload TEXT NOT NULL);
             CREATE INDEX records_account_time ON records(account_id, time DESC, seq DESC);
             CREATE INDEX records_platform_time ON records(platform, time DESC, seq DESC);
             CREATE INDEX records_time ON records(time DESC, seq DESC);
             CREATE INDEX records_status ON records(status, time DESC);
             CREATE INDEX records_talent ON records(platform, account_id, talent_id, time DESC, seq DESC);
             CREATE TABLE collections (id TEXT PRIMARY KEY, account_id TEXT NOT NULL, payload TEXT NOT NULL);
             CREATE TABLE logs (
                seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL,
                account_id TEXT, platform TEXT, task_id TEXT, time TEXT NOT NULL,
                level TEXT NOT NULL, message TEXT NOT NULL, payload TEXT NOT NULL);
             CREATE INDEX logs_account_time ON logs(account_id, level, time DESC, seq DESC);
             CREATE INDEX logs_level_time ON logs(level, time DESC, seq DESC);
             CREATE INDEX logs_task ON logs(account_id, task_id, time DESC, seq DESC);"
        ).map_err(error)?;
        let mut task_logs = Vec::new();
        let runtime_path = directory.join("runtime.json");
        if runtime_path.exists() {
            let runtime: Value = serde_json::from_reader(fs::File::open(runtime_path).map_err(error)?).map_err(error)?;
            let mut preferences = Map::new();
            for key in ["accounts", "configs", "filters", "selected"] {
                if let Some(value) = runtime.get(key) { preferences.insert(key.into(), value.clone()); }
            }
            save_metadata(&transaction, &Value::Object(preferences))?;
            // Historical IDs already link to invitation records. Import each exact key
            // even when multiple historical rows share a UID; collection reconciliation
            // must not merge them or detach their existing invitation history here.
            for talent in array(&runtime["talents"]) { write_talent(&transaction, talent.clone())?; }
            // Original runtime keeps newest records first; seq preserves tie order.
            for record in array(&runtime["records"]).rev() { upsert_record(&transaction, record)?; }
            if let Some(tasks) = runtime["tasks"].as_object() {
                for task in tasks.values() {
                    save_task(&transaction, task)?;
                    for field in ["logs", "activity"] {
                        for entry in array(&task[field]) {
                            let mut entry = entry.clone();
                            entry["accountId"] = task["accountId"].clone();
                            entry["taskId"] = task["startedAt"].clone();
                            entry["kind"] = task["kind"].clone();
                            task_logs.push(entry);
                        }
                    }
                }
            }
            for collection in array(&runtime["collections"]) { save_collection(&transaction, collection)?; }
            for entry in array(&runtime["logs"]) { append_log(&transaction, entry)?; }
        }
        let logs_path = directory.join("errors.ndjson");
        if logs_path.exists() {
            for line in BufReader::new(fs::File::open(logs_path).map_err(error)?).lines() {
                let line = line.map_err(error)?;
                if !line.trim().is_empty() {
                    append_log(&transaction, &serde_json::from_str::<Value>(&line).map_err(error)?)?;
                }
            }
        }
        // Task lists mirror global diagnostics. Match each global row once so two
        // identical errors at the same timestamp remain two historical occurrences.
        let mut matched_logs = HashSet::new();
        for entry in task_logs {
            import_task_log(&transaction, &entry, &mut matched_logs)?;
        }
        transaction.execute_batch("PRAGMA user_version=2;").map_err(error)?;
        transaction.commit().map_err(error)?;
    }
    if version == 1 {
        // Preserve the saved payload and account identity while adding a slot per kind.
        let transaction = db.transaction().map_err(error)?;
        transaction.execute_batch(
            "CREATE TABLE tasks_by_kind (account_id TEXT NOT NULL, kind TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(account_id, kind));
             INSERT INTO tasks_by_kind(account_id,kind,payload) SELECT account_id,json_extract(payload,'$.kind'),payload FROM tasks;
             DROP TABLE tasks;
             ALTER TABLE tasks_by_kind RENAME TO tasks;
             PRAGMA user_version=2;"
        ).map_err(error)?;
        transaction.commit().map_err(error)?;
    }
    Ok(db)
}

fn save_metadata(db: &Connection, preferences: &Value) -> Result<()> {
    if let Some(values) = preferences.as_object() {
        let mut statement = db.prepare_cached("INSERT INTO metadata(key,payload) VALUES (?1,?2) ON CONFLICT(key) DO UPDATE SET payload=excluded.payload").map_err(error)?;
        for (key, value) in values {
            statement.execute(params![key, value.to_string()]).map_err(error)?;
        }
    }
    Ok(())
}
fn save_task(db: &Connection, task: &Value) -> Result<()> {
    let mut task = task.clone();
    if let Some(object) = task.as_object_mut() { object.remove("activity"); object.remove("logs"); }
    db.prepare_cached("INSERT INTO tasks(account_id,kind,payload) VALUES (?1,?2,?3) ON CONFLICT(account_id,kind) DO UPDATE SET payload=excluded.payload")
        .map_err(error)?.execute(params![required(&task,"accountId")?, required(&task,"kind")?, task.to_string()]).map_err(error)?;
    Ok(())
}
fn save_collection(db: &Connection, collection: &Value) -> Result<()> {
    db.prepare_cached("INSERT INTO collections(id,account_id,payload) VALUES (?1,?2,?3) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload")
        .map_err(error)?.execute(params![required(collection,"id")?, required(collection,"accountId")?, collection.to_string()]).map_err(error)?;
    Ok(())
}
fn has_metric(value: &Value) -> bool {
    if value.is_number() { return true; }
    let Some(value) = value.as_str() else { return false; };
    let value = value.trim().trim_start_matches(['¥', '￥']).trim();
    !value.is_empty() && !value.eq_ignore_ascii_case("nan") && !value.chars().all(|c| matches!(c, '-' | '—' | '–'))
}
// Write one exact primary key without identity reconciliation. Both migration and
// collection keep the full JSON payload; normalized fields also feed SQL indexes.
fn write_talent(db: &Connection, mut talent: Value) -> Result<Value> {
    if text(&talent, "source") == "达人广场 · 当前筛选" { talent["source"] = json!("达人广场"); }
    let platform = required(&talent, "platform")?;
    let account_id = required(&talent, "sourceAccountId")?;
    let id = required(&talent, "id")?;
    let gender = match text(&talent, "gender") { "男" => "男", "女" => "女", _ => "unknown" };
    db.prepare_cached(
        "INSERT INTO talents(platform,account_id,id,uid,name,search_name,fans,source,gender,collected_at,has_sales30d,has_sales7d,has_settlement30d,payload)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14)
         ON CONFLICT(platform,account_id,id) DO UPDATE SET uid=excluded.uid,name=excluded.name,search_name=excluded.search_name,fans=excluded.fans,source=excluded.source,gender=excluded.gender,collected_at=excluded.collected_at,has_sales30d=excluded.has_sales30d,has_sales7d=excluded.has_sales7d,has_settlement30d=excluded.has_settlement30d,payload=excluded.payload"
    ).map_err(error)?.execute(
        params![platform, account_id, id, talent["uid"].as_str(), text(&talent,"name"),
            text(&talent,"name").to_lowercase(), talent["fans"].as_f64(), text(&talent,"source"), gender,
            text(&talent,"collectedAt"), has_metric(&talent["sales30d"]), has_metric(&talent["sales7d"]),
            has_metric(&talent["settlement30d"]), talent.to_string()]
    ).map_err(error)?;
    Ok(talent)
}
fn upsert_talent(db: &Connection, incoming: &Value) -> Result<(Value, bool)> {
    let platform = required(incoming, "platform")?;
    let account_id = required(incoming, "sourceAccountId")?;
    let id = required(incoming, "id")?;
    let uid = text(incoming, "uid");
    let mut prior: Option<String> = if uid.is_empty() { None } else {
        // The collection index previously retained the last stored row for a UID.
        db.prepare_cached("SELECT payload FROM talents WHERE platform=?1 AND account_id=?2 AND uid=?3 ORDER BY rowid DESC LIMIT 1")
            .map_err(error)?.query_row(
            params![platform,account_id,uid],|row| row.get(0)).optional().map_err(error)?
    };
    if prior.is_none() {
        prior = db.prepare_cached("SELECT payload FROM talents WHERE platform=?1 AND account_id=?2 AND id=?3")
            .map_err(error)?.query_row(
            params![platform,account_id,id],|row| row.get(0)).optional().map_err(error)?;
    }
    let added = prior.is_none();
    let mut talent = match prior { Some(prior) => decode(prior)?, None => json!({}) };
    let prior_id = talent.get("id").cloned();
    let target = talent.as_object_mut().ok_or("达人数据格式无效")?;
    target.extend(incoming.as_object().ok_or("达人数据格式无效")?.clone());
    if let Some(id) = prior_id { target.insert("id".into(), id); }
    Ok((write_talent(db, talent)?, added))
}
fn upsert_record(db: &Connection, record: &Value) -> Result<()> {
    db.prepare_cached(
        "INSERT INTO records(id,platform,account_id,talent_id,time,status,name,payload) VALUES (?1,?2,?3,?4,?5,?6,?7,?8)
         ON CONFLICT(id) DO UPDATE SET platform=excluded.platform,account_id=excluded.account_id,talent_id=excluded.talent_id,time=excluded.time,status=excluded.status,name=excluded.name,payload=excluded.payload"
    ).map_err(error)?.execute(
        params![required(record,"id")?, required(record,"platform")?, required(record,"accountId")?, required(record,"talentId")?,
            required(record,"time")?, required(record,"status")?, text(record,"name"), record.to_string()]
    ).map_err(error)?;
    Ok(())
}
pub fn append_log(db: &Connection, entry: &Value) -> Result<()> {
    let mut entry = entry.clone();
    if text(&entry,"id").is_empty() { entry["id"] = json!(uuid::Uuid::new_v4().to_string()); }
    if text(&entry,"time").is_empty() {
        entry["time"] = json!(time::OffsetDateTime::now_utc().format(&time::format_description::well_known::Rfc3339).map_err(error)?);
    }
    db.prepare_cached("INSERT INTO logs(id,account_id,platform,task_id,time,level,message,payload) VALUES (?1,?2,?3,?4,?5,?6,?7,?8) ON CONFLICT(id) DO NOTHING")
        .map_err(error)?.execute(params![text(&entry,"id"),entry["accountId"].as_str(),entry["platform"].as_str(),entry["taskId"].as_str(),text(&entry,"time"),text(&entry,"level"),text(&entry,"message"),entry.to_string()]).map_err(error)?;
    Ok(())
}
// Only migration calls this after importing global logs. Match the saved response
// structurally, preserve the global ID, and fill task links absent from that copy.
fn import_task_log(db: &Connection, entry: &Value, matched: &mut HashSet<String>) -> Result<()> {
    let candidates = rows(
        db,
        "SELECT payload FROM logs WHERE account_id=?1 AND time=?2 AND level=?3 AND message=?4
         AND (COALESCE(task_id,'')=?5 OR COALESCE(task_id,'')='')
         ORDER BY (COALESCE(task_id,'')=?5) DESC,seq",
        &[
            SqlValue::Text(text(entry,"accountId").into()),
            SqlValue::Text(text(entry,"time").into()),
            SqlValue::Text(text(entry,"level").into()),
            SqlValue::Text(text(entry,"message").into()),
            SqlValue::Text(text(entry,"taskId").into()),
        ],
    )?;
    let prior = candidates.into_iter().find(|prior| {
        !matched.contains(text(prior,"id")) &&
            (text(entry,"id").is_empty() || text(entry,"id") == text(prior,"id")) &&
            prior["response"] == entry["response"]
    });
    if let Some(mut prior) = prior {
        let id = required(&prior,"id")?.to_owned();
        let target = prior.as_object_mut().ok_or("日志数据格式无效")?;
        for (key, value) in entry.as_object().ok_or("日志数据格式无效")? {
            if key == "id" { continue; }
            let field = target.entry(key.clone()).or_insert(Value::Null);
            if field.is_null() ||
                (matches!(key.as_str(), "taskId" | "kind" | "platform") && field.as_str() == Some("")) {
                *field = value.clone();
            }
        }
        db.execute(
            "UPDATE logs SET platform=?1,task_id=?2,payload=?3 WHERE id=?4",
            params![prior["platform"].as_str(),prior["taskId"].as_str(),prior.to_string(),id],
        ).map_err(error)?;
        matched.insert(id);
    } else {
        let mut entry = entry.clone();
        if text(&entry,"id").is_empty() { entry["id"] = json!(uuid::Uuid::new_v4().to_string()); }
        append_log(db, &entry)?;
        matched.insert(text(&entry,"id").to_owned());
    }
    Ok(())
}
pub fn save(db: &mut Connection, data: &Value) -> Result<Value> {
    let transaction = db.transaction().map_err(error)?;
    save_metadata(&transaction, &data["preferences"])?;
    if let Some(tasks) = data["tasks"].as_object() {
        for task in tasks.values() { save_task(&transaction, task)?; }
    }
    let mut saved = Vec::new();
    let mut added = 0;
    let mut updated_ids = Vec::new();
    for talent in array(&data["talents"]) {
        let (talent, is_new) = upsert_talent(&transaction, talent)?;
        if !is_new { updated_ids.push(text(&talent,"id").to_owned()); }
        saved.push(talent);
        added += usize::from(is_new);
    }
    for record in array(&data["records"]) { upsert_record(&transaction, record)?; }
    for collection in array(&data["collections"]) { save_collection(&transaction, collection)?; }
    for entry in array(&data["activities"]) { append_log(&transaction, entry)?; }
    if let Some(ids) = data.get("deleteRecordIds") {
        transaction.execute("DELETE FROM records WHERE id IN (SELECT value FROM json_each(?1))", [ids.to_string()]).map_err(error)?;
    }
    transaction.commit().map_err(error)?;
    Ok(json!({"talents":saved,"added":added,"updatedIds":updated_ids}))
}
fn rows(db: &Connection, sql: &str, values: &[SqlValue]) -> Result<Vec<Value>> {
    let mut statement = db.prepare_cached(sql).map_err(error)?;
    let mut cursor = statement.query(params_from_iter(values)).map_err(error)?;
    let mut output = Vec::new();
    while let Some(row) = cursor.next().map_err(error)? { output.push(decode(row.get(0).map_err(error)?)?); }
    Ok(output)
}
pub fn load(db: &mut Connection) -> Result<Value> {
    // Only startup calls load. Unknown in-flight sends are never replayed.
    db.execute("UPDATE records SET status='review',payload=json_set(payload,'$.status','review','$.note','上次发送未保存最终结果，请在平台核实') WHERE status='sending'", []).map_err(error)?;
    let mut output = Map::new();
    let mut statement = db.prepare("SELECT key,payload FROM metadata").map_err(error)?;
    let mut cursor = statement.query([]).map_err(error)?;
    while let Some(row) = cursor.next().map_err(error)? {
        output.insert(row.get(0).map_err(error)?, decode(row.get(1).map_err(error)?)?);
    }
    let mut tasks = Map::new();
    // Removed accounts retain their history in SQLite, but do not load dormant
    // task summaries or their per-task activity/error windows on every startup.
    for mut task in rows(db,"SELECT payload FROM tasks WHERE account_id IN (SELECT json_extract(a.value,'$.id') FROM metadata m,json_each(m.payload) a WHERE m.key='accounts')", &[])? {
        let values = [SqlValue::Text(text(&task,"accountId").into()),SqlValue::Text(text(&task,"startedAt").into()),SqlValue::Text(text(&task,"kind").into())];
        let mut activity = rows(db,"SELECT payload FROM logs WHERE account_id=?1 AND task_id=?2 AND json_extract(payload,'$.kind')=?3 AND level<>'error' ORDER BY time DESC,seq DESC LIMIT 200", &values)?;
        activity.reverse();
        let mut logs = rows(db,"SELECT payload FROM logs WHERE account_id=?1 AND task_id=?2 AND json_extract(payload,'$.kind')=?3 AND level='error' ORDER BY time DESC,seq DESC LIMIT 200", &values)?;
        logs.reverse();
        task["activity"] = json!(activity);
        task["logs"] = json!(logs);
        tasks.insert(format!("{}:{}",text(&task,"accountId"),text(&task,"kind")),task);
    }
    output.insert("tasks".into(),Value::Object(tasks));
    let mut logs = rows(db,"SELECT payload FROM logs WHERE level='error' ORDER BY time DESC,seq DESC LIMIT 1000",&[])?;
    logs.reverse();
    output.insert("logs".into(),json!(logs));
    output.insert("talentCounts".into(),talent_counts(db)?);
    Ok(Value::Object(output))
}
pub fn talent_counts(db: &Connection) -> Result<Value> {
    let mut counts = Map::new();
    let mut statement = db.prepare("SELECT account_id,count(*) FROM talents GROUP BY account_id").map_err(error)?;
    let mut cursor = statement.query([]).map_err(error)?;
    while let Some(row) = cursor.next().map_err(error)? { counts.insert(row.get(0).map_err(error)?,json!(row.get::<_,i64>(1).map_err(error)?)); }
    Ok(Value::Object(counts))
}
pub fn account(db: &Connection, id: &str) -> Result<Value> {
    let raw: Option<String> = db.query_row("SELECT value FROM metadata,json_each(metadata.payload) WHERE metadata.key='accounts' AND json_extract(value,'$.id')=?1 LIMIT 1", [id], |row| row.get(0)).optional().map_err(error)?;
    raw.map(decode).transpose()?.ok_or_else(|| "账号不存在".into())
}

#[derive(Default)]
struct Filter { clauses: Vec<String>, values: Vec<SqlValue> }
impl Filter {
    fn bind(&mut self, value: impl Into<SqlValue>) -> String {
        self.values.push(value.into()); format!("?{}", self.values.len())
    }
    fn equal(&mut self, column: &str, value: &str) {
        let binding = self.bind(value.to_owned()); self.clauses.push(format!("{column}={binding}"));
    }
    fn sql(&self) -> String { if self.clauses.is_empty() { "1".into() } else { self.clauses.join(" AND ") } }
}
const LATEST_JOIN: &str = "LEFT JOIN records latest ON latest.seq=(SELECT r.seq FROM records r WHERE r.platform=t.platform AND r.account_id=t.account_id AND r.talent_id=t.id ORDER BY r.time DESC,r.seq DESC LIMIT 1)";
fn talent_filter(request: &Value) -> Result<Filter> {
    let mut filter = Filter::default();
    filter.equal("t.platform",required(request,"platform")?);
    filter.equal("t.account_id",required(request,"accountId")?);
    if let Some(ids) = request.get("ids") {
        if !ids.is_array() { return Err("达人选择范围无效".into()); }
        let binding = filter.bind(ids.to_string());
        filter.clauses.push(format!("t.id IN (SELECT value FROM json_each({binding}))"));
        return Ok(filter);
    }
    let keyword = text(request,"query").trim().to_lowercase();
    if !keyword.is_empty() {
        let binding = filter.bind(keyword);
        filter.clauses.push(format!("(instr(t.search_name,{binding})>0 OR instr(lower(t.id),{binding})>0 OR instr(lower(t.source),{binding})>0)"));
    }
    let filters = &request["filters"];
    let status = text(filters,"status");
    if status == "pending" { filter.clauses.push("latest.seq IS NULL".into()); }
    else if status == "success" { filter.clauses.push("latest.status='success'".into()); }
    else if status != "all" && !status.is_empty() { return Err("邀约状态无效".into()); }
    for (field,column) in [("source","t.source"),("gender","t.gender")] {
        let value = text(&filters["choices"],field);
        if !value.is_empty() { filter.equal(column,value); }
    }
    for (field,operator) in [("min",">="),("max","<=")] {
        let value = text(&filters["ranges"]["fans"],field);
        if !value.is_empty() {
            let bound: f64 = value.parse().map_err(|_| "粉丝数范围无效".to_owned())?;
            if !bound.is_finite() || bound < 0.0 { return Err("粉丝数范围无效".into()); }
            let binding = filter.bind(bound);
            filter.clauses.push(format!("t.fans{operator}{binding}"));
        }
    }
    Ok(filter)
}
fn talent_from(request: &Value) -> String {
    if request.get("ids").is_none() && matches!(text(&request["filters"],"status"),"pending" | "success") {
        format!("talents t {LATEST_JOIN}")
    } else { "talents t".into() }
}
fn record_filter(request: &Value) -> Result<Filter> {
    let mut filter = Filter::default();
    for (field,column) in [("platform","r.platform"),("accountId","r.account_id"),("status","r.status")] {
        let value = text(request,field);
        if !value.is_empty() && value != "all" { filter.equal(column,value); }
    }
    let since = text(request,"since");
    if !since.is_empty() { let binding = filter.bind(since.to_owned()); filter.clauses.push(format!("r.time>={binding}")); }
    let keyword = text(request,"query");
    if !keyword.is_empty() { let binding = filter.bind(keyword.to_owned()); filter.clauses.push(format!("instr(r.name || r.talent_id,{binding})>0")); }
    if let Some(ids) = request.get("ids") {
        if !ids.is_array() { return Err("记录选择范围无效".into()); }
        let binding = filter.bind(ids.to_string());
        filter.clauses.push(format!("r.id IN (SELECT value FROM json_each({binding}))"));
    }
    Ok(filter)
}
fn log_filter(request: &Value) -> Filter {
    let mut filter = Filter::default();
    filter.clauses.push("l.level='error'".into());
    let account_id = text(request,"accountId");
    if !account_id.is_empty() && account_id != "all" { filter.equal("l.account_id",account_id); }
    let platform = text(request,"platform");
    if !platform.is_empty() && platform != "all" {
        let binding = filter.bind(platform.to_owned());
        filter.clauses.push(format!("(l.platform IS NULL OR l.platform={binding})"));
    }
    let before = text(request,"before");
    if !before.is_empty() { let binding = filter.bind(before.to_owned()); filter.clauses.push(format!("l.time<={binding}")); }
    let keyword = text(request,"query");
    if !keyword.is_empty() { let binding = filter.bind(keyword.to_owned()); filter.clauses.push(format!("instr(l.message,{binding})>0")); }
    filter
}
fn count(db: &Connection, from: &str, filter: &Filter) -> Result<i64> {
    db.prepare_cached(&format!("SELECT count(*) FROM {from} WHERE {}",filter.sql())).map_err(error)?
        .query_row(params_from_iter(&filter.values),|row| row.get(0)).map_err(error)
}
fn paging(request: &Value, total: i64) -> Result<(i64,i64)> {
    let size = request["pageSize"].as_i64().unwrap_or(20);
    if ![10,20,50,100].contains(&size) { return Err("每页条数无效".into()); }
    let page = request["page"].as_i64().unwrap_or(1).max(1).min(((total+size-1)/size).max(1));
    Ok((page,size))
}
fn talent_columns(db: &Connection, platform: &str, account_id: &str) -> Result<Vec<&'static str>> {
    let choices = if platform == "kuaishou" { ["sales30d","sales7d"] } else { ["sales30d","settlement30d"] };
    let mut columns = Vec::new();
    for field in choices {
        let found: bool = db.prepare_cached(&format!("SELECT EXISTS(SELECT 1 FROM talents WHERE platform=?1 AND account_id=?2 AND has_{field}=1)")).map_err(error)?
            .query_row(params![platform,account_id],|row| row.get(0)).map_err(error)?;
        if found { columns.push(field); }
    }
    Ok(columns)
}
fn talent_page(db: &Connection, request: &Value) -> Result<Value> {
    let mut filter = talent_filter(request)?;
    let from = talent_from(request);
    let total = count(db,&from,&filter)?;
    let (page,size) = paging(request,total)?;
    let limit = filter.bind(size);
    let offset = filter.bind((page-1)*size);
    // One page cursor supplies both datasets, preserving their shared filter and order.
    let sql = format!("SELECT t.payload,json_remove(latest.payload,'$.response') FROM talents t {LATEST_JOIN} WHERE {} ORDER BY t.collected_at DESC,t.rowid DESC LIMIT {limit} OFFSET {offset}",filter.sql());
    let mut statement = db.prepare_cached(&sql).map_err(error)?;
    let mut cursor = statement.query(params_from_iter(&filter.values)).map_err(error)?;
    let mut talents = Vec::new();
    let mut latest = Vec::new();
    while let Some(row) = cursor.next().map_err(error)? {
        talents.push(decode(row.get(0).map_err(error)?)?);
        if let Some(record) = row.get::<_,Option<String>>(1).map_err(error)? {
            let record = decode(record)?;
            if !record.is_null() { latest.push(record); }
        }
    }
    let platform = required(request,"platform")?;
    let account_id = required(request,"accountId")?;
    let account_total: i64 = db.prepare_cached("SELECT count(*) FROM talents WHERE platform=?1 AND account_id=?2").map_err(error)?
        .query_row(params![platform,account_id],|row| row.get(0)).map_err(error)?;
    let mut statement = db.prepare_cached("SELECT DISTINCT source FROM talents WHERE platform=?1 AND account_id=?2 AND source<>'' ORDER BY source").map_err(error)?;
    let sources = statement.query_map(params![platform,account_id],|row| row.get::<_,String>(0)).map_err(error)?.collect::<std::result::Result<Vec<_>,_>>().map_err(error)?;
    Ok(json!({"rows":talents,"total":total,"page":page,"accountTotal":account_total,"latestRecords":latest,"sources":sources,"columns":talent_columns(db,platform,account_id)?}))
}
fn record_page(db: &Connection, request: &Value) -> Result<Value> {
    let mut filter = record_filter(request)?;
    let total = count(db,"records r",&filter)?;
    let (page,size) = paging(request,total)?;
    let limit = filter.bind(size);
    let offset = filter.bind((page-1)*size);
    let selection = "json_set(json_remove(r.payload,'$.response'),'$.talentUid',COALESCE(json_extract(r.payload,'$.talentUid'),(SELECT uid FROM talents t WHERE t.platform=r.platform AND t.account_id=r.account_id AND t.id=r.talent_id)))";
    let sql = format!("SELECT {selection} FROM records r WHERE {} ORDER BY r.time DESC,r.seq DESC LIMIT {limit} OFFSET {offset}",filter.sql());
    Ok(json!({"rows":rows(db,&sql,&filter.values)?,"total":total,"page":page}))
}
pub fn query(db: &Connection, request: &Value) -> Result<Value> {
    match required(request,"kind")? {
        "talents" => talent_page(db,request),
        "counts" => talent_counts(db),
        "talent_ids" | "invite_ids" => {
            let mut filter = talent_filter(request)?;
            if text(request,"kind") == "invite_ids" {
                filter.clauses.push("NOT EXISTS (SELECT 1 FROM records r WHERE r.platform=t.platform AND r.account_id=t.account_id AND r.talent_id=t.id)".into());
            }
            let mut statement = db.prepare(&format!("SELECT t.id FROM {} WHERE {} ORDER BY t.collected_at DESC,t.rowid DESC",talent_from(request),filter.sql())).map_err(error)?;
            let ids = statement.query_map(params_from_iter(&filter.values),|row| row.get::<_,String>(0)).map_err(error)?.collect::<std::result::Result<Vec<_>,_>>().map_err(error)?;
            Ok(json!(ids))
        }
        "talent_batch" => {
            required(request,"platform")?;
            required(request,"accountId")?;
            if !request["ids"].is_array() { return Err("达人选择范围无效".into()); }
            Ok(json!(rows(db,"SELECT t.payload FROM json_each(?1) selected JOIN talents t ON t.id=selected.value AND t.platform=?2 AND t.account_id=?3 ORDER BY CAST(selected.key AS INTEGER)",&[SqlValue::Text(request["ids"].to_string()),SqlValue::Text(text(request,"platform").into()),SqlValue::Text(text(request,"accountId").into())])?))
        }
        "history" => {
            required(request,"platform")?;
            required(request,"accountId")?;
            if !request["ids"].is_array() { return Err("达人选择范围无效".into()); }
            let selection = "json_object('id',r.id,'accountId',r.account_id,'platform',r.platform,'talentId',r.talent_id,'status',r.status,'time',r.time)";
            // Every existing record blocks another invitation, regardless of status or age.
            Ok(json!(rows(db,&format!("SELECT {selection} FROM records r WHERE r.platform=?1 AND r.account_id=?2 AND r.talent_id IN (SELECT value FROM json_each(?3)) ORDER BY r.time DESC,r.seq DESC"),&[SqlValue::Text(text(request,"platform").into()),SqlValue::Text(text(request,"accountId").into()),SqlValue::Text(request["ids"].to_string())])?))
        }
        "records" => record_page(db,request),
        "record" => {
            let raw: Option<String> = db.query_row("SELECT payload FROM records WHERE id=?1",[required(request,"id")?],|row| row.get(0)).optional().map_err(error)?;
            Ok(raw.map(decode).transpose()?.unwrap_or(Value::Null))
        }
        "dashboard" => dashboard(db,request),
        "logs" => {
            let mut filter = log_filter(request);
            let total = count(db,"logs l",&filter)?;
            let (page,size) = paging(request,total)?;
            let limit = filter.bind(size);
            let offset = filter.bind((page-1)*size);
            let sql = format!("SELECT l.payload FROM logs l WHERE {} ORDER BY l.time DESC,l.seq DESC LIMIT {limit} OFFSET {offset}",filter.sql());
            Ok(json!({"rows":rows(db,&sql,&filter.values)?,"total":total,"page":page}))
        }
        _ => Err("查询类型无效".into()),
    }
}
fn dashboard(db: &Connection, request: &Value) -> Result<Value> {
    let filter = record_filter(request)?;
    let mut counts = Map::new();
    let mut statement = db.prepare(&format!("SELECT r.status,count(*) FROM records r WHERE {} GROUP BY r.status",filter.sql())).map_err(error)?;
    let mut cursor = statement.query(params_from_iter(&filter.values)).map_err(error)?;
    while let Some(row) = cursor.next().map_err(error)? { counts.insert(row.get(0).map_err(error)?,json!(row.get::<_,i64>(1).map_err(error)?)); }
    let mut account_counts = Map::new();
    let mut statement = db.prepare(&format!("SELECT r.account_id,sum(r.status='success'),sum(r.status='review') FROM records r WHERE {} GROUP BY r.account_id",filter.sql())).map_err(error)?;
    let mut cursor = statement.query(params_from_iter(&filter.values)).map_err(error)?;
    while let Some(row) = cursor.next().map_err(error)? { account_counts.insert(row.get(0).map_err(error)?,json!({"success":row.get::<_,i64>(1).map_err(error)?,"review":row.get::<_,i64>(2).map_err(error)?})); }
    let mut talent_scope = Filter::default();
    for (field,column) in [("platform","t.platform"),("accountId","t.account_id")] {
        let value = text(request,field);
        if !value.is_empty() && value != "all" { talent_scope.equal(column,value); }
    }
    let ids = request["accountIds"].as_array().ok_or("统计账号范围无效")?;
    let binding = talent_scope.bind(json!(ids).to_string());
    talent_scope.clauses.push(format!("t.account_id IN (SELECT value FROM json_each({binding}))"));
    let since = required(request,"since")?;
    let binding = talent_scope.bind(since.to_owned());
    talent_scope.clauses.push(format!("t.collected_at>={binding}"));
    let collected = count(db,"talents t",&talent_scope)?;
    let mut dates = Vec::new();
    for bucket in array(&request["buckets"]) {
        let mut scope = record_filter(request)?;
        scope.clauses.push("r.status='success'".into());
        let start = scope.bind(required(bucket,"start")?.to_owned());
        let end = scope.bind(required(bucket,"end")?.to_owned());
        scope.clauses.push(format!("r.time>={start} AND r.time<{end}"));
        let mut date = json!({"day":required(bucket,"day")?,"kuaishou":0,"douyin":0});
        let mut statement = db.prepare(&format!("SELECT r.platform,count(*) FROM records r WHERE {} GROUP BY r.platform",scope.sql())).map_err(error)?;
        let mut cursor = statement.query(params_from_iter(&scope.values)).map_err(error)?;
        while let Some(row) = cursor.next().map_err(error)? {
            let platform: String = row.get(0).map_err(error)?;
            date[platform] = json!(row.get::<_,i64>(1).map_err(error)?);
        }
        dates.push(date);
    }
    Ok(json!({"collected":collected,"counts":counts,"accountCounts":account_counts,"dates":dates}))
}

pub fn delete(db: &mut Connection, request: &Value, running: &HashSet<String>) -> Result<Value> {
    let transaction = db.transaction().map_err(error)?;
    let (table,alias,filter,from) = match required(request,"kind")? {
        "talents" => ("talents","t",talent_filter(request)?,talent_from(request)),
        "records" => ("records","r",record_filter(request)?,"records r".into()),
        "logs" => ("logs","l",log_filter(request),"logs l".into()),
        _ => return Err("删除类型无效".into()),
    };
    if table != "logs" {
        let mut statement = transaction.prepare(&format!("SELECT DISTINCT {alias}.account_id FROM {from} WHERE {}",filter.sql())).map_err(error)?;
        let accounts = statement.query_map(params_from_iter(&filter.values),|row| row.get::<_,String>(0)).map_err(error)?.collect::<std::result::Result<Vec<_>,_>>().map_err(error)?;
        for account_id in accounts {
            let task_running: bool = transaction.query_row("SELECT EXISTS(SELECT 1 FROM tasks WHERE account_id=?1 AND json_extract(payload,'$.status')='running')",[&account_id],|row| row.get(0)).map_err(error)?;
            if running.contains(&account_id) || task_running { return Err("请先停止相关账号的任务，等待任务结束后再删除".into()); }
        }
    }
    let count = transaction.execute(&format!("DELETE FROM {table} WHERE rowid IN (SELECT {alias}.rowid FROM {from} WHERE {})",filter.sql()),params_from_iter(&filter.values)).map_err(error)?;
    transaction.commit().map_err(error)?;
    Ok(json!({"count":count}))
}

fn csv_row(writer: &mut impl Write, fields: &[String]) -> Result<()> {
    for (index,value) in fields.iter().enumerate() {
        if index > 0 { writer.write_all(b",").map_err(error)?; }
        write!(writer,"\"{}\"",value.replace('"',"\"\"")).map_err(error)?;
    }
    writer.write_all(b"\r\n").map_err(error)
}
fn field(value: &Value) -> String {
    match value { Value::Null => String::new(),Value::String(value) => value.clone(),Value::Array(values) => values.iter().map(field).collect::<Vec<_>>().join(" / "),_ => value.to_string() }
}
fn metric(value: &Value) -> String { if has_metric(value) { field(value).trim().to_owned() } else { String::new() } }
fn status_label(status: &str) -> &str {
    match status { "success"=>"已邀约","failed"=>"发送失败","review"=>"待核实","skipped"=>"已跳过","sending"=>"发送中",_=>"未邀约" }
}
fn metric_label(platform: &str, column: &str) -> &'static str {
    match (platform,column) { ("kuaishou","sales30d")=>"近30日合作销售额",("kuaishou","sales7d")=>"近7日合作销售额",(_,"settlement30d")=>"近30日结算额",_=>"近30日销售额" }
}
pub fn export(db: &Connection, request: &Value, writer: &mut impl Write) -> Result<usize> {
    match required(request,"kind")? {
        "talents" => {
            let filter = talent_filter(request)?;
            let columns = talent_columns(db,required(request,"platform")?,required(request,"accountId")?)?;
            let mut headers: Vec<String> = ["达人","达人ID","头像","最近邀约","粉丝数"].into_iter().map(str::to_owned).collect();
            headers.extend(columns.iter().map(|column| metric_label(text(request,"platform"),column).to_owned()));
            headers.extend(["来源".into(),"采集时间".into()]);
            writer.write_all(b"\xef\xbb\xbf").map_err(error)?;
            csv_row(writer,&headers)?;
            let mut statement = db.prepare(&format!("SELECT t.payload,latest.status,strftime('%m/%d %H:%M',t.collected_at,'localtime') FROM talents t {LATEST_JOIN} WHERE {} ORDER BY t.collected_at DESC,t.rowid DESC",filter.sql())).map_err(error)?;
            let mut cursor = statement.query(params_from_iter(&filter.values)).map_err(error)?;
            let mut count = 0;
            while let Some(row) = cursor.next().map_err(error)? {
                let talent = decode(row.get(0).map_err(error)?)?;
                let status: Option<String> = row.get(1).map_err(error)?;
                let time: Option<String> = row.get(2).map_err(error)?;
                let mut fields = vec![field(&talent["name"]),field(&talent["id"]),field(&talent["avatarUrl"]),status_label(status.as_deref().unwrap_or("")).into(),metric(&talent["fans"])];
                fields.extend(columns.iter().map(|column| metric(&talent[*column])));
                fields.extend([field(&talent["source"]),time.unwrap_or_default()]);
                csv_row(writer,&fields)?;
                count += 1;
            }
            Ok(count)
        }
        "records" => {
            let filter = record_filter(request)?;
            writer.write_all(b"\xef\xbb\xbf").map_err(error)?;
            csv_row(writer,&["时间","平台","账号","达人","达人ID","状态","商品ID","话术","备注"].map(str::to_owned))?;
            // Resolve the account JSON once per export, not once for every history row.
            let mut accounts = HashMap::new();
            {
                let mut statement = db.prepare("SELECT json_extract(a.value,'$.id'),json_extract(a.value,'$.name') FROM metadata m,json_each(m.payload) a WHERE m.key='accounts'").map_err(error)?;
                let mut cursor = statement.query([]).map_err(error)?;
                while let Some(row) = cursor.next().map_err(error)? {
                    if let Some(id) = row.get::<_,Option<String>>(0).map_err(error)? {
                        accounts.entry(id).or_insert(row.get::<_,Option<String>>(1).map_err(error)?);
                    }
                }
            }
            let mut statement = db.prepare(&format!("SELECT r.payload,strftime('%m/%d %H:%M',r.time,'localtime') FROM records r WHERE {} ORDER BY r.time DESC,r.seq DESC",filter.sql())).map_err(error)?;
            let mut cursor = statement.query(params_from_iter(&filter.values)).map_err(error)?;
            let mut count = 0;
            while let Some(row) = cursor.next().map_err(error)? {
                let record = decode(row.get(0).map_err(error)?)?;
                let time: Option<String> = row.get(1).map_err(error)?;
                let account = accounts.get(text(&record,"accountId")).and_then(Option::as_deref).unwrap_or("已移除账号");
                let platform = if text(&record,"platform") == "kuaishou" { "快手" } else { "抖音" };
                csv_row(writer,&[time.unwrap_or_default(),platform.into(),account.into(),field(&record["name"]),field(&record["talentId"]),status_label(text(&record,"status")).into(),field(&record["products"]),field(&record["message"]),field(&record["note"])])?;
                count += 1;
            }
            Ok(count)
        }
        "logs" => {
            let filter = log_filter(request);
            let mut statement = db.prepare(&format!("SELECT l.payload FROM logs l WHERE {} ORDER BY l.time,l.seq",filter.sql())).map_err(error)?;
            let mut cursor = statement.query(params_from_iter(&filter.values)).map_err(error)?;
            let mut count = 0;
            while let Some(row) = cursor.next().map_err(error)? {
                let payload: String = row.get(0).map_err(error)?;
                writeln!(writer,"{payload}").map_err(error)?;
                count += 1;
            }
            Ok(count)
        }
        _ => Err("导出类型无效".into()),
    }
}

#[cfg(test)]
#[path = "database_tests.rs"]
mod tests;
