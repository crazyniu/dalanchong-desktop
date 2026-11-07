//! AI module map
//! Purpose: capture an account WebView's visible page for the main UI's modal backdrop.
//! Entry: browser::browser_snapshot validates the caller/account and invokes capture.
//! Flow: Tauri schedules native capture on the UI thread; WKWebView or WebView2 returns
//! JPEG bytes through a one-shot channel, then capture encodes directly into the final
//! in-memory data URL buffer instead of copying an intermediate base64 string.
//! AppKit resolves WebKit's image through CGImage before JPEG encoding, avoiding a TIFF
//! round trip without assuming WebKit exposes NSBitmapImageRep representations.
//! Invariants: capture the WebView only, never the screen or another window. Do not write
//! images to disk, navigate, hide the view, or retain snapshots after returning to the UI.
//! Native callback objects own their capture buffers until completion; native failures
//! propagate to the caller without retries or substitute images.

use base64::{engine::general_purpose::STANDARD, Engine};
use tauri::Webview;

pub async fn capture(view: &Webview) -> Result<String, String> {
    let jpeg = capture_jpeg(view).await?;
    let prefix = "data:image/jpeg;base64,";
    let mut data_url = String::with_capacity(prefix.len() + jpeg.len().div_ceil(3) * 4);
    data_url.push_str(prefix);
    STANDARD.encode_string(jpeg, &mut data_url);
    Ok(data_url)
}

#[cfg(target_os = "macos")]
async fn capture_jpeg(view: &Webview) -> Result<Vec<u8>, String> {
    use std::cell::RefCell;

    use block2::RcBlock;
    use objc2::AnyThread;
    use objc2_app_kit::{
        NSBitmapImageFileType, NSBitmapImageRep, NSImage, NSImageCompressionFactor,
    };
    use objc2_foundation::{NSDictionary, NSError, NSNumber};
    use objc2_web_kit::WKWebView;

    let (sender, receiver) = tokio::sync::oneshot::channel();
    view.with_webview(move |platform| {
        // WKWebView's completion block is Fn, while a one-shot sender is consumed once.
        let sender = RefCell::new(Some(sender));
        let completion = RcBlock::new(move |image: *mut NSImage, error: *mut NSError| {
            let result = (|| {
                // SAFETY: WebKit supplies nullable callback objects valid for this callback.
                // They are borrowed only here; retained JPEG data owns its own storage.
                let image = unsafe {
                    if let Some(error) = error.as_ref() {
                        return Err(error.localizedDescription().to_string());
                    }
                    image.as_ref().ok_or("网页画面为空")?
                };
                let quality = NSNumber::numberWithDouble(0.85);
                // WebKit can return non-bitmap representations, which the array encoder
                // cannot serialize. Resolve their pixels without a TIFF round trip.
                // SAFETY: null rectangle/context/hints request the image's natural size;
                // the returned CGImage is retained through bitmap construction.
                let pixels = unsafe {
                    image.CGImageForProposedRect_context_hints(std::ptr::null_mut(), None, None)
                }
                .ok_or("无法读取网页画面")?;
                let bitmap = NSBitmapImageRep::initWithCGImage(NSBitmapImageRep::alloc(), &pixels);
                // SAFETY: the dictionary pairs AppKit's compression key with NSNumber;
                // bitmap retains its image data until JPEG encoding has completed.
                let jpeg = unsafe {
                    bitmap.representationUsingType_properties(
                        NSBitmapImageFileType::JPEG,
                        &NSDictionary::<_>::from_slices(
                            &[NSImageCompressionFactor],
                            &[&*quality],
                        ),
                    )
                }
                .ok_or("无法生成网页画面")?;
                Ok(jpeg.to_vec())
            })();
            if let Some(sender) = sender.borrow_mut().take() {
                let _ = sender.send(result);
            }
        });
        // SAFETY: Tauri's UI-thread callback exposes the live WKWebView pointer. WebKit
        // copies the completion block and supplies a snapshot of the current view bounds.
        unsafe {
            let webview = &*platform.inner().cast::<WKWebView>();
            webview.takeSnapshotWithConfiguration_completionHandler(None, &completion);
        }
    })
    .map_err(|error| error.to_string())?;
    receiver.await.map_err(|_| "网页画面获取已取消".to_string())?
}

