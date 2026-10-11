import { defineConfig } from "vite";

const tokenPort = process.env.CURSOR_VOICE_TOKEN_PORT || "8787";
const tokenHost = process.env.CURSOR_VOICE_HOST || "127.0.0.1";
const upstream = `http://${tokenHost}:${tokenPort}`;

export default defineConfig({
  server: {
    port: 5179,
    strictPort: true,
    proxy: {
      "/api": upstream,
      "/bridge-config": upstream,
    },
  },
});
