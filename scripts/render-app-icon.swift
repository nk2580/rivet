import AppKit
import ImageIO
import UniformTypeIdentifiers

// AppKit decodes the actual UI SVG; each Retina size is rasterised from vectors.
guard [3,4].contains(CommandLine.arguments.count),
      let image = NSImage(contentsOfFile: CommandLine.arguments[1]),
      let space = CGColorSpace(name: CGColorSpace.sRGB) else {
    fatalError("Usage: render-app-icon.swift source.svg output-directory")
}
let sizes = CommandLine.arguments.count == 4 ? CommandLine.arguments[3].split(separator: ",").compactMap { Int($0) } : [16, 32, 64, 128, 192, 256, 512, 1024]
guard !sizes.isEmpty, sizes.allSatisfy({ $0 >= 16 && $0 <= 1024 }) else { fatalError("Invalid icon sizes.") }
for size in sizes {
    guard let context = CGContext(data: nil, width: size, height: size,
                                  bitsPerComponent: 8, bytesPerRow: 0, space: space,
                                  bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else {
        fatalError("Could not create an sRGB icon canvas.")
    }
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(cgContext: context, flipped: false)
    image.draw(in: NSRect(x: 0, y: 0, width: size, height: size), from: .zero,
               operation: .copy, fraction: 1)
    NSGraphicsContext.restoreGraphicsState()
    let output = URL(fileURLWithPath: CommandLine.arguments[2]).appendingPathComponent("icon-\(size).png")
    guard let bitmap = context.makeImage(),
          let destination = CGImageDestinationCreateWithURL(output as CFURL, UTType.png.identifier as CFString, 1, nil) else {
        fatalError("Could not write an icon PNG.")
    }
    CGImageDestinationAddImage(destination, bitmap, nil)
    guard CGImageDestinationFinalize(destination) else { fatalError("Icon PNG export failed.") }
}
