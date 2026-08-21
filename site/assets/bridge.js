/* Unified bridge — one interface, two engines.

   The user picks where their assets are. Which engine answers is a
   consequence they never see:

     Ethereum & EVM  ─┐
                      ├─→ NEAR Intents 1Click (deposit address, no wallet)
     Bitcoin & more  ─┘
     Cosmos           ─→ Skip:Go via Keplr (signed, multi-asset)

   Two of the three tabs are the same engine with a different default chain,
   which is why this file is one flow and not three. The Cosmos engine needs
   a bundler (@skip-go/client, Buffer polyfills) so it lives in its own build
   and is fetched only when that tab is opened — a Bitcoin user never pays
   for it.

   Everything here is vanilla and build-free on purpose: this flow is the
   part we intend to offer to other sites later, and a build step would make
   that a much bigger ask. */

(function () {
  "use strict";

  /* ---------------------------------------------------------------- config */

  const API = "https://1click.chaindefuser.com/v0";

  /* Distribution-channel JWT. It ships in a public bundle by necessity —
     1Click is called from the browser — so it must never gain any power
     beyond routing and fee attribution. Two things it does buy:
     it redirects appFees to us, and it removes NEAR's default 10bps on
     keyless calls, so charging FEE_BPS costs the user 40bps against the
     keyless baseline rather than 50. Expires 14 Aug 2027; quotes start
     failing when it lapses. */
  const JWT =
    "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCIsImtpZCI6IjIwMjUtMDEtMTItdjEifQ.eyJ2IjoxLCJrZXlfdHlwZSI6ImRpc3RyaWJ1dGlvbl9jaGFubmVsIiwicGFydG5lcl9pZCI6ImF0aCIsImlhdCI6MTc4NjcxMDcxNywiZXhwIjoxODE4MjQ2NzE3fQ.kMYnCsH_30wbny2MOSGwnFfkf4BcX7UA3S5d7LHIakl0_DTEW_12YSSjQZRQQaVfVOpUc8f_J7B_hVowa55CKcdNibWAbp16CRcyi5qxnctWOfo9ypeJnHOpgVtToLgg_PdNfOolzwxymfFO30hy7LgYy_bj57ZvSPbtHT7YUdK1nyXgj7tDvCBeKf1u5nzdpu1CBjGOceiJmDXat1oTYH9f12X8Fkbm8-lGJTgDWi00Bz-LOnH0RRm4WxxAmITk0LhOf3rq1Wk_yjlxCodFEy1ndVxfH_W37NJrhfS95nSEv1YVCYsOUn2X4BaJPyCNCtN7PmGPJ0-636JwuN6_-g";

  /* Service fee, gross. 1Click splits it 50/50, so 50bps charged nets 25.
     Matches the Cosmos leg so the two corridors never quote differently for
     the same reason. Empty recipient ⇒ no appFees are sent at all. */
  const FEE_RECIPIENT = "welcometosolana.near";
  const FEE_BPS = 50;

  /* Raced, not chained. A single public endpoint left the account check
     spinning for many seconds and then failing — unacceptable for a lookup
     that is purely advisory and sits directly under the address field.
     First answer wins; if all of them are slow or down, we say nothing. */
  const SOLANA_RPCS = [
    "https://solana-rpc.publicnode.com",
    "https://api.mainnet-beta.solana.com",
  ];
  const SOLANA_RPC_TIMEOUT_MS = 4000;

  const SAVE_ORDER = "wts.bridge.order.v1";
  const SAVE_DEST = "wts.bridge.dest.v1";

  /* Fixed entry filename, set in vite.cosmos.config.js — a content hash here
     would mean editing this file after every Cosmos build. */
  const COSMOS_ENGINE = "cosmos-bridge-dist/cosmos-engine.js";

  /* ------------------------------------------------------------ chain data */

  /* EVM membership decides which tab a chain lands in. Anything 1Click adds
     that is not listed here falls into "Bitcoin & more" on its own, so a new
     chain appears without a code change. */
  const EVM = new Set(["abs", "arb", "avax", "base", "bera", "bsc", "eth",
    "gnosis", "monad", "op", "plasma", "pol", "scroll", "xlayer", "aurora"]);

  const NAMES = {
    eth: "Ethereum", base: "Base", arb: "Arbitrum", pol: "Polygon",
    op: "Optimism", bsc: "BNB Chain", btc: "Bitcoin", sol: "Solana",
    near: "NEAR", tron: "Tron", doge: "Dogecoin", ltc: "Litecoin",
    bch: "Bitcoin Cash", xrp: "XRP Ledger", ton: "TON", sui: "Sui",
    aptos: "Aptos", avax: "Avalanche", gnosis: "Gnosis", zec: "Zcash",
    dash: "Dash", cardano: "Cardano", stellar: "Stellar",
    starknet: "Starknet", scroll: "Scroll", bera: "Berachain",
    monad: "Monad", aleo: "Aleo", plasma: "Plasma", movement: "Movement",
    hypercore: "Hypercore", fogo: "Fogo", xlayer: "X Layer",
    abs: "Abstract", adi: "ADI", aurora: "Aurora",
  };
  const label = (c) => NAMES[c] || c.toUpperCase();

  /* Address shapes, checked before we spend a quote on them. Anything not
     listed falls back to a length check rather than blocking — refusing an
     address we simply have no pattern for would be worse than letting the
     API judge it. */
  const EVM_RE = /^0x[a-fA-F0-9]{40}$/;
  const SHAPE = {
    eth: EVM_RE, base: EVM_RE, arb: EVM_RE, pol: EVM_RE, op: EVM_RE,
    bsc: EVM_RE, gnosis: EVM_RE, avax: EVM_RE, scroll: EVM_RE, bera: EVM_RE,
    monad: EVM_RE, plasma: EVM_RE, abs: EVM_RE, xlayer: EVM_RE, aurora: EVM_RE,
    sol: /^[1-9A-HJ-NP-Za-km-z]{32,44}$/,
    btc: /^(bc1[a-z0-9]{25,62}|[13][a-km-zA-HJ-NP-Z1-9]{25,34})$/,
    doge: /^[DA9][a-km-zA-HJ-NP-Z1-9]{25,34}$/,
    ltc: /^(ltc1[a-z0-9]{25,62}|[LM3][a-km-zA-HJ-NP-Z1-9]{25,34})$/,
    bch: /^((bitcoincash:)?[qp][a-z0-9]{41}|[13][a-km-zA-HJ-NP-Z1-9]{25,34})$/,
    tron: /^T[a-km-zA-HJ-NP-Z1-9]{33}$/,
    near: /^([a-z0-9._-]+\.(near|testnet)|[a-f0-9]{64})$/,
    xrp: /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/,
    ton: /^[EU]Q[A-Za-z0-9_-]{46}$/,
    sui: /^0x[a-fA-F0-9]{64}$/, aptos: /^0x[a-fA-F0-9]{1,64}$/,
  };
  const okAddr = (c, a) => {
    a = (a || "").trim();
    if (!a) return false;
    const re = SHAPE[c];
    return re ? re.test(a) : a.length >= 20;
  };

  /* Chain marks we ship ourselves. Local files beat a CDN here: they are
     already on the page for the hero chain cloud, they survive the CDN
     going down, and they are the only marks whose licensing we know. */
  const LOCAL_MARK = new Set(["adi", "aleo", "arb", "aurora", "avax", "base",
    "bch", "bera", "bsc", "btc", "cardano", "dash", "doge", "eth", "gnosis",
    "hypercore", "ltc", "near", "op", "plasma", "pol", "scroll", "sol",
    "starknet", "stellar", "sui", "ton", "tron", "xlayer", "xrp", "zec"]);
  const MARK_ALIAS = { monad: "mon" };

  /* Tokens whose correct logo is a mark we already ship. Keyed by symbol, not
     by chain, so ETH on Arbitrum gets the Ethereum mark with an Arbitrum
     badge rather than the Arbitrum logo twice.

     This exists because the community icon CDN we fall back to has been
     unmaintained for years and serves a superseded Solana logo — which is
     exactly the asset it is least acceptable to get wrong on this site. Our
     own files win whenever we have one. */
  const C = "assets/chains/", T = "assets/tokens/";
  const OWN_MARK = {
    /* Stablecoins get their own files rather than a CDN lookup. USDC is the
       destination of very nearly every transfer this site makes, and the
       community set serves USDT as white-on-transparent, which is invisible
       against paper — it rendered as an empty circle. */
    USDC: T + "usdc.png", USDT: T + "usdt.svg",
    SOL: C + "sol.svg", ETH: C + "eth.svg", WETH: C + "eth.svg",
    BTC: C + "btc.svg", WBTC: C + "btc.svg", NEAR: C + "near.svg",
    TRX: C + "tron.svg", XRP: C + "xrp.svg", TON: C + "ton.svg",
    SUI: C + "sui.svg", DOGE: C + "doge.svg", LTC: C + "ltc.svg",
    BCH: C + "bch.svg", ADA: C + "cardano.svg", XLM: C + "stellar.svg",
    ZEC: C + "zec.svg", DASH: C + "dash.svg", BNB: C + "bsc.svg",
    AVAX: C + "avax.svg", POL: C + "pol.svg", MATIC: C + "pol.svg",
    ARB: C + "arb.svg", OP: C + "op.svg", BERA: C + "bera.svg",
    MON: C + "mon.svg", STRK: C + "starknet.svg", ALEO: C + "aleo.svg",
    ATOM: C + "cosmos.png",
  };
  const ownMark = (sym) => OWN_MARK[String(sym || "").toUpperCase()] || null;
  /* Marks drawn as a full coin — they bring their own circular ground, so
     they fill the slot rather than sitting inset on ours. */
  const COIN_MARK = new Set(["USDC", "USDT"]);
  const chainMark = (c) => {
    const file = MARK_ALIAS[c] || c;
    return LOCAL_MARK.has(file) || file === "mon" ? `assets/chains/${file}.svg` : null;
  };

  /* Stables first — an amount is easiest to reason about in dollars — then
     the chain's own asset. */
  const PIN = ["USDC", "USDT", "ETH", "BTC", "SOL", "NEAR", "BNB"];

  /* Chain order in the picker. Alphabetical put Abstract at the top and
     Ethereum eleven rows down, which is the wrong answer for almost every
     visitor. Listed chains come first in this order; everything else keeps
     alphabetical order behind them, so a new 1Click chain still appears
     without being given a rank it has not earned. */
  const CHAIN_RANK = ["eth", "base", "arb", "op", "pol", "bsc", "avax",
    "btc", "tron", "xrp", "ton", "sui", "near", "doge", "ltc", "bch",
    "cardano", "stellar", "zec", "aptos", "starknet", "scroll", "gnosis"];
  function byChainRank(a, b) {
    const ia = CHAIN_RANK.indexOf(a), ib = CHAIN_RANK.indexOf(b);
    if (ia !== -1 || ib !== -1) {
      if (ia === -1) return 1;
      if (ib === -1) return -1;
      return ia - ib;
    }
    return label(a).localeCompare(label(b));
  }

  const GROUPS = {
    evm: {
      engine: "near", title: "Ethereum & EVM",
      marks: ["eth", "base", "arb"], def: { chain: "eth", symbol: "ETH" },
      has: (c) => EVM.has(c),
    },
    cosmos: {
      engine: "cosmos", title: "Cosmos",
      marks: ["cosmos"], def: null, has: () => false,
    },
    more: {
      engine: "near", title: "Bitcoin & more",
      marks: ["btc", "tron", "xrp"], def: { chain: "btc", symbol: "BTC" },
      has: (c) => !EVM.has(c),
    },
  };

  /* -------------------------------------------------------------- plumbing */

  const $ = (id) => document.getElementById(id);
  const root = $("bridge");
  if (!root) return;

  const S = {
    group: "evm",
    tokens: [], byChain: {},
    src: null, dst: null,
    quote: null, order: null,
    cosmosMod: null,
    /* mint -> logo url, filled in after boot from the Solana token registry */
    icons: {},
    pollTimer: null, previewSeq: 0, previewTimer: null,
    cosmos: null,
    /* Once the user types an amount it is theirs, and changing tokens must
       not overwrite it. Until then we keep it sensible for whatever token
       is selected. */
    amountTouched: false,
    /* Whether anything on this page happened because a person did it. The
       bridge quotes its own defaults on load, so without this the funnel
       counts every homepage visit as interest in bridging. */
    engaged: false,
  };

  const esc = (s) => String(s).replace(/[&<>"']/g,
    (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));

  const fmt = (raw, dec, p = 6) =>
    (Number(raw) / 10 ** dec).toLocaleString("en-US", { maximumFractionDigits: p });

  const money = (n) => {
    const a = Math.abs(Number(n));
    const d = a < 1 ? 4 : 2;
    return "$" + Number(n).toLocaleString("en-US",
      { minimumFractionDigits: d, maximumFractionDigits: d });
  };

  /* Decimal string → base units, without floating point ever touching it.
     Returns null for anything that is not a clean number the token can
     actually represent. */
  function toBase(s, dec) {
    s = String(s).trim();
    if (!/^\d*\.?\d*$/.test(s) || s === "" || s === ".") return null;
    const [w = "0", f = ""] = s.split(".");
    if (f.length > dec) return null;
    const b = (w + f.padEnd(dec, "0")).replace(/^0+(?=\d)/, "");
    return /^\d+$/.test(b) && b !== "0" ? b : null;
  }

  const track = (n, d) => { try { window._track && window._track(n, d || {}); } catch (e) { /* noop */ } };

  /* Umami stores event properties well but is weak at summing a numeric field
     across events, so every money figure is sent twice: the raw number for
     export, and a bucket the dashboard can group by directly. */
  function usdBucket(n) {
    const v = Number(n);
    if (!isFinite(v) || v <= 0) return "unknown";
    if (v < 25) return "a_under_25";
    if (v < 100) return "b_25_100";
    if (v < 500) return "c_100_500";
    if (v < 2000) return "d_500_2k";
    if (v < 10000) return "e_2k_10k";
    return "f_10k_plus";
  }
  const money2 = (n) => Math.round(Number(n) * 100) / 100;

  /* Funnel steps should count people, not keystrokes — a debounced quote
     fires on every character typed. `key` defaults to the event name; pass a
     narrower one to count a step once per corridor rather than once per
     session. */
  const fired = new Set();
  function trackOnce(name, data, key) {
    const k = key || name;
    if (fired.has(k)) return;
    fired.add(k);
    track(name, data);
  }

  /* An amount carried across a token change is nonsense: 100 ETH becomes
     100 BTC, which is roughly ten million dollars and has no liquidity on
     any route. So until the user types their own figure, the amount tracks
     roughly a hundred dollars of whatever is selected, rounded to something
     a person would actually type. */
  const START_USD = 100;
  function niceAmount(token) {
    const price = Number(token && token.price);
    if (!isFinite(price) || price <= 0) return "100";
    const v = START_USD / price;
    const mag = Math.pow(10, Math.floor(Math.log10(v)));
    const n = v / mag;
    const step = n < 1.5 ? 1 : n < 3.5 ? 2 : n < 7.5 ? 5 : 10;
    /* Never propose more precision than the token can represent. */
    const dec = Math.min(token.decimals ?? 8, 8);
    return String(Number((step * mag).toFixed(dec)));
  }

  function syncAmount() {
    if (S.amountTouched || !S.src) return;
    $("nb-amt").value = niceAmount(S.src);
  }

  /* ----------------------------------------------------------- token marks */

  /* 1Click publishes no logo field, so marks are resolved from what the data
     does carry: contract address first, then symbol, then a monogram. The
     monogram is the floor — a broken image never renders. */
  const MONO_HUES = ["#365d49", "#5b4a7a", "#7a5a1e", "#8f3a2e", "#2f5d75", "#4a5d2f", "#6d3f5c"];
  function monoFor(sym) {
    let h = 0;
    for (const ch of sym) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return MONO_HUES[h % MONO_HUES.length];
  }

  function markHTML(token, big) {
    if (!token) return "";
    const sym = token.symbol || "?";
    const mine = ownMark(sym);
    const cls = (big ? "tok tok-lg" : "tok") +
      (mine ? " tok--own" : "") +
      (mine && COIN_MARK.has(sym.toUpperCase()) ? " tok--coin" : "");
    const mcls = big ? "tok-mono tok-lg-mono" : "tok-mono";
    const mono = `<span class="${mcls}" style="background:${monoFor(sym)}">${
      esc(sym.replace(/[^A-Za-z0-9]/g, "").slice(0, 3).toUpperCase())}</span>`;

    /* Ours first, always. Then 1inch by contract address, which is current
       for ERC-20s. The community icon set is the last resort before a
       monogram, because it is years stale. */
    const cands = [];
    if (mine) cands.push(mine);
    /* The Solana token registry, keyed by mint. It is the only source that
       knows the long tail: the community icon set has nothing for most of
       these and every one of them was rendering as a monogram. */
    if (token.contractAddress && S.icons[token.contractAddress])
      cands.push(S.icons[token.contractAddress]);
    if (token.contractAddress && EVM_RE.test(token.contractAddress))
      cands.push(`https://tokens.1inch.io/${token.contractAddress.toLowerCase()}.png`);
    cands.push(`https://raw.githubusercontent.com/spothq/cryptocurrency-icons/master/32/color/${
      sym.toLowerCase()}.png`);

    const img = `<img class="${cls}" src="${cands[0]}" alt="" loading="lazy"
      data-fallbacks="${esc(JSON.stringify(cands))}" data-i="0"
      data-mono="${encodeURIComponent(mono)}" onerror="__tokFallback(this)"/>`;

    /* The badge disambiguates one token across many chains — USDC on Base is
       not USDC on Arbitrum. It says nothing at all on a chain's own asset,
       where it would just stamp the Solana logo onto the Solana logo. */
    const badge = chainMark(token.blockchain);
    const redundant = !badge || badge === mine;
    return redundant
      ? img
      : `<span class="tok-wrap">${img}<img class="tok-chain" src="${badge}" alt="" aria-hidden="true"/></span>`;
  }

  window.__tokFallback = function (img) {
    const list = JSON.parse(img.dataset.fallbacks);
    const i = Number(img.dataset.i) + 1;
    if (i < list.length) {
      img.dataset.i = i;
      /* Past our own file the source is a square raster, which wants
         cropping rather than the containing treatment. */
      img.classList.remove("tok--own", "tok--coin");
      img.src = list[i];
      return;
    }
    img.outerHTML = decodeURIComponent(img.dataset.mono);
  };

  /* ------------------------------------------------------------------ tabs */

  function renderTabs() {
    $("bridge-tabs").innerHTML = Object.entries(GROUPS).map(([key, g]) => {
      const marks = g.marks.map((m) => {
        const src = m === "cosmos" ? "assets/chains/cosmos.png" : chainMark(m);
        return src ? `<img src="${src}" alt=""/>` : "";
      }).join("");
      const n = key === "cosmos" ? null : countIn(key);
      const sub = key === "cosmos"
        ? "Osmosis, Celestia, Injective +15"
        : key === "evm"
          ? `Ethereum, Base, Arbitrum${n > 3 ? ` +${n - 3}` : ""}`
          : `Bitcoin, Tron, XRP${n > 3 ? ` +${n - 3}` : ""}`;
      return `<button class="bridge-tab${key === S.group ? " is-active" : ""}" type="button"
          role="tab" id="bridge-tab-${key}" aria-selected="${key === S.group}"
          aria-controls="bridge-panel-${GROUPS[key].engine}" data-group="${key}">
          <span class="bridge-tab-marks">${marks}</span>
          <span><strong>${esc(g.title)}</strong><small>${esc(sub)}</small></span>
        </button>`;
    }).join("");
  }

  const countIn = (key) =>
    Object.keys(S.byChain).filter((c) => c !== "sol" && GROUPS[key].has(c)).length;

  function setGroup(key) {
    if (S.group === key) return;
    S.group = key;
    renderTabs();
    const engine = GROUPS[key].engine;
    $("bridge-panel-near").hidden = engine !== "near";
    $("bridge-panel-cosmos").hidden = engine !== "cosmos";
    /* Once per corridor, not once per click. Counting every click put this at
       104 against 44 visits, which is a fine engagement number and a useless
       funnel step - the stages either count the same thing or they cannot be
       read against each other. */
    trackOnce("bridge_tab", { group: key }, `bridge_tab:${key}`);

    if (engine === "cosmos") { ensureCosmos(); return; }

    /* Switching between the two NEAR tabs re-defaults the source, but only
       when the current one belongs to the tab we just left. Someone who
       chose Solana-bound USDT on Tron and taps across to look at EVM should
       find their choice intact when they tap back. */
    if (!S.src || !GROUPS[key].has(S.src.blockchain)) applyDefault(key);
    syncAmount();
    renderSwap();
    schedulePreview();
  }

  function applyDefault(key) {
    const d = GROUPS[key].def;
    if (!d) return;
    const list = S.byChain[d.chain] || [];
    S.src = list.find((t) => t.symbol === d.symbol) || list[0] ||
      pickAny((c) => GROUPS[key].has(c));
  }

  function pickAny(pred) {
    for (const c of Object.keys(S.byChain)) {
      if (c !== "sol" && pred(c) && S.byChain[c].length) return S.byChain[c][0];
    }
    return null;
  }

  /* ------------------------------------------------------------- swap card */

  function renderSwap() {
    const s = S.src, d = S.dst;
    $("nb-src-mark").innerHTML = markHTML(s);
    $("nb-src-sym").textContent = s ? s.symbol : "—";
    $("nb-src-chain").textContent = s ? label(s.blockchain) : "";
    $("nb-dst-mark").innerHTML = markHTML(d);
    $("nb-dst-sym").textContent = d ? d.symbol : "—";
    $("nb-dst-chain").textContent = "Solana";

    const chain = s ? label(s.blockchain) : "";
    $("nb-via").textContent = s
      ? `Send ${s.symbol} on ${chain} — it arrives on Solana as ${d ? d.symbol : "USDC"}.`
      : "";
    $("nb-refund-label").textContent = chain ? `on ${chain}` : "";
    $("nb-refund").placeholder = chain ? `Your ${chain} address` : "On the sending chain";
  }

  /* ---------------------------------------------------------- asset picker */

  let pickerFor = null;

  function openPicker(kind) {
    pickerFor = kind;
    const dlg = $("bridge-picker");
    $("picker-title").textContent = kind === "src" ? "Send from" : "Receive on Solana";
    $("picker-q").value = "";
    $("picker-q").placeholder = kind === "src" ? "Search chain or token" : "Search token";
    renderPickerList("");
    dlg.showModal();
    /* Land on what is already chosen rather than at the top — on a list this
       long, "where am I now" is the first question. */
    const on = $("picker-list").querySelector(".picker-item.is-on");
    if (on) on.scrollIntoView({ block: "center" });
    /* Focusing the field on a phone raises the keyboard over a bottom sheet
       and hides the list, so only desktop gets an autofocused search. */
    if (window.matchMedia("(min-width: 561px)").matches) $("picker-q").focus();
  }

  function pickerOptions() {
    if (pickerFor === "dst") {
      return [{ chain: "sol", tokens: destTokens() }];
    }
    const g = GROUPS[S.group];
    return Object.keys(S.byChain)
      .filter((c) => c !== "sol" && g.has(c))
      .sort(byChainRank)
      .map((c) => ({ chain: c, tokens: ordered(S.byChain[c]) }));
  }

  function ordered(list) {
    const pinned = [];
    for (const sym of PIN) {
      const t = list.find((x) => x.symbol === sym);
      if (t) pinned.push(t);
    }
    const rest = list.filter((t) => !pinned.includes(t))
      .sort((a, b) => a.symbol.localeCompare(b.symbol));
    return [...pinned, ...rest];
  }

  /* Destination order. The routing network already delivers 17 different
     Solana assets; restricting the picker to two was our own limitation, not
     theirs. Stables and majors lead, the long tail follows alphabetically —
     and an asset with no liquid route simply fails to quote and says so. */
  const DEST_PIN = ["USDC", "USDT", "SOL", "xBTC", "ZEC", "USD1", "sUSDC"];
  function destTokens() {
    const all = (S.byChain.sol || []).slice();
    const pinned = [];
    for (const sym of DEST_PIN) {
      const t = all.find((x) => x.symbol === sym);
      if (t) pinned.push(t);
    }
    const rest = all.filter((t) => !pinned.includes(t))
      .sort((a, b) => a.symbol.localeCompare(b.symbol));
    return [...pinned, ...rest];
  }

  function renderPickerList(q) {
    q = q.trim().toLowerCase();
    const cur = pickerFor === "src" ? S.src : S.dst;
    const html = [];
    for (const { chain, tokens } of pickerOptions()) {
      const name = label(chain);
      /* A query matching the chain name shows the whole chain — typing
         "arbitrum" should not require also knowing a ticker on it. */
      const chainHit = !q || name.toLowerCase().includes(q) || chain.includes(q);
      const hits = tokens.filter((t) => chainHit || t.symbol.toLowerCase().includes(q));
      if (!hits.length) continue;
      html.push(`<p class="picker-group">${esc(name)}</p>`);
      for (const t of hits) {
        const on = cur && cur.assetId === t.assetId;
        html.push(`<button class="picker-item${on ? " is-on" : ""}" type="button"
          data-asset="${esc(t.assetId)}">
          ${markHTML(t)}
          <span><strong>${esc(t.symbol)}</strong><small>${esc(t.name || name)}</small></span>
          ${on ? '<span class="picker-on">✓</span>' : ""}
        </button>`);
      }
    }
    $("picker-list").innerHTML = html.length
      ? html.join("")
      : `<p class="picker-empty">Nothing matches “${esc(q)}”.</p>`;
  }

  function choose(assetId) {
    const t = S.tokens.find((x) => x.assetId === assetId);
    if (!t) return;
    S.engaged = true;
    if (pickerFor === "src") { S.src = t; syncAmount(); } else S.dst = t;
    /* A different destination token means a different token account, so the
       rent warning has to be re-asked rather than left stale. */
    $("bridge-picker").close();
    renderSwap();
    checkDest();
    schedulePreview();
  }

  /* ------------------------------------------------------- live dry quote */

  /* A preview costs nothing and commits to nothing — `dry:true` returns no
     deposit address. Showing the real number before the user hands over an
     address is the single biggest improvement over asking them to commit
     first and discover the rate after. */
  function schedulePreview() {
    clearTimeout(S.previewTimer);
    S.previewTimer = setTimeout(preview, 350);
  }

  async function preview() {
    const amt = $("nb-amt").value;
    const s = S.src, d = S.dst;
    setOut(null);
    if (!s || !d) return;
    const base = toBase(amt, s.decimals);
    if (!base) { $("nb-in-usd").textContent = ""; return; }

    const seq = ++S.previewSeq;
    $("nb-out").textContent = "…";
    try {
      const q = await quote({ dry: true, src: s, dst: d, amount: base,
        recipient: recipientOrPlaceholder(), refundTo: refundOrPlaceholder(s.blockchain) });
      if (seq !== S.previewSeq) return;          // a newer keystroke won
      S.quote = q;
      setOut(q);
      /* Only a quote the user brought about is worth counting. The boot
         quote prices a default nobody chose, and counting it made
         bridge_quote fire before bridge_view and land level with pageviews
         — a funnel step that every visitor passes measures nothing. */
      if (S.engaged) trackOnce("bridge_quote", {
        group: S.group, chain: s.blockchain, symbol: s.symbol,
        dst: d.symbol,
        usd: money2(q.quote.amountInUsd), bucket: usdBucket(q.quote.amountInUsd),
      }, `bridge_quote:${S.group}`);
    } catch (e) {
      if (seq !== S.previewSeq) return;
      S.quote = null;
      $("nb-out").textContent = "—";
      $("nb-out-usd").textContent = "";
      $("nb-meta").hidden = true;
      $("nb-quote-note").className = "note warn";
      $("nb-quote-note").textContent = explain(e);
    }
  }

  /* A dry quote still validates the addresses it is given, so a preview
     before the user has typed one uses a known-good throwaway. Nothing is
     reserved and no address is generated, so this cannot misdirect funds. */
  const SAMPLE = {
    sol: "6dNVEBpV6rjNJmVBUcCLLuBnhrEcHjrKFP8ovAv3Yzp7",
    evm: "0x71C7656EC7ab88b098defB751B7401B5f6d8976F",
    btc: "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq",
    tron: "TN3W4H6rK2ce4vX9YnFQHwKENnHjoxb3m9",
    xrp: "rN7n7otQDd6FczFgLdSqtcsAUxDkw6fzRH",
    doge: "DH5yaieqoZN36fDVciNyRueRGvGLR3mr7L",
    ltc: "ltc1qgm39cu09lyxx7fzhupzqmqm2mvzp2qxrfhzhs0",
    near: "wrap.near",
    ton: "UQAsL_wgOwsF8QwqLW1zLXnHCXCsZJRWMOSTyHZv5vFjHxSl",
    sui: "0x0000000000000000000000000000000000000000000000000000000000000002",
  };
  function recipientOrPlaceholder() {
    const v = $("nb-rcpt").value.trim();
    return okAddr("sol", v) ? v : SAMPLE.sol;
  }
  function refundOrPlaceholder(chain) {
    const v = $("nb-refund").value.trim();
    if (okAddr(chain, v)) return v;
    if (EVM.has(chain)) return SAMPLE.evm;
    return SAMPLE[chain] || SAMPLE.evm;
  }

  function quoteBody(o) {
    const body = {
      dry: !!o.dry, swapType: "EXACT_INPUT", slippageTolerance: 100,
      originAsset: o.src.assetId, depositType: "ORIGIN_CHAIN",
      destinationAsset: o.dst.assetId, amount: o.amount,
      recipient: o.recipient, recipientType: "DESTINATION_CHAIN",
      refundTo: o.refundTo, refundType: "ORIGIN_CHAIN",
      deadline: new Date(Date.now() + 30 * 60_000).toISOString(),
    };
    if (FEE_RECIPIENT) body.appFees = [{ recipient: FEE_RECIPIENT, fee: FEE_BPS }];
    return body;
  }

  async function quote(o) {
    const res = await fetch(`${API}/quote`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${JWT}` },
      body: JSON.stringify(quoteBody(o)),
    });
    if (!res.ok) {
      const txt = (await res.text()).slice(0, 300);
      const err = new Error(txt || `HTTP ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return res.json();
  }

  /* Client errors are useless to a user as raw text. The one thing they need
     to know first is whether any money moved — and on a quote, none ever
     has. */
  function explain(e) {
    const m = String(e && e.message || e);
    if (/amount.*too (small|low)|below.*min/i.test(m))
      return "That amount is below the minimum for this route. Nothing was sent — try a larger amount.";
    if (/liquidity|no route|unsupported/i.test(m))
      return "No route is available for that pair right now. Nothing was sent — try another token.";
    if (e && e.status === 429)
      return "The quote service is busy. Nothing was sent — try again in a moment.";
    if (/failed to fetch|networkerror/i.test(m))
      return "Could not reach the quote service. Nothing was sent — check your connection.";
    return `Could not price that route. Nothing was sent. (${m.slice(0, 120)})`;
  }

  function setOut(q) {
    const d = S.dst;
    $("nb-quote-note").textContent = "";
    $("nb-quote-note").className = "note";
    if (!q) {
      $("nb-out").textContent = "—";
      $("nb-out").classList.remove("has-value");
      $("nb-out-usd").textContent = "";
      $("nb-in-usd").textContent = "";
      $("nb-meta").hidden = true;
      $("nb-go").disabled = true;
      return;
    }
    const v = q.quote;
    $("nb-out").textContent = Number(v.amountOutFormatted)
      .toLocaleString("en-US", { maximumFractionDigits: 6 });
    $("nb-out").classList.add("has-value");
    $("nb-out-usd").textContent = v.amountOutUsd ? money(v.amountOutUsd) : "";
    $("nb-in-usd").textContent = v.amountInUsd ? money(v.amountInUsd) : "";

    const inUsd = Number(v.amountInUsd), outUsd = Number(v.amountOutUsd);
    const total = inUsd - outUsd;
    const pct = inUsd > 0 ? (total / inUsd) * 100 : 0;
    const rate = Number(v.amountOutFormatted) / Number(q.quoteRequest.amount) *
      10 ** (S.src ? S.src.decimals : 0);

    $("nb-rate").textContent = S.src
      ? `1 ${S.src.symbol} ≈ ${rate.toLocaleString("en-US", { maximumFractionDigits: 6 })} ${d.symbol}`
      : "—";
    const cost = $("nb-cost");
    cost.textContent = `${money(total)} · ${pct.toFixed(2)}%`;
    cost.className = pct > 2 ? "is-warn" : pct <= 1 ? "is-good" : "";
    $("nb-min").textContent = `${fmt(v.minAmountOut, d.decimals)} ${d.symbol}`;
    $("nb-eta").textContent = `~${v.timeEstimate}s after confirmation`;
    $("nb-meta").hidden = false;

    /* Fee breakdown. 1Click itemises nothing, so derive it: USD in minus USD
       out is the only cross-asset-safe total, the delivery fee is priced
       from the destination token, and the remainder is route + spread. */
    const wdTok = Number(v.withdrawFee || 0) / 10 ** d.decimals;
    const wdUsd = d.price ? wdTok * Number(d.price) : null;
    $("nb-bd-in").textContent = `${v.amountInFormatted} ${S.src.symbol} · ${money(inUsd)}`;
    $("nb-bd-out").textContent = `${v.amountOutFormatted} ${d.symbol} · ${money(outUsd)}`;
    $("nb-bd-spread").textContent = wdUsd == null ? "included" : money(total - wdUsd);
    $("nb-bd-deliver").textContent =
      `${wdTok.toLocaleString("en-US", { maximumFractionDigits: 6 })} ${d.symbol}` +
      (wdUsd == null ? "" : ` · ${money(wdUsd)}`);
    $("nb-bd-refund").textContent =
      `${fmt(v.refundFee || 0, S.src.decimals)} ${S.src.symbol} kept`;
    $("nb-bd-note").textContent = pct > 1.5
      ? "This percentage is high because the fixed costs don't shrink with the transfer. Sending more makes it proportionally much cheaper."
      : "Fixed costs stay flat as the amount grows, so larger transfers cost proportionally less.";

    $("nb-go").disabled = !ready();
  }

  const ready = () =>
    !!(S.src && S.dst && toBase($("nb-amt").value, S.src.decimals) &&
      okAddr("sol", $("nb-rcpt").value) && okAddr(S.src.blockchain, $("nb-refund").value));

  /* ------------------------------------------------- destination checks */

  /* CCTP-style deliveries and SPL transfers alike need the recipient to own
     a token account for the mint. Opening one costs about $0.19 in rent,
     once, and it is charged out of the transfer — so a first-timer sees a
     number that looks wrong unless we say this up front. Cheap to detect:
     one RPC call. */
  let destSeq = 0;
  async function checkDest() {
    const el = $("nb-rcpt-note");
    const addr = $("nb-rcpt").value.trim();
    $("nb-rcpt").classList.toggle("is-bad", !!addr && !okAddr("sol", addr));
    if (!addr) { el.className = "note"; el.textContent = ""; return; }
    if (!okAddr("sol", addr)) {
      el.className = "note bad";
      el.textContent = "That doesn't look like a Solana address.";
      return;
    }
    el.className = "note ok";
    el.textContent = "Solana address looks right.";

    /* Native SOL needs no token account, and a token whose mint we cannot
       resolve cannot be checked — say nothing rather than guess. */
    const mint = S.dst && S.dst.contractAddress;
    if (!mint) return;

    const seq = ++destSeq;
    const body = JSON.stringify({
      jsonrpc: "2.0", id: 1, method: "getTokenAccountsByOwner",
      params: [addr, { mint }, { encoding: "jsonParsed" }],
    });
    const ask = async (url) => {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), SOLANA_RPC_TIMEOUT_MS);
      try {
        const r = await fetch(url, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body, signal: ctl.signal,
        });
        if (!r.ok) throw new Error(String(r.status));
        const j = await r.json();
        if (j.error || !j.result || !Array.isArray(j.result.value)) throw new Error("bad reply");
        return j.result.value.length > 0;
      } finally { clearTimeout(t); }
    };

    try {
      const has = await Promise.any(SOLANA_RPCS.map(ask));
      if (seq !== destSeq) return;
      if (!has) {
        el.className = "note warn";
        el.textContent = `First time receiving ${S.dst.symbol} here — about $0.19 of the transfer opens the token account. One-off; later transfers don't pay it.`;
      }
    } catch (e) { /* advisory only; never block on it, and never alarm */ }
  }

  function checkRefund() {
    const el = $("nb-refund-note");
    const v = $("nb-refund").value.trim();
    const chain = S.src ? S.src.blockchain : null;
    $("nb-refund").classList.toggle("is-bad", !!v && chain && !okAddr(chain, v));
    if (!v || !chain) { el.className = "note"; el.textContent = ""; return; }
    const good = okAddr(chain, v);
    el.className = good ? "note ok" : "note bad";
    el.textContent = good
      ? `Valid ${label(chain)} address.`
      : `That doesn't look like a ${label(chain)} address.`;
  }

  /* ------------------------------------------------------- wallet autofill */

  /* Read-only. We ask for an address and nothing else — no signing, no
     approvals beyond the connection itself, and the manual field stays the
     default path for anyone who would rather not connect at all. */
  async function fillFromWallet() {
    const p = window.phantom?.solana || window.solflare || window.backpack?.solana ||
      (window.solana && window.solana.isPhantom ? window.solana : null);
    if (!p) {
      $("nb-rcpt-note").className = "note warn";
      $("nb-rcpt-note").textContent = "No Solana wallet detected in this browser — paste the address instead.";
      return;
    }
    try {
      const r = await p.connect();
      const key = (r && r.publicKey) || p.publicKey;
      if (!key) throw new Error("no account");
      $("nb-rcpt").value = key.toString();
      saveDest();
      checkDest();
      schedulePreview();
      track("bridge_wallet_fill", { engine: "near" });
    } catch (e) {
      $("nb-rcpt-note").className = "note warn";
      $("nb-rcpt-note").textContent = "Wallet didn't share an address. You can paste it instead.";
    }
  }

  /* The destination survives tab switches and reloads — it is the one value
     a user has to fetch from somewhere else, so asking twice is a real cost. */
  function saveDest() {
    try { localStorage.setItem(SAVE_DEST, $("nb-rcpt").value.trim()); } catch (e) { /* private mode */ }
  }
  function loadDest() {
    try {
      const v = localStorage.getItem(SAVE_DEST);
      if (v && okAddr("sol", v)) { $("nb-rcpt").value = v; checkDest(); }
    } catch (e) { /* private mode */ }
  }

  /* --------------------------------------------------------------- commit */

  async function submit() {
    if (!ready()) return;
    const go = $("nb-go");
    go.disabled = true;
    $("nb-go-label").textContent = "Reserving address";
    $("nb-go-icon").innerHTML = '<span class="spin"></span>';

    try {
      const s = S.src, d = S.dst;
      const q = await quote({
        dry: false, src: s, dst: d, amount: toBase($("nb-amt").value, s.decimals),
        recipient: $("nb-rcpt").value.trim(), refundTo: $("nb-refund").value.trim(),
      });
      const v = q.quote;
      S.order = {
        addr: v.depositAddress, chain: s.blockchain, chainName: label(s.blockchain),
        srcId: s.assetId, dstId: d.assetId,
        sendAmt: v.amountInFormatted, sendSym: s.symbol,
        getAmt: v.amountOutFormatted, getSym: d.symbol,
        minOut: `${fmt(v.minAmountOut, d.decimals)} ${d.symbol}`,
        eta: v.timeEstimate, at: Date.now(),
        /* Kept on the order so the completion event can still report the size
           after a reload, when the quote object is long gone. */
        usd: money2(v.amountInUsd), outUsd: money2(v.amountOutUsd),
      };
      try { localStorage.setItem(SAVE_ORDER, JSON.stringify(S.order)); } catch (e) { /* private mode */ }
      track("bridge_deposit_reserved", {
        group: S.group, chain: s.blockchain, symbol: s.symbol, dst: d.symbol,
        usd: money2(v.amountInUsd), bucket: usdBucket(v.amountInUsd),
        /* The deposit address makes this transfer's outcome recoverable later:
           it can be handed back to /v0/status to learn what actually arrived,
           long after the tab that started it was closed. Without it, a
           transfer completed on someone's phone is unaccountable forever.
           Single-use and issued by the router, so it identifies the transfer
           rather than the person. */
        deposit: v.depositAddress,
      });
      showOrder(S.order);
    } catch (e) {
      go.disabled = false;
      $("nb-go-label").textContent = "Get deposit address";
      $("nb-go-icon").textContent = "→";
      $("nb-quote-note").className = "note bad";
      $("nb-quote-note").textContent = explain(e);
    }
  }

  function showOrder(o) {
    $("nb-form").hidden = true;
    $("nb-deposit").hidden = false;
    $("nb-progress").hidden = false;

    const src = S.tokens.find((t) => t.assetId === o.srcId) || { symbol: o.sendSym };
    $("nb-send-mark").innerHTML = markHTML(src, true);
    $("nb-send-amt").textContent = `${o.sendAmt} ${o.sendSym}`;
    $("nb-get-amt").textContent = `${o.getAmt} ${o.getSym}`;
    $("nb-dep-net").textContent = o.chainName;
    $("nb-addr").textContent = o.addr;
    $("nb-net-warn").innerHTML =
      `<strong>${esc(o.chainName)} network only.</strong> Funds sent on any other network cannot be recovered.`;
    renderQR(o.addr);

    clearInterval(S.pollTimer);
    poll();
    S.pollTimer = setInterval(poll, 5000);
    $("nb-deposit").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function renderQR(text) {
    const box = $("nb-qr");
    try {
      const q = window.qrcode(0, "M");
      q.addData(text);
      q.make();
      box.innerHTML = q.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
    } catch (e) {
      box.innerHTML = "";
      $("nb-qr-wrap").hidden = true;
    }
  }

  /* --------------------------------------------------------------- status */

  /* `t` is the live headline; `hint` is what the list of stages below cannot
     say. Without the hint the headline just repeated the highlighted row
     word for word, which reads as a rendering bug rather than a status. */
  const STATUS = {
    PENDING_DEPOSIT: { i: 0, t: "Waiting for your transfer",
      hint: "Checking every few seconds — you can leave this page open." },
    KNOWN_DEPOSIT_TX: { i: 1, t: "Transfer detected on chain",
      hint: "Waiting for it to confirm." },
    PROCESSING: { i: 2, t: "Swapping through solvers",
      hint: "Usually under a minute from here." },
    SUCCESS: { i: 3, t: "Delivered", done: true,
      hint: "Your assets are on Solana." },
    REFUNDED: { i: 3, t: "Refunded", done: true, bad: true,
      hint: "The swap could not complete, so your funds went back to your refund address." },
    FAILED: { i: 3, t: "This transfer failed", done: true, bad: true,
      hint: "Nothing was delivered. If funds left your wallet they return to your refund address." },
    EXPIRED: { i: 0, t: "Quote expired", done: true, bad: true,
      hint: "Nothing was sent. Start a new transfer to get a fresh rate." },
  };

  async function poll() {
    if (!S.order) return;
    try {
      const res = await fetch(`${API}/status?depositAddress=${encodeURIComponent(S.order.addr)}`,
        { headers: { Authorization: `Bearer ${JWT}` } });
      /* A 404 here is not an error: the indexer has simply not seen this
         address yet, which is the normal state before the first deposit. */
      if (res.status === 404) { paint("PENDING_DEPOSIT"); return; }
      if (!res.ok) return;
      const j = await res.json();
      paint(j.status || "PENDING_DEPOSIT", j);
    } catch (e) { /* transient; the next tick retries */ }
  }

  /* Explorer links for the receipt. A transfer someone cannot verify for
     themselves is a transfer they have to take our word for, and "it says it
     worked" is worth much less than a block explorer saying so. */
  const EXPLORER_TX = {
    sol: (h) => `https://solscan.io/tx/${h}`,
    eth: (h) => `https://etherscan.io/tx/${h}`,
    base: (h) => `https://basescan.org/tx/${h}`,
    arb: (h) => `https://arbiscan.io/tx/${h}`,
    op: (h) => `https://optimistic.etherscan.io/tx/${h}`,
    pol: (h) => `https://polygonscan.com/tx/${h}`,
    bsc: (h) => `https://bscscan.com/tx/${h}`,
    avax: (h) => `https://snowtrace.io/tx/${h}`,
    btc: (h) => `https://mempool.space/tx/${h}`,
    tron: (h) => `https://tronscan.org/#/transaction/${h}`,
    doge: (h) => `https://dogechain.info/tx/${h}`,
    ltc: (h) => `https://blockchair.com/litecoin/transaction/${h}`,
    xrp: (h) => `https://xrpscan.com/tx/${h}`,
    ton: (h) => `https://tonviewer.com/transaction/${h}`,
    sui: (h) => `https://suiscan.xyz/mainnet/tx/${h}`,
    near: (h) => `https://nearblocks.io/txns/${h}`,
  };
  /* The API returns either bare hashes or objects, depending on the chain. */
  const hashOf = (x) => (typeof x === "string" ? x : (x && (x.hash || x.txHash || x.transactionHash)) || "");

  function receipt(body) {
    const d = (body && body.swapDetails) || {};
    const o = S.order || {};
    const dst = hashOf((d.destinationChainTxHashes || [])[0]);
    const src = hashOf((d.originChainTxHashes || [])[0]);
    const link = (chain, h, label) => {
      const f = EXPLORER_TX[chain];
      return f && h
        ? `<a href="${f(h)}" target="_blank" rel="noopener">${label} <span aria-hidden="true">↗</span></a>`
        : "";
    };
    const got = d.amountOutFormatted || o.getAmt;
    const parts = [
      `<strong>${esc(String(got))} ${esc(o.getSym || "")} arrived on Solana.</strong>`,
      link("sol", dst, "View it on Solscan"),
      link(o.chain, src, `Your ${esc(o.chainName || "")} transaction`),
      '<a href="ecosystem-new.html">See what you can do with it →</a>',
    ].filter(Boolean);
    return parts.join(" &middot; ");
  }

  function paint(status, body) {
    const st = STATUS[status] || STATUS.PENDING_DEPOSIT;
    const o = S.order || {};
    $("nb-status").innerHTML =
      `${esc(st.t)}${st.hint ? `<span class="status-hint">${esc(st.hint)}</span>` : ""}`;
    const b = $("nb-beacon");
    b.className = "beacon " + (st.bad ? "bad" : st.done ? "done" : "live");

    [...$("nb-track").children].forEach((li, i) => {
      li.classList.toggle("past", i < st.i);
      li.classList.toggle("on", i === st.i && !st.done);
      if (i === st.i && st.done) li.classList.add("past");
    });

    /* The deposit landing on chain is the only event that proves money
       actually moved — everything before it is intent. Fired once. */
    if (st.i >= 1) {
      trackOnce("bridge_deposit_seen", {
        chain: o.chain, symbol: o.sendSym, dst: o.getSym,
        usd: o.usd, bucket: usdBucket(o.usd),
      });
    }

    if (st.done) {
      clearInterval(S.pollTimer);
      try { localStorage.removeItem(SAVE_ORDER); } catch (e) { /* private mode */ }
      track(status === "SUCCESS" ? "bridge_success" : "bridge_failed", {
        status, chain: o.chain, symbol: o.sendSym, dst: o.getSym,
        usd: o.usd, out_usd: o.outUsd, bucket: usdBucket(o.usd),
      });
      $("nb-foot").className = "note" + (status === "SUCCESS" ? " ok" : "");
      $("nb-foot").innerHTML = status === "SUCCESS"
        ? receipt(body)
        : status === "REFUNDED"
          ? `Your funds went back to ${esc(o.chainName || "the sending chain")}. Nothing was lost.`
          : "";
    }
  }

  /* -------------------------------------------------------------- resuming */

  function offerResume() {
    let o;
    try { o = JSON.parse(localStorage.getItem(SAVE_ORDER) || "null"); } catch (e) { return; }
    if (!o || !o.addr) return;
    /* A deposit address stays live indefinitely once issued, but an order
       nobody funded within a day is far more likely abandoned than pending,
       and offering to resume it forever is its own kind of trap. */
    if (Date.now() - (o.at || 0) > 24 * 60 * 60 * 1000) {
      try { localStorage.removeItem(SAVE_ORDER); } catch (e) { /* private mode */ }
      return;
    }
    const banner = $("bridge-resume");
    banner.innerHTML =
      `<p><strong>You have a transfer in progress</strong>${
        esc(o.sendAmt)} ${esc(o.sendSym)} from ${esc(o.chainName)} → ${esc(o.getSym)} on Solana.</p>
       <button class="button button--ghost button--sm" type="button" id="resume-go">Pick it up</button>
       <button class="textbtn" type="button" id="resume-drop">Discard</button>`;
    banner.hidden = false;
    $("resume-go").addEventListener("click", () => {
      banner.hidden = true;
      S.order = o;
      setGroup(EVM.has(o.chain) ? "evm" : "more");
      showOrder(o);
    });
    $("resume-drop").addEventListener("click", () => {
      banner.hidden = true;
      try { localStorage.removeItem(SAVE_ORDER); } catch (e) { /* private mode */ }
    });
  }

  function restart() {
    clearInterval(S.pollTimer);
    S.order = null;
    try { localStorage.removeItem(SAVE_ORDER); } catch (e) { /* private mode */ }
    $("nb-deposit").hidden = true;
    $("nb-progress").hidden = true;
    $("nb-form").hidden = false;
    $("nb-go").disabled = false;
    $("nb-go-label").textContent = "Get deposit address";
    $("nb-go-icon").textContent = "→";
    schedulePreview();
  }

  /* ------------------------------------------------------- copy to clipboard */

  async function copy(text, btn) {
    try {
      await navigator.clipboard.writeText(text);
    } catch (e) {
      /* Non-secure contexts and older Safari have no clipboard API. */
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.cssText = "position:absolute;left:-9999px";
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand("copy"); } catch (e2) { /* give up quietly */ }
      ta.remove();
    }
    const span = btn.querySelector("span");
    const was = span.textContent;
    span.textContent = "Copied";
    setTimeout(() => { span.textContent = was; }, 1400);
  }

  /* --------------------------------------------------------- cosmos engine */

  /* Loaded on demand. The Skip client and its polyfills are far larger than
     the rest of this page put together, and two thirds of users never open
     this tab. */
  async function ensureCosmos() {
    /* Already mounted: hand over the destination again rather than returning
       flat. The tab is commonly opened once before an address exists and
       again after, and only re-pushing here makes the second visit useful. */
    if (S.cosmos === "ready") {
      if (S.cosmosMod) S.cosmosMod.setSolanaAddress($("nb-rcpt").value.trim());
      return;
    }
    if (S.cosmos === "loading") return;
    const host = $("bridge-panel-cosmos");
    S.cosmos = "loading";
    host.innerHTML =
      '<div class="engine-loading"><span class="spin"></span><span>Loading the Cosmos route…</span></div>';
    try {
      /* Resolved against the document, not this module: a bare relative
         specifier would look for the bundle under assets/. */
      const mod = await import(new URL(COSMOS_ENGINE, document.baseURI).href);
      host.innerHTML = "";
      S.cosmosMod = await mod.mount(host, {
        solanaAddress: $("nb-rcpt").value.trim(),
        onSolanaAddress: (a) => {
          /* One destination across both engines — whichever tab the user
             typed it into. */
          if (a && okAddr("sol", a)) {
            $("nb-rcpt").value = a;
            saveDest();
            checkDest();
          }
        },
      });
      S.cosmos = "ready";
      track("bridge_engine_loaded", { engine: "cosmos" });
    } catch (e) {
      S.cosmos = null;
      host.innerHTML =
        '<p class="engine-error">The Cosmos route could not load. ' +
        'Please reload the page, or <a href="https://t.me/+3prPanTSreIwMzMy" target="_blank" rel="noopener">tell us</a> if it keeps happening.</p>';
    }
  }

  /* ----------------------------------------------------------------- wiring */

  function wire() {
    $("bridge-tabs").addEventListener("click", (e) => {
      const t = e.target.closest("[data-group]");
      if (t) { S.engaged = true; setGroup(t.dataset.group); }
    });
    /* Arrow keys across a tablist are expected behaviour, not a nicety —
       without them the tabs are unreachable by keyboard beyond the first. */
    $("bridge-tabs").addEventListener("keydown", (e) => {
      if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
      const keys = Object.keys(GROUPS);
      const i = keys.indexOf(S.group);
      const next = keys[(i + (e.key === "ArrowRight" ? 1 : keys.length - 1)) % keys.length];
      setGroup(next);
      $(`bridge-tab-${next}`).focus();
      e.preventDefault();
    });

    $("nb-src").addEventListener("click", () => openPicker("src"));
    $("nb-dst").addEventListener("click", () => openPicker("dst"));
    $("picker-close").addEventListener("click", () => $("bridge-picker").close());
    $("picker-q").addEventListener("input", (e) => renderPickerList(e.target.value));
    $("picker-list").addEventListener("click", (e) => {
      const b = e.target.closest("[data-asset]");
      if (b) choose(b.dataset.asset);
    });
    /* Clicking the backdrop closes it — a <dialog> otherwise traps a user
       who opened the picker by accident on a phone. */
    $("bridge-picker").addEventListener("click", (e) => {
      if (e.target === $("bridge-picker")) $("bridge-picker").close();
    });

    $("nb-amt").addEventListener("input", () => {
      S.amountTouched = true;
      S.engaged = true;
      setOut(null);
      schedulePreview();
    });
    $("nb-rcpt").addEventListener("input", () => {
      S.engaged = true; saveDest(); checkDest(); schedulePreview();
    });
    $("nb-refund").addEventListener("input", () => { checkRefund(); schedulePreview(); });
    $("nb-fill").addEventListener("click", fillFromWallet);
    $("nb-go").addEventListener("click", submit);
    $("nb-restart").addEventListener("click", restart);
    $("nb-copy-addr").addEventListener("click", (e) =>
      copy(S.order.addr, e.currentTarget));
    $("nb-copy-amt").addEventListener("click", (e) =>
      copy(String(S.order.sendAmt), e.currentTarget));
  }

  /* ------------------------------------------------------------ token icons */

  /* Fetched after first paint and never awaited before it. Icons are
     decoration, so a slow registry must delay a quote by exactly nothing.
     One batched request covers every Solana asset we can deliver. */
  const JUP_TOKENS = "https://lite-api.jup.ag/tokens/v2/search?query=";

  async function loadIcons() {
    const mints = (S.byChain.sol || []).map((t) => t.contractAddress).filter(Boolean);
    if (!mints.length) return;
    try {
      const res = await fetch(JUP_TOKENS + encodeURIComponent(mints.join(",")));
      if (!res.ok) return;
      const body = await res.json();
      const list = Array.isArray(body) ? body : (body.tokens || []);
      let found = 0;
      for (const t of list) {
        const url = t.icon || t.logoURI;
        if (t.id && url) { S.icons[t.id] = url; found++; }
      }
      if (!found) return;
      /* Repaint whatever is still showing a placeholder. */
      renderSwap();
      const dlg = $("bridge-picker");
      if (dlg && dlg.open) renderPickerList($("picker-q").value);
    } catch (e) { /* decoration only */ }
  }

  /* -------------------------------------------------------------------- boot */

  async function boot() {
    wire();
    try {
      S.tokens = await (await fetch(`${API}/tokens`)).json();
    } catch (e) {
      $("bridge-panel-near").innerHTML =
        '<p class="engine-error">Could not reach the quote service. Please reload the page.</p>';
      return;
    }
    S.byChain = {};
    for (const t of S.tokens) (S.byChain[t.blockchain] ||= []).push(t);

    S.dst = destTokens()[0] || null;
    loadIcons();                    // deliberately not awaited
    applyDefault("evm");
    syncAmount();
    renderTabs();
    renderSwap();
    loadDest();
    offerResume();
    schedulePreview();

    /* The funnel denominator. A homepage pageview is not the same as having
       reached the bridge, and without this every later rate is measured
       against the wrong number. */
    if ("IntersectionObserver" in window) {
      const io = new IntersectionObserver((entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          trackOnce("bridge_view", {});
          io.disconnect();
        }
      }, { threshold: 0.25 });
      io.observe(root);
    } else {
      trackOnce("bridge_view", {});
    }
  }

  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
