import SwiftUI
import PreSalesCore

struct MainSplitView: View {
    @ObservedObject var viewModel: CopilotViewModel
    @State private var showNewGroupPopover = false
    @State private var newGroupName = ""
    @State private var newGroupCompany = ""
    @State private var newGroupIndustry = ""

    var body: some View {
        VStack(spacing: 0) {
            TopToolbarView(
                viewModel: viewModel,
                showNewGroupPopover: $showNewGroupPopover,
                newGroupName: $newGroupName,
                newGroupCompany: $newGroupCompany,
                newGroupIndustry: $newGroupIndustry
            )

            Divider()

            HSplitView {
                TranscriptPaneView(viewModel: viewModel)
                    .frame(minWidth: 380, idealWidth: 460)

                QuestionCardPaneView(viewModel: viewModel)
                    .frame(minWidth: 500)
            }

            Divider()

            StatusBarView(viewModel: viewModel)
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
}

struct TopToolbarView: View {
    @ObservedObject var viewModel: CopilotViewModel
    @Binding var showNewGroupPopover: Bool
    @Binding var newGroupName: String
    @Binding var newGroupCompany: String
    @Binding var newGroupIndustry: String

    var body: some View {
        VStack(spacing: 10) {
            HStack(spacing: 12) {
                Picker("客户分组", selection: Binding(
                    get: { viewModel.selectedGroupId ?? "" },
                    set: { if !$0.isEmpty { viewModel.selectGroup($0) } }
                )) {
                    if viewModel.groups.isEmpty {
                        Text("暂无分组").tag("")
                    }
                    ForEach(viewModel.groups) { grp in
                        Text("[\(grp.stage ?? "S0")] \(grp.name)").tag(grp.id)
                    }
                }
                .frame(width: 240)

                Button("新建分组") {
                    showNewGroupPopover = true
                }
                .popover(isPresented: $showNewGroupPopover) {
                    VStack(alignment: .leading, spacing: 10) {
                        Text("新建客户分组").font(.headline)
                        TextField("分组名称（如：XX集团售前调研）", text: $newGroupName)
                        TextField("客户单位", text: $newGroupCompany)
                        TextField("所属行业", text: $newGroupIndustry)
                        HStack {
                            Spacer()
                            Button("取消") { showNewGroupPopover = false }
                            Button("创建") {
                                let name = newGroupName
                                let company = newGroupCompany
                                let ind = newGroupIndustry
                                Task {
                                    await viewModel.createGroup(name: name, company: company, industry: ind)
                                    newGroupName = ""
                                    newGroupCompany = ""
                                    newGroupIndustry = ""
                                    showNewGroupPopover = false
                                }
                            }
                            .buttonStyle(.borderedProminent)
                            .disabled(newGroupName.trimmingCharacters(in: .whitespaces).isEmpty)
                        }
                    }
                    .padding()
                    .frame(width: 300)
                }

                Spacer()

                if !viewModel.isRecording {
                    Button(action: { viewModel.startOrResumeRecording() }) {
                        Label(viewModel.isPaused ? "继续录音" : "开始录音", systemImage: "mic.fill")
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(.green)
                    .disabled(viewModel.selectedGroupId == nil)
                } else {
                    Button(action: { viewModel.pauseRecording() }) {
                        Label("暂停", systemImage: "pause.fill")
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(.orange)
                }

                Button(action: { viewModel.endSession() }) {
                    Label("结束会话", systemImage: "stop.fill")
                }
                .buttonStyle(.borderedProminent)
                .tint(.red)
                .disabled(viewModel.selectedGroupId == nil)

                Toggle("涉密离线", isOn: $viewModel.offlineMode)
                    .toggleStyle(.switch)
                    .help("涉密场景关闭联网，降级为纯本地转录模式")
            }

            // S0-S5 Stage Indicator
            HStack(spacing: 8) {
                ForEach(StageCode.allCases, id: \.self) { stage in
                    let isCurrent = stage == viewModel.currentStage
                    let isDone = stage.orderIndex < viewModel.currentStage.orderIndex
                    HStack(spacing: 4) {
                        Text(stage.rawValue).fontWeight(.bold)
                        Text(stage.displayName)
                    }
                    .font(.caption)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 4)
                    .background(
                        isCurrent ? Color.accentColor.opacity(0.22) :
                        isDone ? Color.green.opacity(0.15) : Color.secondary.opacity(0.1)
                    )
                    .overlay(
                        Capsule().stroke(
                            isCurrent ? Color.accentColor :
                            isDone ? Color.green.opacity(0.5) : Color.clear,
                            lineWidth: 1
                        )
                    )
                    .clipShape(Capsule())
                }
                Spacer()
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .background(.ultraThinMaterial)
    }
}

struct TranscriptPaneView: View {
    @ObservedObject var viewModel: CopilotViewModel
    @State private var manualInput = ""
    @State private var editingSegmentId: String?
    @State private var editingDraft = ""

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Text("实时转写字幕流（100% 本地推理）")
                    .font(.headline)
                Spacer()
                Text("\(viewModel.segments.count) 条")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            .padding(12)

            Divider()

            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 10) {
                        ForEach(viewModel.segments) { seg in
                            VStack(alignment: .leading, spacing: 4) {
                                HStack {
                                    Text("#\(seg.seq)")
                                        .font(.caption.monospaced())
                                        .foregroundStyle(Color.accentColor)
                                    if seg.edited {
                                        Text("已修正")
                                            .font(.caption2)
                                            .padding(.horizontal, 5)
                                            .background(Color.orange.opacity(0.2))
                                            .clipShape(RoundedRectangle(cornerRadius: 4))
                                    }
                                    Spacer()
                                    Button("修正") {
                                        editingSegmentId = seg.id
                                        editingDraft = seg.text
                                    }
                                    .buttonStyle(.borderless)
                                    .font(.caption)
                                }

                                if editingSegmentId == seg.id {
                                    TextField("修正转写文本", text: $editingDraft)
                                        .textFieldStyle(.roundedBorder)
                                    HStack {
                                        Button("取消") { editingSegmentId = nil }
                                        Button("保存并重传") {
                                            viewModel.editSegment(segmentId: seg.id, newText: editingDraft)
                                            editingSegmentId = nil
                                        }
                                        .buttonStyle(.borderedProminent)
                                    }
                                } else {
                                    Text(seg.text)
                                        .font(.body)
                                        .textSelection(.enabled)
                                }
                            }
                            .padding(10)
                            .background(Color(nsColor: .controlBackgroundColor))
                            .clipShape(RoundedRectangle(cornerRadius: 8))
                            .id(seg.id)
                        }
                    }
                    .padding(12)
                }
                .onChange(of: viewModel.segments.count) { _, _ in
                    if let last = viewModel.segments.last {
                        proxy.scrollTo(last.id, anchor: .bottom)
                    }
                }
            }

            Divider()

            HStack {
                TextField("手动补充转写文本（或联调输入）...", text: $manualInput)
                    .textFieldStyle(.roundedBorder)
                    .onSubmit {
                        viewModel.submitTranscriptText(manualInput)
                        manualInput = ""
                    }
                Button("上行") {
                    viewModel.submitTranscriptText(manualInput)
                    manualInput = ""
                }
                .disabled(manualInput.trimmingCharacters(in: .whitespaces).isEmpty || viewModel.selectedGroupId == nil)
            }
            .padding(10)
        }
    }
}

