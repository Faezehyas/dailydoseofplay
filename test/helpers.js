// Start the real HTTP + signaling server in-process on a random port.
import { createApp } from "../server/app.js";

export async function startServer({ publicDir, allowedOrigins } = {}) {
  const { server, wss } = await createApp({ publicDir, allowedOrigins, log: () => {} });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return {
    base: `http://127.0.0.1:${port}`,
    wsUrl: `ws://127.0.0.1:${port}/ws`,
    async close() {
      for (const ws of wss.clients) ws.terminate();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}
