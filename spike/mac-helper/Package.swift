// swift-tools-version:6.0
import PackageDescription

let package = Package(
    name: "CuateHelper",
    platforms: [.macOS(.v13)],
    products: [
        .library(name: "CuateHelperCore", targets: ["CuateHelperCore"]),
        .executable(name: "cuate-helper", targets: ["CuateHelper"]),
    ],
    targets: [
        .target(
            name: "CuateHelperCore",
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
            dependencies: ["CuateHelperCore"],
            path: "Tests/CuateHelperCoreTests"
        ),
    ],
    swiftLanguageModes: [.v5]
)
