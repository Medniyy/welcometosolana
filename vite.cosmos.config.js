import { defineConfig } from "vite";
import { resolve } from "node:path";

/* Cosmos engine.
 *
 *   npm run dev:cosmos    -> http://localhost:5180/harness.html
 *   npm run build:cosmos  -> site/cosmos-bridge-dist/cosmos-engine.js
 *
 * Root is src/cosmos so the emitted files land flat in the dist rather than
 * under a mirrored src/cosmos/ path.
 *
 * There are two inputs, and the second one is load-bearing. With a single JS
 * entry, vite 8 / rolldown inlines dynamic imports no matter what
 * `codeSplitting` or the deprecated `inlineDynamicImports` are set to — the
 * `import("./engine.js")` inside entry.js silently disappeared and the build
 * emitted a 31 kB file containing the polyfills and the markup and none of
 * the engine. It looked like a successful build. Adding the harness page
 * restores normal chunking: the entry drops to 5 kB and the engine lands in
 * its own 3.4 MB chunk, fetched only when someone opens the Cosmos tab.
 *
 * harness.html is also genuinely useful — it is the engine on a page of its
 * own, and it carries a noindex. spike.html, the no-UI route diagnostic,
 * stays dev-server-only.
 */
export default defineConfig({
  root: resolve(__dirname, "src/cosmos"),
  /* Relative, so the emitted chunks resolve from the dist folder rather than
     colliding with the site's own /assets/. */
  base: "./",
  server: { port: 5180, open: "/harness.html" },
  define: { global: "globalThis" },
  build: {
    outDir: resolve(__dirname, "site/cosmos-bridge-dist"),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        "cosmos-engine": resolve(__dirname, "src/cosmos/entry.js"),
        harness: resolve(__dirname, "src/cosmos/harness.html"),
      },
      output: {
        /* Unhashed on purpose: site/assets/bridge.js imports this by name at
           runtime, and a content hash would mean editing that file after
           every build. Chunks stay hashed — nothing outside names them. */
        entryFileNames: (chunk) =>
          chunk.name === "cosmos-engine" ? "cosmos-engine.js" : "assets/[name]-[hash].js",
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
      },
    },
  },
});
