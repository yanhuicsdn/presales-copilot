// swift-tools-version: 5.9
import PackageDescription

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
    targets: [
        .target(
            name: "CSherpaOnnx",
            path: "Sources/CSherpaOnnx",
            publicHeadersPath: "include",
            cSettings: [
                .headerSearchPath("include")
            ]
        ),
        .target(
            name: "PreSalesCore",
            dependencies: ["CSherpaOnnx"],
            path: "Sources/PreSalesCore"
        ),
        .executableTarget(
            name: "PreSalesCopilotApp",
            dependencies: ["PreSalesCore"],
            path: "Sources/PreSalesCopilotApp"
        ),
        .testTarget(
            name: "PreSalesCoreTests",
            dependencies: ["PreSalesCore"],
            path: "Tests/PreSalesCoreTests"
        )
    ]
)
