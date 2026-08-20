/* Cosmos → Solana bridge.
   Keplr signs on the Cosmos side; everything past that is unattended.
   Route: source chain → swap to USDC on Osmosis → Noble → Circle CCTP → Solana.

   Config lives at the top on purpose — fee recipient, chain list and the
   dust floor are the things that get tuned, and they should not need a
   reading of the whole file to find. */

import {
  setApiOptions,
  setClientOptions,
  route,
  executeRoute,
  balances,
  getRouteWithGasOnReceive,
} from "@skip-go/client";

/* ------------------------------------------------------------------ config */

const SKIP_API_KEY = "";           // keyless until the key lands; see notes

/* Service fee. 0.5% gross — Skip keeps 20% of it with an API key, 25% without,
   so we net roughly 0.4%. The route itself already costs ~1.2% in fixed relay
   fees, and the user reads the all-in number, which is why this is 50bps and
   not 100.

   Addresses must be ours and valid on the chain the swap runs on. Swaps happen
   on Osmosis, so that is the entry that matters; leave it empty and no fee is
   charged anywhere. */
const AFFILIATE = {
  "osmosis-1": "osmo18cz2h9dtuekk6kupzc40mngth0chy8qc29ymug",
};
const AFFILIATE_BPS = 50;
/* Below this, charge nothing. Small transfers already sit near Skip's
   "value difference too large" rejection, and a failed transfer earns us
   nothing while costing us the user. Judged on the whole transfer rather
   than asset by asset: someone moving $60 across four wallets-worth of dust
   is not a small user, and charging them per asset would say otherwise. */
const FEE_FREE_BELOW_USD = 20;
/* Not a gate — only the point below which a failed solo route is probably the
   fixed exit fee's doing, and suggesting a batch is worth doing.

   It used to block routes outright, on the theory that Skip refuses anything
   this small. Skip does refuse *some* small routes ($1.67 of USDC quoted out
   at $1.50 and was rejected), but it happily runs $3 and $5 exits, and the
   block was turning away transfers that would have worked. Skip is the only
   authority on what Skip will accept, so now we ask it and explain the answer. */
const DUST_USD = 5;

/* ------------------------------------------------------------------- sweep
   Leaving Cosmos costs a flat 0.17 USDC in CCTP relay, charged once per exit
   and regardless of size. Sending five assets straight to Solana pays it five
   times; sweeping them into USDC on Noble first and making one exit pays it
   once. Measured: a $1.15 TIA balance was *refused* as a direct route to
   Solana and came back as $1.16 when sent to Noble instead — intra-Cosmos
   hops carry no such fee, which is the whole reason the sweep works.

   The trade is one extra signature for the exit, so it only pays from two
   assets up; a single asset still goes direct on the proven path. */
const SWEEP_MIN_ASSETS = 2;
/* Swept assets clear a far lower bar than a solo exit, since the fixed fee is
   no longer theirs alone to carry. Below this, a balance costs more in Keplr
   signatures and attention than it returns. */
const SWEEP_DUST_USD = 0.5;
/* Noble charges its fees in USDC, which is the very asset we are sweeping.
   Hold back enough for the one exit transaction — Noble's fees are far below
   a cent, so this is generous on purpose. */
const NOBLE_FEE_RESERVE_USDC = 0.05;
/* Under this the exit costs more than it delivers, sweep or no sweep. */
const EXIT_MIN_USD = 2;
const NOBLE_CHAIN = "noble-1";
const NOBLE_USDC = "uusdc";
/* Every Cosmos hop is paid in that chain's own fee token, so sending a full
   native balance leaves nothing to pay with and Keplr refuses to sign.

   Hold back a number of *transactions*, not a number of dollars. A flat USD
   reserve looks chain-agnostic and is anything but: $0.15 is eight
   transactions on the Hub and two hundred thousand on Neutron, so the same
   rule that barely protects one chain strands 37% of a small balance on
   another. Skip publishes each chain's gas price, which turns the reserve
   into the question actually being asked — how many attempts should this
   cover? Three: enough to retry a failure, not enough to matter. */
const GAS_TX_BUDGET = 400_000;    // generous gas for one transfer or swap
const GAS_RESERVE_TXS = 3;
/* Only for chains whose gas price we could not read. */
const GAS_RESERVE_USD = 0.05;
const FEE_DENOM = {
  "cosmoshub-4": "uatom", "osmosis-1": "uosmo", "noble-1": "uusdc",
  celestia: "utia", "injective-1": "inj", "neutron-1": "untrn",
  "dydx-mainnet-1": "adydx", "akashnet-2": "uakt", "juno-1": "ujuno",
  "stargaze-1": "ustars", "kaiyo-1": "ukuji", "phoenix-1": "uluna",
  "secret-4": "uscrt", "stride-1": "ustrd", "ssc-1": "usaga",
  "archway-1": "aarch", "pryzm-1": "upryzm", "sentinelhub-2": "udvpn",
};
/* The stock Solana endpoint rate-limits browser origins hard. publicnode
   answers CORS preflight and is fine for a token-account lookup. */
/* Raced, not chained. A single public endpoint made the "checking the
   account" spinner sit for many seconds and then fail outright — and this is
   an advisory lookup that must never be the slowest thing on the page. First
   answer wins; if every one of them is slow or down we simply say nothing. */
const SOLANA_RPCS = [
  "https://solana-rpc.publicnode.com",
  "https://api.mainnet-beta.solana.com",
];
const SOLANA_RPC_TIMEOUT_MS = 4000;
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const SOL_MINT = "So11111111111111111111111111111111111111112";
const DFLOW = "https://dev-quote-api.dflow.net";
const SAVE = "cosmos.bridge.v1";

/* Chains Keplr is asked to enable.

   CORE is asked for as one batch, which Keplr shows as a single prompt.
   EXTRA is asked for separately and allowed to fail: `enable()` rejects the
   whole array if even one id is unknown to that Keplr build, so a chain we
   are less sure about must never sit in the batch that matters. */
const CORE = {
  "cosmoshub-4": "Cosmos Hub",
  "osmosis-1": "Osmosis",
  "noble-1": "Noble",
  celestia: "Celestia",
  "injective-1": "Injective",
  "neutron-1": "Neutron",
  "dydx-mainnet-1": "dYdX",
  "akashnet-2": "Akash",
  "juno-1": "Juno",
};
const EXTRA = {
  /* Sentinel is migrating to Solana, so this corridor is the one its holders
     will need. Verified 16 Aug: DVPN routes sentinelhub-2 → osmosis-1 →
     noble-1 → solana in a single transaction. */
  "sentinelhub-2": "Sentinel",
  "stargaze-1": "Stargaze",   // "no modular chain info" in current Keplr builds
  "kaiyo-1": "Kujira",
  "phoenix-1": "Terra",
  "secret-4": "Secret",
  "stride-1": "Stride",
  "ssc-1": "Saga",
  "pryzm-1": "Pryzm",
  "archway-1": "Archway",
};
const CHAINS = { ...CORE, ...EXTRA };

/* Skip's registry does not ship RPC endpoints, so executeRoute needs us to
   resolve one per chain. Without this the client reads endpointOptions off an
   undefined object and every signature dies with "getRpcEndpointForChain".
   cosmos.directory proxies a healthy public node per chain and answers CORS. */
const DIRECTORY = {
  "cosmoshub-4": "cosmoshub", "osmosis-1": "osmosis", "noble-1": "noble",
  celestia: "celestia", "injective-1": "injective", "neutron-1": "neutron",
  "dydx-mainnet-1": "dydx", "akashnet-2": "akash", "juno-1": "juno",
  "stargaze-1": "stargaze", "kaiyo-1": "kujira", "phoenix-1": "terra2",
  "secret-4": "secretnetwork", "stride-1": "stride", "ssc-1": "saga",
  "pryzm-1": "pryzm", "archway-1": "archway", "sentinelhub-2": "sentinel",
};
const directoryName = (chainId) => DIRECTORY[chainId] || chainId.replace(/-\d+$/, "");

/* A second provider, because one was not enough. rpc.cosmos.directory caps at
   roughly 300 requests a minute per IP, and a run touching several chains can
   trip it partway through — which surfaces as "Bad status on response: 429"
   at the worst possible moment, sometimes after the user has already approved.
   A single host for every signature was a single point of failure.

   Polkachu answers with `Access-Control-Allow-Origin: *` and covers 14 of our
   18 chains; cosmos.directory covers the remaining four (Stargaze, Kujira,
   Secret, Pryzm) and stands in whenever Polkachu is unhealthy. */
const POLKACHU = {
  "cosmoshub-4": "cosmos", "osmosis-1": "osmosis", "noble-1": "noble",
  celestia: "celestia", "injective-1": "injective", "neutron-1": "neutron",
  "dydx-mainnet-1": "dydx", "akashnet-2": "akash", "juno-1": "juno",
  "phoenix-1": "terra", "stride-1": "stride", "ssc-1": "saga",
  "archway-1": "archway", "sentinelhub-2": "sentinel",
};

const endpointCache = new Map();   // "kind|chainId" -> base url known to answer

function endpointCandidates(kind, chainId) {
  const list = [];
  const p = POLKACHU[chainId];
  if (p) list.push(kind === "rpc" ? `https://${p}-rpc.polkachu.com` : `https://${p}-api.polkachu.com`);
  list.push(kind === "rpc"
    ? `https://rpc.cosmos.directory/${directoryName(chainId)}`
    : `https://rest.cosmos.directory/${directoryName(chainId)}`);
  return list;
}

