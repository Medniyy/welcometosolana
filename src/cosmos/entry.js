/* Mount entry for the Cosmos engine.

   This is what assets/bridge.js dynamically imports the first time the Cosmos
   tab is opened. It is a separate bundle because @skip-go/client, CosmJS and
   their Node polyfills weigh far more than the rest of the page, and two of
   the three tabs never need any of it.

   The import order below is load-bearing and not a style choice: polyfills
   are imported *statically* so they are evaluated first, and the engine is
   imported *dynamically* so it runs after them. Static imports are hoisted,
   so an engine imported statically here would evaluate before Buffer exists
   and die at transaction-encoding time — with Keplr having already signed.
   See src/polyfills.js. */

import "../polyfills.js";
import { MARKUP } from "./markup.js";

/**
 * Render the engine into a host element and start it.
 *
 * @param {HTMLElement} host  container to render into
 * @param {object} opts
 * @param {string} [opts.solanaAddress]     destination the user already gave
 *   on another tab, so we never ask for it twice
 * @param {(a: string) => void} [opts.onSolanaAddress]  called when they type
 *   one here instead, so the other tabs pick it up
 */
export async function mount(host, opts = {}) {
  /* Markup first. The engine wires its listeners at module scope against ids
     it expects to already exist, which is precisely what keeps that file
     unchanged between the standalone page and this one. */
  host.innerHTML = MARKUP;
  const engine = await import("./engine.js");
  engine.init(opts);
  return engine;
}
