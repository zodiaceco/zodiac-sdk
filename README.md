# Zodiac SDK

Programmatically manage [Zodiac](https://www.zodiac.eco) account constellations.

## Start a new project

```bash
npm create @zodiaceco@latest my-org
```

This sets up a constellation project in `my-org` from the [template](./create/templates/constellation): an example on Ethereum to start from, its dependencies installed, and, if you like, connected to your Zodiac org. `pnpm dlx @zodiaceco/create`, `bunx @zodiaceco/create` and `zodiac create` work the same. See [`@zodiaceco/create`](./create) for its options.

To add the SDK to a project you already have, read on.

## Getting started

### 1. Install

```bash
npm install @zodiaceco/sdk
```

### 2. Authorize project

```bash
zodiac init
```

Opens a browser tab so you can sign in, pick the org you want to use, and approve a new API key. The key (and matching `ZODIAC_API_URL`) are written to a `.env` file in your project root — labeled after the directory so you can find and revoke it later from [app.zodiac.eco/admin/api-keys](https://app.zodiac.eco/admin/api-keys).

**IMPORTANT:** Make sure to add `.env` to your `.gitignore`.

### 3. Adjust the config file

`zodiac init` writes a starter `zodiac.config.ts` to your project root if you
don't already have one. Fill in the contracts you want typed access to.

```ts
import { defineConfig } from '@zodiaceco/sdk/cli/config'

export default defineConfig({
  contracts: {
    eth: {
      dai: '0x6B175474E89094C44Da98b954EedeAC495271d0F',
    },
  },
})
```

### 4. Pull your org data

```bash
# Pull everything (org data + contract ABIs)
zodiac pull
```

This generates typed data in `.zodiac/` at your project root with your org's users and accounts (workspace vaults plus accounts that have been applied via a constellation). Add `.zodiac/` to your `.gitignore`.

## Lifecycle

State lives in three places — your code, the Zodiac OS database, and chain — and each command moves it in one direction:

```
your code  ──push──▶  Zodiac OS (revisions)  ──deploy (in the app)──▶  chain
your code  ◀──pull──  Zodiac OS  ◀──────────────indexing────────────  chain
```

**`pull` reads, never writes.** It fetches your org's users and every account that exists on chain, and generates `.zodiac/`. A referenced node comes filled with its live on-chain state (owners, threshold, roles) so it reads well in the editor — that state is for reading, not something your code has declared.

**`push` writes to the database, never to chain.** It stores your nodes as the constellation's next _revision_ and answers with a link to review it in the app. Re-pushing before a deployment replaces the pending revision rather than stacking new ones. Only what your code explicitly declares is stored: a bare reference like `eth.safe['Treasury']` travels as identity only, so an owner added through the app since your last pull is not silently reverted — while `eth.safe['Treasury']({ threshold: 3 })` declares exactly that field. Within a roles mod, unmentioned roles and allowances stay untouched; passing `null` for a key clears it.

**Deploying happens in the app.** The review page diffs the revision against on-chain state and derives addresses for new nodes from the personal Safe of whoever triggers the deployment — so until a deployment settles them, two people looking at the same constellation see different addresses for new nodes. Deploying registers the accounts in Zodiac OS and executes the transactions. A constellation moves Draft → Pending → Deployed, and the next push starts a new revision back at Draft.

**Then pull again.** Once the new accounts have been seen on chain, the next `pull` includes them, keyed by label per chain — from that point on, reference them (`eth.safe['New Safe']`) instead of re-declaring them with a `nonce`. A project's `push` script runs `zodiac pull` first (`zodiac pull && zodiac push`), so this mostly takes care of itself. The case to avoid is pushing from a stale checkout where an already-deployed node is still declared by `nonce`: the original deployer would re-derive the same address, but anyone else deploying that revision would create a duplicate account.

## Constellation API

The `constellation()` function is the main SDK entry point. It returns an API for declaring account constellations — the set of Safes, Roles mods, Delay mods, and users that make up your on-chain setup.

```ts
import { constellation } from '@zodiaceco/sdk'
```

### Scoping to a workspace and chain

Each constellation is scoped to a single workspace and chain. The `workspace` option must be a valid workspace name from your org.

```ts
const eth = constellation({
  workspace: 'GG',
  label: 'Production',
  chain: 1,
})
```

### Referencing existing accounts

Bracket access gives you existing Safes, Roles mods and Delay mods from the selected workspace and chain — both **vault accounts** (manually-promoted entries surfaced in the workspace UI) and any **constellation accounts** previously created by a `push()`. The codegen records them under the same `accounts` map, marked with a `vault` flag for the subset that are also workspace vaults. Names auto-complete from the codegen output.

A label only ever names an account on the constellation's own chain. The same name on another chain is a different account whose address means nothing here, so it reads as a new node rather than as a reference — two workspaces can both have a `Treasury` on mainnet and on Gnosis without either having to be addressed by address.

```ts
// Reference an existing Safe — no invocation needed
const ggDao = eth.safe['GG DAO']

// Reference an existing Roles mod
const ggDaoRoles = eth.roles['GG DAO Roles']

// Reference an existing Delay mod
const ggDaoDelay = eth.delay['GG DAO Timelock']

// Optionally invoke with overrides
const ggDaoOverridden = eth.safe['GG DAO']({ threshold: 5 })
```

> A project's `push` script runs `zodiac pull` first, so re-pushing always sees the freshest existing-account values from your org.

### Creating new accounts

Use bracket access with a new label to create new nodes. Every mandatory field (`nonce`, `threshold`, `owners` for Safes; `nonce` for Roles mods; `nonce`, `cooldown`, `expiration` for Delay mods) must be supplied explicitly — the SDK does not inject any runtime defaults. The type system surfaces a missing field as a compile-time error so you can't ship an incomplete spec.

```ts
// New Safe — nonce, threshold, owners are required
const newSafe = eth.safe['New Safe']({
  nonce: 0n,
  threshold: 2,
  owners: [
    eth.user['Alice Sample'],
    '0xb8e48df6818d3cbc648b3e8ec248a4f547135f7a',
  ],
  modules: [ggDaoRoles],
})

// New Roles mod targeting an existing Safe
const newRoles = eth.roles['New Roles']({
  nonce: 0n,
  target: ggDao,
})

// New Delay mod targeting an existing Safe
const newDelay = eth.delay['New Timelock']({
  nonce: 0n,
  target: ggDao,
  cooldown: 86400n, // a day before a queued transaction may execute
  expiration: 604800n, // a week to execute it in, `0n` to never expire
})
```

### Delay mods

A Delay mod holds every transaction sent through it for `cooldown` seconds before it can be executed, and drops it again after `expiration` seconds have passed (`0n` means it never expires). Both are declared in seconds.

The accounts allowed to queue a transaction through the delay are its `modules` — a complete array replaces the enabled set:

```ts
const timelock = eth.delay['Treasury Timelock']({
  nonce: 0n,
  target: ggDao,
  cooldown: 172800n,
  expiration: 0n,
  modules: [ggDaoRoles],
})

// The safe executes what has been through the delay
const treasury = eth.safe['Treasury']({ modules: [timelock] })
```

To reconfigure a Delay mod that is already on chain but not in your workspace, bind it by `address` instead of declaring a `nonce` — the same either/or that applies to Roles mods:

```ts
const existing = eth.delay['Existing timelock']({
  address: '0x88A51CcB262d04B334065Ad425928dF79c4CB7d7',
  cooldown: 3600n,
})
```

When a bracket label matches an existing account from your codegen, all overrides become optional — you pass only the fields you want to change against the live configuration.

### Circular references between new nodes

New nodes can reference each other before either has been invoked — use the uninvoked factory as a forward reference:

```ts
const safe = eth.safe['New Safe']({
  nonce: 0n,
  threshold: 1,
  owners: [eth.user['Alice Sample']],
  // Forward reference to a Roles mod that doesn't exist yet
  modules: [eth.roles['New Roles']],
})

const roles = eth.roles['New Roles']({
  nonce: 0n,
  target: safe,
})
```

References are resolved by label at `push()` time, so both sides of the cycle must be included in the call.

### Referencing users

`eth.user[handle]` resolves a user to their personal Safe address on the current chain:

```ts
const aliceAddress = eth.user['Alice Sample']
```

### The `allow` kit

`allow` holds a permission builder for every contract in `zodiac.config.ts`,
by chain prefix and the name you gave it, typed after each contract's ABI:

```ts
import { allow, c } from '@zodiaceco/sdk'

allow.eth.weth.deposit({ send: true })
allow.eth.weth.withdraw(c.lte(10n ** 18n))
```

`zodiac pull-contracts` fetches the ABIs and records what the kit is built
from in `.zodiac/`, so re-run it after changing the contracts. The kit is
built on first use for the project the working directory is in.

### Describing what a role may do

A Roles mod carries roles, and every role lists `permissions` — entries that
describe what the role is allowed to do. Entries carry parameters and a label,
never compiled permissions: they are compiled when the constellation is
deployed, so a stored revision always goes through the current compilers
instead of replaying a copy made when it was pushed.

```ts
import { allow } from '@zodiaceco/sdk'
import { swap, transfer, custom, defikit } from '@zodiaceco/sdk/actions'

const treasuryRoles = eth.roles['GG Treasury Roles']({
  nonce: 0n,
  target: ggTreasury,
  allowances: { usdc_payouts },
  roles: {
    treasury_ops: {
      members: [eth.user['Alice Sample']],
      permissions: [
        swap({ label: 'Rebalance stables', sell: [USDC, DAI], buy: [WETH] }),

        transfer({
          label: 'Grant payouts',
          tokens: [USDC],
          to: [eth.safe['Grants Safe']],
          bridge: [{ to: [gno.safe['Ops Safe']], receive: [GNO_USDC] }],
          allowance: usdc_payouts,
        }),

        defikit.aave_v3.deposit({
          label: 'Aave deposits',
          market: 'Core',
          targets: ['WETH'],
        }),

        custom({
          label: 'Bot ops',
          permissions: [
            allow.eth.weth.deposit({ send: true }),
            allow.eth.weth.withdraw(),
          ],
        }),
      ],
    },
  },
})
```

Each helper covers a different kind of action:

- `swap()` allows signing CoW orders between the tokens it names, optionally
  capped by allowances declared on the same Roles mod: `sellAllowance` caps
  what may be sold across every token in `sell`, `buyAllowance` what may be
  bought across every token in `buy`. Either one can be set on its own.
- `transfer()` allows sending tokens to the addresses it names, optionally
  capped by an allowance declared on the same Roles mod. Pass the zero address
  to allow sending the native token. `bridge` names destinations on other
  chains, sent over Across: each target pins both the recipients and the tokens
  they may receive there. A target takes its chain from its recipient nodes, or
  name one with `chain` when the recipients are plain addresses. Tokens without
  an Across route to a target are skipped, the same way the app skips them —
  routes change between writing a spec and deploying it — but a target nothing
  can reach at all is refused at deploy rather than deployed half-working. A
  transfer bridges to each chain once: every recipient of a target may receive
  every token it names, so recipients that receive other tokens on the same
  chain get a transfer of their own. `transfer()` throws on a second target for
  a chain, and on `to` recipients that live on different chains; `push()`
  throws on `to` recipients off the role's chain, and on a bridge to it.
- `defikit` mirrors the DeFi Kit allow kit — same protocols, verbs and
  parameters, plus a `label`. A DeFi Kit entry is nothing but its annotation;
  the permissions behind it are fetched from the annotation's uri at deploy, so
  `push()` fetches nothing. Protocols and parameters are typed against the
  Ethereum kit, the widest of the chains DeFi Kit serves.
- `custom()` labels a bag of plain `allow`-kit permissions — everything the
  other helpers don't cover. It takes permissions, not other actions.

Every helper takes a `label`. The label names the action in Zodiac and never
reaches the chain. A bare permission with no enclosing helper stays valid, but
it has nowhere to appear in the app beyond the targets it allows.

Allowance keys are plain labels — `key: 'usdc_payouts'` on the declaration, and
`allowance: usdc_payouts` on the transfer, which reads the key off it. They are
encoded to bytes32 when the constellation is deployed, so nothing calls
`encodeKey` by hand. The same holds where an `allow`-kit permission draws on an
allowance: `c.withinAllowance('usdc_payouts')` on a parameter, or
`{ send: true, etherWithinAllowance: 'eth_budget' }` and
`{ callWithinAllowance: 'daily_calls' }` in its options. Allowance and role
keys consist of 1 to 31 letters, digits, underscores or hyphens.

Tokens are named by address, not by symbol. A `transfer()` recipient may also
be a node — an account from your codegen, or one bound by address — which
stands for the address it lives at. A node whose address is only known once the
constellation is deployed is rejected at compile time.

### Showing accounts and roles in the Zodiac app

A constellation deploys whatever it describes, but only what you mark shows up
in the Zodiac app for the rest of your org:

- **`vault: true`** on a Safe lists it under **Vaults**.
- **`policy`** on a role lists it under **Policies**, labelled as given, so
  everyone in your org can see what it permits right in the app. A
  `description` is optional. In a project started with
  `npm create @zodiaceco`, export both from the role's folder:

  ```ts
  // constellation/roles/treasury_ops/index.ts
  export const policy = 'Treasury Ops'
  export const description = 'Day-to-day treasury operations'
  ```

  The role key (`treasury_ops`) is the policy's identity and its on-chain role
  key, so renaming the label changes nothing on chain. Every Roles mod carrying
  the key has to grant it the same way, and no two of them may act for the
  same Safe.

### Pushing the constellation

The `push()` function takes all nodes and sends them to the Zodiac OS API. Pass either a named object (keys become refs) or an array:

```ts
import { push } from '@zodiaceco/sdk'

await push({ ggDao, ggDaoRoles, newSafe, newRoles })
```

All referenced nodes must be included in the `push()` call.

By default, `push()` creates an API client from the `ZODIAC_API_KEY` environment variable. You can pass a custom client:

```ts
await push({ ggDao, newRoles }, { api: new ApiClient({ apiKey: '...' }) })
```

Zodiac shows each constellation's source, the place its code lives, and links
to it. `zodiac push` sends the web page of the git repository the entrypoint is
checked out from, so a push from a clone of `git@github.com:org/repo.git` shows
up as `org/repo`. The remote's credentials never leave your machine. In a
GitHub workflow the repository the workflow runs for is sent instead. To name a
different source, set `ZODIAC_SOURCE` or pass `--source <url>`; when calling
`push()` yourself, pass `{ source }`. A push that names no source keeps the one
Zodiac already holds.

When Zodiac refuses a constellation as it stands — a policy it could not hold,
a key it cannot encode — `push()` rejects with a `ConstellationRejectedError`
that lists every issue, starting at the node you pushed. `zodiac push` prints
it like this:

```
Zodiac refused the constellation "Production". Some policies of this constellation cannot be held in Zodiac:
  • opsRoles ("Ops Roles") › roles › treasury_ops › policy: "Treasury Ops" is a policy on another Roles modifier. Mark this role as that policy too.
```

## CLI reference

```
Usage: zodiac [options] [command]

Zodiac SDK CLI – pull org data and contract ABIs, push constellations

Options:
  -V, --version        output the version number
  -c, --config <path>  path to the config file (default: "zodiac.config.ts")
  -h, --help           display help for command

Commands:
  create [directory]   Start a constellation project, like `npm create @zodiaceco`
  init                 Authorize this directory with a Zodiac org. Opens a browser to mint an API key and writes it to .env.
  pull-org             Fetch Zodiac users and accounts, generate TypeScript types
  pull-contracts       Fetch contract ABIs, generate typed permissions kit. Needs no API key (--module <file> to export the types instead of augmenting the global AllowKit)
  pull                 Fetch Zodiac org and contracts ABI, generate SDK functions
  push [entrypoint]    Push the nodes an entrypoint exports and open them for review (--no-open to skip the browser, --source <url> to name where they are defined, --dry-run to print what would be pushed)
  help [command]       display help for command
```

`zodiac push` imports the entrypoint (`constellation/index.ts` by default),
pushes every named export as a node, and prints where each constellation can be
reviewed. When Zodiac refuses a constellation, it prints what was refused and
exits with code 1. `--dry-run` prints the specification of each constellation
instead of pushing it, and needs no API key.

A project whose entrypoint relies on globals it sets up itself runs that setup
first and then calls the same command:

```ts
import './globals'
import { pushEntrypoint } from '@zodiaceco/sdk/cli/push'

await pushEntrypoint({ entrypoint: process.argv[2] })
```

The CLI runs on Node.js 22 or later and on Bun. It loads `zodiac.config.ts`
and the entrypoint itself, so TypeScript and extensionless imports such as
`./roles` work under either, with nothing else to install.
