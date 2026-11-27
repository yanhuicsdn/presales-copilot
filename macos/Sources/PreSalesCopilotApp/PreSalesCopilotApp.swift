import SwiftUI

@main
struct PreSalesCopilotApp: App {
    @StateObject private var viewModel = CopilotViewModel()

    var body: some Scene {
        WindowGroup("售前智问分身 · PreSales Copilot") {
            MainSplitView(viewModel: viewModel)
                .frame(minWidth: 1080, minHeight: 700)
        }
        .windowStyle(.titleBar)

        Settings {
            SettingsView(viewModel: viewModel)
                .frame(width: 480, height: 280)
        }
    }
}

struct SettingsView: View {
    @ObservedObject var viewModel: CopilotViewModel
    @State private var urlDraft: String = ""

    var body: some View {
        Form {
            Section("云端 Agent 服务（Next.js + Mastra）") {
                TextField("服务地址", text: $urlDraft)
                Button("保存并重连") {
                    viewModel.updateCloudURL(urlDraft)
                }
            }

            Section("隐私与本地录音") {
                Toggle("保留本地原始录音 WAV（仅存本机，绝不上传）", isOn: $viewModel.retainLocalAudioFile)
                Text("提示：建议在 macOS 系统设置中关闭“自动睡眠”，避免长时间客户访谈录音中断。")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            Section("本地 Sherpa-ONNX 模型") {
                Text(viewModel.modelStatus.displayText)
                    .font(.caption)
                Button("重新加载 int8 SenseVoice 模型") {
                    viewModel.loadLocalModel()
                }
            }
        }
        .padding()
        .onAppear {
            urlDraft = viewModel.cloudBaseURLString
        }
    }
}