/* Probed once per chain and remembered. Only successes are cached — a host
   that was down or throttled at connect time deserves another chance later,
   and pinning the fallback for the whole session would outlast the outage. */
async function resolveEndpoint(kind, chainId) {
  const key = `${kind}|${chainId}`;
  const known = endpointCache.get(key);
  if (known) return known;

  const path = kind === "rpc" ? "/status" : "/cosmos/base/tendermint/v1beta1/node_info";
  for (const base of endpointCandidates(kind, chainId)) {
    try {
      const stop = new AbortController();
      const timer = setTimeout(() => stop.abort(), 4000);
      const res = await fetch(base + path, { signal: stop.signal });
      clearTimeout(timer);
      if (!res.ok) continue;
      endpointCache.set(key, base);
      return base;
    } catch { /* unreachable or too slow — try the next provider */ }
  }
  /* None answered. Return the first anyway so Skip reports the real failure
     rather than us inventing one, but do not remember this. */
  return endpointCandidates(kind, chainId)[0];
}

/* Affiliates are read from global API state at execute time rather than passed
   per call, so the map has to be set to match the route about to run. The
   update flag is required or Skip freezes options after the first API call. */
const apiBase = {
  ...(SKIP_API_KEY ? { apiKey: SKIP_API_KEY } : {}),
  allowOptionsUpdateAfterApiCall: true,
};
const feeEnabled = () => Object.values(AFFILIATE).some(Boolean);
const feeBpsFor = (usd) => (!feeEnabled() || usd < FEE_FREE_BELOW_USD ? 0 : AFFILIATE_BPS);

function applyAffiliates(bps) {
  const map = {};
  if (bps) {
    for (const [chainId, address] of Object.entries(AFFILIATE)) {
      if (address) map[chainId] = { affiliates: [{ address, basisPointsFee: String(bps) }] };
    }
  }
  setApiOptions({ ...apiBase, chainIdsToAffiliates: map });
}

setApiOptions(apiBase);
setClientOptions({
  ...(SKIP_API_KEY ? { apiKey: SKIP_API_KEY } : {}),
  endpointOptions: {
    getRpcEndpointForChain: (chainId) => resolveEndpoint("rpc", chainId),
    getRestEndpointForChain: (chainId) => resolveEndpoint("rest", chainId),
  },
});

/* ------------------------------------------------------------------- state */

const S = {
  addresses: {},   // chainId -> bech32
  assets: [],      // { id, chainId, chainName, denom, symbol, amount, decimals, usd, blocked }
  picked: new Set(),
  /* Partial amounts, opt-in. Keyed by asset id rather than stored on the asset
     so a balance reload does not silently discard what the user typed — the
     amount is clamped against the fresh balance instead. */
  amounts: new Map(),   // id -> base-unit string
  editing: new Set(),   // id — rows with the amount editor open
  dest: null,      // { chainId, denom, decimals } for Solana USDC
  solana: "",
  plan: null,      // { mode, legs, exit, feeBps, dest } — see quoteAll
  queue: [],       // { id, status, signatures, txHash, error }
  running: false,
};

/* What we will actually send for an asset: the whole spendable balance unless
   the user chose otherwise, always clamped to what is really there. */
function sendBase(a) {
  const set = S.amounts.get(a.id);
  const max = Number(a.sendable || 0);
  if (set === undefined) return a.sendable;
  return String(Math.max(0, Math.min(Number(set), max)));
}
/* a.usd covers the entire balance including the gas reserve, so the value of
   what is being sent has to be scaled down from it rather than read off it. */
function sendUsd(a) {
  const total = Number(a.amount || 0);
  if (!total) return 0;
  return a.usd * (Number(sendBase(a)) / total);
}
const isPartial = (a) => Number(sendBase(a)) < Number(a.sendable || 0);

const $ = (id) => document.getElementById(id);

/* Analytics. The shell owns the page-level funnel; this engine reports only
   the three moments unique to it — connecting a wallet, committing to a run,
   and what actually arrived. Never throws: a blocked analytics script must
   not take the bridge down with it. */
const track = (n, d) => { try { window._track && window._track(n, d || {}); } catch (e) { /* noop */ } };
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
const show = (id, on = true) => { $(id).hidden = !on; };
const money = (n) => "$" + Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qty = (n, max = 6) => Number(n).toLocaleString("en-US", { maximumFractionDigits: max });

function log(msg) {
  console.log("[bridge]", msg);
  const el = document.createElement("div");
  el.textContent = msg;
  $("log").prepend(el);
}

/* Keplr signals a user decline through the message text, not a code. Anything
   else — an unknown chain id, a locked wallet — must not be reported as one. */
function isUserRejection(e) {
  const m = String(e?.message || e || "").toLowerCase();
  return m.includes("rejected") || m.includes("request rejected") || m.includes("declined");
}

/* Raw client errors are accurate and useless. "Bad status on response: 429"
   tells someone watching their money that something broke, but not the one
   thing they need to know — whether it left. */
function explain(e) {
  const m = String(e?.message || e || "");
  if (/\b429\b|too many requests|rate.?limit/i.test(m)) {
    return "the network node was busy and turned us away — nothing was sent, try again in a moment";
  }
  if (/rejected|declined/i.test(m)) return "you declined the request in Keplr";
  if (/insufficient|not enough/i.test(m)) return "not enough left on that chain to cover the network fee";
  if (/timeout|timed out/i.test(m)) return "the network stopped responding — nothing was sent";
  return m;
}

function fail(where, e) {
  console.error(where, e);
  const msg = e?.message || String(e);
  log(`✗ ${where}: ${msg}`);
  return msg;
}

/* -------------------------------------------------------------------- keplr
   getKey per chain, tolerating chains this Keplr build doesn't carry. */

async function connect() {
  if (!window.keplr) {
    $("connect-note").className = "note bad";
    $("connect-note").innerHTML = 'Keplr not found. <a class="link" href="https://keplr.app/download" target="_blank" rel="noopener">Install it</a>, then reload.';
    return;
  }

  const btn = $("connect");
  btn.disabled = true;
  btn.textContent = "Waiting for Keplr…";

  /* One prompt for the core set. If Keplr rejects the batch because it does
     not carry one of them, fall back to asking chain by chain so a single
     unknown id cannot block the whole connection. */
  let enabled = [];
  try {
    await window.keplr.enable(Object.keys(CORE));
    enabled = Object.keys(CORE);
  } catch (e) {
    if (isUserRejection(e)) {
      btn.disabled = false;
      btn.textContent = "Connect Keplr";
      $("connect-note").className = "note bad";
      $("connect-note").textContent = "You declined the request in Keplr.";
      return;
    }
    log(`batch enable failed (${e?.message || e}) — falling back to one at a time`);
    const settled = await Promise.allSettled(
      Object.keys(CORE).map((id) => window.keplr.enable(id).then(() => id)),
    );
    enabled = settled.filter((r) => r.status === "fulfilled").map((r) => r.value);

    if (!enabled.length) {
      btn.disabled = false;
      btn.textContent = "Connect Keplr";
      $("connect-note").className = "note bad";
      $("connect-note").textContent = settled.some((r) => isUserRejection(r.reason))
        ? "You declined the request in Keplr."
        : `Keplr could not open any of these chains: ${settled[0]?.reason?.message || "unknown error"}`;
      return;
    }
  }

  /* Nice-to-have chains, never allowed to break the connection. */
  const extras = await Promise.allSettled(
    Object.keys(EXTRA).map((id) => window.keplr.enable(id).then(() => id)),
  );
  enabled = enabled.concat(extras.filter((r) => r.status === "fulfilled").map((r) => r.value));

  S.addresses = {};
  await Promise.all(enabled.map(async (id) => {
    try {
      const key = await window.keplr.getKey(id);
      if (key?.bech32Address) S.addresses[id] = key.bech32Address;
    } catch { /* chain not in this Keplr build — skip quietly */ }
  }));

  if (!Object.keys(S.addresses).length) {
    btn.disabled = false;
    btn.textContent = "Connect Keplr";
    $("connect-note").className = "note bad";
    $("connect-note").textContent = "Connected, but Keplr returned no accounts. Is the wallet unlocked?";
    return;
  }

  const n = Object.keys(S.addresses).length;
  btn.textContent = `Connected · ${n} chains`;
  $("connect-note").className = "note ok";
  $("connect-note").textContent = "";
  $("c-connect").classList.add("settled");
  track("bridge_cosmos_connect", { chains: n });

  /* Probe endpoints now, in parallel and unawaited, so the first signature is
     not held up by a health check that could have run while the user was still
     reading their balances. */
  Promise.all(Object.keys(S.addresses).flatMap((id) => [
    resolveEndpoint("rpc", id), resolveEndpoint("rest", id),
  ])).catch(() => { /* resolveEndpoint already falls back on its own */ });

  show("c-assets");
  await loadAssets();
}

/* ---------------------------------------------------------------- portfolio
   Skip's balances endpoint returns amount, decimals, price and valueUsd in
   one call across every chain, which is the only reason the portfolio screen
   can show a real total rather than a list of raw denoms. */

