import SwiftUI
import UIKit
import PreSalesIOSCore

/// Omarchy-aligned single-column, prompt-only dark focus interface for iPhone & iPad.
/// No live transcript scrolling clutter — silently captures speech locally and delivers
/// concise 10–24 char FDE V3.0 prompts on demand via the prominent "获取提问建议" button.
struct MainView: View {
    @ObservedObject var viewModel: IOSCopilotViewModel

    @State private var showNewGroupSheet = false
    @State private var showSettingsSheet = false
    @State private var boundariesExpanded = false

    private let bgCanvas = Color(red: 0.059, green: 0.067, blue: 0.082)   // #0f1115
    private let bgHeader = Color(red: 0.075, green: 0.086, blue: 0.110)   // #13161c
    private let bgBar    = Color(red: 0.071, green: 0.082, blue: 0.106)   // #12151b
    private let bgStatus = Color(red: 0.055, green: 0.063, blue: 0.078)   // #0e1014
    private let bgCard   = Color(red: 0.071, green: 0.082, blue: 0.110)   // #12151c
    private let lineCol  = Color(red: 0.114, green: 0.125, blue: 0.157)   // #1d2028
    private let accent   = Color(red: 0.451, green: 0.569, blue: 0.996)   // #7391fe

    var body: some View {
        VStack(spacing: 0) {
            compactHeader
            Rectangle().fill(lineCol).frame(height: 1)

            promptFocusCanvas

            Rectangle().fill(lineCol).frame(height: 1)
            onDemandDock

            if case .downloading(let progress, _, _, _) = viewModel.modelDownloadState {
                GeometryReader { geo in
                    ZStack(alignment: .leading) {
                        Rectangle().fill(Color(red: 0.11, green: 0.13, blue: 0.18))
                        Rectangle().fill(accent).frame(width: max(4, geo.size.width * CGFloat(progress)))
                    }
                }
                .frame(height: 2)
            } else {
                Rectangle().fill(Color(red: 0.098, green: 0.110, blue: 0.141)).frame(height: 1)
            }
            ultraThinStatusStrip
        }
        .background(bgCanvas.ignoresSafeArea())
        .preferredColorScheme(.dark)
        .sheet(isPresented: $showNewGroupSheet) {
            NewGroupSheet(viewModel: viewModel)
        }
        .sheet(isPresented: $showSettingsSheet) {
            SettingsSheet(viewModel: viewModel)
        }
        .sheet(isPresented: $viewModel.showSummarySheet) {
            if let summary = viewModel.latestSummary {
                SessionSummarySheet(
                    summary: summary,
                    groupName: viewModel.activeGroupName,
                    onDeleteLocalAudio: { viewModel.deleteLastLocalRecording() }
                )
            }
        }
    }

    // MARK: - Compact Single-Row Header

