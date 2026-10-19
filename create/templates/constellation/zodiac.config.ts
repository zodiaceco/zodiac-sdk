import { defineConfig } from "@zodiaceco/sdk/cli/config";

// The contracts the `allow` kit knows, by chain prefix. After changing them,
// run `npm run pull-contracts` to fetch their ABIs into `abis/`.
export default defineConfig({
  contracts: {
    eth: {
      weth: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
    },
  },
});
