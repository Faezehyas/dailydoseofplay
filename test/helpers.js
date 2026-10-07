// Start the real HTTP + signaling server in-process on a random port.
import { createApp } from "../server/app.js";

export async function startServer({ publicDir, allowedOrigins, clientIpHeader, limits, now } = {}) {
  const { server, wss, signaling } = await createApp({ publicDir, allowedOrigins, clientIpHeader, limits, now, log: () => {} });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return {
    base: `http://127.0.0.1:${port}`,
    wsUrl: `ws://127.0.0.1:${port}/ws`,
    wss,
    signaling,
    async close() {
      for (const ws of wss.clients) ws.terminate();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}
