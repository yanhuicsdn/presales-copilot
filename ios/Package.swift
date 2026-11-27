// swift-tools-version: 5.9
import Foundation
import PackageDescription

let packageDir = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
let sherpaFrameworkRelPath = "Frameworks/SherpaOnnxC.xcframework"
let hasNativeSherpa = FileManager.default.fileExists(
    atPath: packageDir.appendingPathComponent(sherpaFrameworkRelPath).path
)

var targets: [Target] = []

if hasNativeSherpa {
    targets.append(
        .binaryTarget(
            name: "SherpaOnnxC",
            path: sherpaFrameworkRelPath
        )
    )
}

targets.append(
    .target(
        name: "CSherpaOnnxIOS",
        dependencies: hasNativeSherpa ? ["SherpaOnnxC"] : [],
        path: "Sources/CSherpaOnnx",
        publicHeadersPath: "include",
        cSettings: hasNativeSherpa
            ? [
                .headerSearchPath("include"),
                .define("SHERPA_ONNX_LINKED")
            ]
            : [
                .headerSearchPath("include")
            ]
    )
)

targets.append(
    .target(
        name: "PreSalesIOSCore",
        dependencies: ["CSherpaOnnxIOS"],
        path: "Sources/PreSalesIOSCore"
    )
)

let package = Package(
    name: "PreSalesIOSKit",
    platforms: [
        .iOS(.v17)
    ],
    products: [
        .library(
            name: "PreSalesIOSCore",
            targets: ["PreSalesIOSCore"]
        )
    ],
    targets: targets
)
