// swift-tools-version:6.0
import PackageDescription
let package = Package(name: "EmbeddedNativeHost", platforms: [.macOS(.v14)], products: [.library(name: "EmbeddedNativeHost", type: .dynamic, targets: ["EmbeddedNativeHost"])], dependencies: [.package(url: "https://github.com/azuretek/imsg.git", exact: "0.17.0-cuate.1")], targets: [.target(name: "EmbeddedNativeHost", dependencies: [.product(name: "IMsgRPC", package: "imsg")]), .testTarget(name: "EmbeddedNativeHostTests", dependencies: ["EmbeddedNativeHost"])], swiftLanguageModes: [.v5])
