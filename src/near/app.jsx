import React from "react";
import { createRoot } from "react-dom/client";
import {
  Widget,
  WidgetConfigProvider,
} from "@aurora-is-near/intents-swap-widget-standalone";
import "@aurora-is-near/intents-swap-widget/styles.css";

/* Fees. FEE_RECIPIENT accrues our cut inside NEAR Intents and can be any
   NEAR-supported address: a named account (you.near), an implicit account,
   or an EVM address you already control. Leave it empty and no appFees are
   sent at all, which is the state this widget shipped in.

   FEE_BPS is the gross rate. 1Click splits it 50/50 by default, so 50 bps
   charged means 25 bps reaches us. */
const FEE_RECIPIENT = "welcometosolana.near";
const FEE_BPS = 50;

const API_KEY = "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCIsImtpZCI6IjIwMjUtMDEtMTItdjEifQ.eyJ2IjoxLCJrZXlfdHlwZSI6ImRpc3RyaWJ1dGlvbl9jaGFubmVsIiwicGFydG5lcl9pZCI6ImF0aCIsImlhdCI6MTc4NjcxMDcxNywiZXhwIjoxODE4MjQ2NzE3fQ.kMYnCsH_30wbny2MOSGwnFfkf4BcX7UA3S5d7LHIakl0_DTEW_12YSSjQZRQQaVfVOpUc8f_J7B_hVowa55CKcdNibWAbp16CRcyi5qxnctWOfo9ypeJnHOpgVtToLgg_PdNfOolzwxymfFO30hy7LgYy_bj57ZvSPbtHT7YUdK1nyXgj7tDvCBeKf1u5nzdpu1CBjGOceiJmDXat1oTYH9f12X8Fkbm8-lGJTgDWi00Bz-LOnH0RRm4WxxAmITk0LhOf3rq1Wk_yjlxCodFEy1ndVxfH_W37NJrhfS95nSEv1YVCYsOUn2X4BaJPyCNCtN7PmGPJ0-636JwuN6_-g";

const supportedChains = [
  "near",
  "eth",
  "sol",
  "base",
  "btc",
  "gnosis",
  "xrp",
  "bera",
  "tron",
  "zec",
  "doge",
  "arb",
  "ton",
  "op",
  "avax",
  "pol",
  "bsc",
  "sui",
  "cardano",
  "ltc",
  "stellar",
  "monad",
  "adi",
  "aleo",
  "bch",
  "dash",
  "plasma",
  "scroll",
  "starknet",
  "xlayer",
  "aurora",
  "hypercore",
];

function NearIntentsWidget() {
  return (
    <WidgetConfigProvider
      config={{
        apiKey: API_KEY,
        ...(FEE_RECIPIENT
          ? { appFees: [{ recipient: FEE_RECIPIENT, fee: FEE_BPS }] }
          : {}),
        connectedWallets: {},
        slippageTolerance: 100,
        confidentialMode: "user-choice",
        enableAccountAbstraction: false,
        enableAutoTokensSwitching: true,
        chainsOrder: supportedChains,
        allowedChainsList: supportedChains,
        allowedTargetChainsList: ["sol"],
        defaultSourceToken: { symbol: "ETH", blockchain: "near" },
        defaultTargetToken: { symbol: "SOL", blockchain: "sol" },
        lockSwapDirection: true,
        showTransactionHistory: true,
        showConversionPreview: true,
        extraQuoteParameters: {},
      }}
      theme={{
        accentColor: "#ffffff",
        successColor: "#98FFB5",
        warningColor: "#FADFAD",
        errorColor: "#FFB8BE",
        colorScheme: "dark",
        borderRadius: "md",
        stylePreset: "clean",
        backgroundColor: "#24262D",
      }}
    >
      <Widget />
    </WidgetConfigProvider>
  );
}

createRoot(document.getElementById("near-intents-root")).render(
  <React.StrictMode>
    <NearIntentsWidget />
  </React.StrictMode>,
);
