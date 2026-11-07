//! AI module map
//! Purpose: native executable entry point; delegate all application setup to lib.rs.
//! Entry: main() invokes dalanchong_lib::run().
//! Invariant: the Windows subsystem attribute suppresses a console in release builds;
//! keep startup, service registration, and shutdown logic in the library entry point.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    dalanchong_lib::run();
}
