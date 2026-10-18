import AppKit
import CuateHelperCore
import Foundation

let arguments = CommandLine.arguments
let info = HelperInfo.current()

func argumentValue(_ name: String) -> String? {
    guard let index = arguments.firstIndex(of: name), index + 1 < arguments.count else { return nil }
    return arguments[index + 1]
}

func printJSON<T: Encodable>(_ value: T) {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
    if let data = try? encoder.encode(value), let text = String(data: data, encoding: .utf8) {
        print(text)
    }
}

if arguments.contains("--state") || arguments.contains("--capabilities") {
    printJSON(Capabilities.current(version: info.version, build: info.build))
    exit(0)
}

if arguments.contains("--setup-model") {
    printJSON(SetupModel(capabilities: Capabilities.current(version: info.version, build: info.build)))
    exit(0)
}

if arguments.contains("--menu-model") {
    printJSON(MenuBarModel(capabilities: Capabilities.current(version: info.version, build: info.build),
                           signing: .current()))
    exit(0)
}

if arguments.contains("--count") {
    struct CountReply: Encodable {
        let hello: HelperInfo
        let count: ChatDatabaseResult
        let capabilities: Capabilities
    }
    let result = ChatDatabase().count()
    printJSON(CountReply(hello: info, count: result,
                         capabilities: Capabilities.current(version: info.version, build: info.build)))
    exit(result.ok ? 0 : 1)
}

let application = NSApplication.shared
application.setActivationPolicy(.accessory)
// The launchd agent always passes --socket, so setup never opens on launch.
// A bare open by a person, or an explicit --setup, does open it.
let openSetup = arguments.contains("--setup") || !arguments.contains("--socket")
let delegate = AppDelegate(info: info,
                           socketPath: argumentValue("--socket"),
                           openSetup: openSetup)
application.delegate = delegate
application.run()
