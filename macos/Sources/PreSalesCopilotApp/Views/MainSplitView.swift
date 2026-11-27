import SwiftUI
import PreSalesCore

/// Omarchy-aligned single-column, prompt-only dark focus interface for macOS.
/// No live transcript scrolling clutter — silently captures speech locally and delivers
/// crisp 10–24 char FDE V3.0 questions on demand via the prominent "获取提问建议" button.
struct MainSplitView: View {
    @ObservedObject var viewModel: CopilotViewModel
    @State private var showNewGroupSheet = false
    @State private var showSettingsSheet = false
    @State private var showShortcutsOverlay = false
    @State private var boundariesExpanded = false
    @State private var newGroupName = ""
    @State private var newGroupCompany = ""
    @State private var newGroupIndustry = ""

    private let bgCanvas = Color(red: 0.059, green: 0.067, blue: 0.082)   // #0f1115
    private let bgHeader = Color(red: 0.075, green: 0.086, blue: 0.110)   // #13161c
    private let bgBar    = Color(red: 0.071, green: 0.082, blue: 0.106)   // #12151b
    private let bgStatus = Color(red: 0.055, green: 0.063, blue: 0.078)   // #0e1014
    private let bgCard   = Color(red: 0.071, green: 0.082, blue: 0.110)   // #12151c
    private let lineCol  = Color(red: 0.114, green: 0.125, blue: 0.157)   // #1d2028
    private let accent   = Color(red: 0.451, green: 0.569, blue: 0.996)   // #7391fe

    var body: some View {
        ZStack {
            VStack(spacing: 0) {
                compactHeader
                Rectangle().fill(lineCol).frame(height: 1)

                promptFocusCanvas

                Rectangle().fill(lineCol).frame(height: 1)
                onDemandActionBar

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
            .background(bgCanvas)

            if showShortcutsOverlay {
                shortcutsOverlay
            }
        }
        .preferredColorScheme(.dark)
        .sheet(isPresented: $showNewGroupSheet) {
            newGroupSheet
        }
        .sheet(isPresented: $showSettingsSheet) {
            SettingsView(viewModel: viewModel)
                .frame(width: 460, height: 320)
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
        // Hidden shortcut buttons matching Omarchy keybindings
        .background(
            Group {
                Button("") { viewModel.toggleRecording() }
                    .keyboardShortcut(.space, modifiers: [])
                Button("") { viewModel.requestHint() }
                    .keyboardShortcut("g", modifiers: [])
                Button("") { viewModel.requestHint() }
                    .keyboardShortcut(.return, modifiers: [])
                Button("") { showNewGroupSheet = true }
                    .keyboardShortcut("n", modifiers: .command)
                Button("") { viewModel.offlineMode.toggle() }
                    .keyboardShortcut("o", modifiers: .command)
                Button("") { viewModel.endSession() }
                    .keyboardShortcut("e", modifiers: .command)
            }
            .opacity(0)
            .allowsHitTesting(false)
        )
    }

    // MARK: - Compact Single-Row Header (48px)

    private var compactHeader: some View {
        HStack(spacing: 8) {
            Menu {
                ForEach(viewModel.groups) { grp in
                    Button {
                        viewModel.selectGroup(grp.id)
                    } label: {
                        HStack {
                            Text("[\(grp.stage ?? "S0")] \(grp.name)")
                            if grp.id == viewModel.selectedGroupId {
                                Image(systemName: "checkmark")
                            }
                        }
                    }
                }
                if !viewModel.groups.isEmpty { Divider() }
                Button("新建客户分组…") { showNewGroupSheet = true }
                Button("刷新分组列表") { Task { await viewModel.refreshGroups() } }
            } label: {
                HStack(spacing: 5) {
                    Text(viewModel.activeGroupName)
                        .lineLimit(1)
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(.white)
                    Image(systemName: "chevron.down")
                        .font(.system(size: 9, weight: .semibold))
                        .foregroundStyle(Color.white.opacity(0.55))
                }
                .padding(.horizontal, 10)
                .frame(height: 30)
                .frame(maxWidth: 185, alignment: .leading)
                .background(Color(red: 0.110, green: 0.125, blue: 0.165))
                .clipShape(RoundedRectangle(cornerRadius: 6))
            }
            .menuStyle(.borderlessButton)
            .fixedSize()

            Button {
                showNewGroupSheet = true
            } label: {
                Image(systemName: "plus")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Color.white.opacity(0.8))
                    .frame(width: 28, height: 28)
            }
            .buttonStyle(.plain)
            .help("新建客户分组 (⌘N)")

            // Compact active stage pill
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
                HStack(spacing: 5) {
                    Circle()
                        .fill(viewModel.isTranscribing ? accent : Color(red: 1.0, green: 0.35, blue: 0.37))
                        .frame(width: 7, height: 7)
                    ZStack(alignment: .leading) {
                        Capsule()
                            .fill(Color(red: 0.15, green: 0.165, blue: 0.204))
                            .frame(width: 36, height: 4)
                        Capsule()
                            .fill(accent)
                            .frame(width: max(4, 36 * CGFloat(min(1.0, viewModel.audioLevel))), height: 4)
                    }
                }
            }

            // Record / Pause Pill (never disabled — auto-creates group on click)
            Button {
                viewModel.toggleRecording()
            } label: {
                HStack(spacing: 6) {
                    Circle()
                        .fill(viewModel.isRecording ? Color(red: 1.0, green: 0.35, blue: 0.37) : Color(red: 0.20, green: 0.83, blue: 0.60))
                        .frame(width: 7, height: 7)
                    Text(viewModel.isRecording ? "暂停" : (viewModel.isPaused ? "继续" : "录音"))
                        .font(.system(size: 12, weight: .bold))
                        .foregroundStyle(viewModel.isRecording ? Color(red: 0.96, green: 0.85, blue: 0.55) : Color.white)
                }
                .padding(.horizontal, 12)
                .frame(height: 30)
                .background(viewModel.isRecording ? Color(red: 0.173, green: 0.133, blue: 0.082) : Color(red: 0.122, green: 0.141, blue: 0.188))
                .overlay(
                    RoundedRectangle(cornerRadius: 6)
                        .stroke(viewModel.isRecording ? Color(red: 0.91, green: 0.78, blue: 0.42) : Color(red: 0.188, green: 0.212, blue: 0.278), lineWidth: 1)
                )
                .clipShape(RoundedRectangle(cornerRadius: 6))
            }
            .buttonStyle(.plain)
            .help("开始/暂停本地录音 (Space)")

            Button("结束") {
                viewModel.endSession()
            }
            .buttonStyle(.plain)
            .font(.system(size: 12, weight: .medium))
            .foregroundStyle(viewModel.selectedGroupId == nil ? Color.white.opacity(0.3) : Color.white.opacity(0.8))
            .padding(.horizontal, 6)
            .disabled(viewModel.selectedGroupId == nil)
            .help("结束会话并生成纪要 (⌘E)")

            Menu {
                Button(viewModel.autoHintEnabled
                       ? "自动提词：已开启（每 \(viewModel.autoHintThreshold) 句）"
                       : "自动提词：关闭（仅手动按钮）") {
                    viewModel.autoHintEnabled.toggle()
                }
                Button(viewModel.offlineMode ? "关闭涉密离线模式" : "开启涉密离线模式") {
                    viewModel.offlineMode.toggle()
                }
                Divider()
                Button("设置…") { showSettingsSheet = true }
                Button("快捷键说明") { showShortcutsOverlay = true }
            } label: {
                Text("⋯")
                    .font(.system(size: 17, weight: .bold))
                    .foregroundStyle(Color.white.opacity(0.75))
                    .frame(width: 28, height: 28)
            }
            .menuStyle(.borderlessButton)
            .fixedSize()
        }
        .padding(.horizontal, 14)
        .frame(height: 48)
        .background(bgHeader)
    }

