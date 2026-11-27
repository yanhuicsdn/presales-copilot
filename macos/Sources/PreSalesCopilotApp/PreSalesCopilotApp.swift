import SwiftUI

@main
struct PreSalesCopilotApp: App {
    @StateObject private var viewModel = CopilotViewModel()

    var body: some Scene {
        WindowGroup("售前智问分身 · PreSales Copilot") {
            MainSplitView(viewModel: viewModel)
                .frame(minWidth: 520, idealWidth: 680, minHeight: 360, idealHeight: 480)
        }
        .windowStyle(.titleBar)
        .defaultSize(width: 680, height: 480)

        Settings {
            SettingsView(viewModel: viewModel)
                .frame(width: 460, height: 320)
        }
    }
}

struct SettingsView: View {
    @ObservedObject var viewModel: CopilotViewModel
    @Environment(\.dismiss) private var dismiss
    @State private var urlDraft: String = ""

    var body: some View {
        Form {
            Section("云端 Agent 服务（V3.0 FDE · Mastra + DeepSeek）") {
                TextField("服务地址", text: $urlDraft)
                HStack {
                    Spacer()
                    Button("保存并重连") {
                        viewModel.updateCloudURL(urlDraft)
                        dismiss()
                    }
                    .buttonStyle(.borderedProminent)
                }
            }

            Section("提问建议触发策略") {
                Toggle("自动触发提词（每采集 \(viewModel.autoHintThreshold) 句自动提示）", isOn: $viewModel.autoHintEnabled)
                if viewModel.autoHintEnabled {
                    Stepper("自动提词句数阈值：\(viewModel.autoHintThreshold) 句", value: $viewModel.autoHintThreshold, in: 2...15)
                } else {
                    Text("当前为推荐的「静默录音 + 手动按钮按需提词」模式，避免会议中频繁弹窗干扰。")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }

            Section("隐私与本地语音引擎") {
                Toggle("保留本地原始录音 WAV（仅存本机，绝不上传）", isOn: $viewModel.retainLocalAudioFile)
                HStack {
                    Text(viewModel.modelStatus.displayText)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Spacer()
                    Button("重新检测 SenseVoice") {
                        viewModel.loadLocalModel()
                    }
                }
            }
        }
        .padding()
        .onAppear {
            urlDraft = viewModel.cloudBaseURLString
        }
    }
}
