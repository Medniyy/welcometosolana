/* Step markup for the Cosmos engine, lifted verbatim from the standalone
   cosmos-bridge.html so the 1,595-line engine keeps finding every id it
   already expects. Injecting this before the engine module is imported is
   what lets that file stay untouched: its top-level wiring runs against a
   DOM that is already in place.

   Only the page chrome was dropped — header, hero and the step numbering
   copy that assumed a page of its own. */

export const MARKUP = String.raw`
  <p class="cosmos-intro">Cosmos is the one route that needs a wallet: Keplr signs
    on the Cosmos side, and the swap, the bridge and the delivery to Solana
    then happen on their own. Your assets arrive as USDC.</p>

  <!-- 1 -->
  <section class="step" id="c-connect">
    <div class="step-head">
      <h2 class="step-title">Connect Keplr</h2>
      <span class="step-num">Step one</span>
    </div>
    <p class="step-note">One approval covers every Cosmos chain we check. We read balances only — nothing moves until you approve it.</p>
    <div class="step-actions">
      <button class="button button--primary" id="connect">Connect Keplr</button>
      <span class="note" id="connect-note"></span>
    </div>
  </section>

  <!-- 2 -->
  <section class="step" id="c-assets" hidden>
    <div class="step-head">
      <h2 class="step-title">What you hold</h2>
      <span class="step-num">Step two</span>
    </div>
    <p class="step-note">Spendable balances only — anything staked or unbonding stays where it is. Very small amounts are held back, though picking two or more assets lets us batch them and move the small ones too.</p>
    <div class="total-row" style="margin-top:22px">
      <strong id="total">—</strong>
      <span id="total-sub"></span>
    </div>
    <div class="assets" id="assets"></div>
    <div id="topup"></div>
    <div class="assets-foot">
      <span class="tally" id="picked-sub"></span>
      <span>
        <button class="textbtn" id="pick-all">Select all</button>
        &nbsp;&nbsp;
        <button class="textbtn" id="pick-none">Clear</button>
      </span>
    </div>
  </section>

  <!-- 3 -->
  <section class="step" id="c-dest" hidden>
    <div class="step-head">
      <h2 class="step-title">Where it lands</h2>
      <span class="step-num">Step three</span>
    </div>
    <p class="step-note">Keplr has no Solana account, so this address comes from a Solana wallet — Phantom, Solflare or Backpack.</p>
    <div style="margin-top:26px">
      <label class="field">
        <span>Your Solana address</span>
        <input type="text" id="solana" placeholder="Paste a Solana address" spellcheck="false" autocomplete="off"/>
      </label>
      <p class="note" id="dest-note"></p>
    </div>
    <div class="step-actions">
      <button class="button button--ghost button--sm" id="wallet-fill">Fill from my Solana wallet</button>
    </div>
    <label class="checkline">
      <input type="checkbox" id="gas-drop" checked/>
      <span>
        <b>Also send a little SOL for network fees</b>
        <span>Recommended. Without a small amount of SOL you can hold USDC but not spend it.</span>
      </span>
    </label>
  </section>

  <!-- 4 -->
  <section class="step" id="c-review" hidden>
    <div class="step-head">
      <h2 class="step-title">Before you sign</h2>
      <span class="step-num">Step four</span>
    </div>
    <div id="review" style="margin-top:24px"></div>
    <div class="step-actions">
      <button class="button button--primary" id="start">Move to Solana</button>
      <button class="button button--ghost button--sm" id="requote">Refresh quote</button>
    </div>
    <p class="callout" id="sig-note"></p>
  </section>

  <!-- 5 -->
  <section class="step" id="c-queue" hidden>
    <div class="step-head">
      <h2 class="step-title">Moving</h2>
      <span class="step-num" id="queue-progress"></span>
    </div>
    <p class="step-note">Keplr asks for one signature at a time. Leave this page open — if you reload, it picks up where it left off.</p>
    <div class="progress" id="progress">
      <div class="progress-track"><div class="progress-fill" id="progress-fill"></div></div>
      <div class="progress-label" id="progress-label"></div>
    </div>
    <div class="queue" id="queue" style="margin-top:22px"></div>
    <details class="log-wrap"><summary>Technical detail</summary><div class="log" id="log"></div></details>
  </section>

  <!-- 6 -->
  <section class="step" id="c-done" hidden>
    <div class="step-head">
      <h2 class="step-title">Arrived</h2>
      <span class="step-num">Done</span>
    </div>
    <div id="done-body" style="margin-top:22px"></div>
    <div id="dflow"></div>
  </section>
`;
