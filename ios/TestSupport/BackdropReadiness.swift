import Foundation

// Test-only: a DOM-ready image can precede the screenshot's composited pixels (issue 510).
// The marker and every capture share one deadline; a missing or wrong pixel can never pass it.
struct BackdropReadiness {
    typealias Pixel = (r: Int, g: Int, b: Int)
    enum Status { case waiting, ready, timedOut }
    let deadline: TimeInterval
    let colour: Pixel
    private(set) var status: Status = .waiting

    static func matches(_ pixel: Pixel?, colour: Pixel) -> Bool {
        guard let pixel else { return false }
        return abs(pixel.r - colour.r) <= 40 && abs(pixel.g - colour.g) <= 40 && abs(pixel.b - colour.b) <= 40
    }

    mutating func sample(at now: TimeInterval, pixel: Pixel?) -> Status {
        if status != .waiting { return status }
        if now >= deadline { status = .timedOut }
        else if Self.matches(pixel, colour: colour) { status = .ready }
        return status
    }
}
