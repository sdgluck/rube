// swift-tools-version: 6.2
//
// Everything in the app that isn't a screen. Split so the parts with no UI —
// the generated models and the API client — build and test on macOS with
// `swift test`, in seconds and without a simulator.
import PackageDescription

let package = Package(
    name: "TinkerbellKit",
    platforms: [.iOS(.v26), .macOS(.v26)],
    products: [
        .library(name: "TinkerbellModels", targets: ["TinkerbellModels"]),
    ],
    targets: [
        .target(name: "TinkerbellModels"),
        .testTarget(name: "TinkerbellModelsTests", dependencies: ["TinkerbellModels"]),
    ]
)
