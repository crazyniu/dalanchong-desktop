//! AI module map
//! Purpose: exercise the shop browser's CDP lifecycle against installed macOS Chrome.
//! Entry: the named ignored test is run only for an explicitly requested integration check.
//! Flow: pin the extension in a disposable profile, load it, close its pages, reopen,
//! then verify shop identity storage and numbered Dock PNGs using production helpers.
//! Ownership: cleanup owns only the Child and UUID directory created here.
//! Invariants: no platform pages, real accounts, installed Chrome files or real
//! keychain data are touched; no Tauri authorization commands are bypassed.

use super::*;

struct IsolatedChrome {
    directory: PathBuf,
    child: Option<Child>,
}

impl Drop for IsolatedChrome {
    fn drop(&mut self) {
        if let Some(child) = self.child.as_mut() {
            if child.try_wait().ok().flatten().is_none() {
                if let Ok(Some(mut socket)) = connect(&self.directory) {
                    let _ = call(&mut socket, "Browser.close", json!({}));
                }
                let deadline = Instant::now() + Duration::from_secs(5);
                while child.try_wait().ok().flatten().is_none() && Instant::now() < deadline {
                    std::thread::sleep(Duration::from_millis(100));
                }
                if child.try_wait().ok().flatten().is_none() { let _ = child.kill(); }
                let _ = child.wait();
            }
        }
        let _ = fs::remove_dir_all(&self.directory);
    }
}

fn pages(socket: &mut WebSocket<TcpStream>) -> Vec<String> {
    call(socket, "Target.getTargets", json!({})).unwrap()["targetInfos"]
        .as_array().unwrap().iter()
        .filter(|target| target["type"] == "page")
        .map(|target| target["targetId"].as_str().unwrap().to_owned()).collect()
}

fn shop_identity(socket: &mut WebSocket<TcpStream>, extension_id: &str) -> Value {
    let scope = format!("chrome-extension://{extension_id}/");
    let targets = call(socket, "Target.getTargets", json!({})).unwrap();
    let worker = targets["targetInfos"].as_array().unwrap().iter().find(|target| {
        target["type"] == "service_worker"
            && target["url"].as_str().unwrap_or("").starts_with(&scope)
    }).expect("extension worker is running");
    let attached = call(socket, "Target.attachToTarget", json!({
        "targetId": worker["targetId"], "flatten": true
    })).unwrap();
    let session = attached["sessionId"].as_str().unwrap();
    let stored = call_session(socket, Some(session), "Extensions.getStorageItems", json!({
        "id": extension_id, "storageArea": "local", "keys": ["shopIdentity"]
    })).unwrap();
    call(socket, "Target.detachFromTarget", json!({"sessionId":session})).unwrap();
    stored["data"]["shopIdentity"].clone()
}

#[test]
#[ignore = "Starts system Chrome with a disposable profile; run this named test explicitly"]
fn isolated_shop_browser_reopens_after_last_window_close() {
    let mut browser = IsolatedChrome {
        directory: std::env::temp_dir().join(format!("dalanchong-chrome-integration-{}", Uuid::new_v4())),
        child: None,
    };
    fs::create_dir_all(browser.directory.join("Default")).unwrap();
    fs::write(browser.directory.join("Default/Preferences"), b"{}").unwrap();
    let extension = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../browser-extension").canonicalize().unwrap();
    browser_extension::pin(&browser.directory, &extension).unwrap();
    let extension_id = browser_extension::extension_id(&extension).unwrap();
    let mut account = ChromeAccount {
        id: Uuid::new_v4(), number: 17, name: "隔离 CDP 店铺".into(),
        window_scale: 80, last_opened_at: None,
    };
    let bounds = WindowBounds { left: 60, top: 60, width: 900, height: 650 };
    browser.child = Some(Command::new("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
        .arg(format!("--user-data-dir={}", browser.directory.display()))
        .args(["--remote-debugging-port=0", "--remote-debugging-address=127.0.0.1",
            "--no-first-run", "--no-default-browser-check", "--disable-background-mode",
            "--use-mock-keychain", "--disable-background-networking", "--disable-component-update",
            "--disable-sync", "about:blank"])
        .stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null()).spawn().unwrap());
    let deadline = Instant::now() + Duration::from_secs(20);
    let mut socket = loop {
        assert!(browser.child.as_mut().unwrap().try_wait().unwrap().is_none(), "isolated Chrome exited during startup");
        if let Ok(Some(mut socket)) = connect(&browser.directory) {
            if page_target(&mut socket).unwrap().is_some() { break socket; }
        }
        assert!(Instant::now() < deadline, "isolated Chrome startup timed out");
        std::thread::sleep(Duration::from_millis(100));
    };

    activate(&mut socket, &bounds).unwrap();
    load_video_extension(&mut socket, &extension, &browser.directory, &account).unwrap();
    set_dock_tile(&mut socket, &account).unwrap();
    assert_eq!(shop_identity(&mut socket, &extension_id), json!({"number":17,"name":"隔离 CDP 店铺"}));
    let initial_pages = pages(&mut socket);
    assert_eq!(initial_pages.len(), 1);
    activate(&mut socket, &bounds).unwrap();
    load_video_extension(&mut socket, &extension, &browser.directory, &account).unwrap();
    assert_eq!(pages(&mut socket), initial_pages, "repeat open must reuse the page");

    for target in initial_pages {
        call(&mut socket, "Target.closeTarget", json!({"targetId":target})).unwrap();
    }
    let deadline = Instant::now() + Duration::from_secs(5);
    while !pages(&mut socket).is_empty() {
        assert!(Instant::now() < deadline, "isolated Chrome pages did not close");
        std::thread::sleep(Duration::from_millis(100));
    }
    assert!(browser.child.as_mut().unwrap().try_wait().unwrap().is_none(), "Chrome must remain alive after its last page closes");
    activate(&mut socket, &bounds).unwrap();
    account.number = 108;
    account.name = "恢复后的隔离店铺".into();
    load_video_extension(&mut socket, &extension, &browser.directory, &account).unwrap();
    set_dock_tile(&mut socket, &account).unwrap();
    assert_eq!(pages(&mut socket).len(), 1);
    assert_eq!(shop_identity(&mut socket, &extension_id), json!({"number":108,"name":"恢复后的隔离店铺"}));
    let icon = crate::chrome_dock::icon(account.number).unwrap();
    assert_eq!(&icon[..8], b"\x89PNG\r\n\x1a\n");
    assert_eq!(u32::from_be_bytes(icon[16..20].try_into().unwrap()), 512);
    assert_eq!(u32::from_be_bytes(icon[20..24].try_into().unwrap()), 512);
    assert_ne!(icon, crate::chrome_dock::icon(17).unwrap(), "shop number must change the PNG");
    eprintln!("isolated CDP passed: extension load, page reuse, last-window reopen, shop identity, numbered Dock PNG");
}
