//! AI module map
//! Purpose: check database migration preservation, bounded queries, and transaction safety.
//! Entry: cargo test --lib database::tests, only when explicitly requested by the user.
//! Flow: synthetic legacy files and public database operations run in unique temporary
//! directories; each fixture owns and removes only its directory after connections drop.
//! Invariants: never inspect live accounts, license caches, WebViews, or platform APIs.
//! Related: database.rs owns production SQL; storage.rs owns IPC and authorization checks.

use super::*;
use std::path::PathBuf;

struct Fixture(PathBuf);
impl Fixture {
    fn new() -> Self {
        let path = std::env::temp_dir().join(format!("dalanchong-database-test-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&path).unwrap();
        Self(path)
    }
    fn write(&self, name: &str, value: &Value) {
        fs::write(self.0.join(name), value.to_string()).unwrap();
    }
}
impl Drop for Fixture {
    fn drop(&mut self) { fs::remove_dir_all(&self.0).unwrap(); }
}
fn talent(id: &str, account: &str) -> Value {
    json!({"id":id,"uid":format!("uid-{id}"),"platform":"kuaishou","sourceAccountId":account,
        "name":format!("达人 {id}"),"fans":100,"source":"达人广场","collectedAt":"2026-11-07T01:00:00Z"})
}
fn record(id: &str, account: &str, talent_id: &str, status: &str) -> Value {
    json!({"id":id,"platform":"kuaishou","accountId":account,"talentId":talent_id,
        "name":format!("达人 {talent_id}"),"time":"2026-11-07T02:00:00Z","status":status,
        "response":{"body":"synthetic response"}})
}

#[test]
fn migration_preserves_history_and_recovers_interrupted_sends() {
    let fixture = Fixture::new();
    let mut first = talent("historical-a", "account-a");
    let mut second = talent("historical-b", "account-a");
    first["uid"] = json!("same-uid");
    second["uid"] = json!("same-uid");
    let task_log = json!({"accountId":"account-a","platform":"kuaishou",
        "time":"2026-11-07T02:00:00Z","level":"error","message":"synthetic failure",
        "response":{"body":"saved detail"}});
    let mut global_a = task_log.clone();
    global_a["id"] = json!("global-a");
    let mut global_b = task_log.clone();
    global_b["id"] = json!("global-b");
    let runtime = json!({"accounts":[{"id":"account-a","name":"账号 A"}],
        "talents":[first,second],"records":[record("in-flight","account-a","historical-a","sending")],
        "tasks":{
            "account-a":{"accountId":"account-a","startedAt":"task-a","kind":"collect",
                "logs":[task_log,task_log]},
            "removed":{"accountId":"removed","startedAt":"task-removed","kind":"collect"}},
        "logs":[global_a]});
    fixture.write("runtime.json", &runtime);
    fixture.write("errors.ndjson", &global_b);
    {
        let mut db = open(&fixture.0).unwrap();
        let ids = query(&db, &json!({"kind":"talent_ids","platform":"kuaishou","accountId":"account-a"})).unwrap();
        assert_eq!(ids, json!(["historical-b","historical-a"]));
        let state = load(&mut db).unwrap();
        let logs = state["tasks"]["account-a:collect"]["logs"].as_array().unwrap();
        assert_eq!(logs.len(), 2);
        assert_eq!(logs.iter().map(|entry| text(entry,"id")).collect::<Vec<_>>(), ["global-a","global-b"]);
        assert!(state["tasks"].get("removed:collect").is_none());
        assert_eq!(db.query_row("SELECT count(*) FROM tasks", [], |row| row.get::<_,i64>(0)).unwrap(), 2);
        let interrupted = query(&db, &json!({"kind":"record","id":"in-flight"})).unwrap();
        assert_eq!(interrupted["status"], "review");
        assert_eq!(interrupted["response"]["body"], "synthetic response");
    }
    assert_eq!(fs::read_to_string(fixture.0.join("runtime.json")).unwrap(), runtime.to_string());
    assert_eq!(fs::read_to_string(fixture.0.join("errors.ndjson")).unwrap(), global_b.to_string());
    let db = open(&fixture.0).unwrap();
    assert_eq!(db.query_row("SELECT count(*) FROM logs", [], |row| row.get::<_,i64>(0)).unwrap(), 2);
    assert_eq!(db.query_row("SELECT status FROM records WHERE id='in-flight'", [], |row| row.get::<_,String>(0)).unwrap(), "review");
}

#[test]
fn pages_and_exports_keep_account_scope_and_on_demand_responses() {
    let fixture = Fixture::new();
    let mut db = open(&fixture.0).unwrap();
    let mut talents: Vec<Value> = (0..12).map(|index| talent(&format!("talent-{index:02}"), "account-a")).collect();
    talents.push(talent("talent-00", "account-b"));
    save(&mut db, &json!({"preferences":{"accounts":[{"id":"account-a","name":"账号,\"A\""}]},
        "talents":talents,"records":[record("result-a","account-a","talent-11","success"),
            record("result-b","account-b","talent-00","failed")]})).unwrap();
    let page = query(&db, &json!({"kind":"talents","platform":"kuaishou","accountId":"account-a","pageSize":10})).unwrap();
    assert_eq!(page["total"], 12);
    assert_eq!(page["rows"].as_array().unwrap().len(), 10);
    assert_eq!(page["rows"][0]["id"], "talent-11");
    assert!(page["latestRecords"][0].get("response").is_none());
    let last = query(&db, &json!({"kind":"talents","platform":"kuaishou","accountId":"account-a","page":2,"pageSize":10})).unwrap();
    assert_eq!(last["rows"].as_array().unwrap().len(), 2);
    let success = query(&db, &json!({"kind":"talent_ids","platform":"kuaishou","accountId":"account-a","filters":{"status":"success"}})).unwrap();
    assert_eq!(success, json!(["talent-11"]));
    let mut recollected = talent("new-platform-id", "account-a");
    recollected["uid"] = json!("uid-talent-11");
    let saved = save(&mut db, &json!({"talents":[recollected]})).unwrap();
    assert_eq!(saved["added"], 0);
    assert_eq!(saved["updatedIds"], json!(["talent-11"]));
    let records = query(&db, &json!({"kind":"records","accountId":"account-a"})).unwrap();
    assert_eq!(records["total"], 1);
    assert!(records["rows"][0].get("response").is_none());
    assert_eq!(query(&db, &json!({"kind":"record","id":"result-a"})).unwrap()["response"]["body"], "synthetic response");
    let mut csv = Vec::new();
    assert_eq!(export(&db, &json!({"kind":"records","accountId":"account-a"}), &mut csv).unwrap(), 1);
    let csv = String::from_utf8(csv).unwrap();
    assert!(csv.starts_with('\u{feff}'));
    assert!(csv.contains("\"账号,\"\"A\"\"\""));
    assert!(csv.contains("talent-11"));
    assert!(!csv.contains("talent-00"));
}

#[test]
fn failed_transactions_and_running_task_deletions_preserve_data() {
    let fixture = Fixture::new();
    fixture.write("runtime.json", &json!({"talents":[talent("imported","account-a")],"records":[{"id":"invalid"}]}));
    assert!(open(&fixture.0).is_err());
    fixture.write("runtime.json", &json!({"talents":[talent("imported","account-a")]}));
    let mut db = open(&fixture.0).unwrap();
    assert_eq!(talent_counts(&db).unwrap(), json!({"account-a":1}));
    let failure = save(&mut db, &json!({"preferences":{"accounts":[{"id":"must-rollback"}]},
        "talents":[talent("must-rollback","account-a")],"records":[{"id":"invalid"}]}));
    assert!(failure.is_err());
    assert_eq!(talent_counts(&db).unwrap(), json!({"account-a":1}));
    assert!(account(&db, "must-rollback").is_err());
    save(&mut db, &json!({"tasks":{"account-a:collect":{"accountId":"account-a","kind":"collect","status":"running"}},
        "talents":[talent("keep","account-a"),talent("imported","account-b")]})).unwrap();
    let selection = json!({"kind":"talents","platform":"kuaishou","accountId":"account-a","ids":["imported"]});
    assert!(delete(&mut db, &selection, &HashSet::new()).is_err());
    assert_eq!(talent_counts(&db).unwrap(), json!({"account-a":2,"account-b":1}));
    save(&mut db, &json!({"tasks":{"account-a:collect":{"accountId":"account-a","kind":"collect","status":"stopped"}}})).unwrap();
    assert_eq!(delete(&mut db, &selection, &HashSet::new()).unwrap()["count"], 1);
    assert_eq!(talent_counts(&db).unwrap(), json!({"account-a":1,"account-b":1}));
}