async function loadAssets() {
  $("total").innerHTML = '<span class="spinner"></span>';
  $("total-sub").textContent = "reading balances";

  const chains = {};
  for (const [chainId, address] of Object.entries(S.addresses)) chains[chainId] = { address };

  let res;
  try {
    /* Names and balances in parallel — the registry is what turns an
       "ibc/208B2F…" hash into something the user recognises. */
    const [b] = await Promise.all([
      balances({ chains }),
      loadAssetNames(Object.keys(S.addresses)),
      loadGasPrices(Object.keys(S.addresses)),
    ]);
    res = b;
  } catch (e) {
    $("total").textContent = "—";
    $("total-sub").textContent = fail("balances", e);
    return;
  }

  S.assets = [];
  for (const [chainId, entry] of Object.entries(res.chains || {})) {
    for (const [denom, d] of Object.entries(entry?.denoms || {})) {
      const usd = Number(d.valueUsd || 0);
      const amount = d.amount;
      if (!amount || Number(amount) === 0) continue;
      S.assets.push({
        id: `${chainId}|${denom}`,
        chainId,
        chainName: CHAINS[chainId] || chainId,
        denom,
        decimals: d.decimals ?? 6,
        amount,
        sendable: amount,
        reserved: "0",
        price: Number(d.price || 0),
        formatted: d.formattedAmount || amount,
        symbol: symbolFor(denom, chainId),
        usd,
        /* Only true dust is blocked outright. Anything between the sweep floor
           and the solo floor is perfectly movable — but only alongside
           something else, which quoting decides once the selection is known. */
        blocked: usd > 0 && usd < SWEEP_DUST_USD ? "too small to be worth the fees" : null,
      });
    }
  }

  applyGasReserve();
  S.assets.sort((a, b) => b.usd - a.usd);
  /* Nothing is selected for the user — moving someone's money is their choice
     to start, not ours to pre-make. A balance reload (after a gas top-up, say)
     keeps whatever they had already ticked and is still selectable. */
  S.picked = new Set([...S.picked].filter((id) => S.assets.some((a) => a.id === id && !a.blocked)));
  renderAssets();
}

/* Two ways a Cosmos transfer dies for want of gas, and both are preventable
   before the user ever sees a Keplr popup:

     1. Sending the whole fee token, leaving nothing to pay the fee with.
        Hold back GAS_RESERVE_USD worth and send the remainder.
     2. Sending an IBC asset from a chain where the fee token balance is
        empty. Nothing to hold back — the asset simply cannot move, and
        saying so here beats failing at the signature. */
function applyGasReserve() {
  const feeHeld = {};                       // chainId -> fee-denom asset
  for (const a of S.assets) {
    if (a.denom === FEE_DENOM[a.chainId]) feeHeld[a.chainId] = a;
  }

  for (const a of S.assets) {
    const feeDenom = FEE_DENOM[a.chainId];
    if (!feeDenom) continue;                // unknown chain, leave it alone
    const fee = feeHeld[a.chainId];

    /* Reserve in base units, from the chain's own gas price where we have it —
       that is the only figure that knows what a transaction there costs. */
    const reserveOf = (asset) => {
      if (!asset) return 0;
      const gas = gasPrices.get(asset.chainId);
      if (gas && gas.denom === asset.denom) {
        return Math.ceil(gas.price * GAS_TX_BUDGET * GAS_RESERVE_TXS);
      }
      if (asset.price > 0) {
        return Math.ceil((GAS_RESERVE_USD / asset.price) * 10 ** asset.decimals);
      }
      return Math.ceil(Number(asset.amount) * 0.01);   // no price: keep 1%
    };

    if (a.denom === feeDenom) {
      const reserve = reserveOf(a);
      const left = Number(a.amount) - reserve;
      if (left <= 0) {
        a.blocked = a.blocked || "all of it is needed for fees";
        a.sendable = "0";
      } else {
        a.sendable = String(Math.floor(left));
        a.reserved = String(reserve);
      }
    } else if (!fee || Number(fee.amount) < reserveOf(fee)) {
      const sym = NATIVE[feeDenom] || feeDenom.replace(/^[ua]/, "").toUpperCase();
      a.blocked = a.blocked || `needs a little ${sym} on ${a.chainName} for fees`;
      /* Flagged rather than merely blocked: this is the one obstacle we can
         clear for the user, and gasTopUps() below turns it into an offer. */
      a.needsGas = true;
    }
  }
}

/* Fallback only. An `ibc/…` hash is meaningless to a human, and showing one
   asks the user to approve moving something they cannot identify — so the real
   names come from Skip's asset registry below, and this covers the gap while
   that loads or if it fails. */
const NATIVE = {
  uatom: "ATOM", uosmo: "OSMO", uusdc: "USDC", utia: "TIA", inj: "INJ",
  untrn: "NTRN", adydx: "DYDX", ustars: "STARS", uakt: "AKT", ujuno: "JUNO",
  ukuji: "KUJI", uluna: "LUNA", uscrt: "SCRT", ustrd: "STRD", usaga: "SAGA",
  udvpn: "DVPN",
};

const assetNames = new Map();   // "chainId|denom" -> { symbol, name }
const gasPrices = new Map();    // chainId -> { denom, price } in base units per gas unit

/* Same one-chain-per-request rule as the assets endpoint — a comma-separated
   list comes back empty rather than erroring. Skip's first fee asset for a
   chain is its native one, which is the only one we reserve against. */
async function loadGasPrices(chainIds) {
  await Promise.allSettled(chainIds.map(async (chainId) => {
    const r = await fetch(`https://api.skip.build/v2/info/chains?chain_ids=${chainId}`);
    if (!r.ok) throw new Error(`chains ${r.status}`);
    const { chains } = await r.json();
    const asset = chains?.[0]?.fee_assets?.[0];
    const price = Number(asset?.gas_price?.average || asset?.gas_price?.low || 0);
    if (asset?.denom && price > 0) gasPrices.set(chainId, { denom: asset.denom, price });
  }));
}

/* One chain per request, deliberately. Skip's assets endpoint answers a
   comma-separated `chain_ids` list with an empty map rather than an error, so
   asking for all thirteen at once silently returned nothing and every balance
   rendered as a raw `ibc/…` hash. Asked one at a time it returns the full
   registry, and one chain failing costs only that chain its names. */
async function loadAssetNames(chainIds) {
  const results = await Promise.allSettled(chainIds.map(async (chainId) => {
    const r = await fetch(`https://api.skip.build/v2/fungible/assets?chain_ids=${chainId}`);
    if (!r.ok) throw new Error(`assets ${r.status}`);
    const { chain_to_assets_map: map } = await r.json();
    for (const a of map?.[chainId]?.assets || []) {
      assetNames.set(`${chainId}|${a.denom}`, {
        symbol: a.recommended_symbol || a.symbol || null,
        name: a.name || null,
      });
    }
  }));

  const missed = results.filter((r) => r.status === "rejected").length;
  if (missed) log(`names unavailable for ${missed} chain${missed === 1 ? "" : "s"} — those show raw denoms`);
}

function symbolFor(denom, chainId) {
  const known = assetNames.get(`${chainId}|${denom}`);
  if (known?.symbol) return known.symbol;
  if (NATIVE[denom]) return NATIVE[denom];
  if (denom.startsWith("ibc/")) return `IBC ${denom.slice(4, 10)}`;
  if (denom.startsWith("factory/")) return denom.split("/").pop().toUpperCase();
  return denom.length > 12 ? denom.slice(0, 12) + "…" : denom.toUpperCase();
}

/* ------------------------------------------------------------- gas top-ups
   Skip builds the transaction, so gas can only be paid in a denom *Skip* lists
   as a fee asset for that chain — what the chain itself would accept does not
   enter into it. Neutron is the case that bites: its feemarket takes USDC
   perfectly well, Skip's registry does not list it, and a wallet holding only
   USDC there owns assets it cannot move.

   The way out is cheap enough to be embarrassing. Two cents of anything
   spendable, routed into the chain's native fee token, is one transaction and
   frees the entire balance — $0.02 of Osmosis USDC buys 92 NTRN, and a
   transfer on Neutron costs 0.00212 of one. That is roughly 87,000 transfers.

   Sized against Skip's route minimum rather than against need, since need is
   the smaller number by orders of magnitude: routes were verified down to
   $0.003, so this sits about six times clear of the floor while staying too
   small for anyone to mind. */
const GAS_TOPUP_USD = 0.02;

function gasTopUps() {
  const stuck = {};
  for (const a of S.assets) {
    if (!a.needsGas) continue;
    (stuck[a.chainId] ||= { chainId: a.chainId, chainName: a.chainName, usd: 0, count: 0 });
    stuck[a.chainId].usd += a.usd;
    stuck[a.chainId].count += 1;
  }

  /* Paying for the top-up needs an asset that can actually move, which by
     definition is one on a chain whose gas is already covered. Largest first:
     it is the least likely to be left short by the deduction. Tied to a real
     dollar rather than a multiple of the top-up, because the top-up is now
     small enough that multiples of it are meaningless. */
  const source = S.assets
    .filter((a) => !a.blocked && a.usd >= 1)
    .sort((x, y) => y.usd - x.usd)[0];

  return Object.values(stuck)
    .filter((s) => s.usd >= 1)     // below this, a signature costs more attention than it frees
    .map((s) => ({ ...s, source, feeDenom: FEE_DENOM[s.chainId] }))
    .filter((s) => s.source && s.feeDenom && s.source.chainId !== s.chainId);
}

