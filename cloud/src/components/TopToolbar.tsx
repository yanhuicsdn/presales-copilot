'use client';

import React, { useState } from 'react';
import {
  BookOpen,
  Mic,
  Pause,
  Plus,
  Square,
  Wifi,
  WifiOff,
  ShieldAlert,
} from 'lucide-react';
import type { StageCode } from '@/lib/types';

const STAGES: Array<{ code: StageCode; label: string }> = [
  { code: 'S0', label: '破冰开场' },
  { code: 'S1', label: '痛点挖掘' },
  { code: 'S2', label: '根因分析' },
  { code: 'S3', label: '边界确认' },
  { code: 'S4', label: '痛点收敛' },
  { code: 'S5', label: '方案探讨' },
];

export interface GroupSummaryItem {
  id: string;
  name: string;
  customerCompany: string;
  industry: string;
  stage: string;
  segmentCount: number;
}

interface TopToolbarProps {
  groups: GroupSummaryItem[];
  activeGroupId: string | null;
  currentStage: StageCode;
  recordingState: 'idle' | 'recording' | 'paused';
  wsConnected: boolean;
  offlineMode: boolean;
  onSelectGroup: (groupId: string) => void;
  onCreateGroup: (name: string, company: string, industry: string) => Promise<void>;
  onStartRecording: () => void;
  onPauseRecording: () => void;
  onEndSession: () => void;
  onToggleOffline: () => void;
  onOpenSkills: () => void;
}

