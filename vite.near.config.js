import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

/* The embedded Aurora NEAR Intents widget, iframed by site/routes.html.
 *
 *   npm run build:near-widget -> site/near-widget-dist/index.html
 *
 * Root is the widget's own folder so the emitted page lands at the top of the
 * dist rather than under a mirrored src/near/ path.
 */
export default defineConfig({
  root: resolve(__dirname, "src/near"),
  base: "./",
  plugins: [react()],
  resolve: {
    alias: {
      algosdk: resolve(__dirname, "node_modules/algosdk/dist/esm/index.js"),
    },
  },
  build: {
    outDir: resolve(__dirname, "site/near-widget-dist"),
    emptyOutDir: true,
  },
});
