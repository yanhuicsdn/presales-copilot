'use client';

import React, { useState } from 'react';
import { Copy, Download, Printer, X } from 'lucide-react';
import type { MeetingSummary } from '@/lib/types';

interface SessionSummaryViewProps {
  summary: MeetingSummary;
  groupName: string;
  onClose: () => void;
}

export function SessionSummaryView({ summary, groupName, onClose }: SessionSummaryViewProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(summary.markdown);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const handleDownloadMd = () => {
    const blob = new Blob([summary.markdown], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `售前沟通纪要-${groupName}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handlePrintPdf = () => {
    window.print();
  };

  const b = summary.confirmedBoundaries;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="max-h-[90vh] w-full max-w-3xl flex flex-col rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl overflow-hidden">
        <div className="no-print flex items-center justify-between border-b border-slate-800 px-5 py-3.5">
          <div>
            <h2 className="text-base font-semibold text-white">会话结束 · 结构化沟通纪要</h2>
            <p className="text-xs text-slate-400">客户分组：{groupName}</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void handleCopy()}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-700"
            >
              <Copy className="h-3.5 w-3.5" />
              {copied ? '已复制' : '复制文本'}
            </button>
            <button
              type="button"
              onClick={handleDownloadMd}
              className="inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-500"
            >
              <Download className="h-3.5 w-3.5" />
              导出 Markdown
            </button>
            <button
              type="button"
              onClick={handlePrintPdf}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-700"
            >
              <Printer className="h-3.5 w-3.5" />
              导出 PDF
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-md p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-5 text-sm">
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-indigo-400 mb-2">
              一、沟通纪要总览
            </h3>
            <p className="whitespace-pre-line leading-relaxed text-slate-200 rounded-lg bg-slate-950/60 p-4 border border-slate-800">
              {summary.minutes}
            </p>
          </div>

          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-indigo-400 mb-2">
              二、客户痛点清单（{summary.painPoints.length}）
            </h3>
            {summary.painPoints.length === 0 ? (
              <p className="text-xs text-slate-500">暂未提取到明确痛点。</p>
            ) : (
              <div className="space-y-2">
                {summary.painPoints.map((p, idx) => (
                  <div
                    key={p.id}
                    className="rounded-lg border border-slate-800 bg-slate-950/60 p-3 flex items-start justify-between gap-3"
                  >
                    <div>
                      <div className="font-medium text-white">
                        {idx + 1}. {p.title}
                        {p.priority != null && (
                          <span className="ml-2 rounded bg-rose-500/20 px-1.5 py-0.5 text-[11px] text-rose-300">
                            P{p.priority}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-slate-400 mt-1">{p.description}</p>
                    </div>
                    <span className="shrink-0 rounded bg-slate-800 px-2 py-0.5 text-[11px] text-slate-300">
                      归属：{p.rootCauseCategory}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-indigo-400 mb-2">
              三、已确认边界约束
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
              {(
                [
                  ['数据位置', b.dataLocation],
                  ['网络环境', b.networkType],
                  ['数据量级', b.dataVolume],
                  ['使用终端', b.terminalType],
                  ['保密要求', b.confidentiality],
                ] as const
              ).map(([k, v]) => (
                <div key={k} className="rounded-lg border border-slate-800 bg-slate-950/60 p-2.5">
                  <div className="text-slate-500">{k}</div>
                  <div className={`mt-1 font-medium ${v ? 'text-emerald-300' : 'text-amber-400'}`}>
                    {v ?? '待确认'}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-amber-400 mb-2">
                四、待确认事项
              </h3>
              <ul className="list-disc pl-5 space-y-1 text-xs text-slate-300">
                {summary.unconfirmedItems.length > 0 ? (
                  summary.unconfirmedItems.map((item, i) => <li key={i}>{item}</li>)
                ) : (
                  <li className="text-emerald-400">全部核心项已确认闭环</li>
                )}
              </ul>
            </div>
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-emerald-400 mb-2">
                五、下一步行动建议
              </h3>
              <ol className="list-decimal pl-5 space-y-1 text-xs text-slate-300">
                {summary.nextActions.map((act, i) => (
                  <li key={i}>{act}</li>
                ))}
              </ol>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