function renderTopUps() {
  const box = $("topup");
  box.innerHTML = "";
  for (const t of gasTopUps()) {
    const sym = NATIVE[t.feeDenom] || t.feeDenom.replace(/^[ua]/, "").toUpperCase();
    const el = document.createElement("div");
    el.className = "callout";
    el.innerHTML = `
      <p>${money(t.usd)} across ${t.count} asset${t.count === 1 ? "" : "s"} on ${t.chainName} cannot move because there is no ${sym} there to pay the network fee.
      Sending ${money(GAS_TOPUP_USD)} of your ${t.source.symbol} on ${t.source.chainName} covers it — one signature, and far more gas than these transfers will ever use.</p>
      <button class="button button--ghost button--sm">Send ${money(GAS_TOPUP_USD)} of ${sym} to ${t.chainName}</button>
      <span class="note" style="margin-left:10px"></span>`;

    const btn = el.querySelector("button");
    const note = el.querySelector(".note");
    btn.addEventListener("click", () => runGasTopUp(t, btn, note).catch((e) => {
      btn.disabled = false;
      note.className = "note bad";
      note.textContent = fail("top-up", e);
    }));
    box.appendChild(el);
  }
}

async function runGasTopUp(t, btn, note) {
  btn.disabled = true;
  note.className = "note";
  note.innerHTML = '<span class="spinner"></span> pricing';

  /* Priced in the source asset, so a $0.50 top-up stays $0.50 whatever the
     token is worth. Falls back to a hundredth of the balance if Skip gave us
     no price, which is small enough to be safe and large enough to matter. */
  const amountIn = t.source.price > 0
    ? Math.ceil((GAS_TOPUP_USD / t.source.price) * 10 ** t.source.decimals)
    : Math.ceil(Number(t.source.sendable) * 0.01);

  applyAffiliates(0);            // never take a cut of someone's gas money
  const req = routeReq(t.source, t.chainId, t.feeDenom, String(amountIn), 0);
  const r = await route(req);

  const item = { status: "queued" };
  note.innerHTML = '<span class="spinner"></span> approve in Keplr';
  await runRoute(r, item, (status) => {
    note.innerHTML = status === "signing"
      ? '<span class="spinner"></span> waiting for your signature'
      : `<span class="spinner"></span> ${status}`;
  });

  note.className = "note ok";
  note.textContent = "Sent. Re-reading your balances…";
  await loadAssets();            // re-render with the block cleared
}

function renderAssets() {
  const box = $("assets");
  box.innerHTML = "";
  renderTopUps();

  /* Anything a sweep could carry is worth showing, even below the solo floor —
     hiding it is what made small balances look unmovable. */
  const visible = S.assets.filter((a) => a.usd >= SWEEP_DUST_USD || S.picked.has(a.id));
  const totalUsd = S.assets.reduce((s, a) => s + a.usd, 0);
  const chainCount = new Set(S.assets.map((a) => a.chainId)).size;

  $("total").textContent = money(totalUsd);
  $("total-sub").textContent = `across ${chainCount} chain${chainCount === 1 ? "" : "s"}`;

  if (!visible.length) {
    box.innerHTML = '<p class="step-note">Nothing above ' + money(SWEEP_DUST_USD) + ' on the chains we check. If your funds are elsewhere in Cosmos, tell us which chain and we will add it.</p>';
    updatePicked();
    return;
  }

  for (const a of visible) {
    const group = document.createElement("div");
    group.className = "asset-group";

    const row = document.createElement("label");
    row.className = "asset" + (a.blocked ? " blocked" : "");
    const held = Number(a.reserved) > 0
      ? ` · keeping ${qty(Number(a.reserved) / 10 ** a.decimals, 4)} for fees`
      : "";
    const sending = Number(sendBase(a)) / 10 ** a.decimals;
    row.innerHTML = `
      <input type="checkbox" ${S.picked.has(a.id) ? "checked" : ""} ${a.blocked ? "disabled" : ""}/>
      <span>
        <span class="name">${a.symbol}</span>
        <span class="where">${a.chainName}${a.blocked ? " · " + a.blocked : held}</span>
      </span>
      <span class="val">
        <span class="usd">${a.usd ? money(isPartial(a) ? sendUsd(a) : a.usd) : "—"}</span>
        <span class="amt">${qty(a.blocked ? Number(a.formatted) : sending)}</span>
      </span>`;
    row.querySelector("input").addEventListener("change", (e) => {
      if (e.target.checked) S.picked.add(a.id); else S.picked.delete(a.id);
      /* A full redraw rather than updatePicked alone: selecting is what makes
         the amount control appear, and it lives outside this row. */
      S.editing.delete(a.id);
      renderAssets();
    });
    group.appendChild(row);

    /* Offered only once an asset is actually going somewhere. Sending
       everything stays the default and needs no interaction. */
    if (!a.blocked && S.picked.has(a.id)) group.appendChild(amountLine(a));
    box.appendChild(group);
  }
  updatePicked();
}

/* The partial-amount control. Closed, it is one line of text and a link; open,
   a single field. Deliberately understated — most people want all of it, and
   an always-visible input would ask everyone to make a decision that only a
   few of them have. */
function amountLine(a) {
  const el = document.createElement("div");
  el.className = "amount-line";
  const max = Number(a.sendable) / 10 ** a.decimals;
  const now = Number(sendBase(a)) / 10 ** a.decimals;

  if (!S.editing.has(a.id)) {
    el.innerHTML = isPartial(a)
      ? `<span>Sending <span class="mono">${qty(now)}</span> of <span class="mono">${qty(max)}</span> ${a.symbol}</span>
         <button class="textbtn" data-act="edit">Change</button>
         <button class="textbtn" data-act="all">Send all</button>`
      : `<span>Sending all <span class="mono">${qty(max)}</span> ${a.symbol}</span>
         <button class="textbtn" data-act="edit">Change amount</button>`;
  } else {
    /* Empty, not prefilled. A field carrying the current amount means typing
       "5" produces "5137.033099" — the number you meant, welded to the one
       that was already there. The placeholder carries the same information
       without being in the way. */
    el.innerHTML = `
      <span>Send</span>
      <input type="number" step="any" min="0" max="${max}" placeholder="${qty(now)}" />
      <span>of <span class="mono">${qty(max)}</span> ${a.symbol}</span>
      <button class="textbtn" data-act="all">Max</button>`;

    const input = el.querySelector("input");

    /* Typing is not a decision until you stop. Marks an over-balance entry as
       you type, but commits nothing — that happens on the way out. */
    input.addEventListener("input", () => {
      const v = Number(input.value);
      el.classList.toggle("over", Number.isFinite(v) && v > max + 1e-12);
    });

    const commit = () => {
      const v = Number(input.value);
      /* Blank or nonsense means "all", which is also the default — nothing to
         undo and nothing to explain. Over the balance settles at the balance,
         because there is no longer a Done button on which to correct it, and
         the closed line states plainly what was chosen. */
      if (input.value.trim() === "" || !Number.isFinite(v) || v <= 0 || v >= max) S.amounts.delete(a.id);
      else S.amounts.set(a.id, String(Math.floor(v * 10 ** a.decimals)));
      S.editing.delete(a.id);
      renderAssets();
    };

    /* Clicking away is approval. Staying inside the control is not. */
    input.addEventListener("blur", (e) => { if (!el.contains(e.relatedTarget)) commit(); });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); commit(); }
      if (e.key === "Escape") { e.preventDefault(); S.editing.delete(a.id); renderAssets(); }
    });
    setTimeout(() => input.focus(), 0);
  }

  /* Buttons must not steal focus, or the input's blur fires first, re-renders,
     and the click lands on an element that no longer exists. */
  el.addEventListener("mousedown", (e) => { if (e.target.dataset?.act) e.preventDefault(); });
  el.addEventListener("click", (e) => {
    const act = e.target.dataset?.act;
    if (!act) return;
    if (act === "edit") S.editing.add(a.id);
    if (act === "all") { S.amounts.delete(a.id); S.editing.delete(a.id); }
    renderAssets();
  });
  return el;
}

function updatePicked() {
  const sel = S.assets.filter((a) => S.picked.has(a.id));
  const sum = sel.reduce((s, a) => s + sendUsd(a), 0);
  $("picked-sub").textContent = sel.length
    ? `${sel.length} selected · ${money(sum)}`
    : "nothing selected";
  show("c-dest", sel.length > 0);
  maybeReview();
}

$("pick-all").addEventListener("click", () => {
  S.assets.filter((a) => !a.blocked).forEach((a) => S.picked.add(a.id));
  renderAssets();
});
$("pick-none").addEventListener("click", () => { S.picked.clear(); renderAssets(); });

/* ------------------------------------------------------------- destination */

const isSolanaAddress = (a) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a.trim());

async function discoverDest() {
  if (S.dest) return S.dest;
  const r = await fetch("https://api.skip.build/v2/info/chains?include_svm=true");
  const { chains } = await r.json();
  const svm = (chains || []).find((c) => c.chain_type === "svm");
  if (!svm) throw new Error("Skip is not offering a Solana route right now");
  S.dest = { chainId: svm.chain_id, denom: USDC_MINT, decimals: 6 };
  return S.dest;
}

/* CCTP mints into a USDC token account that must already exist. A wallet that
   has never held USDC does not have one, which is exactly our typical user. */
