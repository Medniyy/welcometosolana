/* CosmJS and the Skip client are written against Node globals. Browsers have
   none of them, and the failure is invisible until transaction encoding runs —
   Keplr signs happily, then "Buffer is not defined" on broadcast.

   This must be imported by an entry file that loads the app *dynamically*,
   because static imports are hoisted and evaluated before any statement here
   would run. src/near-intents-widget.jsx uses the same pattern. */

import { Buffer } from "buffer";

globalThis.Buffer = globalThis.Buffer || Buffer;
globalThis.global = globalThis.global || globalThis;
globalThis.process = globalThis.process || { env: {}, version: "", nextTick: (fn, ...a) => queueMicrotask(() => fn(...a)) };
