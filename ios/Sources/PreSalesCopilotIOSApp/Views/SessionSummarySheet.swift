import SwiftUI
import UIKit
import PreSalesIOSCore

struct SessionSummarySheet: View {
    let summary: MeetingSummary
    let groupName: String
    let onDeleteLocalAudio: () -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var copied = false
    @State private var exportedPDFURL: URL?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    sectionCard(title: "一、沟通纪要总览") {
                        Text(summary.minutes)
                            .font(.subheadline)
                    }

                    sectionCard(title: "二、客户痛点清单（\(summary.painPoints.count)）") {
                        if summary.painPoints.isEmpty {
                            Text("暂未提取到明确痛点").font(.caption).foregroundStyle(.secondary)
                        } else {
                            VStack(alignment: .leading, spacing: 8) {
                                ForEach(Array(summary.painPoints.enumerated()), id: \.element.id) { idx, p in
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text("\(idx + 1). \(p.title)\(p.priority.map { " (P\($0))" } ?? "")")
                                            .font(.subheadline.weight(.semibold))
                                        Text("归属：\(p.rootCauseCategory) · \(p.description)")
                                            .font(.caption)
                                            .foregroundStyle(.secondary)
                                    }
                                }
                            }
                        }
                    }

                    sectionCard(title: "三、已确认边界约束") {
                        let b = summary.confirmedBoundaries
                        VStack(alignment: .leading, spacing: 4) {
                            Text("• 数据位置：\(b.dataLocation ?? "待确认")")
                            Text("• 网络环境：\(b.networkType ?? "待确认")")
                            Text("• 数据量级：\(b.dataVolume ?? "待确认")")
                            Text("• 使用终端：\(b.terminalType ?? "待确认")")
                            Text("• 保密要求：\(b.confidentiality ?? "待确认")")
                        }
                        .font(.subheadline)
                    }

                    sectionCard(title: "四、待确认事项") {
                        if summary.unconfirmedItems.isEmpty {
                            Text("全部核心项已确认闭环").font(.caption).foregroundStyle(.green)
                        } else {
                            VStack(alignment: .leading, spacing: 4) {
                                ForEach(summary.unconfirmedItems, id: \.self) { item in
                                    Text("☐ \(item)").font(.subheadline)
                                }
                            }
                        }
                    }

                    sectionCard(title: "五、下一步行动建议") {
                        VStack(alignment: .leading, spacing: 6) {
                            ForEach(Array(summary.nextActions.enumerated()), id: \.offset) { idx, act in
                                Text("\(idx + 1). \(act)").font(.subheadline)
                            }
                        }
                    }

                    VStack(spacing: 10) {
                        HStack(spacing: 10) {
                            Button {
                                UIPasteboard.general.string = summary.markdown
                                copied = true
                            } label: {
                                Label(copied ? "已复制文本" : "复制 Markdown", systemImage: "doc.on.doc")
                                    .frame(maxWidth: .infinity)
                            }
                            .buttonStyle(.bordered)

                            ShareLink(item: summary.markdown, subject: Text("售前沟通纪要 - \(groupName)")) {
                                Label("分享 Markdown", systemImage: "square.and.arrow.up")
                                    .frame(maxWidth: .infinity)
                            }
                            .buttonStyle(.borderedProminent)
                        }

                        if let pdfURL = exportedPDFURL {
                            ShareLink(item: pdfURL) {
                                Label("分享 / 保存 PDF 文件", systemImage: "doc.richtext")
                                    .frame(maxWidth: .infinity)
                            }
                            .buttonStyle(.bordered)
                        }

                        Button(role: .destructive) {
                            onDeleteLocalAudio()
                        } label: {
                            Label("删除本机原始录音文件", systemImage: "trash")
                                .frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.bordered)
                    }
                }
                .padding(16)
            }
            .navigationTitle("结构化沟通纪要")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("完成") { dismiss() }
                }
            }
            .onAppear {
                exportedPDFURL = renderSummaryPDF(markdown: summary.markdown, groupName: groupName)
            }
        }
    }

    private func sectionCard<Content: View>(title: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title)
                .font(.caption.weight(.bold))
                .foregroundStyle(Color.accentColor)
            content()
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(12)
        .background(Color(.secondarySystemBackground))
        .clipShape(RoundedRectangle(cornerRadius: 12))
    }

    private func renderSummaryPDF(markdown: String, groupName: String) -> URL? {
        let pageRect = CGRect(x: 0, y: 0, width: 595, height: 842)
        let renderer = UIGraphicsPDFRenderer(bounds: pageRect)
        let data = renderer.pdfData { ctx in
            ctx.beginPage()
            let attrs: [NSAttributedString.Key: Any] = [
                .font: UIFont.systemFont(ofSize: 12),
                .foregroundColor: UIColor.label
            ]
            let insetRect = pageRect.insetBy(dx: 36, dy: 36)
            (markdown as NSString).draw(in: insetRect, withAttributes: attrs)
        }
        let safeName = groupName.replacingOccurrences(of: "/", with: "-")
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("售前沟通纪要-\(safeName).pdf")
        do {
            try data.write(to: url)
            return url
        } catch {
            return nil
        }
    }
}
