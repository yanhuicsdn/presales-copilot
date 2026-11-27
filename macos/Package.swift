// swift-tools-version: 5.9
import Foundation
import PackageDescription

let packageDir = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
let sherpaFrameworkRelPath = "Frameworks/sherpa-onnx.xcframework"
let hasNativeSherpa = FileManager.default.fileExists(
    atPath: packageDir.appendingPathComponent(sherpaFrameworkRelPath).path
)

var targets: [Target] = []

if hasNativeSherpa {
    targets.append(
        .binaryTarget(
            name: "SherpaOnnxBinary",
            path: sherpaFrameworkRelPath
        )
    )
}

targets.append(
    .target(
        name: "CSherpaOnnx",
        dependencies: hasNativeSherpa ? ["SherpaOnnxBinary"] : [],
        path: "Sources/CSherpaOnnx",
        publicHeadersPath: "include",
        cSettings: hasNativeSherpa
            ? [
                .headerSearchPath("include"),
                .headerSearchPath("../../Frameworks/sherpa-onnx.xcframework/macos-arm64_x86_64/Headers"),
                .define("SHERPA_ONNX_LINKED")
            ]
            : [
                .headerSearchPath("include")
            ]
    )
)

targets.append(
    .target(
        name: "PreSalesCore",
        dependencies: ["CSherpaOnnx"],
        path: "Sources/PreSalesCore"
    )
)

targets.append(
    .executableTarget(
        name: "PreSalesCopilotApp",
        dependencies: ["PreSalesCore"],
        path: "Sources/PreSalesCopilotApp"
    )
)

targets.append(
    .testTarget(
        name: "PreSalesCoreTests",
        dependencies: ["PreSalesCore"],
        path: "Tests/PreSalesCoreTests"
    )
)

let package = Package(
    name: "PreSalesCopilot",
    platforms: [
        .macOS(.v14)
    ],
    products: [
        .library(
            name: "PreSalesCore",
            targets: ["PreSalesCore"]
        ),
        .executable(
            name: "PreSalesCopilot",
            targets: ["PreSalesCopilotApp"]
        )
    ],
    targets: targets
)
