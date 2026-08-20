/* Revenue and completed-volume report.
 *
 *   npm run revenue
 *
 * Answers the one question analytics cannot: how much actually moved, and how
 * many transfers actually finished.
 *
 * Browser analytics cannot answer it because a completion event only fires
 * while the tab is open. Someone who reserves a deposit address, sends from
 * their phone and shuts the laptop is counted as "reserved" forever. The money
 * trail has no such gap: a fee exists only if a transfer completed, it is
 * recorded on a chain, and it is still there tomorrow.
 *
 * Two rails, two places to look:
 *   Cosmos  - Skip pays the affiliate cut to an Osmosis address, one payment
 *             per fee-bearing leg. Countable and timestamped.
 *   NEAR    - 1Click credits appFees as an *intents balance* inside the
 *             intents.near contract, not as a wallet token balance. It will
 *             not appear in a NEAR wallet's asset list.
 *
 * No keys, no backend, nothing to keep running.
 */

const OSMO_FEE_ADDRESS = "osmo18cz2h9dtuekk6kupzc40mngth0chy8qc29ymug";
const NEAR_FEE_ACCOUNT = "welcometosolana.near";

const OSMO_LCD = "https://osmosis-api.polkachu.com";
const NEAR_RPC = "https://rpc.mainnet.near.org";

/* Gross rate charged to the user. Both rails share it so the two halves of the
   report are comparable. */
const FEE_BPS = 50;
/* Neither rail pays us the whole fee: Skip keeps 20-25%, 1Click splits 50/50.
   Implied volume is therefore a range, not a number, and is printed as one. */
const OUR_SHARE = { cosmos: 0.8, near: 0.5 };

const usdc = (base) => Number(base) / 1e6;
const money = (n) => "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/* Tokens 1Click can credit a fee in. Balances are keyed by token, so a fee
   taken on a USDC route lands in the USDC entry. */
const NEAR_FEE_TOKENS = {
  "nep141:eth-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.omft.near": ["USDC (Ethereum)", 6],
  "nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near": ["USDC (Solana)", 6],
  "nep141:eth-0xdac17f958d2ee523a2206206994597c13d831ec7.omft.near": ["USDT (Ethereum)", 6],
  "nep141:sol-c800a4bd850783ccb82c2b2c7e84175443606352.omft.near": ["USDT (Solana)", 6],
  "nep141:wrap.near": ["wNEAR", 24],
};

async function cosmosFees() {
  const q = encodeURIComponent(`transfer.recipient='${OSMO_FEE_ADDRESS}'`);
  const res = await fetch(`${OSMO_LCD}/cosmos/tx/v1beta1/txs?query=${q}&limit=100&order_by=ORDER_BY_DESC`);
  if (!res.ok) throw new Error(`Osmosis LCD ${res.status}`);
  const body = await res.json();

  const payments = [];
  for (const tx of body.tx_responses || []) {
    for (const ev of tx.events || []) {
      if (ev.type !== "transfer") continue;
      const at = Object.fromEntries(ev.attributes.map((a) => [a.key, a.value]));
      if (at.recipient !== OSMO_FEE_ADDRESS) continue;
      const m = String(at.amount || "").match(/^(\d+)(.+)$/);
      if (m) payments.push({ at: tx.timestamp, amount: Number(m[1]), hash: tx.txhash });
    }
  }
  return payments;
}

async function nearFees() {
  const ids = Object.keys(NEAR_FEE_TOKENS);
  const args = Buffer.from(JSON.stringify({ account_id: NEAR_FEE_ACCOUNT, token_ids: ids })).toString("base64");
  const res = await fetch(NEAR_RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0", id: 1, method: "query",
      params: {
        request_type: "call_function", finality: "final",
        account_id: "intents.near", method_name: "mt_batch_balance_of", args_base64: args,
      },
    }),
  });
  const j = await res.json();
  if (!j.result) throw new Error(JSON.stringify(j.error).slice(0, 200));
  const out = JSON.parse(Buffer.from(j.result.result).toString());
  return ids.map((id, i) => {
    const [label, dec] = NEAR_FEE_TOKENS[id];
    return { label, amount: Number(out[i] || 0), value: Number(out[i] || 0) / 10 ** dec };
  }).filter((t) => t.amount > 0);
}

const impliedVolume = (feeUsd, share) => {
  const rate = FEE_BPS / 10000;
  return { low: feeUsd / rate, high: feeUsd / share / rate };
};

(async () => {
  console.log("\n  COMPLETED VOLUME AND FEES");
  console.log("  " + "-".repeat(64));

  let cosmosUsd = 0, cosmosCount = 0;
  try {
    const p = await cosmosFees();
    cosmosCount = p.length;
    cosmosUsd = p.reduce((s, x) => s + usdc(x.amount), 0);
    console.log(`\n  Cosmos  ${OSMO_FEE_ADDRESS.slice(0, 12)}...`);
    console.log(`    fee payments received : ${cosmosCount}`);
    console.log(`    total fees            : ${cosmosUsd.toFixed(6)} USDC`);
    if (p.length) {
      console.log(`    first / latest        : ${p[p.length - 1].at}  /  ${p[0].at}`);
      const v = impliedVolume(cosmosUsd, OUR_SHARE.cosmos);
      console.log(`    implied volume        : ${money(v.low)} - ${money(v.high)}`);
    }
  } catch (e) {
    console.log(`\n  Cosmos  could not read: ${e.message}`);
  }

  let nearUsd = 0;
  try {
    const t = await nearFees();
    console.log(`\n  NEAR    ${NEAR_FEE_ACCOUNT}  (intents balance, not a wallet balance)`);
    if (!t.length) {
      console.log("    no fees credited yet");
    } else {
      for (const x of t) console.log(`    ${x.label.padEnd(22)}: ${x.value.toFixed(6)}`);
      nearUsd = t.filter((x) => /USDC|USDT/.test(x.label)).reduce((s, x) => s + x.value, 0);
      const v = impliedVolume(nearUsd, OUR_SHARE.near);
      console.log(`    implied volume        : ${money(v.low)} - ${money(v.high)}`);
    }
  } catch (e) {
    console.log(`\n  NEAR    could not read: ${e.message}`);
  }

  console.log("\n  " + "-".repeat(64));
  console.log(`  total fees earned: ${money(cosmosUsd + nearUsd)}`);
  console.log(`
  Read this alongside the analytics funnel, not instead of it. This is what
  finished; Umami is who showed up and where they stopped. Neither answers
  the other.

  A caveat specific to Cosmos: the affiliate fee rides the Osmosis swap. A
  transfer with no swap in it - USDC that is already USDC, moving to Noble
  and out - has nothing for a fee to attach to. Volume implied from fees
  therefore *understates* what actually moved, and understates it badly for
  stablecoin holders.
`);
})();
