import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { NextRequest } from 'next/server';
import { PresalesDatabase, setDbForTesting } from '@/lib/db';
import { PresalesWsGateway } from '@/gateway/ws-gateway';
import { resetMastraForTesting } from '@/mastra';
import * as healthRoute from '@/app/api/health/route';
import * as skillsRoute from '@/app/api/skills/route';
import * as groupsRoute from '@/app/api/groups/route';
import * as groupDetailRoute from '@/app/api/groups/[groupId]/route';
import * as segmentsRoute from '@/app/api/groups/[groupId]/segments/route';
import * as sessionsRoute from '@/app/api/groups/[groupId]/sessions/route';
import * as summaryRoute from '@/app/api/groups/[groupId]/summary/route';
import type { ServerWsMessage } from '@/lib/types';

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(Buffer.from(c)));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', reject);
  });
}

async function sendNextResponse(res: http.ServerResponse, nextRes: Response) {
  res.statusCode = nextRes.status;
  nextRes.headers.forEach((value, key) => res.setHeader(key, value));
  const buf = Buffer.from(await nextRes.arrayBuffer());
  res.end(buf);
}

function createWsCollector(url: string) {
  const ws = new WebSocket(url);
  const queue: ServerWsMessage[] = [];
  const waiters: Array<(msg: ServerWsMessage) => void> = [];

  ws.on('message', (data) => {
    const parsed = JSON.parse(data.toString('utf-8')) as ServerWsMessage;
    const waiter = waiters.shift();
    if (waiter) waiter(parsed);
    else queue.push(parsed);
  });

  const openPromise = new Promise<void>((resolve, reject) => {
    ws.once('open', () => resolve());
    ws.once('error', reject);
  });

  const nextMessage = async (
    predicate?: (m: ServerWsMessage) => boolean,
    timeoutMs = 5000
  ): Promise<ServerWsMessage> => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (queue.length > 0) {
        const msg = queue.shift()!;
        if (!predicate || predicate(msg)) return msg;
        continue;
      }
      const remaining = Math.max(10, deadline - Date.now());
      const msg = await new Promise<ServerWsMessage>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('WS message timeout')), remaining);
        waiters.push((m) => {
          clearTimeout(timer);
          resolve(m);
        });
      });
      if (!predicate || predicate(msg)) return msg;
    }
    throw new Error('WS predicate timeout');
  };

  return { ws, openPromise, nextMessage };
}