async function checkTokenAccount(owner) {
  const body = JSON.stringify({
    jsonrpc: "2.0", id: 1, method: "getTokenAccountsByOwner",
    params: [owner, { mint: USDC_MINT }, { encoding: "jsonParsed" }],
  });

  const ask = async (url) => {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), SOLANA_RPC_TIMEOUT_MS);
    try {
      const r = await fetch(url, {
        method: "POST", headers: { "content-type": "application/json" },
        body, signal: ctl.signal,
      });
      if (!r.ok) throw new Error(`${url} ${r.status}`);
      const j = await r.json();
      if (j.error) throw new Error(j.error.message);
      return (j.result?.value || []).length > 0;
    } finally {
      clearTimeout(t);
    }
  };

  /* Promise.any resolves on the first success and only rejects if every
     endpoint fails, which is exactly the semantics wanted here. */
  return Promise.any(SOLANA_RPCS.map(ask));
}

let destTimer;
$("solana").addEventListener("input", (e) => {
  clearTimeout(destTimer);
  const v = e.target.value.trim();
  const note = $("dest-note");

  if (!v) {
    note.className = "note";
    note.textContent = "";
    S.solana = ""; maybeReview(); return;
  }
  if (!isSolanaAddress(v)) {
    note.className = "note bad";
    note.textContent = "That does not look like a Solana address.";
    S.solana = ""; maybeReview(); return;
  }

  S.solana = v;
  note.className = "note";
  note.innerHTML = '<span class="spinner"></span> checking the account';
  destTimer = setTimeout(async () => {
    try {
      const has = await checkTokenAccount(v);
      note.className = "note ok";
      note.textContent = has
        ? "Address checks out and already holds USDC."
        : "Address checks out. It has no USDC account yet — we open one as part of delivery.";
    } catch (e) {
      /* Advisory only. Saying we could not reach Solana reads as a problem
         with the transfer, which it is not — the address is still valid and
         the route is unaffected. */
      note.className = "note ok";
      note.textContent = "Address checks out.";
    }
    maybeReview();
  }, 400);
});

/* Optional convenience only — we never ask a Solana wallet to sign. */
$("wallet-fill").addEventListener("click", async () => {
  const provider = window.phantom?.solana || window.solflare || window.backpack?.solana;
  if (!provider) {
    $("dest-note").className = "note warn";
    $("dest-note").textContent = "No Solana wallet detected in this browser. Paste the address instead.";
    return;
  }
  try {
    const res = await provider.connect();
    const key = (res?.publicKey || provider.publicKey)?.toString();
    if (!key) throw new Error("wallet returned no address");
    $("solana").value = key;
    $("solana").dispatchEvent(new Event("input"));
  } catch (e) {
    $("dest-note").className = "note warn";
    $("dest-note").textContent = fail("wallet", e);
  }
});

$("gas-drop").addEventListener("change", () => { if (S.solana) quoteAll(); });

/* ------------------------------------------------------------------ quotes */

/* Debounced because the amount field calls this on every keystroke, and each
   call is a round of Skip quotes. The token guard inside quoteAll makes stale
   results harmless, but not free. */
let reviewTimer;
function maybeReview() {
  const ready = S.picked.size > 0 && S.solana;
  show("c-review", ready);
  clearTimeout(reviewTimer);
  if (ready) reviewTimer = setTimeout(() => quoteAll().catch((e) => fail("quote", e)), 350);
}

const isNobleUsdc = (a) => a.chainId === NOBLE_CHAIN && a.denom === NOBLE_USDC;
const usdc = (base) => Number(base || 0) / 1e6;

/* One route request, built the same way everywhere so the execute-time
   re-quote cannot silently differ from the one the user approved. */
const routeReq = (from, toChainId, toDenom, amountIn, feeBps) => ({
  amountIn,
  sourceAssetDenom: from.denom,
  sourceAssetChainId: from.chainId,
  destAssetDenom: toDenom,
  destAssetChainId: toChainId,
  cumulativeAffiliateFeeBps: String(feeBps),
  smartRelay: true,
  allowMultiTx: true,
  allowUnsafe: false,
});

async function gasRouteFor(routeResponse, routeRequest) {
  if (!$("gas-drop").checked) return undefined;
  try {
    const withGas = await getRouteWithGasOnReceive({ routeResponse, routeRequest });
    return withGas.gasRoute;
  } catch {
    return undefined;    // a gas top-up is a bonus, never a blocker
  }
}

let quoteToken = 0;
async function quoteAll() {
  const mine = ++quoteToken;
  const sel = S.assets.filter((a) => S.picked.has(a.id) && Number(sendBase(a)) > 0);
  const totalUsd = sel.reduce((s, a) => s + sendUsd(a), 0);
  const feeBps = feeBpsFor(totalUsd);

  /* Sweeping needs somewhere to sweep to. If this Keplr build never handed us
     a Noble address there is no staging chain, so the only honest option is
     the direct path — worse on fees, but it works. */
  const canSweep = Boolean(S.addresses[NOBLE_CHAIN]) && sel.length >= SWEEP_MIN_ASSETS;
  const mode = canSweep ? "sweep" : "direct";

  $("review").innerHTML = `<p class="step-note"><span class="spinner"></span> Pricing ${sel.length} asset${sel.length === 1 ? "" : "s"}${mode === "sweep" ? " as one transfer" : ""}…</p>`;
  $("start").disabled = true;

  let dest;
  try { dest = await discoverDest(); }
  catch (e) { $("review").innerHTML = `<p class="note bad">${fail("chains", e)}</p>`; return; }

  const plan = mode === "sweep"
    ? await planSweep(sel, dest, feeBps)
    : await planDirect(sel, dest, feeBps);

  if (mine !== quoteToken) return;   // a newer quote run superseded this one
  S.plan = plan;
  renderReview(dest);
}

/* Direct: every asset makes its own exit to Solana and pays its own relay fee.
   Right for a single asset, and the fallback when sweeping is unavailable. */
async function planDirect(sel, dest, feeBps) {
  const legs = [];
  for (const a of sel) {
    try {
      /* Asked, never guessed. A local dust threshold is a prediction about
         where Skip draws its line, and it was wrong in the direction that
         costs most — refusing $5 because we valued it at $4.998, on a route
         Skip is perfectly happy to run. Skip decides; we only explain. */
      const req = routeReq(a, dest.chainId, dest.denom, sendBase(a), feeBps);
      const r = await route(req);
      legs.push({ asset: a, route: r, req, gasRoute: await gasRouteFor(r, req), feeBps });
    } catch (e) {
      /* The fixed exit fee is what kills small solo transfers, and batching is
         the actual remedy — worth saying, but only once Skip has really said no. */
      const hint = sendUsd(a) < DUST_USD && !isNobleUsdc(a)
        ? " — picking another asset would batch them into one transfer, which usually gets small amounts through"
        : "";
      legs.push({ asset: a, error: (e?.message || "no route") + hint });
    }
  }
  return { mode: "direct", legs, exit: null, feeBps, dest };
}

/* Sweep: phase A moves everything to USDC on Noble, phase B makes one exit.
   The affiliate fee rides phase A because that is where the swap happens —
   the Noble → Solana leg is a pure CCTP transfer with nothing to take a cut
   of, so charging there is not merely undesirable, it is impossible. */
async function planSweep(sel, dest, feeBps) {
  const legs = [];
  for (const a of sel) {
    /* Already the asset we are sweeping to, already on the staging chain.
       Routing it to itself would be a signature spent on nothing. */
    if (isNobleUsdc(a)) {
      legs.push({ asset: a, passthrough: true, expectedOut: sendBase(a), feeBps: 0 });
      continue;
    }
    try {
      const req = routeReq(a, NOBLE_CHAIN, NOBLE_USDC, sendBase(a), feeBps);
      const r = await route(req);
      legs.push({ asset: a, route: r, req, expectedOut: r.amountOut, feeBps });
    } catch (e) {
      legs.push({ asset: a, error: e?.message || "no route" });
    }
  }

  const staged = legs.reduce((s, l) => s + Number(l.expectedOut || 0), 0);
  const exit = await planExit(staged, dest);
  return { mode: "sweep", legs, exit, feeBps, dest, staged };
}

/* The one leg that leaves Cosmos. Quoted here on expected amounts so the user
   sees a real arrival number, and quoted again at execution time against the
   balance that actually landed — routes are cheap, wrong numbers are not. */
async function planExit(stagedBase, dest) {
  const reserve = Math.ceil(NOBLE_FEE_RESERVE_USDC * 1e6);
  const amountIn = Math.max(0, Math.floor(stagedBase) - reserve);
  if (!amountIn) return { error: "nothing would reach Noble to send on" };
  if (usdc(amountIn) < EXIT_MIN_USD) {
    return { error: `only ${money(usdc(amountIn))} would reach Noble — too little to cover the ${money(0.17)} exit to Solana` };
  }
  try {
    const from = { chainId: NOBLE_CHAIN, denom: NOBLE_USDC };
    const req = routeReq(from, dest.chainId, dest.denom, String(amountIn), 0);
    const r = await route(req);
    return { route: r, req, amountIn: String(amountIn), gasRoute: await gasRouteFor(r, req) };
  } catch (e) {
    return { error: e?.message || "no route out of Noble" };
  }
}

/* Stated plainly and always, including when it is nothing. A fee someone finds
   later reads as a trick; a fee they were shown reads as a price. */
