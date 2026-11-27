import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/lib/db';
import { runSessionSummary } from '@/mastra';
import { getWsGateway } from '@/gateway/ws-gateway';

const sessionControlSchema = z.object({
  action: z.enum(['start', 'pause', 'resume', 'end']),
  sessionId: z.string().optional(),
  generateSummaryOnEnd: z.boolean().default(true),
});

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ groupId: string }> }
) {
  const { groupId } = await context.params;
  const body = await req.json();
  const parsed = sessionControlSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: '会话控制参数无效', details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const db = getDb();
  const group = await db.getGroup(groupId);
  if (!group) {
    return NextResponse.json({ error: '客户分组不存在' }, { status: 404 });
  }

  const session = await db.createOrUpdateSession(
    groupId,
    parsed.data.action,
    parsed.data.sessionId
  );

  let summary = null;
  if (parsed.data.action === 'end' && parsed.data.generateSummaryOnEnd) {
    summary = await runSessionSummary({ groupId, sessionId: session.id });
    getWsGateway().broadcastToGroup(groupId, {
      type: 'session_summary',
      summary,
    });
  }

  return NextResponse.json({ session, summary });
}