struct QuestionCardPaneView: View {
    @ObservedObject var viewModel: CopilotViewModel
    @State private var alternativesExpanded = true

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Text("云端推送问题卡片")
                    .font(.headline)

                if let card = viewModel.latestCard {
                    // Risk Tags
                    HStack(spacing: 8) {
                        ForEach(card.riskTags) { tag in
                            Label(tag.label, systemImage: "exclamationmark.triangle.fill")
                                .font(.caption.weight(.semibold))
                                .padding(.horizontal, 10)
                                .padding(.vertical, 5)
                                .background(riskColor(tag.level).opacity(0.18))
                                .foregroundStyle(riskColor(tag.level))
                                .clipShape(Capsule())
                        }
                    }

                    // Primary Highlighted Question
                    VStack(alignment: .leading, spacing: 10) {
                        HStack {
                            Text("推荐主问题 · 可直接照着念")
                                .font(.caption.weight(.bold))
                                .foregroundStyle(.white)
                                .padding(.horizontal, 8)
                                .padding(.vertical, 3)
                                .background(Color.accentColor)
                                .clipShape(RoundedRectangle(cornerRadius: 6))
                            Spacer()
                            Button("复制") {
                                NSPasteboard.general.clearContents()
                                NSPasteboard.general.setString(card.primaryQuestion, forType: .string)
                            }
                            .buttonStyle(.bordered)
                        }

                        Text("“\(card.primaryQuestion)”")
                            .font(.title2.weight(.semibold))
                            .fixedSize(horizontal: false, vertical: true)
                            .textSelection(.enabled)

                        Text("策略依据：\(card.rationale)")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    .padding(18)
                    .background(Color.accentColor.opacity(0.08))
                    .overlay(
                        RoundedRectangle(cornerRadius: 14)
                            .stroke(Color.accentColor.opacity(0.6), lineWidth: 2)
                    )
                    .clipShape(RoundedRectangle(cornerRadius: 14))

                    // Alternative Questions (Collapsible)
                    DisclosureGroup("备选问题（\(card.alternativeQuestions.count) 条）", isExpanded: $alternativesExpanded) {
                        VStack(alignment: .leading, spacing: 10) {
                            ForEach(Array(card.alternativeQuestions.enumerated()), id: \.offset) { idx, q in
                                HStack(alignment: .top, spacing: 8) {
                                    Text("\(idx + 1).")
                                        .font(.callout.monospaced().bold())
                                        .foregroundStyle(.secondary)
                                    Text(q)
                                        .font(.body)
                                        .textSelection(.enabled)
                                    Spacer()
                                }
                                .padding(10)
                                .background(Color(nsColor: .controlBackgroundColor))
                                .clipShape(RoundedRectangle(cornerRadius: 8))
                            }
                        }
                        .padding(.top, 8)
                    }
                    .padding(12)
                    .background(Color(nsColor: .windowBackgroundColor))
                    .overlay(
                        RoundedRectangle(cornerRadius: 10)
                            .stroke(Color.secondary.opacity(0.25), lineWidth: 1)
                    )
                } else {
                    ContentUnavailableView(
                        "等待云端推送问题卡片",
                        systemImage: "sparkles",
                        description: Text("开始录音后，Mac 本地转写文本将实时推送至云端 Mastra Agent，3 秒内返回候选提问话术。")
                    )
                    .padding(.top, 60)
                }
            }
            .padding(16)
        }
    }

    private func riskColor(_ level: RiskLevel) -> Color {
        switch level {
        case .high: return .red
        case .medium: return .orange
        case .low: return .green
        }
    }
}