function feeRow(inUsd) {
  if (!feeEnabled()) return "";
  if (!S.plan.feeBps) {
    return `<div class="row"><span class="k">Service fee</span><span class="v">None — under ${money(FEE_FREE_BELOW_USD)}</span></div>`;
  }
  const feeUsd = (inUsd * S.plan.feeBps) / 10000;
  return `<div class="row"><span class="k">Service fee (${(S.plan.feeBps / 100).toFixed(2)}%)</span><span class="v">${money(feeUsd)}</span></div>`;
}

function renderReview(dest) {
  const { mode, legs, exit } = S.plan;
  const ok = legs.filter((l) => l.route || l.passthrough);
  const bad = legs.filter((l) => l.error);

  /* Input value is the user's, whichever shape the plan takes. Output is the
     exit's word in sweep mode and the sum of the legs in direct mode. */
  const inUsd = ok.reduce((s, l) => s + (l.route ? Number(l.route.usdAmountIn || 0) : sendUsd(l.asset)), 0);
  const outUsd = mode === "sweep"
    ? Number(exit?.route?.usdAmountOut || 0)
    : ok.reduce((s, l) => s + Number(l.route.usdAmountOut || 0), 0);
  const out = mode === "sweep"
    ? Number(exit?.route?.amountOut || 0) / 10 ** dest.decimals
    : ok.reduce((s, l) => s + Number(l.route.amountOut || 0) / 10 ** dest.decimals, 0);

  const legTxs = ok.reduce((s, l) => s + (l.passthrough ? 0 : l.route.txsRequired || 1), 0);
  const txs = legTxs + (mode === "sweep" && exit?.route ? (exit.route.txsRequired || 1) : 0)
    + (exit?.gasRoute ? 1 : 0) + ok.reduce((s, l) => s + (l.gasRoute ? 1 : 0), 0);

  const legSecs = Math.max(0, ...ok.map((l) => l.route?.estimatedRouteDurationSeconds || 0));
  const secs = legSecs + (mode === "sweep" ? (exit?.route?.estimatedRouteDurationSeconds || 0) : 0);
  const costPct = inUsd > 0 ? ((inUsd - outUsd) / inUsd) * 100 : 0;

  /* Sweeping cannot price the exit until the legs have quoted, so a failed
     exit is the one error that invalidates the whole plan rather than one row
     of it. Say so before the user reaches for the button. */
  if (mode === "sweep" && exit?.error) {
    $("review").innerHTML = `<p class="callout warn">These can be gathered together, but not sent on — ${exit.error}. Pick more, or larger, assets.</p>`;
    $("start").disabled = true;
    $("sig-note").textContent = "";
    return;
  }

  /* Nothing routed. A summary of zeros and an estimate of "about 0 signatures"
     is noise on top of a failure — show only what went wrong. */
  if (!ok.length) {
    $("review").innerHTML = bad
      .map((l) => `<p class="callout warn">${l.asset.symbol} on ${l.asset.chainName} can't be routed right now — ${l.error}.</p>`)
      .join("") || '<p class="callout warn">No route is available for what you picked right now.</p>';
    $("start").disabled = true;
    $("sig-note").textContent = "";
    return;
  }

  let html = `<div class="lines">
    <div class="row"><span class="k">You send</span><span class="v">${ok.length} asset${ok.length === 1 ? "" : "s"} · ${money(inUsd)}</span></div>
    <div class="row big"><span class="k">You receive</span><span class="v">≈ ${qty(out, 2)} USDC</span></div>
    <div class="row"><span class="k">Total cost</span><span class="v">${costPct.toFixed(2)}% · ${money(Math.max(0, inUsd - outUsd))}</span></div>
    ${feeRow(inUsd)}
    <div class="row"><span class="k">Arrives in</span><span class="v">≈ ${secs < 90 ? Math.max(30, secs) + " sec" : Math.round(secs / 60) + " min"}</span></div>
  </div>`;

  if (mode === "sweep") {
    const saved = Math.max(0, ok.length - 1) * 0.17;
    html += `<p class="callout">Your ${ok.length} assets are gathered into USDC on Noble first, then sent to Solana in one go. Leaving Cosmos costs a flat ${money(0.17)} however much you send, so doing it once instead of ${ok.length} times saves about ${money(saved)}.</p>`;
  }

  html += `<details class="more"><summary>See it broken down</summary><div class="lines">`;
  for (const l of ok) {
    const label = mode === "sweep" ? "USDC on Noble" : "USDC";
    const o = l.passthrough
      ? usdc(l.expectedOut)
      : Number(l.route.amountOut || 0) / 10 ** (mode === "sweep" ? 6 : dest.decimals);
    html += `<div class="row"><span class="k">${l.asset.symbol} · ${l.asset.chainName}</span><span class="v">${l.passthrough ? "already " : "→ "}${qty(o, 2)} ${label}</span></div>`;
    for (const f of l.route?.estimatedFees || []) {
      html += `<div class="row"><span class="k" style="padding-left:14px">${String(f.feeType || "fee").toLowerCase().replace(/_/g, " ")}</span><span class="v">${f.usdAmount ? money(f.usdAmount) : qty(f.amount)}</span></div>`;
    }
  }
  if (mode === "sweep" && exit?.route) {
    html += `<div class="row"><span class="k">Noble → Solana</span><span class="v">→ ${qty(out, 2)} USDC${exit.gasRoute ? " + SOL" : ""}</span></div>`;
    for (const f of exit.route.estimatedFees || []) {
      html += `<div class="row"><span class="k" style="padding-left:14px">${String(f.feeType || "fee").toLowerCase().replace(/_/g, " ")}</span><span class="v">${f.usdAmount ? money(f.usdAmount) : qty(f.amount)}</span></div>`;
    }
  }
  html += `</div></details>`;

  for (const l of bad) {
    html += `<p class="callout warn">${l.asset.symbol} on ${l.asset.chainName} can't be routed right now — ${l.error}. It will be skipped.</p>`;
  }

  $("review").innerHTML = html;
  $("start").disabled = ok.length === 0 || (mode === "sweep" && !exit?.route);
  $("sig-note").textContent = mode === "sweep"
    ? `Keplr will ask you to sign about ${txs} times — once or twice per asset to gather them on Noble, then once more to send them to Solana. Nothing is signed on Solana.`
    : `Keplr will ask you to sign about ${txs} time${txs === 1 ? "" : "s"} — roughly ${Math.round(txs / Math.max(1, ok.length))} per asset. Nothing is signed on Solana.`;
}

$("requote").addEventListener("click", quoteAll);

/* ----------------------------------------------------------------- execute */

/* Every route walks the same four phases, so a row is four pips: filled behind,
   glowing on the one in flight, dark ahead. Four is enough to show motion and
   few enough to read at a glance. */
const PHASES = 4;
const PHASE = {
  queued: 0, signing: 1, broadcasting: 2, relaying: 3, waiting: 3,
  /* Landing on Noble is a complete leg but not arrival — the exit row is
     where "arrived" gets to mean it. */
  staged: PHASES, done: PHASES,
};
const PHASE_TEXT = {
  queued: "waiting its turn",
  signing: "approve in Keplr",
  broadcasting: "sending",
  relaying: "crossing chains",
  waiting: "settling on Noble",
  staged: "gathered on Noble",
  done: "arrived",
  skipped: "skipped",
};

const phaseOf = (item) =>
  item.status === "failed" || item.status === "skipped"
    ? (item.phase || 0)
    : (PHASE[item.status] ?? 0);

function renderQueue() {
  const box = $("queue");
  box.innerHTML = "";

  for (const item of S.queue) {
    const reached = phaseOf(item);
    const failed = item.status === "failed";
    const live = !failed && item.status !== "done" && item.status !== "staged" && item.status !== "skipped" && item.status !== "queued";

    let where;
    if (item.received && (item.status === "done" || item.status === "staged")) {
      where = `${item.chainName} → ${qty(item.received, 2)} USDC on ${item.status === "staged" ? "Noble" : "Solana"}`;
    } else if (failed) {
      where = `${item.chainName} · ${item.error || "failed"}`;
    } else {
      where = `${item.chainName} · ${PHASE_TEXT[item.status] || ""}`;
    }

    const pips = Array.from({ length: PHASES }, (_, i) => {
      if (failed && i === reached) return '<span class="pip bad"></span>';
      if (i < reached) return '<span class="pip on"></span>';
      if (live && i === reached) return '<span class="pip live"></span>';
      return '<span class="pip"></span>';
    }).join("");

    const row = document.createElement("div");
    row.className = "qrow";
    row.innerHTML = `
      <span>
        <span class="name">${item.symbol}</span>
        <span class="where">${where}</span>
      </span>
      <span class="pips">${pips}</span>`;
    box.appendChild(row);
  }

  renderProgress();
}

/* One bar for the whole run, measured in phases rather than in finished rows —
   otherwise a single slow transfer shows no movement for minutes at a time. */
function renderProgress() {
  const total = S.queue.length * PHASES;
  const walked = S.queue.reduce((s, i) => s + phaseOf(i), 0);
  const pct = total ? Math.round((walked / total) * 100) : 0;

  $("progress-fill").style.width = `${pct}%`;

  const done = S.queue.filter((i) => i.status === "done").length;
  const failed = S.queue.filter((i) => i.status === "failed").length;
  const active = S.queue.find((i) => !["queued", "done", "staged", "failed", "skipped"].includes(i.status));

  /* Stop the sheen once nothing is moving — an animation that outlives the
     work it describes reads as a hang. */
  $("progress").classList.toggle("settled", !active);

  $("progress-label").textContent = active
    ? `${itemLabel(active)} — ${PHASE_TEXT[active.status] || ""}`
    : failed
      ? `${done} arrived · ${failed} did not go through`
      : `${done} of ${S.queue.length} complete`;

  $("queue-progress").textContent = `${pct}%`;
}

