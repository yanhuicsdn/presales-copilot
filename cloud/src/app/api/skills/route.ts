import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import {
  SEVEN_COMMUNICATION_PRINCIPLES,
  STAGE_DEFINITIONS,
  TECH_ANALOGY_LIBRARY,
} from '@/lib/skills';

export async function GET() {
  const db = getDb();
  const skills = await db.getSkillConfigs();
  return NextResponse.json({
    principles: SEVEN_COMMUNICATION_PRINCIPLES,
    skills,
    stages: Object.values(STAGE_DEFINITIONS),
    analogies: TECH_ANALOGY_LIBRARY,
  });
}
