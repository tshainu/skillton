import { defineConfig } from "vite";
import path from "node:path";
import electron from "vite-plugin-electron/simple";

export default defineConfig({
  build: {
    rollupOptions: {
      input: path.join(__dirname, "electron/__no-renderer.ts"),
    },
  },
  plugins: [
    electron({
      main: {
        entry: "electron/main.ts",
      },
      preload: {
        input: path.join(__dirname, "electron/preload.ts"),
      },
    }),
  ],
  server: {
    allowedHosts: true,
  },
});
