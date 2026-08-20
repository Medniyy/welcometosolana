/* Cosmos → Solana spike.
   Purpose is measurement, not product: prove the corridor works with Keplr
   as the only wallet, and answer the three questions the design is blocked on.

     R1  Does the Solana USDC token account need to exist first, and does
         Skip's relay create it? (CCTP mint reverts without one.)
     R4  How many Keplr popups does one asset actually cost?
     --  What does it really cost, and how long does it really take?

   Deliberately no framework and no styling system. Read the log, not the UI. */

import {
  setApiOptions,
  route,
  executeRoute,
  transactionStatus,
} from "@skip-go/client";

/* Keyless. Skip shares one restrictive rate limit across all anonymous
   callers, which is fine for a handful of spike runs. */
setApiOptions({ apiUrl: "https://api.skip.build" });

const SKIP = "https://api.skip.build";
const SOLANA_RPC = "https://api.mainnet-beta.solana.com";
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

/* Chains Keplr is asked to enable. One prompt covers the whole list. */
const CHAINS = [
  ["cosmoshub-4", "cosmoshub"],
  ["osmosis-1", "osmosis"],
  ["noble-1", "noble"],
  ["celestia", "celestia"],
  ["injective-1", "injective"],
  ["neutron-1", "neutron"],
  ["dydx-mainnet-1", "dydx"],
  ["stargaze-1", "stargaze"],
  ["akashnet-2", "akash"],
  ["juno-1", "juno"],
];

/* Enough denom metadata to make the balance list readable. Anything not
   listed shows raw — IBC denoms are expected and fine to route from. */
const DENOMS = {
  uatom: ["ATOM", 6], uosmo: ["OSMO", 6], uusdc: ["USDC", 6],
  utia: ["TIA", 6], inj: ["INJ", 18], untrn: ["NTRN", 6],
  adydx: ["DYDX", 18], ustars: ["STARS", 6], uakt: ["AKT", 6],
  ujuno: ["JUNO", 6],
};

const $ = (id) => document.getElementById(id);
const state = { keys: {}, balances: [], picked: null, dest: null };

function log(msg, kind = "") {
  const el = document.createElement("div");
  el.className = "line " + kind;
  const t = new Date().toLocaleTimeString("en-GB");
  el.textContent = `${t}  ${msg}`;
  $("log").prepend(el);
  console.log(msg);
}

const fmt = (raw, dec) => (Number(raw) / 10 ** dec).toLocaleString("en-US", {
  maximumFractionDigits: 6,
});

/* ---------------------------------------------------------------- discovery
   Don't guess Skip's id for Solana or the canonical USDC denom — ask. */

async function discoverSolana() {
  const r = await fetch(`${SKIP}/v2/info/chains?include_svm=true&include_evm=true`);
  if (!r.ok) throw new Error(`chains ${r.status}`);
  const { chains } = await r.json();
  const svm = chains.filter((c) => c.chain_type === "svm");
  log(`Skip knows ${chains.length} chains, ${svm.length} SVM: ${svm.map((c) => c.chain_id).join(", ")}`);
  if (!svm.length) throw new Error("no SVM chain in Skip's list");

  const chainId = svm[0].chain_id;
  const a = await fetch(`${SKIP}/v2/fungible/assets?chain_ids=${chainId}`);
  const { chain_to_assets_map: map } = await a.json();
  const assets = map?.[chainId]?.assets || [];
  const usdc = assets.find((x) => x.denom === USDC_MINT)
    || assets.find((x) => x.recommended_symbol === "USDC" || x.symbol === "USDC");
  if (!usdc) throw new Error("USDC not found on Skip's Solana asset list");

  log(`Solana chain_id "${chainId}", USDC denom ${usdc.denom}`, "ok");
  return { chainId, denom: usdc.denom, decimals: usdc.decimals ?? 6 };
}

/* ------------------------------------------------------------------- keplr */

