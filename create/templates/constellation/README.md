# Zodiac constellation

Your organisation's onchain accounts, roles, and permissions as code.

## What's a Zodiac constellation?

A **constellation** is a declarative description of an organisation's smart account graph: which Safes you operate, what roles each one delegates, who's allowed to do what, and how the pieces are wired together.

You write the desired state in TypeScript. Zodiac figures out the diff against what's currently onchain, plans the most efficient set of transactions, and gives you a UI to review and sign them. Anyone with access to the workspace sees the same plan and the same audit trail.

## Why manage your accounts as code?

Treat your smart account graph the way you treat infrastructure: declare it as code, version it in git, ship it like software. AI-assisted edits, branch + PR review, CI dry runs, and a safe path to onchain via Zodiac's review and signing UI.

## Getting started

This project starts with one example on Ethereum: a new Safe, a Roles mod on it, and a role that may wrap ETH and supply WETH to Aave.

1. `npm install`.
2. `npm run pull`. On first run, this opens a browser to authorize this directory and mint a Zodiac API key, which it writes to `.env`. It then fetches your org's users and accounts and the ABIs of the contracts in `zodiac.config.ts`, and generates types for them. If you don't have a Zodiac account yet, the browser walks you through sign-up first.
   > `.env` is in `.gitignore`. Don't commit your API key.
3. Edit `constellation/index.ts` and the role under `constellation/roles/treasury_ops/` to describe the state you want onchain. Start with the placeholder owner and member addresses.
4. `npm run push`. This sends the constellation to Zodiac and opens a browser tab where you review the diff and sign the transactions.

Day-to-day: edit the constellation, then `npm run push`. To permission another contract, add it to `zodiac.config.ts` under its chain prefix and run `npm run pull-contracts`, so the `allow` kit knows it.

> **VS Code tip:** if `allow.eth.weth.*` (or whatever you just added) doesn't autocomplete after a pull, restart the TypeScript server: `Cmd+Shift+P` → "TypeScript: Restart TS Server".

To check an edit without pushing, `npx zodiac push --dry-run` prints what would be pushed. It needs no API key.

Using pnpm, yarn or Bun? Run the same scripts with `pnpm`, `yarn` or `bun run` in place of `npm run`.

## Project layout

```
.
├── constellation/
│   ├── index.ts            # entrypoint — what gets pushed
│   ├── allowances/         # reusable Roles-allowance objects
│   └── roles/<role>/       # one folder per role
│       ├── index.ts
│       ├── members.ts      # addresses allowed to assume the role
│       └── permissions.ts  # what the role can call
├── zodiac.config.ts        # contracts the `allow` kit should know about
├── abis/                   # contract ABIs, fetched by `npm run pull-contracts`
├── .zodiac/                # generated codegen (git-ignored)
└── .env                    # ZODIAC_API_KEY for this directory (git-ignored)
```

## Defining a constellation

`constellation/index.ts` is what gets pushed to Zodiac. Start by scoping a constellation to a single workspace and chain:

```ts
import { constellation } from "@zodiaceco/sdk";

const eth = constellation({
  workspace: "Default workspace",
  label: "Backend Operator",
  chain: 1, // ethereum
});
```

`npm run pull-org` regenerates type-level info for your workspace, so workspace name, chain id, account labels, role labels, and user handles all autocomplete.

### Existing vs new nodes

Bracket access on `.safe`, `.roles`, and `.user` is your editor for both **existing** accounts (vaults already in your workspace + anything previously pushed via a constellation) and **new** ones you're declaring for the first time.

```ts
// Reference an existing Safe verbatim — no invocation
const treasury = eth.safe["GG Treasury"];

// Tweak an existing Safe — invoke with overrides; all fields are optional
export const tweaked = eth.safe["GG Treasury"]({ threshold: 4 });

// Declare a new Safe — required fields are enforced at compile time
export const backendSafe = eth.safe["Backend Safe"]({
  nonce: 0n,
  threshold: 2,
  owners: ["0xcAF075b4102d96CdF9Bc5A2cEDb170a8b69697E8", eth.user["alice"]],
  modules: [eth.roles["Backend Operator"]],
});
```

