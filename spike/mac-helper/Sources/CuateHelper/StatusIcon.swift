import AppKit

enum StatusIcon {
    /// A filled message bubble. The badge is a separate dot with a transparent
    /// gap, so it reads at menu bar size and stays a template image.
    static func image(badge: Bool) -> NSImage {
        let size = NSSize(width: 20, height: 18)
        let image = NSImage(size: size, flipped: false) { _ in
            NSColor.black.setFill()
            let bubble = NSBezierPath(roundedRect: NSRect(x: 2, y: 4, width: 16, height: 11), xRadius: 4, yRadius: 4)
            bubble.fill()
            let tail = NSBezierPath()
            tail.move(to: NSPoint(x: 6, y: 5))
            tail.line(to: NSPoint(x: 6, y: 2))
            tail.line(to: NSPoint(x: 10, y: 5))
            tail.close()
            tail.fill()
            if badge {
                NSGraphicsContext.current?.compositingOperation = .destinationOut
                NSBezierPath(ovalIn: NSRect(x: 11, y: 9, width: 9, height: 9)).fill()
                NSGraphicsContext.current?.compositingOperation = .sourceOver
                NSBezierPath(ovalIn: NSRect(x: 13, y: 11, width: 6, height: 6)).fill()
            }
            return true
        }
        image.isTemplate = true
        return image
    }
}
