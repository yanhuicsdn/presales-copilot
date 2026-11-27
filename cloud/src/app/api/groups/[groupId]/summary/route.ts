import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { runSessionSummary } from '@/mastra';
import { getWsGateway } from '@/gateway/ws-gateway';

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ groupId: string }> }
) {
  const { groupId } = await context.params;
  const db = getDb();
  const group = await db.getGroup(groupId);
  if (!group) {
    return NextResponse.json({ error: '客户分组不存在' }, { status: 404 });
  }

  const summaries = await db.getMeetingSummaries(groupId);
  const latest = summaries[0] ?? null;

  const format = req.nextUrl.searchParams.get('format');
  if (format === 'markdown') {
    if (!latest) {
      return NextResponse.json({ error: '尚未生成沟通纪要' }, { status: 404 });
    }
    return new NextResponse(latest.markdown, {
      status: 200,
      headers: {
        'Content-Type': 'text/markdown; charset=utf-8',
        'Content-Disposition': `attachment; filename="presales-summary-${groupId}.md"`,
      },
    });
  }

  return NextResponse.json({ latestSummary: latest, summaries });
}

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

  const summary = await runSessionSummary({ groupId, sessionId });
  getWsGateway().broadcastToGroup(groupId, {
    type: 'session_summary',
    summary,
  });

  return NextResponse.json({ summary });
}