async function connect() {
  if (!window.keplr) throw new Error("Keplr not found — install the extension");
  const ids = CHAINS.map(([id]) => id);

  const t0 = performance.now();
  await window.keplr.enable(ids);
  log(`Keplr enabled ${ids.length} chains in one prompt (${Math.round(performance.now() - t0)}ms)`, "ok");

  for (const [id] of CHAINS) {
    try {
      const key = await window.keplr.getKey(id);
      state.keys[id] = key.bech32Address;
    } catch (e) {
      log(`no key for ${id}: ${e.message}`, "warn");
    }
  }
  log(`addresses derived for ${Object.keys(state.keys).length} chains`);
}

async function loadBalances() {
  state.balances = [];
  await Promise.all(
    CHAINS.map(async ([chainId, dirName]) => {
      const addr = state.keys[chainId];
      if (!addr) return;
      try {
        const url = `https://rest.cosmos.directory/${dirName}/cosmos/bank/v1beta1/balances/${addr}`;
        const r = await fetch(url);
        if (!r.ok) return log(`${dirName} balances ${r.status}`, "warn");
        const { balances = [] } = await r.json();
        for (const b of balances) {
          if (Number(b.amount) === 0) continue;
          const [sym, dec] = DENOMS[b.denom] || [b.denom, 6];
          state.balances.push({ chainId, dirName, denom: b.denom, amount: b.amount, sym, dec });
        }
      } catch (e) {
        log(`${dirName} unreachable: ${e.message}`, "warn");
      }
    }),
  );

  state.balances.sort((a, b) => a.chainId.localeCompare(b.chainId));
  const box = $("balances");
  box.innerHTML = "";
  if (!state.balances.length) {
    box.innerHTML = "<p class='dim'>Nothing found. Wrong account, or these chains are empty.</p>";
    return;
  }
  state.balances.forEach((b, i) => {
    const row = document.createElement("label");
    row.className = "row";
    row.innerHTML = `<input type="radio" name="asset" value="${i}">
      <span class="sym">${b.sym}</span>
      <span class="amt">${fmt(b.amount, b.dec)}</span>
      <span class="dim">${b.chainId}</span>
      <span class="dim tiny">${b.denom.length > 28 ? b.denom.slice(0, 28) + "…" : b.denom}</span>`;
    row.querySelector("input").addEventListener("change", () => {
      state.picked = b;
      $("amount").value = fmt(b.amount, b.dec);
      log(`picked ${b.sym} on ${b.chainId}`);
    });
    box.appendChild(row);
  });
  log(`${state.balances.length} non-zero balances across ${new Set(state.balances.map((b) => b.chainId)).size} chains`, "ok");
}

/* --------------------------------------------------------------------- R1
   Does the destination already hold a USDC account? One RPC call, no
   Solana libraries: ask for the owner's accounts filtered by the mint. */

async function checkTokenAccount(owner) {
  const body = {
    jsonrpc: "2.0", id: 1, method: "getTokenAccountsByOwner",
    params: [owner, { mint: USDC_MINT }, { encoding: "jsonParsed" }],
  };
  const r = await fetch(SOLANA_RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const j = await r.json();
  if (j.error) throw new Error(j.error.message);
  const accounts = j.result?.value || [];
  if (accounts.length) {
    const amt = accounts[0].account.data.parsed.info.tokenAmount.uiAmountString;
    log(`R1: destination already has a USDC account (balance ${amt}) — CCTP can mint`, "ok");
    return true;
  }
  log("R1: destination has NO USDC account. If this run still lands, Skip's relay opened it. If it stalls, we need the opener wallet.", "warn");
  return false;
}

/* ------------------------------------------------------------------- route */

async function quote() {
  if (!state.picked) throw new Error("pick an asset first");
  const dest = state.dest || (state.dest = await discoverSolana());

  const destAddr = $("solana").value.trim();
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(destAddr)) throw new Error("that is not a Solana address");
  await checkTokenAccount(destAddr);

  const b = state.picked;
  const amountIn = toBase($("amount").value, b.dec);
  if (!amountIn) throw new Error("bad amount");

  log(`routing ${$("amount").value} ${b.sym} → USDC on ${dest.chainId}…`);
  const r = await route({
    amountIn,
    sourceAssetDenom: b.denom,
    sourceAssetChainId: b.chainId,
    destAssetDenom: dest.denom,
    destAssetChainId: dest.chainId,
    cumulativeAffiliateFeeBps: "0",
    smartRelay: true,
    allowMultiTx: true,
    allowUnsafe: false,
  });

  state.route = r;
  const out = fmt(r.amountOut, dest.decimals);
  const inUsd = Number(r.usdAmountIn || 0);
  const outUsd = Number(r.usdAmountOut || 0);
  const cost = inUsd && outUsd ? `${(((inUsd - outUsd) / inUsd) * 100).toFixed(2)}%` : "n/a";

  log(`route found: ${r.operations.length} operations, ${r.chainIds?.length ?? "?"} chains`, "ok");
  log(`R4: requiredChainAddresses = [${(r.requiredChainAddresses || []).join(", ")}]`);
  log(`R4: txsRequired = ${r.txsRequired}  ← this is the Keplr popup count`, "ok");
  log(`out ≈ ${out} USDC · all-in cost ${cost} · est ${r.estimatedRouteDurationSeconds}s`);
  (r.estimatedFees || []).forEach((f) =>
    log(`  fee ${f.feeType}: ${f.amount} ${f.originAsset?.symbol || ""} (~$${f.usdAmount || "?"})`));

  $("go").disabled = false;
  return r;
}

