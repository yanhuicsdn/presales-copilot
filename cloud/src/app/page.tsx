'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { TopToolbar, type GroupSummaryItem } from '@/components/TopToolbar';
import { TranscriptPane } from '@/components/TranscriptPane';
import { QuestionCardPane } from '@/components/QuestionCardPane';
import { StatusBar } from '@/components/StatusBar';
import { SessionSummaryView } from '@/components/SessionSummaryView';
import { SkillsDrawer } from '@/components/SkillsDrawer';
import type {
  GroupCheckpoint,
  IncomingSegmentPayload,
  MeetingSummary,
  QuestionCard,
  ServerWsMessage,
  StageCode,
  TranscriptSegment,
} from '@/lib/types';

export default function PreSalesCopilotConsolePage() {
  const [groups, setGroups] = useState<GroupSummaryItem[]>([]);
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null);
  const [checkpoint, setCheckpoint] = useState<GroupCheckpoint | null>(null);
  const [segments, setSegments] = useState<TranscriptSegment[]>([]);
  const [latestCard, setLatestCard] = useState<QuestionCard | null>(null);
  const [bufferedSeqs, setBufferedSeqs] = useState<number[]>([]);
  const [nextSeq, setNextSeq] = useState<number>(1);
  const [recordingState, setRecordingState] = useState<'idle' | 'recording' | 'paused'>('idle');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [wsConnected, setWsConnected] = useState(false);
  const [offlineMode, setOfflineMode] = useState(false);
  const [pendingQueue, setPendingQueue] = useState<IncomingSegmentPayload[]>([]);
  const [providerMode, setProviderMode] = useState<string>('deterministic');
  const [analyzing, setAnalyzing] = useState(false);
  const [summaryModal, setSummaryModal] = useState<MeetingSummary | null>(null);
  const [skillsOpen, setSkillsOpen] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const offlineRef = useRef(offlineMode);
  offlineRef.current = offlineMode;

  const fetchGroups = useCallback(async (selectIfEmpty = true) => {
    const res = await fetch('/api/groups');
    if (!res.ok) return;
    const data = await res.json();
    const list = (data.groups ?? []) as GroupSummaryItem[];
    setGroups(list);
    if (selectIfEmpty && list.length > 0) {
      setActiveGroupId((prev) => prev ?? list[0].id);
    }
  }, []);

  const loadGroupDetail = useCallback(async (groupId: string) => {
    const res = await fetch(`/api/groups/${groupId}`);
    if (!res.ok) return;
    const data = await res.json();
    setCheckpoint(data.checkpoint ?? null);
    setSegments(data.segments ?? []);
    setLatestCard(data.latestCard ?? null);
    setBufferedSeqs(data.bufferedSeqs ?? []);
    setNextSeq(data.group?.nextExpectedSeq ?? 1);
  }, []);

  useEffect(() => {
    void fetchGroups(true);
    fetch('/api/health')
      .then((r) => r.json())
      .then((d) => {
        if (d.providerMode) setProviderMode(d.providerMode);
      })
      .catch(() => undefined);
  }, [fetchGroups]);

  useEffect(() => {
    if (activeGroupId) {
      void loadGroupDetail(activeGroupId);
    }
  }, [activeGroupId, loadGroupDetail]);

  // WebSocket lifecycle
  useEffect(() => {
    if (offlineMode) {
      wsRef.current?.close();
      wsRef.current = null;
      setWsConnected(false);
      return;
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws${
      activeGroupId ? `?groupId=${encodeURIComponent(activeGroupId)}` : ''
    }`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      setWsConnected(true);
      if (activeGroupId) {
        ws.send(JSON.stringify({ type: 'subscribe', groupId: activeGroupId }));
      }
    };

    ws.onclose = () => {
      setWsConnected(false);
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data) as ServerWsMessage;
        if (msg.type === 'snapshot') {
          setCheckpoint(msg.checkpoint);
          setSegments(msg.segments);
          setLatestCard(msg.latestCard);
          setBufferedSeqs(msg.bufferedSeqs);
          setNextSeq(msg.group.nextExpectedSeq);
        } else if (msg.type === 'segment_ack') {
          setBufferedSeqs(msg.bufferedSeqs);
          setNextSeq(msg.nextExpectedSeq);
          if (activeGroupId) {
            void loadGroupDetail(activeGroupId);
          }
        } else if (msg.type === 'question_card') {
          setLatestCard(msg.card);
          setAnalyzing(false);
          if (activeGroupId) {
            void loadGroupDetail(activeGroupId);
            void fetchGroups(false);
          }
        } else if (msg.type === 'stage_updated') {
          setCheckpoint(msg.checkpoint);
          void fetchGroups(false);
        } else if (msg.type === 'session_summary') {
          setSummaryModal(msg.summary);
        }
      } catch {
        // ignore malformed frames
      }
    };

    return () => {
      ws.close();
    };
  }, [activeGroupId, offlineMode, loadGroupDetail, fetchGroups]);

  // Flush pending offline queue automatically upon reconnect
  useEffect(() => {
    if (!offlineMode && activeGroupId && pendingQueue.length > 0) {
      const batch = [...pendingQueue];
      setPendingQueue([]);
      setAnalyzing(true);
      fetch(`/api/groups/${activeGroupId}/segments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ segments: batch, triggerAnalyze: true }),
      })
        .then((r) => r.json())
        .then((data) => {
          if (data.card) setLatestCard(data.card);
          if (data.checkpoint) setCheckpoint(data.checkpoint);
          void loadGroupDetail(activeGroupId);
          void fetchGroups(false);
        })
        .finally(() => setAnalyzing(false));
    }
  }, [offlineMode, activeGroupId, pendingQueue, loadGroupDetail, fetchGroups]);

  const handleCreateGroup = async (name: string, company: string, industry: string) => {
    const res = await fetch('/api/groups', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, customerCompany: company, industry }),
    });
    if (!res.ok) return;
    const data = await res.json();
    await fetchGroups(false);
    setActiveGroupId(data.group.id);
    setCheckpoint(data.checkpoint);
    setSegments([]);
    setLatestCard(null);
    setNextSeq(1);
    setRecordingState('idle');
  };

  const handleStartRecording = async () => {
    if (!activeGroupId) return;
    const action = recordingState === 'paused' ? 'resume' : 'start';
    const res = await fetch(`/api/groups/${activeGroupId}/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, sessionId: sessionId ?? undefined }),
    });
    if (res.ok) {
      const data = await res.json();
      setSessionId(data.session.id);
    }
    setRecordingState('recording');
  };

  const handlePauseRecording = async () => {
    if (!activeGroupId) return;
    await fetch(`/api/groups/${activeGroupId}/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'pause', sessionId: sessionId ?? undefined }),
    });
    setRecordingState('paused');
  };

  const handleEndSession = async () => {
    if (!activeGroupId) return;
    const res = await fetch(`/api/groups/${activeGroupId}/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'end',
        sessionId: sessionId ?? undefined,
        generateSummaryOnEnd: true,
      }),
    });
    setRecordingState('idle');
    setSessionId(null);
    if (res.ok) {
      const data = await res.json();
      if (data.summary) setSummaryModal(data.summary);
    }
  };

  const handleSendTranscript = async (text: string) => {
    if (!activeGroupId) return;
    const seq = nextSeq;
    const curSessionId = sessionId || 'ses_console';
    setNextSeq((s) => s + 1);

    const payload: IncomingSegmentPayload = {
      sessionId: curSessionId,
      seq,
      text,
      startedAt: Date.now(),
      endedAt: Date.now(),
      isFinal: true,
    };

    if (offlineRef.current) {
      setPendingQueue((prev) => [...prev, payload]);
      // Show locally in left pane even while offline (strictly matching local-only mode)
      setSegments((prev) => [
        ...prev,
        {
          id: `local_${seq}_${Date.now()}`,
          groupId: activeGroupId,
          sessionId: curSessionId,
          seq,
          text,
          originalText: null,
          edited: false,
          speakerLabel: null,
          startedAt: payload.startedAt!,
          endedAt: payload.endedAt!,
          isFinal: true,
          createdAt: Date.now(),
        },
      ]);
      return;
    }

    setAnalyzing(true);
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          type: 'segment',
          groupId: activeGroupId,
          ...payload,
        })
      );
    } else {
      // HTTP fallback
      const res = await fetch(`/api/groups/${activeGroupId}/segments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ segments: [payload], triggerAnalyze: true }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.card) setLatestCard(data.card);
        if (data.checkpoint) setCheckpoint(data.checkpoint);
        await loadGroupDetail(activeGroupId);
        await fetchGroups(false);
      }
      setAnalyzing(false);
    }
  };

  const handleEditSegment = async (segmentId: string, newText: string) => {
    if (!activeGroupId) return;
    setAnalyzing(true);
    try {
      const res = await fetch(`/api/groups/${activeGroupId}/segments`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ segmentId, text: newText, reanalyze: true }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.card) setLatestCard(data.card);
        if (data.checkpoint) setCheckpoint(data.checkpoint);
        await loadGroupDetail(activeGroupId);
      }
    } finally {
      setAnalyzing(false);
    }
  };

  const activeGroup = groups.find((g) => g.id === activeGroupId);
  const currentStage: StageCode = checkpoint?.currentStage ?? 'S0';

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-slate-950 text-slate-100">
      <TopToolbar
        groups={groups}
        activeGroupId={activeGroupId}
        currentStage={currentStage}
        recordingState={recordingState}
        wsConnected={wsConnected}
        offlineMode={offlineMode}
        onSelectGroup={(id) => {
          setActiveGroupId(id);
          setSummaryModal(null);
        }}
        onCreateGroup={handleCreateGroup}
        onStartRecording={() => void handleStartRecording()}
        onPauseRecording={() => void handlePauseRecording()}
        onEndSession={() => void handleEndSession()}
        onToggleOffline={() => setOfflineMode((v) => !v)}
        onOpenSkills={() => setSkillsOpen(true)}
      />

      <main className="flex-1 grid grid-cols-1 md:grid-cols-12 min-h-0">
        <div className="md:col-span-5 min-h-0 h-full">
          <TranscriptPane
            segments={segments}
            pendingCount={pendingQueue.length}
            offlineMode={offlineMode}
            disabled={!activeGroupId}
            onSendSimulatedTranscript={handleSendTranscript}
            onEditSegment={handleEditSegment}
          />
        </div>
        <div className="md:col-span-7 min-h-0 h-full">
          <QuestionCardPane
            latestCard={latestCard}
            checkpoint={checkpoint}
            loading={analyzing}
          />
        </div>
      </main>

      <StatusBar
        wsConnected={wsConnected}
        offlineMode={offlineMode}
        providerMode={providerMode}
        pendingQueueCount={pendingQueue.length}
        bufferedSeqs={bufferedSeqs}
      />

      {summaryModal && (
        <SessionSummaryView
          summary={summaryModal}
          groupName={activeGroup?.name ?? '当前客户'}
          onClose={() => setSummaryModal(null)}
        />
      )}

      <SkillsDrawer open={skillsOpen} onClose={() => setSkillsOpen(false)} />
    </div>
  );
}
