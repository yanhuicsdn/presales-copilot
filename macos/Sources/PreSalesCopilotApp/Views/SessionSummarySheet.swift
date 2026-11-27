import SwiftUI
import AppKit
import UniformTypeIdentifiers
import PreSalesCore

struct SessionSummarySheet: View {
    let summary: MeetingSummary
    let groupName: String
    let onDeleteLocalAudio: () -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var copied = false

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                VStack(alignment: .leading) {
                    Text("会话结束 · 结构化沟通纪要")
                        .font(.title3.bold())
                    Text("客户分组：\(groupName)")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Spacer()

                Button(copied ? "已复制" : "复制文本") {
                    NSPasteboard.general.clearContents()
                    NSPasteboard.general.setString(summary.markdown, forType: .string)
                    copied = true
                }

                Button("导出 Markdown") {
                    exportMarkdown()
                }
                .buttonStyle(.borderedProminent)

                Button("导出 PDF") {
                    exportPDF()
                }

                Button("删除本地原始录音", role: .destructive) {
                    onDeleteLocalAudio()
                }

                Button("关闭") { dismiss() }
            }
            .padding()

            Divider()

            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    GroupBox("一、沟通纪要") {
                        Text(summary.minutes)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .textSelection(.enabled)
                            .padding(6)
                    }

                    GroupBox("二、客户痛点清单") {
                        VStack(alignment: .leading, spacing: 8) {
                            ForEach(Array(summary.painPoints.enumerated()), id: \.element.id) { idx, item in
                                Text("\(idx + 1). \(item.title)（归属：\(item.rootCauseCategory)）— \(item.description)")
                                    .frame(maxWidth: .infinity, alignment: .leading)
                            }
                            if summary.painPoints.isEmpty {
                                Text("暂未提取明确痛点").foregroundStyle(.secondary)
                            }
                        }
                        .padding(6)
                    }

                    GroupBox("三、已确认边界") {
                        let b = summary.confirmedBoundaries
                        VStack(alignment: .leading, spacing: 4) {
                            Text("• 数据位置：\(b.dataLocation ?? "待确认")")
                            Text("• 网络环境：\(b.networkType ?? "待确认")")
                            Text("• 数据量级：\(b.dataVolume ?? "待确认")")
                            Text("• 使用终端：\(b.terminalType ?? "待确认")")
                            Text("• 保密要求：\(b.confidentiality ?? "待确认")")
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(6)
                    }

                    GroupBox("四、待确认事项与下一步行动建议") {
                        VStack(alignment: .leading, spacing: 6) {
                            ForEach(summary.unconfirmedItems, id: \.self) { item in
                                Text("☐ \(item)")
                            }
                            Divider()
                            ForEach(Array(summary.nextActions.enumerated()), id: \.offset) { idx, act in
                                Text("\(idx + 1). \(act)")
                            }
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(6)
                    }
                }
                .padding()
            }
        }
        .frame(minWidth: 760, minHeight: 560)
    }

    private func exportMarkdown() {
        let panel = NSSavePanel()
        panel.nameFieldStringValue = "售前沟通纪要-\(groupName).md"
        panel.allowedContentTypes = [.plainText]
        if panel.runModal() == .OK, let url = panel.url {
            try? summary.markdown.write(to: url, atomically: true, encoding: .utf8)
        }
    }

    private func exportPDF() {
        let panel = NSSavePanel()
        panel.nameFieldStringValue = "售前沟通纪要-\(groupName).pdf"
        panel.allowedContentTypes = [.pdf]
        guard panel.runModal() == .OK, let url = panel.url else { return }

        let textView = NSTextView(frame: NSRect(x: 0, y: 0, width: 520, height: 740))
        textView.string = summary.markdown
        textView.font = NSFont.systemFont(ofSize: 12)
        let data = textView.dataWithPDF(inside: textView.bounds)
        try? data.write(to: url)
    }
}
