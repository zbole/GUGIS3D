import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import cesium from "vite-plugin-cesium";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [react(), cesium({
    cesiumBuildRootPath: fileURLToPath(new URL("./node_modules/cesium/Build", import.meta.url)),
    cesiumBuildPath: fileURLToPath(new URL("./node_modules/cesium/Build/Cesium", import.meta.url)),
  })],
  server: {
    port: 5173,
    host: "127.0.0.1",
    strictPort: true,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8000",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
    },
  },
});