export function TopToolbar({
  groups,
  activeGroupId,
  currentStage,
  recordingState,
  wsConnected,
  offlineMode,
  onSelectGroup,
  onCreateGroup,
  onStartRecording,
  onPauseRecording,
  onEndSession,
  onToggleOffline,
  onOpenSkills,
}: TopToolbarProps) {
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newCompany, setNewCompany] = useState('');
  const [newIndustry, setNewIndustry] = useState('');

  const activeStageIdx = STAGES.findIndex((s) => s.code === currentStage);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    await onCreateGroup(newName.trim(), newCompany.trim(), newIndustry.trim());
    setNewName('');
    setNewCompany('');
    setNewIndustry('');
    setCreating(false);
  };

  return (
    <header className="no-print border-b border-slate-800 bg-slate-900/90 backdrop-blur px-4 py-2.5 flex flex-col gap-2.5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {/* Left: Brand + Group Selector */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-600 text-xs font-bold text-white shadow">
              智
            </span>
            <div>
              <h1 className="text-sm font-semibold text-white leading-none">
                售前智问分身 · PreSales Copilot
              </h1>
              <p className="text-[11px] text-slate-400 mt-0.5">
                Next.js + Mastra 云端 Agent · 本地转写零音频外传
              </p>
            </div>
          </div>

          <div className="h-5 w-px bg-slate-800" />

          <div className="flex items-center gap-1.5">
            <select
              aria-label="选择客户分组"
              value={activeGroupId ?? ''}
              onChange={(e) => onSelectGroup(e.target.value)}
              className="rounded-md border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-slate-100 focus:border-indigo-500 focus:outline-none min-w-[200px]"
            >
              {groups.length === 0 && <option value="">请新建客户分组...</option>}
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  [{g.stage}] {g.name} ({g.segmentCount}条)
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => setCreating((v) => !v)}
              className="inline-flex items-center gap-1 rounded-md border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-700 transition"
            >
              <Plus className="h-3.5 w-3.5" />
              新建分组
            </button>
          </div>
        </div>

        {/* Right: Recording Controls & Status */}
        <div className="flex items-center gap-2">
          {recordingState !== 'recording' ? (
            <button
              type="button"
              disabled={!activeGroupId}
              onClick={onStartRecording}
              className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-40 transition"
            >
              <Mic className="h-3.5 w-3.5" />
              {recordingState === 'paused' ? '继续录音' : '开始会话'}
            </button>
          ) : (
            <button
              type="button"
              onClick={onPauseRecording}
              className="inline-flex items-center gap-1.5 rounded-md bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-500 transition"
            >
              <Pause className="h-3.5 w-3.5" />
              暂停
            </button>
          )}

          <button
            type="button"
            disabled={!activeGroupId}
            onClick={onEndSession}
            className="inline-flex items-center gap-1.5 rounded-md bg-rose-600/90 px-3 py-1.5 text-xs font-medium text-white hover:bg-rose-500 disabled:opacity-40 transition"
          >
            <Square className="h-3.5 w-3.5" />
            结束并生成纪要
          </button>

          <button
            type="button"
            onClick={onToggleOffline}
            title="涉密场景可开启离线模式，仅本地暂存转写文本，恢复联网后补传"
            className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition ${
              offlineMode
                ? 'border-amber-500/60 bg-amber-500/15 text-amber-300'
                : 'border-slate-700 bg-slate-800/80 text-slate-300 hover:bg-slate-700'
            }`}
          >
            {offlineMode ? <ShieldAlert className="h-3.5 w-3.5" /> : wsConnected ? <Wifi className="h-3.5 w-3.5 text-emerald-400" /> : <WifiOff className="h-3.5 w-3.5 text-rose-400" />}
            {offlineMode ? '涉密离线模式' : wsConnected ? '云端已连接' : '重连中'}
          </button>

          <button
            type="button"
            onClick={onOpenSkills}
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-700 transition"
          >
            <BookOpen className="h-3.5 w-3.5" />
            9 大 Skill 库
          </button>
        </div>
      </div>

      {/* Inline New Group Form */}
      {creating && (
        <form
          onSubmit={handleCreate}
          className="flex flex-wrap items-center gap-2 rounded-lg border border-indigo-500/40 bg-slate-950/90 p-2.5"
        >
          <input
            type="text"
            required
            placeholder="客户分组名称（如：XX政务局智能审批项目）"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            className="flex-1 min-w-[200px] rounded border border-slate-700 bg-slate-900 px-2.5 py-1 text-xs text-white focus:border-indigo-500 focus:outline-none"
          />
          <input
            type="text"
            placeholder="客户单位"
            value={newCompany}
            onChange={(e) => setNewCompany(e.target.value)}
            className="w-40 rounded border border-slate-700 bg-slate-900 px-2.5 py-1 text-xs text-white focus:border-indigo-500 focus:outline-none"
          />
          <input
            type="text"
            placeholder="所属行业（如：政务/制造）"
            value={newIndustry}
            onChange={(e) => setNewIndustry(e.target.value)}
            className="w-36 rounded border border-slate-700 bg-slate-900 px-2.5 py-1 text-xs text-white focus:border-indigo-500 focus:outline-none"
          />
          <button
            type="submit"
            className="rounded bg-indigo-600 px-3 py-1 text-xs font-medium text-white hover:bg-indigo-500"
          >
            确认创建
          </button>
          <button
            type="button"
            onClick={() => setCreating(false)}
            className="rounded px-2 py-1 text-xs text-slate-400 hover:text-slate-200"
          >
            取消
          </button>
        </form>
      )}

      {/* Stage Stepper S0-S5 */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
        {STAGES.map((st, idx) => {
          const isCurrent = st.code === currentStage;
          const isCompleted = idx < activeStageIdx;
          return (
            <div
              key={st.code}
              className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium border transition shrink-0 ${
                isCurrent
                  ? 'border-indigo-400 bg-indigo-500/20 text-indigo-200 shadow-sm shadow-indigo-500/20'
                  : isCompleted
                  ? 'border-emerald-600/40 bg-emerald-500/10 text-emerald-300'
                  : 'border-slate-800 bg-slate-950/60 text-slate-500'
              }`}
            >
              <span className="font-mono font-bold">{st.code}</span>
              <span>{st.label}</span>
            </div>
          );
        })}
      </div>
    </header>
  );
}