const itemLabel = (i) => (i.isExit ? "Sending to Solana" : `${i.symbol} on ${i.chainName}`);

const getCosmosSigner = async (chainId) => {
  const key = await window.keplr.getKey(chainId);
  return key.isNanoLedger
    ? window.keplr.getOfflineSignerOnlyAmino(chainId)
    : window.keplr.getOfflineSigner(chainId);
};

/* One route, executed, with the row it drives. Everything about signing is
   identical whether the leg heads to Noble, to Solana, or is a gas top-up —
   only where the progress gets drawn differs, hence the optional reporter. */
function runRoute(r, item, onStatus) {
  /* Remember how far it got. A failure needs to mark the phase it died in, and
     the status alone stops carrying that once it becomes "failed". */
  const draw = () => {
    item.phase = PHASE[item.status] ?? item.phase ?? 0;
    return onStatus ? onStatus(item.status) : renderQueue();
  };

  /* A gas top-up never touches Solana, so S.dest may not be discovered yet. */
  const addressesFor = (route_) => (route_.requiredChainAddresses || []).map((chainId) => {
    const address = chainId === S.dest?.chainId ? S.solana : S.addresses[chainId];
    if (!address) throw new Error(`no address for ${chainId}`);
    return { chainId, address };
  });

  return executeRoute({
    route: r,
    userAddresses: addressesFor(r),
    getCosmosSigner,
    onTransactionSignRequested: async () => { item.status = "signing"; draw(); },
    onTransactionSigned: async ({ chainId }) => {
      item.status = "broadcasting"; draw(); log(`signed on ${chainId}`);
    },
    onTransactionBroadcast: async ({ txHash, chainId }) => {
      item.status = "relaying"; item.txHash = txHash; draw();
      log(`broadcast ${chainId} ${txHash.slice(0, 12)}…`);
    },
    onTransactionCompleted: async ({ chainId }) => { log(`hop complete on ${chainId}`); },
  });
}

async function nobleUsdcBalance() {
  const address = S.addresses[NOBLE_CHAIN];
  if (!address) return 0;
  const res = await balances({ chains: { [NOBLE_CHAIN]: { address } } });
  return Number(res?.chains?.[NOBLE_CHAIN]?.denoms?.[NOBLE_USDC]?.amount || 0);
}

/* executeRoute resolves once the relay reports the transfer complete, but the
   balance endpoint indexes on its own schedule, so quoting the exit straight
   away can read a Noble balance that is real money short. Wait for the number
   to arrive, and give up gracefully — the exit is capped by what is actually
   there, so proceeding early costs accuracy, never funds. */
async function waitForNoble(target, item) {
  const deadline = Date.now() + 90_000;
  let seen = await nobleUsdcBalance();
  while (seen < target * 0.95 && Date.now() < deadline) {
    if (item) { item.status = "waiting"; renderQueue(); }
    await new Promise((r) => setTimeout(r, 5000));
    seen = await nobleUsdcBalance();
  }
  log(`noble holds ${qty(usdc(seen), 2)} USDC`);
  return seen;
}

async function start() {
  if (S.running || !S.plan) return;
  S.running = true;
  $("start").disabled = true;
  show("c-queue");
  $("c-review").classList.add("settled");

  const { mode, legs, exit } = S.plan;
  const runnable = legs.filter((l) => l.route || l.passthrough);

  /* The Cosmos equivalent of reserving a deposit address: the point past
     which the user has committed and Keplr starts asking for signatures. */
  const planUsd = legs.reduce((t, l) => t + (sendUsd(l.asset) || 0), 0);
  track("bridge_cosmos_start", {
    mode, assets: runnable.length,
    usd: money2(planUsd), bucket: usdBucket(planUsd),
  });

  S.queue = runnable.map((l) => ({
    id: l.asset.id, symbol: l.asset.symbol, chainName: l.asset.chainName, status: "queued",
  }));
  if (mode === "sweep") {
    S.queue.push({ id: "__exit", symbol: "USDC", chainName: "Noble → Solana", status: "queued", isExit: true });
  }
  renderQueue();
  persist();

  /* Measured before anything moves. USDC already sitting on Noble that the
     user did not select is none of our business, and this is what keeps the
     exit from spending it. */
  const before = mode === "sweep" ? await nobleUsdcBalance() : 0;

  let delivered = 0;
  let entitled = 0;    // base-unit uusdc this run is allowed to send onward
  let arriving = 0;

  /* Sequential on purpose: Keplr can only hold one prompt at a time, and a
     user watching five popups fight for focus will abandon. */
  for (let i = 0; i < runnable.length; i++) {
    const l = runnable[i];
    const item = S.queue[i];

    if (l.passthrough) {
      item.status = "staged";
      entitled += Number(l.expectedOut || 0);
      renderQueue();
      continue;
    }

    try {
      /* Must match the bps this route was quoted with, or Skip rejects the
         message build for an affiliate mismatch. */
      applyAffiliates(l.feeBps);
      await runRoute(l.route, item);

      if (mode === "sweep") {
        item.status = "staged";
        item.received = usdc(l.expectedOut);
        entitled += Number(l.expectedOut || 0);
        arriving += Number(l.expectedOut || 0);
      } else {
        item.status = "done";
        item.received = Number(l.route.amountOut || 0) / 10 ** S.dest.decimals;
        delivered += Number(l.route.usdAmountOut || 0);
        if (l.gasRoute) {
          applyAffiliates(0);
          log("sending a little SOL for fees");
          try { await runRoute(l.gasRoute, item); } catch (e) { log(`gas top-up skipped: ${e.message}`); }
        }
      }
    } catch (e) {
      item.status = "failed";
      item.error = explain(e).slice(0, 90);
      fail(`${item.symbol}`, e);
    }
    renderQueue();
    persist();
  }

  if (mode === "sweep") delivered = await runExit({ before, entitled, arriving, exit });

  S.running = false;
  finish(delivered);
}

/* Phase B. Re-quoted rather than replayed: the plan's exit route was priced on
   what we expected to land, and the amount that actually landed is the only
   one Skip will accept a signature for. */
async function runExit({ before, entitled, arriving, exit }) {
  const item = S.queue[S.queue.length - 1];
  if (!entitled) {
    item.status = "skipped";
    item.error = "nothing reached Noble";
    renderQueue();
    return 0;
  }

  try {
    const settled = await waitForNoble(before + arriving, item);
    const reserve = Math.ceil(NOBLE_FEE_RESERVE_USDC * 1e6);
    /* Capped by both what this run gathered and what is really there, so a
       shortfall in one leg cannot make the exit try to spend a balance the
       user never offered. */
    const amountIn = Math.max(0, Math.min(entitled, settled - reserve));
    if (usdc(amountIn) < EXIT_MIN_USD) {
      throw new Error(`only ${money(usdc(amountIn))} landed on Noble — below the ${money(EXIT_MIN_USD)} needed to cover the exit`);
    }

    /* The exit is a CCTP transfer with no swap in it, so there is nothing for
       an affiliate fee to attach to. Clearing the map also stops the phase A
       fee being reapplied to a leg that was never quoted with one. */
    applyAffiliates(0);
    const from = { chainId: NOBLE_CHAIN, denom: NOBLE_USDC };
    const req = routeReq(from, S.dest.chainId, S.dest.denom, String(amountIn), 0);
    const r = await route(req);
    log(`exiting with ${qty(usdc(amountIn), 2)} USDC`);

    await runRoute(r, item);
    item.status = "done";
    item.received = Number(r.amountOut || 0) / 10 ** S.dest.decimals;

    const gasRoute = exit?.gasRoute ? await gasRouteFor(r, req) : undefined;
    if (gasRoute) {
      log("sending a little SOL for fees");
      try { await runRoute(gasRoute, item); } catch (e) { log(`gas top-up skipped: ${e.message}`); }
    }
    renderQueue();
    persist();
    return Number(r.usdAmountOut || 0);
  } catch (e) {
    item.status = "failed";
    /* This failure is the one worth being explicit about: the money is not
       lost, it is USDC on Noble, and it can be sent again without redoing
       any of the gathering. */
    item.error = explain(e).slice(0, 90);
    fail("exit to Solana", e);
    renderQueue();
    persist();
    return 0;
  }
}

$("start").addEventListener("click", () => start().catch((e) => fail("run", e)));

/* -------------------------------------------------------------------- done */

