//! AI module map
//! Purpose: compose the shop number into a macOS browser's in-memory Dock PNG.
//! Entry: chrome::set_dock_tile calls icon before sending Browser.setDockTile.
//! Flow: read the bundled rounded macOS bug tile as NSImage, draw it into a fresh
//! 512px premultiplied RGBA bitmap, overlay a red/white shop badge, and return PNG
//! bytes. Transparent outer margins, source assets and Chrome's bundle stay intact.
//! Ownership: all AppKit objects belong to this call on the browser worker thread.
//! These bitmap, graphics-context, path and font APIs are not main-thread-only;
//! the current graphics context is thread-local and restored before PNG encoding.
//! Boundary: no windows, external commands, files, caches or retries are involved.

use objc2::{rc::autoreleasepool, runtime::AnyObject, AnyThread};
use objc2_app_kit::{
    NSBezierPath, NSBitmapFormat, NSBitmapImageFileType, NSBitmapImageRep, NSColor,
    NSCompositingOperation, NSDeviceRGBColorSpace, NSFont, NSFontAttributeName,
    NSForegroundColorAttributeName, NSGraphicsContext, NSImage, NSRectFillUsingOperation,
    NSStringDrawing,
};
use objc2_foundation::{NSData, NSDictionary, NSMutableDictionary, NSPoint, NSRect, NSSize, NSString};

pub fn icon(number: u32) -> Result<Vec<u8>, String> {
    autoreleasepool(|_| {
        let data = NSData::with_bytes(include_bytes!("../../assets/icons/app.iconset/icon_512x512.png"));
        let source = NSImage::initWithData(NSImage::alloc(), &data)
            .ok_or("无法读取店铺浏览器图标")?;
        // Decoded PNG representations can have a non-premultiplied layout that
        // NSGraphicsContext cannot draw into. Own a separate drawable RGBA target.
        // SAFETY: null planes ask AppKit to allocate and own all pixel storage.
        // 512 pixels × 4 eight-bit samples require 2048 bytes per row and 32 bits
        // per pixel. Empty format flags select premultiplied, alpha-last RGBA;
        // NSDeviceRGBColorSpace is AppKit's static RGB color-space name.
        let bitmap = unsafe {
            NSBitmapImageRep::initWithBitmapDataPlanes_pixelsWide_pixelsHigh_bitsPerSample_samplesPerPixel_hasAlpha_isPlanar_colorSpaceName_bitmapFormat_bytesPerRow_bitsPerPixel(
                NSBitmapImageRep::alloc(), std::ptr::null_mut(),
                512, 512, 8, 4, true, false, NSDeviceRGBColorSpace,
                NSBitmapFormat::empty(), 2048, 32,
            )
        }.ok_or("无法创建店铺浏览器图标画布")?;
        bitmap.setSize(NSSize::new(512.0, 512.0));
        let context = NSGraphicsContext::graphicsContextWithBitmapImageRep(&bitmap)
            .ok_or("无法绘制店铺浏览器图标")?;
        let text = NSString::from_str(&number.to_string());
        let font = NSFont::boldSystemFontOfSize(100.0);
        let white = NSColor::whiteColor();
        // SAFETY: AppKit's static attribute keys are paired with the required
        // NSFont/NSColor objects. The dictionary retains both for text drawing.
        let attributes = unsafe {
            NSMutableDictionary::<NSString, AnyObject>::from_slices(
                &[NSFontAttributeName, NSForegroundColorAttributeName],
                &[&*font, &*white],
            )
        };
        // SAFETY: the attributes dictionary contains correctly typed AppKit text
        // attributes. Measure the real digits so multi-digit numbers fit the badge.
        let measured = unsafe { text.sizeWithAttributes(Some(&attributes)) };
        let scale = (112.0 / measured.width).min(112.0 / measured.height).min(1.0);
        let font = NSFont::boldSystemFontOfSize(100.0 * scale);
        // SAFETY: the static font key is updated with another NSFont instance.
        unsafe { attributes.insert(NSFontAttributeName, &*font) };
        // SAFETY: the same valid attributes now contain the fitted font.
        let measured = unsafe { text.sizeWithAttributes(Some(&attributes)) };

        NSGraphicsContext::saveGraphicsState_class();
        NSGraphicsContext::setCurrentContext(Some(&context));
        let canvas = NSRect::new(NSPoint::new(0.0, 0.0), NSSize::new(512.0, 512.0));
        NSRectFillUsingOperation(canvas, NSCompositingOperation::Clear);
        source.drawInRect_fromRect_operation_fraction(
            canvas, NSRect::new(NSPoint::new(0.0, 0.0), source.size()),
            NSCompositingOperation::SourceOver, 1.0,
        );
        NSColor::colorWithSRGBRed_green_blue_alpha(0.90, 0.16, 0.18, 1.0).setFill();
        // Overlay the rounded macOS tile's top-right corner while retaining 16px
        // of transparent canvas beyond the badge. Bitmap coordinates are unflipped.
        NSBezierPath::bezierPathWithOvalInRect(NSRect::new(
            NSPoint::new(352.0, 352.0), NSSize::new(144.0, 144.0),
        )).fill();
        // SAFETY: text attributes remain valid and drawing targets only this
        // call's private bitmap context; center its measured box inside the circle.
        unsafe {
            text.drawAtPoint_withAttributes(
                NSPoint::new(424.0 - measured.width / 2.0, 424.0 - measured.height / 2.0),
                Some(&attributes),
            );
        }
        // Drawing has no fallible Rust exits after setting the private context;
        // restore the worker thread's previous state before the fallible encoder.
        NSGraphicsContext::restoreGraphicsState_class();
        // SAFETY: an empty properties dictionary requests standard PNG encoding;
        // the bitmap owns the complete icon pixels until encoding finishes.
        let png = unsafe {
            bitmap.representationUsingType_properties(NSBitmapImageFileType::PNG, &NSDictionary::new())
        }.ok_or("无法生成店铺浏览器图标")?;
        Ok(png.to_vec())
    })
}
