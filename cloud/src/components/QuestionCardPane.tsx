'use client';

import React, { useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Copy,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { SKILL_MAP, STAGE_DEFINITIONS } from '@/lib/skills';
import type { GroupCheckpoint, QuestionCard } from '@/lib/types';

interface QuestionCardPaneProps {
  latestCard: QuestionCard | null;
  checkpoint: GroupCheckpoint | null;
  loading: boolean;
}

export function QuestionCardPane({ latestCard, checkpoint, loading }: QuestionCardPaneProps) {
  const [altsExpanded, setAltsExpanded] = useState(true);
  const [copied, setCopied] = useState(false);

  const handleCopy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore clipboard errors
    }
  };

  const levelStyles = {
    high: 'border-rose-500/50 bg-rose-500/15 text-rose-200',
    medium: 'border-amber-500/50 bg-amber-500/15 text-amber-200',
    low: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
  };

  return (
    <section className="flex flex-col h-full bg-slate-950 overflow-y-auto p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-300">
            云端推送问题卡片区（右侧栏）
          </h2>
          <p className="text-[11px] text-slate-500">
            Mastra 工作流实时分析 → 策略路由 → 自校验闭环推送
          </p>
        </div>
        {latestCard && (
          <div className="flex items-center gap-2 text-[11px] text-slate-400 font-mono">
            <span>耗时 {latestCard.latencyMs}ms</span>
            <span className="rounded bg-slate-800 px-1.5 py-0.5 text-indigo-300">
              {latestCard.providerMode === 'deepseek' ? 'DeepSeek API' : 'Mastra 规则引擎'}
            </span>
          </div>
        )}
      </div>

      {loading && (
        <div className="rounded-xl border border-indigo-500/40 bg-indigo-500/10 px-4 py-3 text-xs text-indigo-200 animate-pulse">
          Mastra Agent 正在执行：六维分析 → Skill 策略路由 → 问题生成与自校验...
        </div>
      )}

      {!latestCard ? (
        <div className="flex-1 flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-800 p-8 text-center">
          <Sparkles className="h-9 w-9 text-indigo-500/50 mb-3" />
          <p className="text-sm font-medium text-slate-300">暂无问题卡片</p>
          <p className="text-xs text-slate-500 mt-1 max-w-sm">
            当左侧收到客户转写文本后，云端 Mastra 引擎将在 3 秒内推送主问题（可直接照着念）、2-4 条备选问题及风险提示标签。
          </p>
        </div>
      ) : (
        <>
          {/* Risk Tags */}
          <div className="flex flex-wrap gap-2">
            {latestCard.riskTags.map((tag) => (
              <div
                key={tag.code}
                title={tag.reason}
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium ${levelStyles[tag.level]}`}
              >
                <AlertTriangle className="h-3.5 w-3.5" />
                <span>{tag.label}</span>
              </div>
            ))}
            {latestCard.validation.passed && (
              <div className="inline-flex items-center gap-1 rounded-full border border-indigo-500/40 bg-indigo-500/10 px-2.5 py-1 text-xs text-indigo-300">
                <ShieldCheck className="h-3.5 w-3.5" />
                自校验通过（第 {latestCard.validation.attempts} 轮）
              </div>
            )}
          </div>

          {/* Highlighted Primary Question */}
          <div className="rounded-2xl border-2 border-indigo-500/70 bg-gradient-to-br from-indigo-950/80 via-slate-900 to-slate-900 p-5 shadow-lg shadow-indigo-950/40">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <span className="rounded-md bg-indigo-600 px-2 py-0.5 text-[11px] font-bold text-white">
                  推荐主问题 · 可直接照着念
                </span>
                <span className="text-xs text-indigo-300 font-medium">
                  {latestCard.stage} {STAGE_DEFINITIONS[latestCard.stage].name}
                </span>
              </div>
              <button
                type="button"
                onClick={() => void handleCopy(latestCard.primaryQuestion)}
                className="inline-flex items-center gap-1 rounded-md border border-indigo-500/40 bg-indigo-500/15 px-2.5 py-1 text-xs text-indigo-200 hover:bg-indigo-500/30 transition"
              >
                <Copy className="h-3 w-3" />
                {copied ? '已复制' : '复制话术'}
              </button>
            </div>
            <p className="text-xl font-semibold leading-relaxed text-white tracking-wide">
              “{latestCard.primaryQuestion}”
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-indigo-500/20 pt-3">
              <span className="text-[11px] text-slate-400">命中 Skill：</span>
              {latestCard.matchedSkills.map((sk) => (
                <span
                  key={sk}
                  className="rounded bg-indigo-500/20 border border-indigo-400/30 px-2 py-0.5 text-[11px] font-medium text-indigo-200"
                >
                  {SKILL_MAP[sk]?.name ?? sk}
                </span>
              ))}
            </div>
            <p className="mt-2 text-xs text-slate-400">策略依据：{latestCard.rationale}</p>
          </div>

          {/* Collapsible Alternative Questions (1-4) */}
          <div className="rounded-xl border border-slate-800 bg-slate-900/60 overflow-hidden">
            <button
              type="button"
              onClick={() => setAltsExpanded((v) => !v)}
              className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-slate-800/50 transition"
            >
              <span className="text-xs font-semibold text-slate-200">
                备选问题（{latestCard.alternativeQuestions.length} 条）
              </span>
              {altsExpanded ? (
                <ChevronUp className="h-4 w-4 text-slate-400" />
              ) : (
                <ChevronDown className="h-4 w-4 text-slate-400" />
              )}
            </button>
            {altsExpanded && (
              <div className="divide-y divide-slate-800/80 border-t border-slate-800">
                {latestCard.alternativeQuestions.map((q, idx) => (
                  <div
                    key={idx}
                    className="flex items-start justify-between gap-3 px-4 py-3 hover:bg-slate-800/30"
                  >
                    <div className="flex gap-2.5">
                      <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-800 text-[11px] font-mono text-slate-300">
                        {idx + 1}
                      </span>
                      <p className="text-sm text-slate-200 leading-relaxed">{q}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleCopy(q)}
                      className="shrink-0 text-slate-500 hover:text-indigo-300"
                      title="复制此备选问题"
                    >
                      <Copy className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 6-Dimension Analysis & Boundary Slots */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-3.5 space-y-2">
              <h3 className="text-xs font-semibold text-slate-300">六维实时诊断</h3>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="rounded bg-slate-950/70 px-2.5 py-1.5">
                  <span className="text-slate-500">是否跑偏：</span>
                  <span className={latestCard.analysis.offTopic ? 'text-rose-400 font-medium' : 'text-emerald-400'}>
                    {latestCard.analysis.offTopic ? '是（方案先行）' : '否'}
                  </span>
                </div>
                <div className="rounded bg-slate-950/70 px-2.5 py-1.5">
                  <span className="text-slate-500">抽象程度：</span>
                  <span className="text-slate-200">{latestCard.analysis.abstractness}</span>
                </div>
                <div className="rounded bg-slate-950/70 px-2.5 py-1.5">
                  <span className="text-slate-500">信息完整度：</span>
                  <span className="text-slate-200">{latestCard.analysis.completeness}</span>
                </div>
                <div className="rounded bg-slate-950/70 px-2.5 py-1.5">
                  <span className="text-slate-500">逻辑矛盾：</span>
                  <span className={latestCard.analysis.contradiction ? 'text-rose-400 font-medium' : 'text-emerald-400'}>
                    {latestCard.analysis.contradiction ? '存在矛盾' : '一致'}
                  </span>
                </div>
                <div className="rounded bg-slate-950/70 px-2.5 py-1.5">
                  <span className="text-slate-500">客户情绪：</span>
                  <span className="text-slate-200">{latestCard.analysis.emotion}</span>
                </div>
                <div className="rounded bg-slate-950/70 px-2.5 py-1.5">
                  <span className="text-slate-500">痛点清晰度：</span>
                  <span className="text-indigo-300 font-mono">{latestCard.analysis.painPointClarity}/100</span>
                </div>
              </div>
            </div>

            {checkpoint && (
              <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-3.5 space-y-2">
                <h3 className="text-xs font-semibold text-slate-300">五项边界槽位追踪</h3>
                <div className="space-y-1 text-xs">
                  {(
                    [
                      ['数据位置', checkpoint.boundaries.dataLocation],
                      ['内外网环境', checkpoint.boundaries.networkType],
                      ['数据量级', checkpoint.boundaries.dataVolume],
                      ['使用终端', checkpoint.boundaries.terminalType],
                      ['保密要求', checkpoint.boundaries.confidentiality],
                    ] as const
                  ).map(([label, val]) => (
                    <div key={label} className="flex items-center justify-between rounded bg-slate-950/60 px-2.5 py-1">
                      <span className="text-slate-400">{label}</span>
                      {val ? (
                        <span className="inline-flex items-center gap-1 text-emerald-300">
                          <CheckCircle2 className="h-3 w-3" /> {val}
                        </span>
                      ) : (
                        <span className="text-slate-600">待确认</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </section>
  );
}