#[cfg(target_os = "windows")]
async fn capture_jpeg(view: &Webview) -> Result<Vec<u8>, String> {
    use std::{cell::RefCell, rc::Rc};

    use webview2_com::{
        CapturePreviewCompletedHandler,
        Microsoft::Web::WebView2::Win32::COREWEBVIEW2_CAPTURE_PREVIEW_IMAGE_FORMAT_JPEG,
    };
    use windows::Win32::{
        Foundation::HGLOBAL,
        System::Com::StructuredStorage::CreateStreamOnHGlobal,
    };

    let (sender, receiver) = tokio::sync::oneshot::channel();
    view.with_webview(move |platform| {
        // Initiation can fail before the native completion callback runs. Both paths
        // share the same sender and release it exactly once on this UI thread.
        let sender = Rc::new(RefCell::new(Some(sender)));
        let started = (|| -> Result<(), String> {
            // SAFETY: a null HGLOBAL asks COM to allocate the stream buffer; true makes
            // the last IStream reference free it. Tauri supplies the live UI-thread COM
            // controller, and all stream/controller calls stay on that same thread.
            let (stream, webview) = unsafe {
                (
                    CreateStreamOnHGlobal(HGLOBAL::default(), true)
                        .map_err(|error| error.to_string())?,
                    platform.controller().CoreWebView2()
                        .map_err(|error| error.to_string())?,
                )
            };
            let completed_stream = stream.clone();
            let completed_sender = sender.clone();
            let completion = CapturePreviewCompletedHandler::create(Box::new(move |result| {
                let jpeg = result
                    .map_err(|error| error.to_string())
                    .and_then(|()| read_image_stream(&completed_stream));
                if let Some(sender) = completed_sender.borrow_mut().take() {
                    let _ = sender.send(jpeg);
                }
                Ok(())
            }));
            // SAFETY: WebView2 retains the stream and callback through capture. The
            // callback owns an additional stream reference until its bytes are copied.
            unsafe {
                webview.CapturePreview(
                    COREWEBVIEW2_CAPTURE_PREVIEW_IMAGE_FORMAT_JPEG,
                    &stream,
                    &completion,
                )
            }
            .map_err(|error| error.to_string())
        })();
        if let Err(error) = started {
            if let Some(sender) = sender.borrow_mut().take() {
                let _ = sender.send(Err(error));
            }
        }
    })
    .map_err(|error| error.to_string())?;
    receiver.await.map_err(|_| "网页画面获取已取消".to_string())?
}

#[cfg(target_os = "windows")]
fn read_image_stream(stream: &windows::Win32::System::Com::IStream) -> Result<Vec<u8>, String> {
    use windows::Win32::System::Com::{STATFLAG_NONAME, STATSTG, STREAM_SEEK_SET};

    let mut stat = STATSTG::default();
    // SAFETY: the retained in-memory stream is complete and used on its COM UI thread.
    // Stat writes to a live struct; NONAME avoids allocating a name that needs freeing.
    unsafe {
        stream.Stat(&mut stat, STATFLAG_NONAME)
            .map_err(|error| error.to_string())?;
        stream.Seek(0, STREAM_SEEK_SET, None)
            .map_err(|error| error.to_string())?;
    }
    let length = u32::try_from(stat.cbSize).map_err(|_| "网页画面尺寸过大")?;
    let mut image = vec![0; length as usize];
    let mut read = 0;
    // SAFETY: the vector has length bytes of writable storage; COM receives exactly
    // that capacity and a live output counter. Reject partial reads instead of encoding
    // an incomplete image; the stream releases its native allocation after this callback.
    unsafe {
        stream.Read(image.as_mut_ptr().cast(), length, Some(&mut read))
            .ok()
            .map_err(|error| error.to_string())?;
    }
    if read != length {
        return Err("网页画面数据不完整".into());
    }
    Ok(image)
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
async fn capture_jpeg(_view: &Webview) -> Result<Vec<u8>, String> {
    Err("当前系统不支持网页画面获取".into())
}
