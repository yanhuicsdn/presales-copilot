'use client';

import React from 'react';
import { X } from 'lucide-react';
import {
  NINE_SKILLS,
  SEVEN_COMMUNICATION_PRINCIPLES,
  TECH_ANALOGY_LIBRARY,
} from '@/lib/skills';

interface SkillsDrawerProps {
  open: boolean;
  onClose: () => void;
}

export function SkillsDrawer({ open, onClose }: SkillsDrawerProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-xs">
      <div className="h-full w-full max-w-xl bg-slate-900 border-l border-slate-800 flex flex-col shadow-2xl">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-800">
          <div>
            <h2 className="text-sm font-semibold text-white">沟通方法论 Skill 规则库（完整版）</h2>
            <p className="text-xs text-slate-400">7 大底层原则 · 9 大 Skill · 技术概念降维比喻库</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-6 text-xs">
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-indigo-400 mb-2.5">
              七大底层沟通原则
            </h3>
            <div className="space-y-1.5">
              {SEVEN_COMMUNICATION_PRINCIPLES.map((p) => (
                <div key={p.code} className="rounded-lg border border-slate-800 bg-slate-950/60 p-2.5">
                  <span className="font-semibold text-white">
                    {p.index}. {p.title}：
                  </span>
                  <span className="text-slate-300">{p.description}</span>
                </div>
              ))}
            </div>
          </div>

          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-indigo-400 mb-2.5">
              九个核心 Skill 规则
            </h3>
            <div className="space-y-2">
              {NINE_SKILLS.map((sk) => (
                <div key={sk.id} className="rounded-lg border border-slate-800 bg-slate-950/60 p-3 space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-white text-sm">{sk.name}</span>
                    <span className="font-mono text-[11px] text-indigo-300">
                      允许阶段：{sk.allowedStages.join(', ')}
                    </span>
                  </div>
                  <p className="text-slate-400">
                    <strong className="text-slate-300">触发条件：</strong>
                    {sk.triggerCondition}
                  </p>
                  <p className="text-indigo-200">
                    <strong className="text-slate-300">话术模板：</strong>“{sk.promptTemplate}”
                  </p>
                  <p className="text-emerald-300/90">
                    <strong className="text-slate-300">完成标准：</strong>
                    {sk.completionCriteria}
                  </p>
                </div>
              ))}
            </div>
          </div>

          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-indigo-400 mb-2.5">
              技术概念降维翻译比喻库
            </h3>
            <div className="space-y-2">
              {TECH_ANALOGY_LIBRARY.map((item) => (
                <div key={item.concept} className="rounded-lg border border-slate-800 bg-slate-950/60 p-2.5">
                  <div className="font-medium text-white">
                    {item.concept} → <span className="text-amber-300">{item.analogy}</span>
                  </div>
                  <p className="text-slate-400 mt-0.5">{item.script}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
