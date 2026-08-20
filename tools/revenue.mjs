/* Revenue and completed-volume report.
 *
 *   npm run revenue
 *
 * Answers the one question browser analytics cannot: how much actually moved,
 * and how many transfers actually finished.
 *
 * Analytics cannot answer it because a completion event only fires while the
 * tab is open. Someone who reserves a deposit address, sends from their phone
 * and shuts the laptop stays "reserved" forever. The money trail has no such
 * gap: a fee exists only if a transfer completed, it is recorded on a chain,
 * and it is still there tomorrow.
 *
 * Two rails, two places to look:
 *
 *   Cosmos - Skip pays the affiliate cut to an Osmosis address, one payment
 *            per fee-bearing leg. Countable and timestamped.
 *   NEAR   - 1Click credits appFees as an *intents balance* inside the
 *            intents.near contract, not as a token in the wallet. A NEAR
 *            wallet will show the settlement as an "App Interaction" calling
 *            execute_intents and show no balance change, because the balance
 *            is held by the contract on our behalf. This is the single most
 *            confusing thing about the NEAR side and it is not a bug.
 *
 * No keys, no backend, nothing to keep running.
 */

const OSMO_FEE_ADDRESS = "osmo18cz2h9dtuekk6kupzc40mngth0chy8qc29ymug";
const NEAR_FEE_ACCOUNT = "welcometosolana.near";

const OSMO_LCD = "https://osmosis-api.polkachu.com";
const NEAR_RPC = "https://rpc.mainnet.near.org";
/* Prices and decimals come from the same token list the site quotes against,
   so a fee credited in any asset can be valued without a second source. */
const ONECLICK_TOKENS = "https://1click.chaindefuser.com/v0/tokens";

/* What the user is charged. */
const FEE_BPS = 50;

/* What actually reaches us, which is not the same thing and is the reason
   early volume estimates read half what they should have.
 *
 *   NEAR  - confirmed from a live quote: we submit appFees 50 and 1Click
 *           rewrites it to 25 for us and 25 for itself. Exactly half.
 *   Cosmos- Skip keeps 25% without an API key (20% with one), so 37.5 of 50.
 *
 * Checked against reality on 2026-08-20: two NEAR transfers delivered
 * 4.441249 USDC and credited 0.0112 in fees. 25 bps of 4.48 is 0.0112. */
const NET_BPS = { cosmos: 37.5, near: 25 };

const usdc = (base) => Number(base) / 1e6;
const money = (n) => "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const impliedVolume = (feeUsd, rail) => feeUsd / (NET_BPS[rail] / 10000);

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

async function nearView(method, args) {
  const res = await fetch(NEAR_RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0", id: 1, method: "query",
      params: {
        request_type: "call_function", finality: "final",
        account_id: "intents.near", method_name: method,
        args_base64: Buffer.from(JSON.stringify(args)).toString("base64"),
      },
    }),
  });
  const j = await res.json();
  if (!j.result) throw new Error(JSON.stringify(j.error).slice(0, 200));
  return JSON.parse(Buffer.from(j.result.result).toString());
}

/* Ask the contract what it holds rather than checking a list of guesses. An
   earlier version hardcoded five likely tokens and reported half the balance,
   because one fee had been credited in native ETH which was not on the list.
   It looked like a complete answer, which is the dangerous kind of wrong. */
async function nearFees() {
  const owned = await nearView("mt_tokens_for_owner",
    { account_id: NEAR_FEE_ACCOUNT, from_index: "0", limit: 200 });
  const ids = owned.map((t) => t.token_id);
  if (!ids.length) return [];

  const balances = await nearView("mt_batch_balance_of",
    { account_id: NEAR_FEE_ACCOUNT, token_ids: ids });

  let meta = [];
  try { meta = await (await fetch(ONECLICK_TOKENS)).json(); } catch (e) { /* priced best-effort */ }

  return ids.map((id, i) => {
    const m = meta.find((t) => t.assetId === id);
    const dec = m ? m.decimals : 18;
    const amount = Number(balances[i] || 0) / 10 ** dec;
    return {
      label: m ? m.symbol : id.split(":")[1].slice(0, 16),
      amount,
      usd: m && m.price ? amount * Number(m.price) : null,
    };
  }).filter((t) => t.amount > 0);
}

(async () => {
  console.log("\n  COMPLETED VOLUME AND FEES");
  console.log("  " + "-".repeat(66));

  let cosmosUsd = 0;
  try {
    const p = await cosmosFees();
    cosmosUsd = p.reduce((s, x) => s + usdc(x.amount), 0);
    console.log(`\n  Cosmos   ${OSMO_FEE_ADDRESS.slice(0, 14)}...   (Skip affiliate)`);
    console.log(`    fee payments received : ${p.length}`);
    console.log(`    total fees            : ${cosmosUsd.toFixed(6)} USDC`);
    if (p.length) {
      console.log(`    first / latest        : ${p[p.length - 1].at}  /  ${p[0].at}`);
      console.log(`    fee-bearing volume    : ${money(impliedVolume(cosmosUsd, "cosmos"))}   (at ${NET_BPS.cosmos} bps net)`);
    }
  } catch (e) {
    console.log(`\n  Cosmos   could not read: ${e.message}`);
  }

  let nearUsd = 0;
  try {
    const t = await nearFees();
    console.log(`\n  NEAR     ${NEAR_FEE_ACCOUNT}   (intents balance, NOT a wallet balance)`);
    if (!t.length) {
      console.log("    no fees credited yet");
    } else {
      for (const x of t) {
        console.log(`    ${x.label.padEnd(8)}: ${x.amount.toFixed(8).padStart(15)}` +
          (x.usd == null ? "    (unpriced)" : `    ${money(x.usd)}`));
      }
      nearUsd = t.reduce((s, x) => s + (x.usd || 0), 0);
      console.log(`    total                 : ${money(nearUsd)}`);
      console.log(`    volume delivered      : ${money(impliedVolume(nearUsd, "near"))}   (at ${NET_BPS.near} bps net)`);
    }
  } catch (e) {
    console.log(`\n  NEAR     could not read: ${e.message}`);
  }

  console.log("\n  " + "-".repeat(66));
  console.log(`  total fees earned: ${money(cosmosUsd + nearUsd)}`);
  console.log(`
  Read this alongside the analytics funnel, not instead of it. This is what
  finished; the funnel is who showed up and where they stopped.

  Where to see it by hand:
    Cosmos : mintscan.io/osmosis/address/${OSMO_FEE_ADDRESS}
    NEAR   : a NEAR Intents portfolio for ${NEAR_FEE_ACCOUNT}.
             A normal NEAR wallet shows only "App Interaction - execute_intents"
             with no balance change. The funds are real; the wallet cannot see
             a balance the intents contract holds on your behalf.

  You charge 0.5% and keep half of it. Volume above is derived from what
  reached us, not from what was charged.

  Two things these numbers are not:
    - The Cosmos figure is not everything that moved. The affiliate cut rides
      the Osmosis swap, so a transfer with no swap in it - USDC that is
      already USDC, going to Noble and out - has nothing for a fee to attach
      to. It moves real money and earns nothing.
    - Neither figure is what the user paid to move funds. Network gas and the
      CCTP "smart relay" charge are costs of the route, paid to validators and
      relayers. None of that reaches us.
`);
})();
