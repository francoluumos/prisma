import { defineConfig } from "vite";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));

// Multi-page build: emit both the Aero (index) and Gravel pages.
export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: resolve(root, "index.html"),
        gravel: resolve(root, "gravel.html"),
      },
    },
  },
});
