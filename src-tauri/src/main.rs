//! AI module map
//! Purpose: native executable entry point; delegate all application setup to lib.rs.
//! Entry: Cargo's dalanchong binary invokes dalanchong_lib::run(); the macOS Cargo
//! runner places development launches in 大懒虫.app with an ASCII executable name.
//! Info.plist supplies Chinese display metadata for development and packaged apps.
//! Invariant: the Windows subsystem attribute suppresses a console in release builds;
//! keep startup, service registration, and shutdown logic in the library entry point.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    dalanchong_lib::run();
}
