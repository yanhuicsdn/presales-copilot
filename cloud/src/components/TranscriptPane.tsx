'use client';

import React, { useState } from 'react';
import { Check, Edit3, Send, Sparkles, X } from 'lucide-react';
import type { TranscriptSegment } from '@/lib/types';

interface TranscriptPaneProps {
  segments: TranscriptSegment[];
  pendingCount: number;
  offlineMode: boolean;
  disabled: boolean;
  onSendSimulatedTranscript: (text: string) => Promise<void>;
  onEditSegment: (segmentId: string, newText: string) => Promise<void>;
}

const PRESET_UTTERANCES = [
  {
    label: 'S0 破冰介绍',
    text: '你好，我们是法务和业务审核部门，平时每天要审大量供应商合同和报销单据。',
  },
  {
    label: '触发打断方案先行',
    text: '我们领导想直接私有化部署 DeepSeek 大模型加 RAG 知识库，你们看需要几张显卡？',
  },
  {
    label: '触发场景还原',
    text: '反正现在老系统特别不好用，资料很乱，大家效率低得很。',
  },
  {
    label: '具体痛点画面',
    text: '具体就是业务员每天上传 PDF 合同到审批系统，点人工比对条款，期望 5 分钟标出风险，实际系统不支持条款比对，全靠人工逐字核对要花 2 小时还经常漏审。',
  },
  {
    label: 'S2 明确根因',
    text: '这个确实是现有老系统功能做不到自动比对，而且跨部门审批流程口径也不统一。',
  },
  {
    label: 'S3 确认五项边界',
    text: '数据目前存在本地机房数据库，环境是纯内网隔离，存量大概 50 万份合同，员工主要在 PC端浏览器使用，属于商密数据不可出内网。',
  },
  {
    label: 'S4 痛点排序确认',
    text: '可以，同意按刚才梳理的来，合同人工审核耗时易漏排第一 P0 优先解决，接下来聊聊解决思路吧。',
  },
];

export function TranscriptPane({
  segments,
  pendingCount,
  offlineMode,
  disabled,
  onSendSimulatedTranscript,
  onEditSegment,
}: TranscriptPaneProps) {
  const [inputText, setInputText] = useState('');
  const [sending, setSending] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim() || disabled || sending) return;
    setSending(true);
    try {
      await onSendSimulatedTranscript(inputText.trim());
      setInputText('');
    } finally {
      setSending(false);
    }
  };

  const handleSaveEdit = async (segmentId: string) => {
    if (!editingText.trim()) return;
    await onEditSegment(segmentId, editingText.trim());
    setEditingId(null);
    setEditingText('');
  };

  return (
    <section className="flex flex-col h-full border-r border-slate-800 bg-slate-950/60">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-800/80 bg-slate-900/40">
        <div>
          <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-300">
            实时转写字幕流（左侧栏）
          </h2>
          <p className="text-[11px] text-slate-500">
            按客户分组有序重组 · 点击单条可手动修正并重新触发云端分析
          </p>
        </div>
        <span className="rounded bg-slate-800 px-2 py-0.5 text-[11px] text-slate-300 font-mono">
          共 {segments.length} 条{pendingCount > 0 ? ` · 待补传 ${pendingCount}` : ''}
        </span>
      </div>

      {/* Transcript Stream */}
      <div className="flex-1 overflow-y-auto p-4 space-y-2.5">
        {segments.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center text-slate-500 py-12">
            <Sparkles className="h-8 w-8 mb-2 text-slate-700" />
            <p className="text-sm text-slate-400">等待 Mac 本地 SenseVoice 转写文本上行</p>
            <p className="text-xs text-slate-500 mt-1 max-w-sm">
              可使用下方快捷话术或手动输入，模拟 macOS 客户端流式推送文本分片至云端 Mastra Agent。
            </p>
          </div>
        ) : (
          segments.map((seg) => (
            <div
              key={seg.id}
              className="group rounded-lg border border-slate-800/90 bg-slate-900/70 p-3 hover:border-slate-700 transition"
            >
              <div className="flex items-center justify-between text-[11px] text-slate-500 mb-1">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-indigo-400 font-semibold">#{seg.seq}</span>
                  <span>{new Date(seg.startedAt).toLocaleTimeString('zh-CN', { hour12: false })}</span>
                  {seg.edited && (
                    <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] text-amber-300">
                      已修正
                    </span>
                  )}
                </div>
                {editingId !== seg.id && (
                  <button
                    type="button"
                    onClick={() => {
                      setEditingId(seg.id);
                      setEditingText(seg.text);
                    }}
                    className="opacity-0 group-hover:opacity-100 inline-flex items-center gap-1 text-slate-400 hover:text-indigo-300 transition"
                  >
                    <Edit3 className="h-3 w-3" />
                    修正文本
                  </button>
                )}
              </div>

              {editingId === seg.id ? (
                <div className="space-y-2 mt-1">
                  <textarea
                    rows={2}
                    value={editingText}
                    onChange={(e) => setEditingText(e.target.value)}
                    className="w-full rounded border border-indigo-500 bg-slate-950 p-2 text-xs text-slate-100 focus:outline-none"
                  />
                  <div className="flex justify-end gap-1.5">
                    <button
                      type="button"
                      onClick={() => setEditingId(null)}
                      className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-slate-400 hover:bg-slate-800"
                    >
                      <X className="h-3 w-3" /> 取消
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleSaveEdit(seg.id)}
                      className="inline-flex items-center gap-1 rounded bg-indigo-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-indigo-500"
                    >
                      <Check className="h-3 w-3" /> 保存并重新分析
                    </button>
                  </div>
                </div>
              ) : (
                <p className="text-sm leading-relaxed text-slate-200">{seg.text}</p>
              )}
            </div>
          ))
        )}
      </div>

      {/* Simulator Quick Presets + Input */}
      <div className="no-print border-t border-slate-800 bg-slate-900/70 p-3 space-y-2">
        <div className="flex flex-wrap gap-1.5">
          {PRESET_UTTERANCES.map((preset) => (
            <button
              key={preset.label}
              type="button"
              disabled={disabled || sending}
              onClick={() => void onSendSimulatedTranscript(preset.text)}
              className="rounded-full border border-slate-700 bg-slate-800/80 px-2.5 py-1 text-[11px] text-slate-300 hover:border-indigo-500 hover:text-white disabled:opacity-40 transition"
            >
              {preset.label}
            </button>
          ))}
        </div>

        <form onSubmit={handleSubmit} className="flex items-center gap-2">
          <input
            type="text"
            disabled={disabled}
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            placeholder={
              offlineMode
                ? '离线模式：输入文本将先写入本地待传队列，恢复联网后自动补发...'
                : '输入模拟现场客户发言（回车发送至 Mastra 云端 Agent）...'
            }
            className="flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-100 placeholder:text-slate-500 focus:border-indigo-500 focus:outline-none disabled:opacity-40"
          />
          <button
            type="submit"
            disabled={disabled || sending || !inputText.trim()}
            className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3.5 py-2 text-xs font-medium text-white hover:bg-indigo-500 disabled:opacity-40 transition"
          >
            <Send className="h-3.5 w-3.5" />
            {offlineMode ? '暂存本地' : '上行分析'}
          </button>
        </form>
      </div>
    </section>
  );
}
