//! AI module map
//! Purpose: derive a stable, application-scoped hardware device code for license.rs.
//! Entry: id() returns a 32-character lowercase hexadecimal fingerprint or None.
//! Flow: read IOPlatformUUID on macOS or SMBIOS Type 1 on Windows, reject placeholder
//! UUIDs, hash the fixed domain/platform/UUID bytes with SHA-256, format the complete
//! hw-v1-<digest> intermediate string, then MD5 that string for the final device code.
//! Invariants: raw UUIDs remain local to this module; no cache, environment override,
//! random fallback, or network input may choose identity. Domain, byte order, platform
//! tag, intermediate prefix, and final digest rule are persistent binding protocol.
//! The final digest is an identifier, not a signature or proof of trusted hardware.
//! Ownership: FFI must release native objects and parse only valid returned ranges;
//! unsupported platforms cannot obtain an authorized identity.

use md5::Md5;
use sha2::{Digest, Sha256};
use uuid::Uuid;

// Keep the fixed domain and hw-v1 prefix in the MD5 input; changing them rekeys devices.
const FINGERPRINT_DOMAIN: &[u8] = b"dalanchong:hardware:v1\0";

/// Derive identity from system hardware; return None when unavailable, never a cached or UI-supplied fallback.
pub fn id() -> Option<String> {
    let hardware = hardware_uuid()?;
    let bytes = hardware.as_bytes();
    if bytes.iter().all(|byte| *byte == 0) || bytes.iter().all(|byte| *byte == 0xff) {
        return None;
    }
    let mut hash = Sha256::new();
    hash.update(FINGERPRINT_DOMAIN);
    hash.update(std::env::consts::OS.as_bytes());
    hash.update([0]);
    hash.update(bytes);
    let hardware_code = format!("hw-v1-{:x}", hash.finalize());
    Some(format!("{:x}", Md5::digest(hardware_code.as_bytes())))
}

#[cfg(target_os = "macos")]
fn hardware_uuid() -> Option<Uuid> {
    use core_foundation::{
        base::{CFAllocatorRef, CFType, CFTypeRef, TCFType},
        dictionary::{CFDictionaryRef, CFMutableDictionaryRef},
        string::{CFString, CFStringRef},
    };
    use std::{ffi::c_char, ptr};

    #[link(name = "IOKit", kind = "framework")]
    extern "C" {
        fn IOServiceMatching(name: *const c_char) -> CFMutableDictionaryRef;
        fn IOServiceGetMatchingService(port: u32, matching: CFDictionaryRef) -> u32;
        fn IORegistryEntryCreateCFProperty(
            entry: u32,
            key: CFStringRef,
            allocator: CFAllocatorRef,
            options: u32,
        ) -> CFTypeRef;
        fn IOObjectRelease(object: u32) -> i32;
    }

    // SAFETY: The class name is NUL-terminated. IOKit consumes the matching dictionary; the service is released after reading.
    // CFType takes Create-rule ownership after null checks; downcast verifies the CFString type before reading.
    let property = unsafe {
        let matching = IOServiceMatching(c"IOPlatformExpertDevice".as_ptr());
        if matching.is_null() {
            return None;
        }
        let service = IOServiceGetMatchingService(0, matching);
        if service == 0 {
            return None;
        }
        let key = CFString::new("IOPlatformUUID");
        let property =
            IORegistryEntryCreateCFProperty(service, key.as_concrete_TypeRef(), ptr::null(), 0);
        IOObjectRelease(service);
        if property.is_null() {
            return None;
        }
        CFType::wrap_under_create_rule(property)
    };
    let value = property.downcast::<CFString>()?;
    Uuid::parse_str(&value.to_string()).ok()
}

#[cfg(target_os = "windows")]
fn hardware_uuid() -> Option<Uuid> {
    use windows_sys::Win32::System::SystemInformation::{GetSystemFirmwareTable, RSMB};

    // SAFETY: A null buffer with length zero queries the required size without writing memory.
    let size = unsafe { GetSystemFirmwareTable(RSMB, 0, std::ptr::null_mut(), 0) };
    if size < 8 {
        return None;
    }
    let mut data = vec![0u8; size as usize];
    // SAFETY: The buffer owns size bytes and stays in place during the call; parse only a complete response.
    let written = unsafe { GetSystemFirmwareTable(RSMB, 0, data.as_mut_ptr(), size) };
    if written != size {
        return None;
    }
    // RawSMBIOSData has an 8-byte version/length header before its SMBIOS records.
    let table_length = u32::from_le_bytes(data.get(4..8)?.try_into().ok()?) as usize;
    let mut table = data.get(8..)?.get(..table_length)?;
    while table.len() >= 4 {
        let record_type = table[0];
        let record_length = table[1] as usize;
        if record_length < 4 || record_type == 127 {
            return None;
        }
        let record = table.get(..record_length)?;
        if record_type == 1 {
            let bytes: [u8; 16] = record.get(8..24)?.try_into().ok()?;
            // Type 1 stores its UUID at 8..24; SMBIOS 2.6+ uses little endian for the first three fields.
            return Some(if (data[1], data[2]) >= (2, 6) {
                Uuid::from_bytes_le(bytes)
            } else {
                Uuid::from_bytes(bytes)
            });
        }
        // Records include a double-NUL-terminated string area after their fixed-length fields.
        let strings = table.get(record_length..)?;
        let strings_end = strings.windows(2).position(|pair| pair == [0, 0])?;
        table = strings.get(strings_end + 2..)?;
    }
    None
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn hardware_uuid() -> Option<Uuid> {
    None
}
