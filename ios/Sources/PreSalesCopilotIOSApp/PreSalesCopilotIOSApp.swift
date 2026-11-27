import SwiftUI

@main
struct PreSalesCopilotIOSApp: App {
    @StateObject private var viewModel = IOSCopilotViewModel()

    var body: some Scene {
        WindowGroup {
            MainView(viewModel: viewModel)
        }
    }
}