struct StatusBarView: View {
    @ObservedObject var viewModel: CopilotViewModel

    var body: some View {
        HStack(spacing: 16) {
            Label(connectionLabel, systemImage: connectionIcon)
                .foregroundStyle(connectionColor)
            Divider().frame(height: 12)
            Text(viewModel.modelStatus.displayText)
            Spacer()
            Text("待传队列：\(viewModel.pendingQueueCount)")
                .font(.caption.monospaced())
        }
        .font(.caption)
        .padding(.horizontal, 14)
        .padding(.vertical, 6)
        .background(.bar)
    }

    private var connectionLabel: String {
        switch viewModel.connectionState {
        case .connected: return "云端已连接"
        case .connecting: return "连接中..."
        case .disconnected: return "网络已断开（本地缓存中）"
        case .offlineConfidential: return "涉密离线模式（仅本地转写）"
        }
    }

    private var connectionIcon: String {
        switch viewModel.connectionState {
        case .connected: return "wifi"
        case .connecting: return "wifi.exclamationmark"
        case .disconnected: return "wifi.slash"
        case .offlineConfidential: return "lock.shield"
        }
    }

    private var connectionColor: Color {
        switch viewModel.connectionState {
        case .connected: return .green
        case .connecting: return .orange
        case .disconnected: return .red
        case .offlineConfidential: return .yellow
        }
    }
}
