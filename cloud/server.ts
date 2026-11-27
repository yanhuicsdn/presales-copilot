import http from 'node:http';
import next from 'next';
import { getDb } from './src/lib/db';
import { getWsGateway } from './src/gateway/ws-gateway';
import { getProviderMode } from './src/lib/llm-provider';

const dev = process.env.NODE_ENV !== 'production';
const hostname = process.env.HOST || '0.0.0.0';
const port = Number(process.env.PORT || 3000);

async function main() {
  await getDb().init();
  const app = next({ dev, hostname, port });
  const handle = app.getRequestHandler();

  await app.prepare();

  const gateway = getWsGateway();
  const server = http.createServer((req, res) => {
    void handle(req, res);
  });

  server.on('upgrade', (req, socket, head) => {
    const pathname = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`).pathname;
    if (pathname === '/ws') {
      gateway.handleUpgrade(req, socket, head);
    } else if (!dev) {
      socket.destroy();
    }
  });

  server.listen(port, hostname, () => {
    console.log(
      `[PreSales Copilot Cloud] Ready on http://${hostname}:${port} (WS: /ws, Mastra mode: ${getProviderMode()})`
    );
  });
}

main().catch((err) => {
  console.error('[PreSales Copilot Cloud] Fatal startup error:', err);
  process.exit(1);
});
