import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/lib/db';
import { ingestOrderedSegments } from '@/lib/sequence-manager';
import { runPresalesAnalysis } from '@/mastra';
import { getWsGateway } from '@/gateway/ws-gateway';

const segmentItemSchema = z.object({
  segmentId: z.string().optional(),
  sessionId: z.string().default('ses_http'),
  seq: z.number().int().min(1),
  text: z.string().min(1),
  startedAt: z.number().optional(),
  endedAt: z.number().optional(),
  isFinal: z.boolean().optional(),
  speakerLabel: z.string().nullable().optional(),
});

const postSegmentsSchema = z.object({
  segments: z.array(segmentItemSchema).min(1),
  triggerAnalyze: z.boolean().default(true),
});

const patchSegmentSchema = z.object({
  segmentId: z.string().min(1),
  text: z.string().min(1),
  reanalyze: z.boolean().default(true),
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
  const [segments, buffered] = await Promise.all([
    db.getSegments(groupId),
    db.getGapBufferSegments(groupId),
  ]);
  return NextResponse.json({
    segments,
    bufferedSeqs: buffered.map((b) => b.seq),
    nextExpectedSeq: group.nextExpectedSeq,
  });
}

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ groupId: string }> }
) {
  const { groupId } = await context.params;
  const body = await req.json();
  const parsed = postSegmentsSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: '转写分片参数无效', details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const db = getDb();
  const group = await db.getGroup(groupId);
  if (!group) {
    return NextResponse.json({ error: '客户分组不存在' }, { status: 404 });
  }

  const ingest = await ingestOrderedSegments(db, groupId, parsed.data.segments);
  const gateway = getWsGateway();
  gateway.broadcastToGroup(groupId, {
    type: 'segment_ack',
    groupId,
    acceptedSeqs: ingest.acceptedSeqs,
    bufferedSeqs: ingest.bufferedSeqs,
    duplicateSeqs: ingest.duplicateSeqs,
    nextExpectedSeq: ingest.nextExpectedSeq,
  });

  let analysisResult = null;
  if (parsed.data.triggerAnalyze && ingest.acceptedSegments.length > 0) {
    const latest = ingest.acceptedSegments[ingest.acceptedSegments.length - 1];
    analysisResult = await runPresalesAnalysis({
      groupId,
      sessionId: latest.sessionId,
      triggerSeq: latest.seq,
    });
    gateway.broadcastToGroup(groupId, {
      type: 'question_card',
      card: analysisResult.card,
    });
    if (analysisResult.stageChanged) {
      gateway.broadcastToGroup(groupId, {
        type: 'stage_updated',
        groupId,
        previousStage: analysisResult.previousStage,
        currentStage: analysisResult.currentStage,
        checkpoint: analysisResult.checkpoint,
      });
    }
  }

  return NextResponse.json({
    ingest,
    card: analysisResult?.card ?? null,
    checkpoint: analysisResult?.checkpoint ?? (await db.getCheckpoint(groupId)),
  });
}

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ groupId: string }> }
) {
  const { groupId } = await context.params;
  const body = await req.json();
  const parsed = patchSegmentSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: '修正参数无效', details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const db = getDb();
  const updated = await db.editSegment(groupId, parsed.data.segmentId, parsed.data.text);
  if (!updated) {
    return NextResponse.json({ error: '未找到指定转写片段' }, { status: 404 });
  }

  let analysisResult = null;
  if (parsed.data.reanalyze) {
    analysisResult = await runPresalesAnalysis({
      groupId,
      sessionId: updated.sessionId,
      triggerSeq: updated.seq,
    });
    getWsGateway().broadcastToGroup(groupId, {
      type: 'question_card',
      card: analysisResult.card,
    });
  }

  return NextResponse.json({
    segment: updated,
    card: analysisResult?.card ?? null,
    checkpoint: analysisResult?.checkpoint ?? (await db.getCheckpoint(groupId)),
  });
}
