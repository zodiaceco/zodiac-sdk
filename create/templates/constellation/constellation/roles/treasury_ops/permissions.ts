import { allow, type Permissions } from "@zodiaceco/sdk";
import { custom, defikit } from "@zodiaceco/sdk/actions";

// Each entry is one thing the role may do. Its label names it in the Zodiac
// app and never reaches the chain.
export default [
  // `allow` kit permissions for the contracts in zodiac.config.ts.
  custom({
    label: "Wrap and unwrap ETH",
    permissions: [
      allow.eth.weth.deposit({ send: true }),
      allow.eth.weth.withdraw(),
    ],
  }),

  // A DeFi Kit preset, compiled when the constellation is deployed.
  defikit.aave_v3.deposit({
    label: "Supply WETH to Aave v3",
    market: "Core",
    targets: ["WETH"],
  }),
] satisfies Permissions;
