import { defineConfig } from "vite";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));

// Multi-page build: emit the Aero (index), Gravel, and Beta studio pages.
export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: resolve(root, "index.html"),
        gravel: resolve(root, "gravel.html"),
        beta: resolve(root, "beta.html"),
        pickup: resolve(root, "pickup.html"),
        terms: resolve(root, "terms.html"),
        cookies: resolve(root, "cookies.html"),
        impressum: resolve(root, "impressum.html"),
      },
    },
  },
});
