import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/lib/db';

const createGroupSchema = z.object({
  name: z.string().min(1, '分组名称不能为空').max(120),
  customerCompany: z.string().max(120).optional(),
  industry: z.string().max(80).optional(),
  notes: z.string().max(1000).optional(),
});

export async function GET() {
  const db = getDb();
  const groups = await db.listGroups();
  return NextResponse.json({ groups });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = createGroupSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: '请求参数无效', details: parsed.error.flatten() },
        { status: 400 }
      );
    }
    const db = getDb();
    const { group, checkpoint } = await db.createGroup(parsed.data);
    return NextResponse.json({ group, checkpoint }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : '创建客户分组失败' },
      { status: 500 }
    );
  }
}