    // MARK: - Single-Column Prompt-Only Focus Canvas

    private var promptFocusCanvas: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                if viewModel.isAnalyzing {
                    HStack(spacing: 8) {
                        if viewModel.latestCard == nil { Spacer() }
                        ProgressView()
                            .controlSize(.small)
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
                        // Top meta row: Ask Next + non-low risk pills + matched skill + Copy
                        HStack(spacing: 8) {
                            Text("建议追问")
                                .font(.system(size: 11, weight: .bold))
                                .foregroundStyle(accent)

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

                            Spacer()

                            Button("复制") {
                                viewModel.copyText(card.primaryQuestion)
                            }
                            .buttonStyle(.plain)
                            .font(.system(size: 11))
                            .foregroundStyle(Color(red: 0.486, green: 0.514, blue: 0.588))
                        }

                        // Large 1-sentence short prompt with left accent bar
                        HStack(alignment: .top, spacing: 14) {
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

                    // Compact clickable alternative short prompts
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
                                .padding(.vertical, 9)
                                .background(bgCard)
                                .clipShape(RoundedRectangle(cornerRadius: 6))
                            }
                            .buttonStyle(.plain)
                        }
                    }
                } else if !viewModel.isAnalyzing {
                    // Clean quiet empty state
                    VStack(spacing: 10) {
                        Text(viewModel.capturedCount > 0
                             ? "已静默采集 \(viewModel.capturedCount) 句对话"
                             : "后台静默倾听中")
                            .font(.system(size: 17, weight: .bold))
                            .foregroundStyle(Color(red: 0.831, green: 0.851, blue: 0.902))

                        Text(viewModel.capturedCount > 0
                             ? "需要提示时，点击下方「获取提问建议」即可生成简短提词。"
                             : "点击右上角「录音」(Space) 开始采集，需要时再点下方「获取提问建议」。")
                            .font(.system(size: 12))
                            .foregroundStyle(Color(red: 0.408, green: 0.439, blue: 0.522))
                            .multilineTextAlignment(.center)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.top, 76)
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
            .padding(24)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func boundaryRow(_ label: String, _ value: String?) -> some View {
        HStack {
            Text(label)
                .font(.system(size: 11))
                .foregroundStyle(Color(red: 0.431, green: 0.459, blue: 0.533))
                .frame(width: 78, alignment: .leading)
            Text((value?.isEmpty == false) ? value! : "待确认")
                .font(.system(size: 11, weight: .medium))
                .foregroundStyle((value?.isEmpty == false) ? Color(red: 0.431, green: 0.906, blue: 0.718) : Color(red: 0.545, green: 0.573, blue: 0.647))
            Spacer()
        }
    }

    // MARK: - Bottom On-Demand Action Bar (54px)

    private var onDemandActionBar: some View {
        HStack(spacing: 12) {
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
                .font(.system(size: 13, weight: .bold))
                .foregroundStyle(viewModel.canRequestHint ? Color.white : Color(red: 0.408, green: 0.439, blue: 0.522))
                .frame(maxWidth: .infinity)
                .frame(height: 36)
                .background(viewModel.canRequestHint ? accent : Color(red: 0.122, green: 0.141, blue: 0.188))
                .clipShape(RoundedRectangle(cornerRadius: 6))
            }
            .buttonStyle(.plain)
            .disabled(!viewModel.canRequestHint)
            .help("按需向云端请求简短提问建议 (G / Return)")

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
            .buttonStyle(.plain)
        }
        .padding(.horizontal, 16)
        .frame(height: 54)
        .background(bgBar)
    }

    // MARK: - Ultra-Thin Status Strip (24px)

    private var ultraThinStatusStrip: some View {
        HStack(spacing: 12) {
            HStack(spacing: 5) {
                Circle()
                    .fill(viewModel.offlineMode ? Color(red: 0.91, green: 0.78, blue: 0.42) : (viewModel.connectionState == .connected ? Color(red: 0.204, green: 0.827, blue: 0.600) : Color(red: 1.0, green: 0.51, blue: 0.48)))
                    .frame(width: 6, height: 6)
                Text(viewModel.offlineMode ? "涉密离线" : (viewModel.connectionState == .connected ? viewModel.activeModel : "未连接"))
                    .font(.system(size: 10))
                    .foregroundStyle(Color(red: 0.420, green: 0.447, blue: 0.522))
            }

            HStack(spacing: 5) {
                Circle()
                    .fill(viewModel.isSenseVoiceActive ? Color(red: 0.204, green: 0.827, blue: 0.600) : (viewModel.modelStatus.isReady ? accent : Color(red: 0.91, green: 0.78, blue: 0.42)))
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
        .frame(height: 24)
        .background(bgStatus)
    }

    private var speechStatusLabel: String {
        if case .downloading(let progress, let dlMB, let totMB, _) = viewModel.modelDownloadState {
            return "SenseVoice 下载中 \(Int(progress * 100))% (\(dlMB)/\(totMB)MB)"
        }
        if viewModel.isTranscribing {
            return "SenseVoice 本地转写中…"
        }
        return "\(viewModel.modelStatus.displayText) · 已采集 \(viewModel.capturedCount) 句"
    }

    // MARK: - Sheets & Overlays

    private var newGroupSheet: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("新建客户分组")
                .font(.headline)
            TextField("分组名称（如：XX政务局售前调研）", text: $newGroupName)
                .textFieldStyle(.roundedBorder)
            TextField("客户单位", text: $newGroupCompany)
                .textFieldStyle(.roundedBorder)
            TextField("所属行业（如：政务/金融/制造）", text: $newGroupIndustry)
                .textFieldStyle(.roundedBorder)
            HStack {
                Spacer()
                Button("取消") { showNewGroupSheet = false }
                Button("创建") {
                    let n = newGroupName
                    let c = newGroupCompany
                    let i = newGroupIndustry
                    Task {
                        _ = await viewModel.createGroup(name: n, company: c, industry: i)
                        newGroupName = ""
                        newGroupCompany = ""
                        newGroupIndustry = ""
                        showNewGroupSheet = false
                    }
                }
                .buttonStyle(.borderedProminent)
                .disabled(newGroupName.trimmingCharacters(in: .whitespaces).isEmpty)
            }
        }
        .padding(20)
        .frame(width: 360)
    }

    private var shortcutsOverlay: some View {
        ZStack {
            Color.black.opacity(0.7)
                .ignoresSafeArea()
                .onTapGesture { showShortcutsOverlay = false }

            VStack(alignment: .leading, spacing: 8) {
                Text("快捷键")
                    .font(.headline)
                    .foregroundStyle(.white)
                    .padding(.bottom, 4)
                Text("Space    — 开始 / 暂停本地录音")
                Text("G / ↵    — 获取简短提问建议")
                Text("⌘N       — 新建客户分组")
                Text("⌘O       — 切换涉密离线模式")
                Text("⌘E       — 结束会话并生成纪要")
            }
            .font(.system(size: 12).monospaced())
            .foregroundStyle(Color(red: 0.81, green: 0.83, blue: 0.88))
            .padding(20)
            .frame(width: 340, alignment: .leading)
            .background(Color(red: 0.090, green: 0.102, blue: 0.133))
            .overlay(RoundedRectangle(cornerRadius: 10).stroke(Color.white.opacity(0.12), lineWidth: 1))
            .clipShape(RoundedRectangle(cornerRadius: 10))
        }
    }
}