async function finish(deliveredUsd) {
  const sweeping = S.plan?.mode === "sweep";
  const exitRow = sweeping ? S.queue.find((i) => i.isExit) : null;
  const assetRows = S.queue.filter((i) => !i.isExit);
  const failed = assetRows.filter((i) => i.status === "failed");
  const gathered = assetRows.filter((i) => i.status === "staged").length;
  const arrived = sweeping
    ? (exitRow?.status === "done" ? gathered : 0)
    : assetRows.filter((i) => i.status === "done").length;
  show("c-done");

  /* Sweeping delivers in one transaction, so the arrival figure is the exit's
     alone — the staged rows already counted the same money on its way. */
  const totalUsdc = sweeping
    ? (exitRow?.received || 0)
    : S.queue.reduce((s, i) => s + (i.received || 0), 0);

  /* Do not congratulate someone whose transfer failed. */
  const title = arrived === 0 ? "Nothing moved" : failed.length ? "Partly done" : "Arrived";

  /* USDC is close enough to a dollar that the delivered amount is the volume
     figure. Reported whatever the outcome — a run that stranded funds on
     Noble is exactly the one worth knowing the size of. */
  track("bridge_cosmos_done", {
    outcome: arrived === 0 ? "none" : failed.length ? "partial" : "ok",
    assets: arrived, mode: sweeping ? "sweep" : "direct",
    usd: money2(totalUsdc), bucket: usdBucket(totalUsdc),
  });
  $("c-done").querySelector(".step-title").textContent = title;

  const short = S.solana ? `${S.solana.slice(0, 6)}…${S.solana.slice(-4)}` : "";
  const explorer = S.solana
    ? `<p class="step-note"><a class="link" href="https://solscan.io/account/${S.solana}" target="_blank" rel="noopener">See it on Solscan →</a></p>`
    : "";

  /* The sweep's own failure mode: the money left its original chains, became
     USDC on Noble, and stopped there. It is safe and it is spendable, and a
     user who is not told exactly that will assume the worst. */
  const stranded = sweeping && exitRow?.status === "failed" && gathered > 0
    ? `<p class="callout warn">Your ${gathered} asset${gathered === 1 ? " is" : "s are"} now USDC on Noble, and the last step to Solana did not go through — ${exitRow.error}. Nothing is lost and nothing needs redoing: reconnect and the balance on Noble can be sent on by itself.</p>`
    : "";

  $("done-body").innerHTML = arrived
    ? `<p class="step-note"><strong>${qty(totalUsdc, 2)} USDC</strong> is now in your Solana wallet
       <span class="mono">${short}</span>. ${sweeping ? `${arrived} asset${arrived === 1 ? "" : "s"} gathered and sent as one transfer` : `${arrived} of ${assetRows.length} transfers completed`}.</p>${explorer}
       ${failed.length ? `<p class="callout warn">${failed.length} did not go through. Nothing was lost — those funds are still on their original chain and you can try again.</p>` : ""}`
    : stranded
      ? `${stranded}${explorer}`
      : `<p class="step-note">Nothing was transferred, and nothing was lost — your funds are still on their original chains.</p>
         <p class="callout warn">${failed[0]?.error || exitRow?.error || "The transfer could not be completed."} Try again, and if it repeats, send us the message above.</p>`;

  localStorage.removeItem(SAVE);
  if (arrived) await offerSolSwap();
}

/* DFlow price for turning a little USDC into SOL. Quoting needs no wallet and
   no key; executing needs a Solana signature, which is why it is offered here
   as a next step rather than folded into the bridge itself. */
async function offerSolSwap() {
  const box = $("dflow");
  try {
    const p = new URLSearchParams({
      inputMint: USDC_MINT, outputMint: SOL_MINT, amount: "2000000", slippageBps: "100",
    });
    const r = await fetch(`${DFLOW}/order?${p}`);
    if (!r.ok) throw new Error(`quote ${r.status}`);
    const q = await r.json();
    const sol = Number(q.outAmount || 0) / 1e9;
    if (!sol) throw new Error("no quote");

    box.innerHTML = `
      <div class="lines" style="margin-top:22px">
        <div class="row"><span class="k">Need SOL for fees?</span><span class="v">$2 ≈ ${qty(sol, 4)} SOL</span></div>
      </div>
      <p class="step-note">A couple of dollars of SOL covers hundreds of transactions. Priced live by DFlow.</p>
      <div class="step-actions">
        <a class="button button--ghost button--sm" href="https://jup.ag/swap/USDC-SOL" target="_blank" rel="noopener">Swap USDC for SOL</a>
      </div>`;
  } catch {
    box.innerHTML = `<p class="step-note">You will need a small amount of SOL to pay network fees before you can move this USDC.</p>`;
  }
}

/* ---------------------------------------------------------- fee diagnostic
   An affiliate cut is invisible until money moves, and a live transfer is a
   poor place to discover it never attached — the fee is global API state, set
   apart from the call that uses it, which is exactly the shape of bug that
   fails silently. This quotes the same route twice, with the fee and without,
   and reports the gap. No signature, no funds, decisive answer.

   Connect Keplr, select assets, then run `bridgeVerifyFee()` in the console. */
async function verifyFee() {
  const out = (r) => Number(r?.amountOut || 0);
  const address = AFFILIATE["osmosis-1"];
  if (!address) {
    console.warn("[fee] AFFILIATE['osmosis-1'] is empty — nothing will ever be charged. Set it first.");
    return { configured: false };
  }

  const a = S.assets.filter((x) => !x.blocked && S.picked.has(x.id)).sort((x, y) => y.usd - x.usd)[0]
    || S.assets.filter((x) => !x.blocked).sort((x, y) => y.usd - x.usd)[0];
  if (!a) { console.warn("[fee] no routable asset — connect Keplr first"); return { configured: true }; }

  const quote = async (bps) => {
    applyAffiliates(bps);
    return route(routeReq(a, NOBLE_CHAIN, NOBLE_USDC, sendBase(a), bps));
  };

  try {
    const [free, charged] = [await quote(0), await quote(AFFILIATE_BPS)];
    const taken = out(free) - out(charged);
    const bps = out(free) ? (taken / out(free)) * 10000 : 0;
    /* Skip quotes move between calls, so this is a band rather than an equality
       — but a fee that failed to attach reads as ~0 and is unmistakable. */
    const attached = bps > AFFILIATE_BPS * 0.5;

    console.table({
      asset: `${a.symbol} on ${a.chainName}`,
      recipient: address,
      "out without fee": qty(usdc(out(free)), 4),
      "out with fee": qty(usdc(out(charged)), 4),
      "fee taken (USDC)": qty(usdc(taken), 4),
      "effective bps": bps.toFixed(1),
      verdict: attached ? `attaching — expect it on Osmosis at ${address}` : "NOT attaching",
    });
    applyAffiliates(0);
    return { configured: true, attached, bps, recipient: address };
  } catch (e) {
    console.error("[fee] quote failed", e);
    applyAffiliates(0);
    return { configured: true, error: e?.message };
  }
}
window.bridgeVerifyFee = verifyFee;

/* ------------------------------------------------------------- persistence */

function persist() {
  try {
    localStorage.setItem(SAVE, JSON.stringify({
      at: Date.now(), solana: S.solana,
      queue: S.queue.map(({ id, symbol, chainName, status, error, isExit, phase }) => ({ id, symbol, chainName, status, error, isExit, phase })),
    }));
  } catch { /* private browsing */ }
}

function resume() {
  let saved;
  try { saved = JSON.parse(localStorage.getItem(SAVE) || "null"); } catch { return; }
  if (!saved?.queue?.length) return;
  if (Date.now() - saved.at > 6 * 60 * 60 * 1000) { localStorage.removeItem(SAVE); return; }

  /* "staged" counts as unfinished: the money is on Noble, mid-sweep, and a run
     abandoned there is exactly the one worth offering to resume. */
  const unfinished = saved.queue.filter((i) => i.status !== "done" && i.status !== "skipped");
  if (!unfinished.length) { localStorage.removeItem(SAVE); return; }

  const interrupted = ["signing", "broadcasting", "waiting"];
  S.queue = saved.queue.map((i) => (interrupted.includes(i.status) ? { ...i, status: "queued" } : i));
  S.solana = saved.solana || "";
  show("c-queue");
  renderQueue();

  const onNoble = saved.queue.filter((i) => i.status === "staged").length;
  log(onNoble
    ? `picked up an unfinished sweep — ${onNoble} asset${onNoble === 1 ? "" : "s"} reached Noble as USDC and can be sent on`
    : "picked up an unfinished run — reconnect Keplr to continue");
}

/* ------------------------------------------------------------------- mount

   This engine is rendered inside the unified bridge rather than owning a page
   of its own, so the two statements that actually *start* it are deferred to
   init(). Everything above still runs at module scope against markup the
   caller injected first — that is what let this file stay as it was.

   The one thing the shell hands over is the destination address. It is the
   only value a user has to fetch from somewhere else, so asking for it again
   just because they switched tabs is a real cost. It travels both ways. */

/* Push a destination the user gave on another tab. Idempotent, and it routes
   through the same "input" path as typing, so validation and the token-account
   check run exactly as they would have. */
export function setSolanaAddress(a) {
  if (!a || !isSolanaAddress(a)) return;
  const el = $("solana");
  if (!el || el.value.trim() === a) return;
  el.value = a;
  el.dispatchEvent(new Event("input"));
}

export function init(opts = {}) {
  $("connect").addEventListener("click", () => connect().catch((e) => fail("connect", e)));

  if (opts.solanaAddress && isSolanaAddress(opts.solanaAddress)) {
    $("solana").value = opts.solanaAddress;
    /* Same path as typing it: validates, checks the token account, and lets
       the review step open on its own once everything else is settled. */
    $("solana").dispatchEvent(new Event("input"));
  }

  if (typeof opts.onSolanaAddress === "function") {
    $("solana").addEventListener("change", () => {
      const v = $("solana").value.trim();
      if (isSolanaAddress(v)) opts.onSolanaAddress(v);
    });
  }

  resume();
}
