'use client';

import React from 'react';
import { Cpu, Database, Radio, UploadCloud } from 'lucide-react';

interface StatusBarProps {
  wsConnected: boolean;
  offlineMode: boolean;
  providerMode: string;
  pendingQueueCount: number;
  bufferedSeqs: number[];
}

export function StatusBar({
  wsConnected,
  offlineMode,
  providerMode,
  pendingQueueCount,
  bufferedSeqs,
}: StatusBarProps) {
  return (
    <footer className="no-print border-t border-slate-800 bg-slate-900 px-4 py-1.5 flex flex-wrap items-center justify-between gap-4 text-[11px] text-slate-400">
      <div className="flex items-center gap-4">
        <span className="inline-flex items-center gap-1.5">
          <Radio
            className={`h-3.5 w-3.5 ${
              offlineMode ? 'text-amber-400' : wsConnected ? 'text-emerald-400' : 'text-rose-400'
            }`}
          />
          网络状态：{offlineMode ? '离线涉密模式（仅本地转写）' : wsConnected ? 'WebSocket 长连接正常' : '连接断开'}
        </span>

        <span className="inline-flex items-center gap-1.5">
          <Cpu className="h-3.5 w-3.5 text-indigo-400" />
          本地转录引擎：Sherpa-ONNX int8 SenseVoice（音频零外传）
        </span>

        <span className="inline-flex items-center gap-1.5">
          <Database className="h-3.5 w-3.5 text-sky-400" />
          云端引擎：Mastra ({providerMode === 'deepseek' ? 'DeepSeek API' : '规则增强模式'})
        </span>
      </div>

      <div className="flex items-center gap-3 font-mono">
        <span className="inline-flex items-center gap-1">
          <UploadCloud className="h-3.5 w-3.5 text-slate-400" />
          待传队列：{pendingQueueCount}
        </span>
        {bufferedSeqs.length > 0 && (
          <span className="text-amber-300">云端乱序空洞暂存：[{bufferedSeqs.join(', ')}]</span>
        )}
      </div>
    </footer>
  );
}