For Safes the required fields are `nonce`, `threshold`, `owners`. For Roles mods, `nonce` (plus `owner`, `target`, `avatar` if you want anything other than the wired-up defaults). The SDK injects no runtime defaults — missing required fields surface as TypeScript errors.

#### Binding to an existing Roles mod by address

Bracket access only knows about accounts in your workspace codegen. To configure a Roles mod that's already deployed on-chain but **not** in your workspace, bind it by `address` instead of declaring a `nonce`. Zodiac diffs your spec against the live mod and updates only what changed:

```ts
const arb = constellation({
  workspace: "Default workspace",
  label: "Backend Operator",
  chain: 42161, // arbitrum
});

export const ops = arb.roles["Existing roles mod"]({
  address: "0x88A51CcB262d04B334065Ad425928dF79c4CB7d7",
  roles: { backend_operator },
});
```

A roles node therefore takes **either** `nonce` (deploy a new mod) **or** `address` (bind an existing one) — never both.

### Forward references between new nodes

New nodes can reference each other before either has been invoked — the uninvoked factory works as a forward reference. Both sides just need to be exported so `push()` resolves them by name:

```ts
export const backendSafe = eth.safe["Backend Safe"]({
  nonce: 0n,
  threshold: 2,
  owners: ["0x1234567890123456789012345678901234567890"],
  modules: [eth.roles["Backend Operator"]], // forward ref — not invoked yet
});

export const backendRoles = eth.roles["Backend Operator"]({
  nonce: 0n,
  target: backendSafe,
  owner: backendSafe,
  avatar: backendSafe,
  roles: { backend_operator },
  allowances: { usdc_payouts },
});
```

### Users

`eth.user["Alice Example"]` resolves to the user's personal Safe address on the constellation's chain. Useful in owner lists and role-member arrays without hardcoding addresses.

### Pushing

Only the values you `export` end up in the constellation.

`npm run push` runs `pull` first, walks your exports, sends the spec to Zodiac, and opens your browser to review the diff and sign the transactions.

### Roles and permissions

Each role lives in its own folder under `constellation/roles/`:

```
constellation/roles/backend_operator/
├── index.ts          # combines members + permissions
├── members.ts        # who can act as this role
└── permissions.ts    # what the role can call
```

Members are an array of addresses, user accessors, or node references — anything that resolves to an address is accepted:

```ts
import type { Members } from "@zodiaceco/sdk";

export default [
  "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
  eth.user["alice"],
  eth.safe["Trading Bot"],
] satisfies Members;
```

A role's `permissions` is a list of **entries**. Each entry is one thing the role may do, and each carries a `label` that names it as a single card in the Zodiac UI — labels never reach the chain.

```ts
import { allow, type Permissions } from "@zodiaceco/sdk";
import { custom, defikit, swap, transfer } from "@zodiaceco/sdk/actions";

export default [
  // A labelled bag of `allow`-kit permissions, for anything the
  // other entries don't cover.
  custom({
    label: "Wrap and unwrap ETH",
    permissions: [
      allow.eth.weth.deposit({ send: true }),
      allow.eth.weth.withdraw(),
    ],
  }),

  // A DeFi Kit preset, by protocol and verb.
  defikit.aave_v3.deposit({
    label: "Supply WETH to Aave v3",
    market: "Core",
    targets: ["WETH"],
  }),

  // Sign CoW orders selling any of `sell` for any of `buy`.
  swap({
    label: "Rebalance stables",
    sell: [USDC, DAI],
    buy: [USDC, DAI],
  }),

  // Send tokens to fixed recipients, optionally bridged over Across.
  transfer({
    label: "Payouts",
    tokens: [USDC],
    to: [eth.safe["Payouts"]],
    allowance: usdc_payouts,
  }),
] satisfies Permissions;
```

