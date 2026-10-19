// swift-tools-version:6.0
import PackageDescription

let package = Package(
    name: "CuateHelper",
    platforms: [.macOS(.v14)],
    products: [
        .library(name: "CuateHelperCore", targets: ["CuateHelperCore"]),
        .executable(name: "cuate-helper", targets: ["CuateHelper"]),
    ],
    dependencies: [
        .package(url: "https://github.com/azuretek/imsg.git", exact: "0.17.0-cuate.1"),
    ],
    targets: [
        .target(
            name: "CuateHelperCore",
            dependencies: [.product(name: "IMsgRPC", package: "imsg")],
            path: "Sources/CuateHelperCore",
            linkerSettings: [.linkedLibrary("sqlite3")]
        ),
        .executableTarget(
            name: "CuateHelper",
            dependencies: ["CuateHelperCore"],
            path: "Sources/CuateHelper"
        ),
        .testTarget(
            name: "CuateHelperCoreTests",
            dependencies: ["CuateHelperCore", .product(name: "IMsgRPC", package: "imsg")],
            path: "Tests/CuateHelperCoreTests"
        ),
    ],
    swiftLanguageModes: [.v5]
)
