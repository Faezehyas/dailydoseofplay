// Entry point for `npm start` (local and Wasmer Edge).
import { createApp } from "./app.js";

const HOST = process.env.HOST || "0.0.0.0";
const PORT = Number(process.env.PORT || 8080);

createApp().then(({ server }) => {
  server.listen(PORT, HOST, () => {
    console.log(`Daily Dose of Play listening on http://${HOST}:${PORT}`);
  });
});
