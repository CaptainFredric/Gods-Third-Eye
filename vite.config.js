import { defineConfig, loadEnv } from "vite";
import cesium from "vite-plugin-cesium";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const relayTarget = env.GTE_DEV_LIVE_RELAY_TARGET || "http://127.0.0.1:4180";

  return {
    base: "./",
    plugins: [cesium()],
    server: {
      port: 5173,
      strictPort: true,
      open: false,
      proxy: {
        "/api/live": {
          target: relayTarget,
          changeOrigin: true
        }
      }
    },
    preview: {
      port: 4173,
      strictPort: true
    },
    build: {
      sourcemap: false,
      target: "esnext"
    }
  };
});
