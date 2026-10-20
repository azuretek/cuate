import Foundation
import CoreFoundation
import Darwin
@_cdecl("swift_request")
func request(_ id: Int32, _ delay: Int32) {
    precondition(!Thread.isMainThread)
    DispatchQueue.main.asyncAfter(deadline: .now() + .milliseconds(Int(delay))) {
        precondition(Thread.isMainThread)
        native_complete(id, getpid(), 1)
    }
}
let args = CommandLine.arguments.map { strdup($0) } + [nil]
var argv = args
let initial = argv.withUnsafeMutableBufferPointer { embed_init(Int32(args.count - 1), $0.baseAddress!) }
precondition(initial == 0)
setenv("SWIFT_MAIN_PID", String(getpid()), 1)
let mainLoop = CFRunLoopGetMain()
var result: Int32 = 1
var ticks = 0
let timer = Timer.scheduledTimer(withTimeInterval: 0.005, repeats: true) { _ in
    precondition(Thread.isMainThread)
    ticks += 1
}
let worker = Thread {
    precondition(!Thread.isMainThread)
    let code = embed_run()
    DispatchQueue.main.async {
        result = code
        CFRunLoopStop(mainLoop)
    }
}
worker.start()
CFRunLoopRun()
timer.invalidate()
let isProbe = CommandLine.arguments.count > 1 && ["probe.cjs", "suite.cjs"].contains(URL(fileURLWithPath: CommandLine.arguments[1]).lastPathComponent)
if isProbe { precondition(ticks > 0) }
embed_dispose()
for arg in args { free(arg) }
if isProbe { print("SWIFT_MAIN_LOOP_TICKS=\(ticks) PID=\(getpid()) RETURN=\(result)") }
exit(result)
