// swift-tools-version: 5.9
import PackageDescription

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
    targets: [
        .target(
            name: "CSherpaOnnxIOS",
            path: "Sources/CSherpaOnnx",
            publicHeadersPath: "include",
            cSettings: [
                .headerSearchPath("include")
            ]
        ),
        .target(
            name: "PreSalesIOSCore",
            dependencies: ["CSherpaOnnxIOS"],
            path: "Sources/PreSalesIOSCore"
        )
    ]
)
