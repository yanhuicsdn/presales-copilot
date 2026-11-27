import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getProviderMode, getDeepSeekModelName } from '@/lib/llm-provider';
import { getWsGateway } from '@/gateway/ws-gateway';

export async function GET() {
  await getDb().init();
  return NextResponse.json({
    status: 'ok',
    service: 'presales-copilot-cloud',
    agentEngine: 'mastra',
    providerMode: getProviderMode(),
    model: getDeepSeekModelName(),
    wsConnections: getWsGateway().getActiveConnectionCount(),
    timestamp: Date.now(),
  });
}