    private var compactHeader: some View {
        HStack(spacing: 8) {
            Menu {
                ForEach(viewModel.groups) { grp in
                    Button {
                        viewModel.selectGroup(grp.id)
                    } label: {
                        Label("[\(grp.stage ?? "S0")] \(grp.name)",
                              systemImage: grp.id == viewModel.selectedGroupId ? "checkmark" : "folder")
                    }
                }
                if !viewModel.groups.isEmpty { Divider() }
                Button {
                    showNewGroupSheet = true
                } label: {
                    Label("新建客户分组", systemImage: "plus.circle")
                }
                Button {
                    Task { await viewModel.refreshGroups() }
                } label: {
                    Label("刷新分组列表", systemImage: "arrow.clockwise")
                }
            } label: {
                HStack(spacing: 5) {
                    Text(viewModel.activeGroupName)
                        .lineLimit(1)
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(.white)
                    Image(systemName: "chevron.down")
                        .font(.system(size: 10, weight: .semibold))
                        .foregroundStyle(Color.white.opacity(0.55))
                }
                .padding(.horizontal, 10)
                .frame(height: 32)
                .frame(maxWidth: 165, alignment: .leading)
                .background(Color(red: 0.110, green: 0.125, blue: 0.165))
                .clipShape(RoundedRectangle(cornerRadius: 6))
            }

            Button {
                showNewGroupSheet = true
            } label: {
                Image(systemName: "plus")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(Color.white.opacity(0.8))
                    .frame(width: 28, height: 28)
            }

            // Active Stage Pill
            Text("\(viewModel.currentStage.rawValue) \(viewModel.currentStage.displayName)")
                .font(.system(size: 11, weight: .bold))
                .foregroundStyle(accent)
                .padding(.horizontal, 8)
                .padding(.vertical, 4)
                .background(Color(red: 0.110, green: 0.133, blue: 0.188))
                .clipShape(RoundedRectangle(cornerRadius: 4))

            Spacer()

            // Subtle live mic bar
            if viewModel.isRecording || viewModel.isTranscribing {
                HStack(spacing: 4) {
                    Circle()
                        .fill(viewModel.isTranscribing ? accent : Color(red: 1.0, green: 0.35, blue: 0.37))
                        .frame(width: 7, height: 7)
                    ZStack(alignment: .leading) {
                        Capsule()
                            .fill(Color(red: 0.15, green: 0.165, blue: 0.204))
                            .frame(width: 28, height: 4)
                        Capsule()
                            .fill(accent)
                            .frame(width: max(4, 28 * CGFloat(min(1.0, viewModel.audioLevel))), height: 4)
                    }
                }
            }

            Menu {
                Button {
                    viewModel.autoHintEnabled.toggle()
                } label: {
                    Label(
                        viewModel.autoHintEnabled
                            ? "自动提词：已开（每 \(viewModel.autoHintThreshold) 句）"
                            : "自动提词：关（仅手动按钮）",
                        systemImage: viewModel.autoHintEnabled ? "bolt.fill" : "hand.tap"
                    )
                }
                Button {
                    viewModel.offlineMode.toggle()
                } label: {
                    Label(viewModel.offlineMode ? "关闭涉密离线模式" : "开启涉密离线模式",
                          systemImage: viewModel.offlineMode ? "lock.open" : "lock.shield")
                }
                Divider()
                Button {
                    viewModel.endSession()
                } label: {
                    Label("结束会话并生成纪要", systemImage: "doc.text")
                }
                .disabled(viewModel.selectedGroupId == nil)
                Button {
                    showSettingsSheet = true
                } label: {
                    Label("设置", systemImage: "gearshape")
                }
            } label: {
                Image(systemName: "ellipsis")
                    .font(.system(size: 16, weight: .bold))
                    .foregroundStyle(Color.white.opacity(0.8))
                    .frame(width: 30, height: 30)
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .background(bgHeader)
    }

    // MARK: - Prompt-Only Focus Canvas

    private var promptFocusCanvas: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                if viewModel.isAnalyzing {
                    HStack(spacing: 8) {
                        if viewModel.latestCard == nil { Spacer() }
                        ProgressView()
                            .tint(accent)
                        Text("正在提炼简短提词…")
                            .font(.system(size: 13))
                            .foregroundStyle(accent)
                        if viewModel.latestCard == nil { Spacer() }
                    }
                    .padding(.top, viewModel.latestCard == nil ? 76 : 0)
                }

                if let card = viewModel.latestCard {
                    VStack(alignment: .leading, spacing: 12) {
                        // Meta row: Ask Next + non-low risk pills + matched skill + Copy
                        HStack(spacing: 6) {
                            Text("建议追问")
                                .font(.system(size: 11, weight: .bold))
                                .foregroundStyle(accent)

                            ScrollView(.horizontal, showsIndicators: false) {
                                HStack(spacing: 6) {
                                    ForEach(card.riskTags.filter { $0.level != .low }) { tag in
                                        Text(tag.label)
                                            .font(.system(size: 10, weight: .medium))
                                            .foregroundStyle(tag.level == .high ? Color(red: 1.0, green: 0.61, blue: 0.58) : Color(red: 0.94, green: 0.81, blue: 0.48))
                                            .padding(.horizontal, 7)
                                            .padding(.vertical, 3)
                                            .background(tag.level == .high ? Color(red: 0.204, green: 0.098, blue: 0.118) : Color(red: 0.188, green: 0.153, blue: 0.078))
                                            .clipShape(RoundedRectangle(cornerRadius: 4))
                                    }

                                    if let firstSkill = card.matchedSkills.first {
                                        Text(SkillDisplayNames.label(for: firstSkill))
                                            .font(.system(size: 10, weight: .medium))
                                            .foregroundStyle(Color(red: 0.65, green: 0.72, blue: 0.92))
                                            .padding(.horizontal, 7)
                                            .padding(.vertical, 3)
                                            .background(Color(red: 0.12, green: 0.15, blue: 0.23))
                                            .clipShape(RoundedRectangle(cornerRadius: 4))
                                    }
                                }
                            }

                            Button("复制") {
                                viewModel.copyText(card.primaryQuestion)
                            }
                            .font(.system(size: 11))
                            .foregroundStyle(Color(red: 0.486, green: 0.514, blue: 0.588))
                        }

                        // Large 1-sentence short prompt with left accent bar
                        HStack(alignment: .top, spacing: 12) {
                            RoundedRectangle(cornerRadius: 2)
                                .fill(accent)
                                .frame(width: 3)
                            Text(card.primaryQuestion)
                                .font(.system(size: 22, weight: .semibold))
                                .lineSpacing(6)
                                .foregroundStyle(.white)
                                .fixedSize(horizontal: false, vertical: true)
                                .frame(maxWidth: .infinity, alignment: .leading)
                        }
                        .contentShape(Rectangle())
                        .onTapGesture {
                            viewModel.copyText(card.primaryQuestion)
                        }
                    }

                    // Compact tap-to-copy alternative prompts
                    VStack(spacing: 6) {
                        ForEach(Array(card.alternativeQuestions.enumerated()), id: \.offset) { idx, q in
                            Button {
                                viewModel.copyText(q)
                            } label: {
                                HStack(alignment: .top, spacing: 10) {
                                    Text("\(idx + 1)")
                                        .font(.system(size: 11, weight: .bold).monospacedDigit())
                                        .foregroundStyle(Color(red: 0.353, green: 0.376, blue: 0.439))
                                        .padding(.top, 2)
                                    Text(q)
                                        .font(.system(size: 14))
                                        .foregroundStyle(Color(red: 0.812, green: 0.831, blue: 0.878))
                                        .multilineTextAlignment(.leading)
                                        .frame(maxWidth: .infinity, alignment: .leading)
                                }
                                .padding(.horizontal, 12)
                                .padding(.vertical, 10)
                                .background(bgCard)
                                .clipShape(RoundedRectangle(cornerRadius: 6))
                            }
                            .buttonStyle(.plain)
                        }
                    }
                } else if !viewModel.isAnalyzing {
                    VStack(spacing: 10) {
                        Text(viewModel.capturedCount > 0
                             ? "已静默采集 \(viewModel.capturedCount) 句对话"
                             : "后台静默倾听中")
                            .font(.system(size: 18, weight: .bold))
                            .foregroundStyle(Color(red: 0.831, green: 0.851, blue: 0.902))

                        Text(viewModel.capturedCount > 0
                             ? "需要提示时，点击下方「获取提问建议」即可生成简短提词。"
                             : "点击下方「录音」开始静默采集，需要时再点「获取提问建议」。")
                            .font(.system(size: 13))
                            .foregroundStyle(Color(red: 0.408, green: 0.439, blue: 0.522))
                            .multilineTextAlignment(.center)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.top, 84)
                }

                // Collapsible Boundaries Strip (5 core + optional V3.0 boundaries)
                if boundariesExpanded {
                    let b = viewModel.checkpoint?.boundaries ?? BoundaryConstraints()
                    VStack(alignment: .leading, spacing: 6) {
                        boundaryRow("数据与存储", b.dataLocation)
                        boundaryRow("内外网跨端", b.networkType)
                        boundaryRow("数据量级", b.dataVolume)
                        boundaryRow("终端与限制", b.terminalType)
                        boundaryRow("保密与权限", b.confidentiality)
                        if let hist = b.historicalDataStatus, !hist.isEmpty {
                            boundaryRow("历史样例", hist)
                        }
                        if let sys = b.systemConstraints, !sys.isEmpty {
                            boundaryRow("现网约束", sys)
                        }
                    }
                    .padding(12)
                    .background(bgCard)
                    .clipShape(RoundedRectangle(cornerRadius: 8))
                }
            }
            .padding(20)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func boundaryRow(_ label: String, _ value: String?) -> some View {
        HStack {
            Text(label)
                .font(.system(size: 12))
                .foregroundStyle(Color(red: 0.431, green: 0.459, blue: 0.533))
                .frame(width: 82, alignment: .leading)
            Text((value?.isEmpty == false) ? value! : "待确认")
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle((value?.isEmpty == false) ? Color(red: 0.431, green: 0.906, blue: 0.718) : Color(red: 0.545, green: 0.573, blue: 0.647))
            Spacer()
        }
    }

    // MARK: - Thumb-Friendly On-Demand Action Dock

    private var onDemandDock: some View {
        VStack(spacing: 10) {
            // Big primary "Get Hint" button
            Button {
                viewModel.requestHint()
            } label: {
                Text(
                    viewModel.isAnalyzing
                    ? "正在生成简短提词…"
                    : (viewModel.unpromptedCount > 0
                       ? "获取提问建议（\(viewModel.unpromptedCount) 句新对话）"
                       : "获取提问建议")
                )
                .font(.system(size: 15, weight: .bold))
                .foregroundStyle(viewModel.canRequestHint ? Color.white : Color(red: 0.408, green: 0.439, blue: 0.522))
                .frame(maxWidth: .infinity)
                .frame(height: 44)
                .background(viewModel.canRequestHint ? accent : Color(red: 0.122, green: 0.141, blue: 0.188))
                .clipShape(RoundedRectangle(cornerRadius: 8))
            }
            .disabled(!viewModel.canRequestHint)

            // Secondary compact row: Record/Pause + Bounds toggle + End
            HStack(spacing: 10) {
                Button {
                    viewModel.toggleRecording()
                } label: {
                    HStack(spacing: 6) {
                        Circle()
                            .fill(viewModel.isRecording ? Color(red: 1.0, green: 0.35, blue: 0.37) : Color(red: 0.20, green: 0.83, blue: 0.60))
                            .frame(width: 8, height: 8)
                        Text(viewModel.isRecording ? "暂停录音" : (viewModel.isPaused ? "继续录音" : "开始录音"))
                            .font(.system(size: 13, weight: .bold))
                            .foregroundStyle(viewModel.isRecording ? Color(red: 0.96, green: 0.85, blue: 0.55) : Color.white)
                    }
                    .frame(maxWidth: .infinity)
                    .frame(height: 36)
                    .background(viewModel.isRecording ? Color(red: 0.173, green: 0.133, blue: 0.082) : Color(red: 0.122, green: 0.141, blue: 0.188))
                    .overlay(
                        RoundedRectangle(cornerRadius: 6)
                            .stroke(viewModel.isRecording ? Color(red: 0.91, green: 0.78, blue: 0.42) : Color(red: 0.188, green: 0.212, blue: 0.278), lineWidth: 1)
                    )
                    .clipShape(RoundedRectangle(cornerRadius: 6))
                }

                Button {
                    withAnimation(.easeInOut(duration: 0.15)) {
                        boundariesExpanded.toggle()
                    }
                } label: {
                    Text("边界 \(viewModel.confirmedBoundaryCount)/5")
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(viewModel.confirmedBoundaryCount == 5 ? Color(red: 0.431, green: 0.906, blue: 0.718) : Color(red: 0.545, green: 0.573, blue: 0.647))
                        .padding(.horizontal, 12)
                        .frame(height: 36)
                        .background(Color(red: 0.098, green: 0.114, blue: 0.153))
                        .clipShape(RoundedRectangle(cornerRadius: 6))
                }

                Button {
                    viewModel.endSession()
                } label: {
                    Text("结束")
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(viewModel.selectedGroupId == nil ? Color.white.opacity(0.3) : Color.white.opacity(0.8))
                        .padding(.horizontal, 12)
                        .frame(height: 36)
                        .background(Color(red: 0.098, green: 0.114, blue: 0.153))
                        .clipShape(RoundedRectangle(cornerRadius: 6))
                }
                .disabled(viewModel.selectedGroupId == nil)
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .background(bgBar)
    }

    // MARK: - Ultra-Thin Status Strip

    private var ultraThinStatusStrip: some View {
        HStack(spacing: 10) {
            HStack(spacing: 4) {
                Circle()
                    .fill(viewModel.offlineMode ? Color(red: 0.91, green: 0.78, blue: 0.42) : (viewModel.connectionState == .connected ? Color(red: 0.204, green: 0.827, blue: 0.600) : Color(red: 1.0, green: 0.51, blue: 0.48)))
                    .frame(width: 6, height: 6)
                Text(viewModel.offlineMode ? "离线" : (viewModel.connectionState == .connected ? viewModel.activeModel : "未连接"))
                    .font(.system(size: 10))
                    .foregroundStyle(Color(red: 0.420, green: 0.447, blue: 0.522))
                    .lineLimit(1)
            }

            HStack(spacing: 4) {
                Circle()
                    .fill(viewModel.isSenseVoiceActive ? Color(red: 0.204, green: 0.827, blue: 0.600) : (viewModel.isSpeechReady ? accent : Color(red: 0.91, green: 0.78, blue: 0.42)))
                    .frame(width: 6, height: 6)
                Text(speechStatusLabel)
                    .font(.system(size: 10))
                    .foregroundStyle(Color(red: 0.420, green: 0.447, blue: 0.522))
                    .lineLimit(1)
            }

            Spacer()

            if !viewModel.statusMessage.isEmpty {
                Text(viewModel.statusMessage)
                    .font(.system(size: 10))
                    .foregroundStyle(accent)
                    .lineLimit(1)
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 6)
        .background(bgStatus)
    }

    private var speechStatusLabel: String {
        if case .downloading(let progress, let dlMB, let totMB, _) = viewModel.modelDownloadState {
            return "SenseVoice \(Int(progress * 100))% (\(dlMB)/\(totMB)MB)"
        }
        if viewModel.isTranscribing {
            return "SenseVoice 转写中…"
        }
        return (viewModel.isSenseVoiceActive ? "SenseVoice 就绪" : "Apple 端侧就绪") + " · \(viewModel.capturedCount) 句"
    }
}

struct NewGroupSheet: View {
    @ObservedObject var viewModel: IOSCopilotViewModel
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var company = ""
    @State private var industry = ""

    var body: some View {
        NavigationStack {
            Form {
                Section("客户分组信息") {
                    TextField("分组名称（如：XX政务局售前调研）", text: $name)
                    TextField("客户单位", text: $company)
                    TextField("所属行业（如：政务/金融/制造）", text: $industry)
                }
            }
            .navigationTitle("新建客户分组")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("取消") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("创建") {
                        Task {
                            _ = await viewModel.createGroup(name: name, company: company, industry: industry)
                            dismiss()
                        }
                    }
                    .disabled(name.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
        }
    }
}

struct SettingsSheet: View {
    @ObservedObject var viewModel: IOSCopilotViewModel
    @Environment(\.dismiss) private var dismiss
    @State private var urlDraft = ""

    var body: some View {
        NavigationStack {
            Form {
                Section("云端 Agent 服务（V3.0 FDE · Mastra + DeepSeek）") {
                    TextField("云端地址", text: $urlDraft)
                        .keyboardType(.URL)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                    Button("保存并重新连接") {
                        viewModel.updateCloudURL(urlDraft)
                        dismiss()
                    }
                }

                Section("提问建议触发策略") {
                    Toggle("自动触发提词（每 \(viewModel.autoHintThreshold) 句自动提示）", isOn: $viewModel.autoHintEnabled)
                    if viewModel.autoHintEnabled {
                        Stepper("自动提词句数阈值：\(viewModel.autoHintThreshold) 句", value: $viewModel.autoHintThreshold, in: 2...15)
                    } else {
                        Text("当前为「静默录音 + 手动点击按钮按需提词」模式，会议中不刷屏、不打扰。")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }

                Section("端侧隐私与语音引擎（Sherpa-ONNX int8 SenseVoice）") {
                    Toggle("涉密离线模式（暂停云端 Agent）", isOn: $viewModel.offlineMode)
                    Toggle("保留本机原始录音 WAV（绝不上传）", isOn: $viewModel.retainLocalAudioFile)
                    Text("当前引擎：\(viewModel.speechMode.displayText)")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    if case .downloading(let progress, let dlMB, let totMB, let mirror) = viewModel.modelDownloadState {
                        VStack(alignment: .leading, spacing: 6) {
                            ProgressView(value: progress)
                            HStack {
                                Text("\(mirror) 下载中 \(Int(progress * 100))% (\(dlMB)/\(totMB) MB)")
                                    .font(.caption.monospacedDigit())
                                Spacer()
                                Button("取消") { viewModel.cancelModelDownload() }
                            }
                        }
                    } else if viewModel.isSenseVoiceActive {
                        Button("删除本地 SenseVoice 模型 (~226MB)", role: .destructive) {
                            viewModel.deleteLocalModel()
                        }
                    } else {
                        Button("下载 SenseVoice int8 模型 (~226MB)") {
                            viewModel.startModelDownload()
                        }
                    }
                }
            }
            .navigationTitle("设置")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("完成") { dismiss() }
                }
            }
            .onAppear { urlDraft = viewModel.cloudBaseURLString }
        }
    }
}
