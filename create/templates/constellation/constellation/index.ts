import { constellation } from "@zodiaceco/sdk";
import { treasury_ops } from "./roles";

const eth = constellation({
  workspace: "Default workspace",
  label: "Treasury",
  chain: 1, // Ethereum
});

// A new Safe: replace the owner with your signers, then push.
export const treasury = eth.safe["Treasury"]({
  nonce: 0n,
  threshold: 1,
  owners: ["0x0000000000000000000000000000000000000001"],
  modules: [eth.roles["Treasury Roles"]],
});

// A Roles mod on the Safe, holding the roles under `./roles`.
export const treasuryRoles = eth.roles["Treasury Roles"]({
  nonce: 0n,
  target: treasury,
  owner: treasury,
  avatar: treasury,
  roles: { treasury_ops },
});
