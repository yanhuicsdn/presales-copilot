import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { runPresalesAnalysis } from '@/mastra';
import { getWsGateway } from '@/gateway/ws-gateway';

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ groupId: string }> }
) {
  const { groupId } = await context.params;
  const db = getDb();
  const group = await db.getGroup(groupId);
  if (!group) {
    return NextResponse.json({ error: '客户分组不存在' }, { status: 404 });
  }

  let sessionId: string | null = null;
  try {
    const body = await req.json();
    sessionId = typeof body?.sessionId === 'string' ? body.sessionId : null;
  } catch {
    // optional body
  }

  const result = await runPresalesAnalysis({ groupId, sessionId });
  const gateway = getWsGateway();
  gateway.broadcastToGroup(groupId, { type: 'question_card', card: result.card });
  if (result.stageChanged) {
    gateway.broadcastToGroup(groupId, {
      type: 'stage_updated',
      groupId,
      previousStage: result.previousStage,
      currentStage: result.currentStage,
      checkpoint: result.checkpoint,
    });
  }

  return NextResponse.json(result);
}