describe('End-to-End Integration: Next.js API + WebSocket Gateway + Mastra Engine', () => {
  let tmpDir: string;
  let db: PresalesDatabase;
  let gateway: PresalesWsGateway;
  let server: http.Server;
  let baseUrl: string;
  let wsUrl: string;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'presales-e2e-'));
    process.env.MASTRA_DATABASE_URL = `file:${path.join(tmpDir, 'mastra.db')}`;
    delete process.env.DEEPSEEK_API_KEY;

    resetMastraForTesting();
    db = new PresalesDatabase(`file:${path.join(tmpDir, 'app.db')}`);
    await db.init();
    setDbForTesting(db);

    gateway = new PresalesWsGateway();
    globalThis.__presalesWsGateway = gateway;

    server = http.createServer(async (req, res) => {
      try {
        const fullUrl = `http://127.0.0.1${req.url || '/'}`;
        const urlObj = new URL(fullUrl);
        const pathname = urlObj.pathname;
        const method = req.method || 'GET';
        const rawBody = method === 'GET' || method === 'DELETE' ? undefined : await readBody(req);
        const nextReq = new NextRequest(fullUrl, {
          method,
          headers: req.headers as Record<string, string>,
          body: rawBody,
        });

        let response: Response | null = null;

        if (pathname === '/api/health' && method === 'GET') {
          response = await healthRoute.GET();
        } else if (pathname === '/api/skills' && method === 'GET') {
          response = await skillsRoute.GET();
        } else if (pathname === '/api/groups' && method === 'GET') {
          response = await groupsRoute.GET();
        } else if (pathname === '/api/groups' && method === 'POST') {
          response = await groupsRoute.POST(nextReq);
        } else {
          const m = pathname.match(/^\/api\/groups\/([^/]+)(\/.*)?$/);
          if (m) {
            const groupId = m[1];
            const sub = m[2] || '';
            const ctx = { params: Promise.resolve({ groupId }) };
            if (sub === '' && method === 'GET') response = await groupDetailRoute.GET(nextReq, ctx);
            else if (sub === '' && method === 'PATCH') response = await groupDetailRoute.PATCH(nextReq, ctx);
            else if (sub === '' && method === 'DELETE') response = await groupDetailRoute.DELETE(nextReq, ctx);
            else if (sub === '/segments' && method === 'GET') response = await segmentsRoute.GET(nextReq, ctx);
            else if (sub === '/segments' && method === 'POST') response = await segmentsRoute.POST(nextReq, ctx);
            else if (sub === '/segments' && method === 'PATCH') response = await segmentsRoute.PATCH(nextReq, ctx);
            else if (sub === '/sessions' && method === 'POST') response = await sessionsRoute.POST(nextReq, ctx);
            else if (sub === '/summary' && method === 'GET') response = await summaryRoute.GET(nextReq, ctx);
            else if (sub === '/summary' && method === 'POST') response = await summaryRoute.POST(nextReq, ctx);
          }
        }

        if (!response) {
          res.statusCode = 404;
          res.end(JSON.stringify({ error: 'Not Found' }));
          return;
        }
        await sendNextResponse(res, response);
      } catch (err) {
        res.statusCode = 500;
        res.end(JSON.stringify({ error: String(err) }));
      }
    });

    server.on('upgrade', (req, socket, head) => {
      const pathname = new URL(req.url || '/', 'http://127.0.0.1').pathname;
      if (pathname === '/ws') {
        gateway.handleUpgrade(req, socket, head);
      } else {
        socket.destroy();
      }
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const addr = server.address() as { port: number };
    baseUrl = `http://127.0.0.1:${addr.port}`;
    wsUrl = `ws://127.0.0.1:${addr.port}/ws`;
  });

  afterAll(async () => {
    await gateway.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await db.close();
    setDbForTesting(null);
    globalThis.__presalesWsGateway = undefined;
    resetMastraForTesting();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('simulates full macOS client lifecycle: WS stream, out-of-order, offline catch-up, edit & summary export', async () => {
    // 1. Health & Skills check
    const health = await fetch(`${baseUrl}/api/health`).then((r) => r.json());
    expect(health.status).toBe('ok');
    expect(health.agentEngine).toBe('mastra');

    const skills = await fetch(`${baseUrl}/api/skills`).then((r) => r.json());
    expect(skills.principles).toHaveLength(10);
    expect(skills.skills).toHaveLength(12);
    expect(skills.stages).toHaveLength(6);

    // 2. Create customer group
    const createRes = await fetch(`${baseUrl}/api/groups`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: '华东能源集团售前访谈',
        customerCompany: '华东能源集团',
        industry: '能源电力',
      }),
    });
    expect(createRes.status).toBe(201);
    const { group } = await createRes.json();

    // 3. Connect simulated macOS WebSocket client and subscribe
    const client = createWsCollector(`${wsUrl}?groupId=${group.id}&clientId=macbook-m3`);
    await client.openPromise;

    const snap = await client.nextMessage((m) => m.type === 'snapshot');
    expect(snap.type).toBe('snapshot');
    if (snap.type === 'snapshot') {
      expect(snap.checkpoint.currentStage).toBe('S0');
      expect(snap.segments).toHaveLength(0);
    }

    // 4. Stream seq 1 over WS & assert < 3000ms cloud response latency
    const startTs = Date.now();
    client.ws.send(
      JSON.stringify({
        type: 'segment',
        groupId: group.id,
        sessionId: 'ses_mac_1',
        segmentId: 'seg_mac_1',
        seq: 1,
        text: '我们是采购和法务中心，平时要处理大量设备招标合同与合规审查。',
      })
    );

    const ack1 = await client.nextMessage((m) => m.type === 'segment_ack');
    expect(ack1.type === 'segment_ack' && ack1.acceptedSeqs).toEqual([1]);

    const card1 = await client.nextMessage((m) => m.type === 'question_card');
    const roundTripMs = Date.now() - startTs;
    expect(roundTripMs).toBeLessThan(3000);
    expect(card1.type).toBe('question_card');
    if (card1.type === 'question_card') {
      expect(card1.card.stage).toBe('S1');
      expect(card1.card.primaryQuestion.length).toBeGreaterThan(8);
      expect(card1.card.alternativeQuestions.length).toBeGreaterThanOrEqual(2);
    }

    // 5. Out-of-order segment seq 3 arrives before seq 2 -> buffered!
    client.ws.send(
      JSON.stringify({
        type: 'segment',
        groupId: group.id,
        sessionId: 'ses_mac_1',
        seq: 3,
        text: '每天业务员上传 PDF 合同到老系统，点人工逐页核对条款，期望10分钟审完，实际经常耗两小时还容易漏审。',
      })
    );
    const ackGap = await client.nextMessage((m) => m.type === 'segment_ack');
    if (ackGap.type === 'segment_ack') {
      expect(ackGap.acceptedSeqs).toEqual([]);
      expect(ackGap.bufferedSeqs).toEqual([3]);
    }

    // 6. Simulate network disconnect -> offline local queue -> HTTP catch-up POST with seq 2
    client.ws.close();
    const catchupRes = await fetch(`${baseUrl}/api/groups/${group.id}/segments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        segments: [
          {
            sessionId: 'ses_mac_1',
            seq: 2,
            text: '本来领导说直接买个大模型，但其实业务上最痛的是合同审核。',
          },
        ],
        triggerAnalyze: true,
      }),
    });
    expect(catchupRes.status).toBe(200);
    const catchupData = await catchupRes.json();
    // seq 2 arrival automatically flushed buffered seq 3!
    expect(catchupData.ingest.acceptedSeqs).toEqual([2, 3]);
    expect(catchupData.ingest.bufferedSeqs).toEqual([]);
    expect(catchupData.card).not.toBeNull();

    // 7. Manual edit correction of seg_mac_1 via HTTP PATCH
    const patchRes = await fetch(`${baseUrl}/api/groups/${group.id}/segments`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        segmentId: 'seg_mac_1',
        text: '我们是采购和法务中心，平时要处理大量设备招标合同与合规审核（已手动修正）。',
        reanalyze: true,
      }),
    });
    expect(patchRes.status).toBe(200);
    const patchData = await patchRes.json();
    expect(patchData.segment.edited).toBe(true);

    // 8. Reconnect WS client (cross-session resume) & end session -> receives structured summary
    const client2 = createWsCollector(`${wsUrl}?groupId=${group.id}&clientId=macbook-m3-reconnected`);
    await client2.openPromise;
    const snap2 = await client2.nextMessage((m) => m.type === 'snapshot');
    if (snap2.type === 'snapshot') {
      expect(snap2.segments.map((s) => s.seq)).toEqual([1, 2, 3]);
      expect(snap2.segments[0].edited).toBe(true);
    }

    client2.ws.send(
      JSON.stringify({
        type: 'session_control',
        groupId: group.id,
        sessionId: 'ses_mac_1',
        action: 'end',
      })
    );
    const sumMsg = await client2.nextMessage((m) => m.type === 'session_summary');
    expect(sumMsg.type).toBe('session_summary');
    if (sumMsg.type === 'session_summary') {
      expect(sumMsg.summary.markdown).toContain('华东能源集团售前访谈');
      expect(sumMsg.summary.nextActions.length).toBeGreaterThan(0);
    }

    // 9. Download Markdown export over HTTP
    const mdRes = await fetch(`${baseUrl}/api/groups/${group.id}/summary?format=markdown`);
    expect(mdRes.status).toBe(200);
    const mdText = await mdRes.text();
    expect(mdText).toContain('# 售前沟通纪要 — 华东能源集团售前访谈');

    client2.ws.close();
  });
});