function toBase(s, dec) {
  s = String(s).trim().replace(/,/g, "");
  if (!/^\d*\.?\d*$/.test(s) || s === "" || s === ".") return null;
  const [w = "0", f = ""] = s.split(".");
  if (f.length > dec) return null;
  const b = (w + f.padEnd(dec, "0")).replace(/^0+(?=\d)/, "");
  return /^\d+$/.test(b) && b !== "0" ? b : null;
}

/* ----------------------------------------------------------------- execute */

async function go() {
  const r = state.route;
  if (!r) throw new Error("quote first");

  const destAddr = $("solana").value.trim();
  const userAddresses = (r.requiredChainAddresses || []).map((chainId) => {
    const address = chainId === state.dest.chainId ? destAddr : state.keys[chainId];
    if (!address) throw new Error(`no address for required chain ${chainId} — enable it in Keplr`);
    return { chainId, address };
  });
  log(`supplying ${userAddresses.length} addresses; only Cosmos ones will be asked to sign`);

  const getCosmosSigner = async (chainId) => {
    const key = await window.keplr.getKey(chainId);
    log(`↳ Keplr signature requested on ${chainId}`, "sig");
    return key.isNanoLedger
      ? window.keplr.getOfflineSignerOnlyAmino(chainId)
      : window.keplr.getOfflineSigner(chainId);
  };

  const t0 = Date.now();
  let signatures = 0;

  await executeRoute({
    route: r,
    userAddresses,
    getCosmosSigner,
    onTransactionSigned: async ({ chainId }) => {
      signatures += 1;
      log(`signed #${signatures} on ${chainId}`, "sig");
    },
    onTransactionBroadcast: async ({ txHash, chainId }) => {
      log(`broadcast ${chainId} ${txHash}`);
    },
    onTransactionCompleted: async ({ txHash, chainId, status }) => {
      log(`hop done ${chainId} ${txHash} — ${status?.state || "?"}`, "ok");
    },
    onTransactionTracked: async ({ txHash, chainId }) => {
      const s = await transactionStatus({ txHash, chainId });
      log(`tracking ${chainId}: ${s.state}`);
    },
  });

  const secs = Math.round((Date.now() - t0) / 1000);
  log(`ARRIVED. ${signatures} Keplr signatures, ${secs}s wall clock.`, "ok");
  log("Now re-check the destination — if it had no USDC account before and does now, R1 is solved for free.", "ok");
}

/* --------------------------------------------------------------------- ui */

const guard = (fn) => async () => {
  try { await fn(); } catch (e) { log(`✗ ${e.message}`, "err"); console.error(e); }
};

$("connect").addEventListener("click", guard(async () => {
  await connect();
  await loadBalances();
  $("quote").disabled = false;
}));
$("quote").addEventListener("click", guard(quote));
$("go").addEventListener("click", guard(go));
$("recheck").addEventListener("click", guard(async () => {
  const a = $("solana").value.trim();
  if (a) await checkTokenAccount(a);
}));

log("ready — keyless Skip, mainnet. Use an amount you are willing to lose.");
