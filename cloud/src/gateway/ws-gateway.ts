import { WebSocketServer, WebSocket } from 'ws';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { getDb } from '@/lib/db';
import { ingestOrderedSegments } from '@/lib/sequence-manager';
import { runPresalesAnalysis, runSessionSummary } from '@/mastra';
import type { ClientWsMessage, ServerWsMessage } from '@/lib/types';

interface ClientMeta {
  ws: WebSocket;
  groupId: string | null;
  clientId: string;
}

export class PresalesWsGateway {
  private wss: WebSocketServer;
  private clients = new Map<WebSocket, ClientMeta>();
  // Per-group serial processing chain to keep checkpoints & seq ordering race-free
  private groupLocks = new Map<string, Promise<void>>();

  constructor() {
    this.wss = new WebSocketServer({ noServer: true });
    this.wss.on('connection', (ws, req) => this.handleConnection(ws, req));
  }

  public handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
    this.wss.handleUpgrade(req, socket, head, (ws) => {
      this.wss.emit('connection', ws, req);
    });
  }

  public broadcastToGroup(groupId: string, message: ServerWsMessage): void {
    const raw = JSON.stringify(message);
    for (const meta of this.clients.values()) {
      if (meta.groupId === groupId && meta.ws.readyState === WebSocket.OPEN) {
        meta.ws.send(raw);
      }
    }
  }

  public getActiveConnectionCount(): number {
    return this.clients.size;
  }

  public close(): Promise<void> {
    return new Promise((resolve) => {
      for (const meta of this.clients.values()) {
        meta.ws.terminate();
      }
      this.clients.clear();
      this.wss.close(() => resolve());
    });
  }

  private enqueueGroupWork(groupId: string, fn: () => Promise<void>): Promise<void> {
    const prev = this.groupLocks.get(groupId) ?? Promise.resolve();
    const next = prev
      .catch(() => undefined)
      .then(fn)
      .finally(() => {
        if (this.groupLocks.get(groupId) === next) {
          this.groupLocks.delete(groupId);
        }
      });
    this.groupLocks.set(groupId, next);
    return next;
  }

  private send(ws: WebSocket, msg: ServerWsMessage): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }

  private handleConnection(ws: WebSocket, req: IncomingMessage): void {
    const url = new URL(req.url || '/ws', 'http://localhost');
    const initialGroupId = url.searchParams.get('groupId');
    const clientId = url.searchParams.get('clientId') || `client_${Date.now()}`;

    const meta: ClientMeta = {
      ws,
      groupId: initialGroupId,
      clientId,
    };
    this.clients.set(ws, meta);

    if (initialGroupId) {
      void this.sendSnapshot(ws, initialGroupId);
    }

    ws.on('message', (data) => {
      void this.handleMessage(ws, data.toString('utf-8'));
    });

    ws.on('close', () => {
      this.clients.delete(ws);
    });
  }

  private async sendSnapshot(ws: WebSocket, groupId: string): Promise<void> {
    const db = getDb();
    const group = await db.getGroup(groupId);
    if (!group) {
      this.send(ws, {
        type: 'error',
        code: 'GROUP_NOT_FOUND',
        message: `未找到客户分组: ${groupId}`,
        recoverable: true,
      });
      return;
    }
    const [checkpoint, segments, latestCard, buffered] = await Promise.all([
      db.getCheckpoint(groupId),
      db.getSegments(groupId),
      db.getLatestQuestionCard(groupId),
      db.getGapBufferSegments(groupId),
    ]);

    if (!checkpoint) return;
    this.send(ws, {
      type: 'snapshot',
      group,
      checkpoint,
      segments,
      latestCard,
      bufferedSeqs: buffered.map((b) => b.seq),
    });
  }

  private async handleMessage(ws: WebSocket, raw: string): Promise<void> {
    let msg: ClientWsMessage;
    try {
      msg = JSON.parse(raw) as ClientWsMessage;
    } catch {
      this.send(ws, {
        type: 'error',
        code: 'INVALID_JSON',
        message: '无法解析 WebSocket JSON 消息',
        recoverable: true,
      });
      return;
    }

    const meta = this.clients.get(ws);
    if (!meta) return;

    try {
      switch (msg.type) {
        case 'ping': {
          this.send(ws, { type: 'pong', ts: msg.ts });
          break;
        }
        case 'subscribe': {
          meta.groupId = msg.groupId;
          await this.sendSnapshot(ws, msg.groupId);
          break;
        }
        case 'segment': {
          meta.groupId = msg.groupId;
          await this.enqueueGroupWork(msg.groupId, async () => {
            const db = getDb();
            const ingest = await ingestOrderedSegments(db, msg.groupId, [
              {
                segmentId: msg.segmentId,
                sessionId: msg.sessionId,
                seq: msg.seq,
                text: msg.text,
                startedAt: msg.startedAt,
                endedAt: msg.endedAt,
                isFinal: msg.isFinal ?? true,
              },
            ]);

            this.broadcastToGroup(msg.groupId, {
              type: 'segment_ack',
              groupId: msg.groupId,
              acceptedSeqs: ingest.acceptedSeqs,
              bufferedSeqs: ingest.bufferedSeqs,
              duplicateSeqs: ingest.duplicateSeqs,
              nextExpectedSeq: ingest.nextExpectedSeq,
            });

            if (ingest.acceptedSegments.length > 0) {
              const latestSeq = ingest.acceptedSegments[ingest.acceptedSegments.length - 1].seq;
              const result = await runPresalesAnalysis({
                groupId: msg.groupId,
                sessionId: msg.sessionId,
                triggerSeq: latestSeq,
              });
              this.broadcastToGroup(msg.groupId, {
                type: 'question_card',
                card: result.card,
              });
              if (result.stageChanged) {
                this.broadcastToGroup(msg.groupId, {
                  type: 'stage_updated',
                  groupId: msg.groupId,
                  previousStage: result.previousStage,
                  currentStage: result.currentStage,
                  checkpoint: result.checkpoint,
                });
              }
            }
          });
          break;
        }
        case 'segment_batch': {
          meta.groupId = msg.groupId;
          await this.enqueueGroupWork(msg.groupId, async () => {
            const db = getDb();
            const ingest = await ingestOrderedSegments(db, msg.groupId, msg.segments);
            this.broadcastToGroup(msg.groupId, {
              type: 'segment_ack',
              groupId: msg.groupId,
              acceptedSeqs: ingest.acceptedSeqs,
              bufferedSeqs: ingest.bufferedSeqs,
              duplicateSeqs: ingest.duplicateSeqs,
              nextExpectedSeq: ingest.nextExpectedSeq,
            });

            if (ingest.acceptedSegments.length > 0) {
              const latest = ingest.acceptedSegments[ingest.acceptedSegments.length - 1];
              const result = await runPresalesAnalysis({
                groupId: msg.groupId,
                sessionId: latest.sessionId,
                triggerSeq: latest.seq,
              });
              this.broadcastToGroup(msg.groupId, {
                type: 'question_card',
                card: result.card,
              });
              if (result.stageChanged) {
                this.broadcastToGroup(msg.groupId, {
                  type: 'stage_updated',
                  groupId: msg.groupId,
                  previousStage: result.previousStage,
                  currentStage: result.currentStage,
                  checkpoint: result.checkpoint,
                });
              }
            }
          });
          break;
        }
        case 'segment_edit': {
          meta.groupId = msg.groupId;
          await this.enqueueGroupWork(msg.groupId, async () => {
            const db = getDb();
            const updated = await db.editSegment(msg.groupId, msg.segmentId, msg.text);
            if (!updated) {
              this.send(ws, {
                type: 'error',
                code: 'SEGMENT_NOT_FOUND',
                message: `未找到转写片段: ${msg.segmentId}`,
                recoverable: true,
              });
              return;
            }
            const result = await runPresalesAnalysis({
              groupId: msg.groupId,
              sessionId: updated.sessionId,
              triggerSeq: updated.seq,
            });
            await this.sendSnapshot(ws, msg.groupId);
            this.broadcastToGroup(msg.groupId, {
              type: 'question_card',
              card: result.card,
            });
          });
          break;
        }
        case 'session_control': {
          meta.groupId = msg.groupId;
          await this.enqueueGroupWork(msg.groupId, async () => {
            const db = getDb();
            const session = await db.createOrUpdateSession(msg.groupId, msg.action, msg.sessionId);
            if (msg.action === 'end') {
              const summary = await runSessionSummary({
                groupId: msg.groupId,
                sessionId: session.id,
              });
              this.broadcastToGroup(msg.groupId, {
                type: 'session_summary',
                summary,
              });
            } else {
              await this.sendSnapshot(ws, msg.groupId);
            }
          });
          break;
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.send(ws, {
        type: 'error',
        code: 'PROCESSING_ERROR',
        message,
        recoverable: true,
      });
    }
  }
}

declare global {
  // eslint-disable-next-line no-var
  var __presalesWsGateway: PresalesWsGateway | undefined;
}

export function getWsGateway(): PresalesWsGateway {
  if (!globalThis.__presalesWsGateway) {
    globalThis.__presalesWsGateway = new PresalesWsGateway();
  }
  return globalThis.__presalesWsGateway;
}