A bare `allow`-kit permission is still a valid entry — it just shows up unlabelled:

```ts
export default [allow.eth.weth.withdraw()] satisfies Permissions;
```

**Entries describe, they never compile.** A `defikit` entry stores its protocol, verb and parameters; a `swap` stores its token lists. The permissions are built when the constellation is deployed, so a stored revision always compiles through the current compilers instead of replaying a copy made when it was pushed. A compiled `PermissionSet` — what calling `defi-kit` directly returns — is therefore not an entry; reach for `defikit` instead.

#### Allowances

An allowance is a refilling budget the Roles modifier tracks on-chain. Define it once under `constellation/allowances/`, hand it to the roles node, and reference it from any permission that should draw on it:

```ts
// constellation/allowances/index.ts
export const usdc_payouts = {
  key: "usdc_payouts",
  refill: 10_000n * 10n ** 6n, // added each period
  maxRefill: 10_000n * 10n ** 6n, // cap the balance refills to
  period: 60n * 60n * 24n, // seconds
  balance: 10_000n * 10n ** 6n, // starting balance
  timestamp: 0n,
};
```

```ts
// constellation/roles/<role>/permissions.ts
import { allow, c } from "@zodiaceco/sdk";

allow.eth.usdc.transfer(undefined, c.withinAllowance("usdc_payouts"));
```

A `key` is at most 31 bytes.

#### Adding contracts

The `allow` kit only knows about contracts listed in `zodiac.config.ts`. Add the address under the right chain prefix (see [Getting started](#getting-started) for an example), then run `npm run pull-contracts`. If a contract isn't verified on the explorer, the CLI prints the path where you should drop the ABI JSON by hand and re-run.

#### Overloaded functions

The `allow` kit names each member after its ABI function, so a contract that
overloads a name — say sUSDS, with both `deposit(uint256,address)` and
`deposit(uint256,address,uint16)` — has no single member that could mean either.
Address the one you want by its full signature:

```ts
allow.eth.susds["deposit(uint256,address)"](
  c.withinAllowance("sky_savings"),
  c.avatar,
);
```

### Showing Safes and roles in the Zodiac app

A constellation deploys everything it describes, but the Zodiac app only lists what you mark for the rest of your org.

**Vaults.** Add `vault: true` to a Safe to list it under **Vaults**. It's named by its label, the key in `eth.safe["Treasury"]`:

```ts
export const treasury = eth.safe["Treasury"]({
  nonce: 0n,
  threshold: 1,
  owners: ["0x…"],
  modules: [eth.roles["Treasury Roles"]],
  vault: true,
});
```

**Policies.** Export `policy` from a role's folder to list the role under **Policies**, so everyone in your org can see what it permits. The value is the policy's name; a `description` is optional:

```ts
// constellation/roles/treasury_ops/index.ts
export { default as members } from "./members";
export { default as permissions } from "./permissions";
export const policy = "Treasury Ops";
export const description = "Day-to-day treasury operations";
```

Neither reaches the chain. The policy's identity is the role key (`treasury_ops`), not its name, so renaming it changes nothing onchain. Every Roles mod that has a role with the same key carries the same policy: each of them has to give it the same name, description, members and permissions, and no two of them may act for the same Safe.

## Commands

| Command                  | What it does                                                                                                                    |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| `npm run pull`           | Refresh codegen: org data and contract ABIs. On first run, also authorizes this directory (mints an API key, writes `.env`).    |
| `npm run pull-org`       | Just the org data (users, accounts)                                                                                             |
| `npm run pull-contracts` | Just the contract ABIs and `allow` kit types. Run this after you add a contract to `zodiac.config.ts`.                          |
| `npm run push`           | Send the constellation to Zodiac and open the review URL. Runs `pull` first, so you push against fresh org state and contracts. |
| `npm run format`         | Prettier across the project                                                                                                     |
