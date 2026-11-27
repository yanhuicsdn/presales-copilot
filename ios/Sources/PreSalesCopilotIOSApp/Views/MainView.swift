import SwiftUI
import UIKit
import PreSalesIOSCore

struct MainView: View {
    @ObservedObject var viewModel: IOSCopilotViewModel
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass

    @State private var activeTab = 0 // 0 = 问题卡片, 1 = 实时字幕
    @State private var showNewGroupSheet = false
    @State private var showSettingsSheet = false

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                stageStrip

                if horizontalSizeClass == .regular {
                    // iPad Split Layout
                    HStack(spacing: 0) {
                        TranscriptPaneIOSView(viewModel: viewModel)
                            .frame(maxWidth: .infinity)
                        Divider()
                        QuestionCardPaneIOSView(viewModel: viewModel)
                            .frame(maxWidth: .infinity)
                    }
                } else {
                    // iPhone Compact Layout with Quick Switcher
                    Picker("视图切换", selection: $activeTab) {
                        Text("问题卡片").tag(0)
                        Text("实时字幕 (\(viewModel.segments.count))").tag(1)
                    }
                    .pickerStyle(.segmented)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 8)

                    if activeTab == 0 {
                        QuestionCardPaneIOSView(viewModel: viewModel)
                    } else {
                        TranscriptPaneIOSView(viewModel: viewModel)
                    }
                }

                Divider()
                recordingControlDock
            }
            .navigationTitle("售前智问分身")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Menu {
                        ForEach(viewModel.groups) { grp in
                            Button {
                                viewModel.selectGroup(grp.id)
                            } label: {
                                Label("[\(grp.stage ?? "S0")] \(grp.name)", systemImage: grp.id == viewModel.selectedGroupId ? "checkmark" : "folder")
                            }
                        }
                        Divider()
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
                        HStack(spacing: 4) {
                            Image(systemName: "person.2.fill")
                            Text(viewModel.activeGroupName)
                                .lineLimit(1)
                                .frame(maxWidth: 140)
                            Image(systemName: "chevron.down")
                                .font(.caption2)
                        }
                        .font(.subheadline.weight(.medium))
                    }
                }

                ToolbarItem(placement: .topBarTrailing) {
                    HStack(spacing: 12) {
                        Button {
                            viewModel.offlineMode.toggle()
                        } label: {
                            Image(systemName: viewModel.offlineMode ? "lock.shield.fill" : (viewModel.connectionState == .connected ? "wifi" : "wifi.slash"))
                                .foregroundStyle(viewModel.offlineMode ? .orange : (viewModel.connectionState == .connected ? .green : .red))
                        }
                        .accessibilityLabel(viewModel.offlineMode ? "关闭涉密离线模式" : "开启涉密离线模式")

                        Button {
                            showSettingsSheet = true
                        } label: {
                            Image(systemName: "gearshape")
                        }
                    }
                }
            }
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
            .alert("提示", isPresented: Binding(
                get: { viewModel.statusErrorMessage != nil },
                set: { if !$0 { viewModel.statusErrorMessage = nil } }
            )) {
                Button("确定", role: .cancel) { viewModel.statusErrorMessage = nil }
            } message: {
                Text(viewModel.statusErrorMessage ?? "")
            }
        }
    }

    private var stageStrip: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
                ForEach(StageCode.allCases, id: \.self) { stage in
                    let isCurrent = stage == viewModel.currentStage
                    let isDone = stage.orderIndex < viewModel.currentStage.orderIndex
                    HStack(spacing: 3) {
                        Text(stage.rawValue).fontWeight(.bold)
                        Text(stage.displayName)
                    }
                    .font(.caption2)
                    .padding(.horizontal, 9)
                    .padding(.vertical, 5)
                    .background(
                        isCurrent ? Color.accentColor.opacity(0.2) :
                        isDone ? Color.green.opacity(0.15) : Color(.secondarySystemBackground)
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
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
        }
        .background(Color(.systemBackground))
    }

    private var recordingControlDock: some View {
        VStack(spacing: 6) {
            HStack(spacing: 10) {
                if !viewModel.isRecording {
                    Button {
                        viewModel.startOrResumeRecording()
                    } label: {
                        Label(viewModel.isPaused ? "继续录音" : "开始录音", systemImage: "mic.fill")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(.green)
                    .disabled(viewModel.selectedGroupId == nil)
                } else {
                    Button {
                        viewModel.pauseRecording()
                    } label: {
                        Label("暂停", systemImage: "pause.fill")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(.orange)
                }

                Button {
                    viewModel.endSession()
                } label: {
                    Label("结束生成纪要", systemImage: "stop.fill")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .tint(.red)
                .disabled(viewModel.selectedGroupId == nil)
            }

            HStack {
                Text(viewModel.speechMode.displayText)
                    .lineLimit(1)
                Spacer()
                Text("待传: \(viewModel.pendingQueueCount)")
                    .monospacedDigit()
            }
            .font(.caption2)
            .foregroundStyle(.secondary)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .background(.ultraThinMaterial)
    }
}

struct QuestionCardPaneIOSView: View {
    @ObservedObject var viewModel: IOSCopilotViewModel
    @State private var altsExpanded = true
    @State private var copied = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                if let card = viewModel.latestCard {
                    // Risk Tags
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 8) {
                            ForEach(card.riskTags) { tag in
                                Label(tag.label, systemImage: "exclamationmark.triangle.fill")
                                    .font(.caption.weight(.semibold))
                                    .padding(.horizontal, 10)
                                    .padding(.vertical, 5)
                                    .background(riskColor(tag.level).opacity(0.16))
                                    .foregroundStyle(riskColor(tag.level))
                                    .clipShape(Capsule())
                            }
                        }
                    }

                    // Highlighted Primary Question
                    VStack(alignment: .leading, spacing: 10) {
                        HStack {
                            Text("推荐主问题 · 可直接照着念")
                                .font(.caption.weight(.bold))
                                .foregroundStyle(.white)
                                .padding(.horizontal, 8)
                                .padding(.vertical, 4)
                                .background(Color.accentColor)
                                .clipShape(RoundedRectangle(cornerRadius: 6))
                            Spacer()
                            Button(copied ? "已复制" : "复制") {
                                UIPasteboard.general.string = card.primaryQuestion
                                copied = true
                                DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { copied = false }
                            }
                            .font(.caption)
                            .buttonStyle(.bordered)
                        }

                        Text("“\(card.primaryQuestion)”")
                            .font(.title3.weight(.semibold))
                            .fixedSize(horizontal: false, vertical: true)

                        ScrollView(.horizontal, showsIndicators: false) {
                            HStack(spacing: 6) {
                                ForEach(card.matchedSkills, id: \.self) { sk in
                                    Text(SkillDisplayNames.label(for: sk))
                                        .font(.caption2.weight(.medium))
                                        .padding(.horizontal, 8)
                                        .padding(.vertical, 3)
                                        .background(Color.accentColor.opacity(0.15))
                                        .clipShape(RoundedRectangle(cornerRadius: 5))
                                }
                            }
                        }

                        Text("策略依据：\(card.rationale)")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    .padding(16)
                    .background(Color.accentColor.opacity(0.08))
                    .overlay(
                        RoundedRectangle(cornerRadius: 14)
                            .stroke(Color.accentColor.opacity(0.6), lineWidth: 1.5)
                    )
                    .clipShape(RoundedRectangle(cornerRadius: 14))

                    // Alternative Questions
                    DisclosureGroup("备选问题（\(card.alternativeQuestions.count) 条）", isExpanded: $altsExpanded) {
                        VStack(alignment: .leading, spacing: 8) {
                            ForEach(Array(card.alternativeQuestions.enumerated()), id: \.offset) { idx, q in
                                HStack(alignment: .top, spacing: 8) {
                                    Text("\(idx + 1).")
                                        .font(.callout.monospaced().bold())
                                        .foregroundStyle(.secondary)
                                    Text(q)
                                        .font(.subheadline)
                                    Spacer()
                                    Button {
                                        UIPasteboard.general.string = q
                                    } label: {
                                        Image(systemName: "doc.on.doc")
                                            .font(.caption)
                                    }
                                    .buttonStyle(.borderless)
                                }
                                .padding(10)
                                .background(Color(.secondarySystemBackground))
                                .clipShape(RoundedRectangle(cornerRadius: 8))
                            }
                        }
                        .padding(.top, 8)
                    }
                    .padding(12)
                    .background(Color(.systemBackground))
                    .overlay(
                        RoundedRectangle(cornerRadius: 12)
                            .stroke(Color(.separator), lineWidth: 0.6)
                    )

                    // Five Boundary Tracker
                    if let b = viewModel.checkpoint?.boundaries {
                        VStack(alignment: .leading, spacing: 6) {
                            Text("五项边界约束进度")
                                .font(.caption.weight(.semibold))
                                .foregroundStyle(.secondary)
                            boundaryRow("数据位置", b.dataLocation)
                            boundaryRow("内外网环境", b.networkType)
                            boundaryRow("数据量级", b.dataVolume)
                            boundaryRow("使用终端", b.terminalType)
                            boundaryRow("保密要求", b.confidentiality)
                        }
                        .padding(12)
                        .background(Color(.secondarySystemBackground))
                        .clipShape(RoundedRectangle(cornerRadius: 12))
                    }
                } else {
                    ContentUnavailableView(
                        "等待云端推送问题卡片",
                        systemImage: "sparkles",
                        description: Text("选择客户分组并点击「开始录音」，端侧转写文本将实时推送至云端 Mastra + DeepSeek Agent 并返回候选提问。")
                    )
                    .padding(.top, 40)
                }
            }
            .padding(14)
        }
    }

    private func boundaryRow(_ label: String, _ value: String?) -> some View {
        HStack {
            Text(label).font(.caption).foregroundStyle(.secondary)
            Spacer()
            Text(value ?? "待确认")
                .font(.caption.weight(.medium))
                .foregroundStyle(value == nil ? .orange : .green)
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

struct TranscriptPaneIOSView: View {
    @ObservedObject var viewModel: IOSCopilotViewModel
    @State private var manualText = ""
    @State private var editingId: String?
    @State private var editingDraft = ""

    var body: some View {
        VStack(spacing: 0) {
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 10) {
                        ForEach(viewModel.segments) { seg in
                            VStack(alignment: .leading, spacing: 6) {
                                HStack {
                                    Text("#\(seg.seq)")
                                        .font(.caption.monospaced().bold())
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
                                        editingId = seg.id
                                        editingDraft = seg.text
                                    }
                                    .font(.caption)
                                }

                                if editingId == seg.id {
                                    TextField("修正转写文本", text: $editingDraft)
                                        .textFieldStyle(.roundedBorder)
                                    HStack {
                                        Button("取消") { editingId = nil }
                                        Spacer()
                                        Button("保存重算") {
                                            viewModel.editSegment(segmentId: seg.id, newText: editingDraft)
                                            editingId = nil
                                        }
                                        .buttonStyle(.borderedProminent)
                                    }
                                } else {
                                    Text(seg.text)
                                        .font(.subheadline)
                                }
                            }
                            .padding(10)
                            .background(Color(.secondarySystemBackground))
                            .clipShape(RoundedRectangle(cornerRadius: 10))
                            .id(seg.id)
                        }

                        if !viewModel.partialTranscript.isEmpty {
                            Text("正在识别：\(viewModel.partialTranscript)")
                                .font(.footnote)
                                .foregroundStyle(.secondary)
                                .padding(8)
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

            HStack(spacing: 8) {
                TextField("输入补充文本（或模拟客户发言）...", text: $manualText)
                    .textFieldStyle(.roundedBorder)
                Button("发送") {
                    viewModel.submitTranscriptText(manualText)
                    manualText = ""
                }
                .buttonStyle(.borderedProminent)
                .disabled(manualText.trimmingCharacters(in: .whitespaces).isEmpty || viewModel.selectedGroupId == nil)
            }
            .padding(10)
        }
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
                    TextField("分组名称（如：XX集团售前访谈）", text: $name)
                    TextField("客户单位", text: $company)
                    TextField("所属行业（如：政务/能源/制造）", text: $industry)
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
                            await viewModel.createGroup(name: name, company: company, industry: industry)
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
                Section("云端 Agent 服务（Next.js + Mastra + DeepSeek）") {
                    TextField("云端地址", text: $urlDraft)
                        .keyboardType(.URL)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                    Button("保存并重新连接") {
                        viewModel.updateCloudURL(urlDraft)
                        dismiss()
                    }
                }

                Section("端侧隐私与录音设置") {
                    Toggle("涉密离线模式（暂停云端 Agent）", isOn: $viewModel.offlineMode)
                    Toggle("保留本机原始录音 WAV（绝不上传）", isOn: $viewModel.retainLocalAudioFile)
                    Text("端侧引擎：\(viewModel.speechMode.displayText)")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Text("录音期间自动保持屏幕常亮并支持后台音频保活，来电打断后自动暂停。")
                        .font(.caption)
                        .foregroundStyle(.secondary)
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
