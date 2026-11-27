import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/lib/db';

const updateGroupSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  customerCompany: z.string().max(120).optional(),
  industry: z.string().max(80).optional(),
  notes: z.string().max(1000).optional(),
  status: z.enum(['active', 'archived']).optional(),
});

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ groupId: string }> }
) {
  const { groupId } = await context.params;
  const db = getDb();
  const group = await db.getGroup(groupId);
  if (!group) {
    return NextResponse.json({ error: '客户分组不存在' }, { status: 404 });
  }
  const [checkpoint, segments, cards, latestSummary, sessions, buffered] = await Promise.all([
    db.getCheckpoint(groupId),
    db.getSegments(groupId),
    db.getQuestionCards(groupId, 20),
    db.getLatestMeetingSummary(groupId),
    db.listSessions(groupId),
    db.getGapBufferSegments(groupId),
  ]);

  return NextResponse.json({
    group,
    checkpoint,
    segments,
    latestCard: cards[0] ?? null,
    cards,
    latestSummary,
    sessions,
    bufferedSeqs: buffered.map((b) => b.seq),
  });
}

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ groupId: string }> }
) {
  const { groupId } = await context.params;
  const body = await req.json();
  const parsed = updateGroupSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: '参数无效', details: parsed.error.flatten() }, { status: 400 });
  }
  const db = getDb();
  const updated = await db.updateGroup(groupId, parsed.data);
  if (!updated) {
    return NextResponse.json({ error: '客户分组不存在' }, { status: 404 });
  }
  return NextResponse.json({ group: updated });
}

export async function DELETE(
  _req: NextRequest,
  context: { params: Promise<{ groupId: string }> }
) {
  const { groupId } = await context.params;
  const db = getDb();
  const deleted = await db.deleteGroup(groupId);
  if (!deleted) {
    return NextResponse.json({ error: '客户分组不存在' }, { status: 404 });
  }
  return NextResponse.json({ deleted: true, groupId });
}
