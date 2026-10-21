// swift-tools-version: 6.2
//
// Everything in the app that isn't the app target itself. Split so the parts
// with no UI — the generated models, the API client, sign-in and link parsing —
// build and test on macOS with `swift test`, in seconds and without a
// simulator. The two feature targets are the screens; they sit on top so a
// screen can never be something the client depends on.
import PackageDescription

let package = Package(
    name: "RubeKit",
    platforms: [.iOS(.v26), .macOS(.v26)],
    products: [
        .library(name: "RubeModels", targets: ["RubeModels"]),
        .library(name: "RubeAPI", targets: ["RubeAPI"]),
        .library(name: "RubeCore", targets: ["RubeCore"]),
        .library(name: "PortalFeature", targets: ["PortalFeature"]),
        .library(name: "AdminFeature", targets: ["AdminFeature"]),
    ],
    targets: [
        .target(name: "RubeModels"),
        // Foundation only, on purpose: the wire protocol, the probe and the
        // Plex PIN flow are where a mistake locks someone out, and this is what
        // keeps them testable without a device.
        .target(name: "RubeAPI", dependencies: ["RubeModels"]),
        .target(name: "RubeCore", dependencies: ["RubeAPI", "RubeModels"]),
        .target(name: "PortalFeature", dependencies: ["RubeCore", "RubeAPI", "RubeModels"]),
        .target(name: "AdminFeature", dependencies: ["RubeCore", "RubeAPI", "RubeModels"]),
        .testTarget(name: "RubeModelsTests", dependencies: ["RubeModels"]),
        .testTarget(name: "RubeAPITests", dependencies: ["RubeAPI", "RubeModels"]),
        .testTarget(name: "RubeCoreTests", dependencies: ["RubeCore", "RubeAPI"]),
    ]
)
