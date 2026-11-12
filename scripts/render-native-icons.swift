/**
 * AI module map
 * Purpose: render platform-specific transparent icon canvases from the white bug artwork.
 * Entry: build-icons.mjs invokes this macOS AppKit exporter with source/Mac/Windows paths.
 * Flow: draw the unchanged artwork inside an inset rounded white tile on an RGBA
 * bitmap, then write the two 1024px PNG masters consumed by ICNS/ICO generation.
 * Ownership: only requested generated icon files are written; source artwork and
 * web branding remain untouched. No application process or user data is accessed.
 */
import AppKit

let sourceURL = URL(fileURLWithPath: CommandLine.arguments[1])
guard let source = NSImage(contentsOf: sourceURL) else {
    throw NSError(domain: "NativeIconExport", code: 1,
                  userInfo: [NSLocalizedDescriptionKey: "无法读取图标源图"])
}

func render(to path: String, inset: CGFloat, radius: CGFloat) throws {
    let size = 1024
    guard let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil,
        pixelsWide: size, pixelsHigh: size, bitsPerSample: 8, samplesPerPixel: 4,
        hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB,
        bytesPerRow: 0, bitsPerPixel: 0),
        let context = NSGraphicsContext(bitmapImageRep: bitmap) else {
        throw NSError(domain: "NativeIconExport", code: 2,
                      userInfo: [NSLocalizedDescriptionKey: "无法创建图标画布"])
    }
    bitmap.size = NSSize(width: CGFloat(size), height: CGFloat(size))
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = context
    context.imageInterpolation = .high
    context.shouldAntialias = true
    NSColor.clear.setFill()
    NSRect(x: 0, y: 0, width: CGFloat(size), height: CGFloat(size)).fill(using: .copy)
    let tile = NSRect(x: inset, y: inset,
                      width: CGFloat(size) - 2 * inset, height: CGFloat(size) - 2 * inset)
    NSBezierPath(roundedRect: tile, xRadius: radius, yRadius: radius).addClip()
    source.draw(in: tile, from: NSRect(origin: .zero, size: source.size),
                operation: .sourceOver, fraction: 1)
    NSGraphicsContext.restoreGraphicsState()
    guard let png = bitmap.representation(using: .png, properties: [:]) else {
        throw NSError(domain: "NativeIconExport", code: 3,
                      userInfo: [NSLocalizedDescriptionKey: "无法编码图标 PNG"])
    }
    try png.write(to: URL(fileURLWithPath: path), options: .atomic)
}

// macOS has a larger optical margin; the Windows tile stays legible at 16px.
try render(to: CommandLine.arguments[2], inset: 96, radius: 185)
try render(to: CommandLine.arguments[3], inset: 64, radius: 192)
