/// <reference path="./zodiac-os-codegen.d.ts" />
import type { Address, ChainId } from '@zodiaceco/api-types'
import type { PermissionEntry } from './actions'
import type { AllowanceSpec } from './types'
import { createRequire } from 'module'
import { resolveZodiacDir } from './paths'
import { UUID } from 'crypto'

/**
 * A role definition keyed by role name. Entries describe what the role may do —
 * parameters and labels, never compiled permissions. They are expanded into
 * `{ targets, annotations }` when the constellation is deployed, so that a
 * stored revision always compiles through the current compilers.
 *
 * A role carrying `policy` is a policy in Zodiac. Its key is the policy's
 * identity, so the same key on several Roles mods is one policy, active on
 * each of their vaults. Only a policy has a `description`.
 */
export type RoleDef = {
  members: readonly AddressOrRef[]
  permissions: readonly PermissionEntry[]
} & (
  | {
      /** Marks the role as a policy, labelled with this value. Never reaches
       * the chain. */
      policy: string
      /** Describes the policy in Zodiac. Never reaches the chain. */
      description?: string
    }
  | { policy?: undefined; description?: undefined }
)

type User = {
  id: UUID
  fullName: string
  personalSafes: Record<
    number,
    { address: Lowercase<Address>; active: boolean }
  >
}

type Account = {
  id: UUID
  label: string
  address: Lowercase<Address>
  chain: ChainId
  /** True for accounts promoted to a workspace vault. */
  vault: boolean
}

type AccountsByLabel = Readonly<Record<string, Account>>

/**
 * A workspace's accounts, grouped by node type and then by chain.
 *
 * Both groupings keep bracket-accessor namespaces apart, so that a label is
 * only ever ambiguous between accounts a constellation could actually choose
 * between: a SAFE and a ROLES mod sharing a label don't collide, and neither
 * do two safes of the same name on different chains.
 */
type WorkspaceAccounts = {
  workspaceId: UUID
  workspaceName: string
  safes: AccountsByChain
  rolesMods: AccountsByChain
  delays: AccountsByChain
}

type AccountsByChain = { readonly [chain in ChainId]?: AccountsByLabel }

/** Shape of the codegen data produced by `zodiac pull-org`. */
export type CodegenData = {
  users: Readonly<Record<string, User>>
  accounts: Readonly<Record<string, WorkspaceAccounts>>
}

// If `pull-org` has been run, the consumer's `.zodiac/index.d.ts` augments
// `ZodiacGeneratedCodegen` with literal `users`/`accounts` shapes. Otherwise
// the interface is empty and we fall back to the wide `CodegenData`.
type GeneratedCodegen = ZodiacGeneratedCodegen extends CodegenData
  ? ZodiacGeneratedCodegen
  : CodegenData

type ConstellationOpts<C extends CodegenData> = {
  /** Workspace to scope accounts and roles to. */
  workspace: keyof C['accounts'] & string
  /** Human-readable label for this constellation. */
  label: string
  /** Target chain for all nodes in this constellation. */
  chain: ChainId
}

type ConstellationInternalOpts<C extends CodegenData> = {
  /** Injected codegen data (used for testing). */
  codegen?: C
}

type Prettify<T> = { readonly [K in keyof T]: T[K] } & {}

/**
 * The accounts of one type that a constellation on `Ch` can name. Accounts on
 * every other chain are not in scope: their addresses mean nothing here, so
 * offering them would only invite a node that carries a foreign address under
 * this constellation's chain.
 */
type ChainEntries<A, Ch extends ChainId> = Ch extends keyof A
  ? NonNullable<A[Ch]>
  : {}

type SafeEntries<
  C extends CodegenData,
  W extends keyof C['accounts'],
  Ch extends ChainId,
> = ChainEntries<C['accounts'][W]['safes'], Ch>

type RolesEntries<
  C extends CodegenData,
  W extends keyof C['accounts'],
  Ch extends ChainId,
> = ChainEntries<C['accounts'][W]['rolesMods'], Ch>

type DelayEntries<
  C extends CodegenData,
  W extends keyof C['accounts'],
  Ch extends ChainId,
> = ChainEntries<C['accounts'][W]['delays'], Ch>

type NodeType = 'SAFE' | 'ROLES' | 'DELAY'

/** A reference to a node used in `owners`, `modules`, `target`, etc. */
export type NodeRef = Readonly<{
  type: NodeType
  label: string
  chain: ChainId
}>

/** A blockchain address (checksummed or lowercase) or a reference to another
 * node in the constellation. Values are normalized to lowercase before being
 * sent to the API. */
type AddressOrRef = Address | NodeRef

/** A role's members: addresses, users or nodes. */
export type Members = readonly AddressOrRef[]

type NodeBase = Readonly<{
  /** Human-readable identifier, unique within the constellation. */
  label: string
  /** Chain the node is deployed on. */
  chain: ChainId
  /** Set for existing nodes (from codegen or bound by address), absent for new
   * nodes. Accepts checksummed or lowercase; normalized to lowercase on push. */
  address?: Address
  /** Deployment nonce — required for new nodes, optional for existing. */
  nonce?: bigint
}>

/** A safe node — a reference to one the workspace already has, or a new one
 * with the config it is deployed with. */
export type SafeNode = NodeBase &
  Readonly<{
    /** Discriminator identifying this node as a Safe. */
    type: 'SAFE'
    /** Number of owner signatures required to execute a transaction. */
    threshold: number
    /** Safe owner addresses or node references. */
    owners: readonly (string | NodeRef)[]
    /** Module addresses or node references enabled on the safe. */
    modules?: readonly (string | NodeRef)[]
    /** Whether this safe shall appear as a vault in the workspace. @default false */
    vault?: boolean
  }>

/** A roles modifier node — a reference to one the workspace already has, or a
 * new one with the config it is deployed with. */
export type RolesNode = NodeBase &
  Readonly<{
    /** Discriminator identifying this node as a Roles modifier. */
    type: 'ROLES'
    /** The safe that this roles modifier controls. */
    target?: AddressOrRef
    /** The account that is allowed to update the configuration of the Roles mod. */
    owner?: AddressOrRef
    /** The account that calls will be executed from. */
    avatar?: AddressOrRef
    /** MultiSend contract addresses for batched transactions. */
    multisend?: readonly Address[]
    /** Role definitions configured on this modifier. Pass `null` for a key to
     * clear that role; unmentioned roles are left untouched. */
    roles?: Record<string, RoleDef | null>
    /** Spending allowances configured on this modifier, keyed by name. Pass
     * `null` for a key to clear that allowance; unmentioned allowances are
     * left untouched. */
    allowances?: Record<string, AllowanceSpec | null>
  }>

/** A delay modifier node — a reference to one the workspace already has, or a
 * new one with the config it is deployed with. */
export type DelayNode = NodeBase &
  Readonly<{
    /** Discriminator identifying this node as a Delay modifier. */
    type: 'DELAY'
    /** The safe that this delay modifier controls. */
    target?: AddressOrRef
    /** The account that is allowed to update the configuration of the Delay mod. */
    owner?: AddressOrRef
    /** The account that calls will be executed from. */
    avatar?: AddressOrRef
    /** Seconds a queued transaction waits before it becomes executable. */
    cooldown?: bigint
    /** Seconds a transaction stays executable once its cooldown has passed. */
    expiration?: bigint
    /** Module addresses or node references enabled on the delay. */
    modules?: readonly (string | NodeRef)[]
  }>

/** Any complete node that can be passed to `push()`. */
export type ConstellationNode = SafeNode | RolesNode | DelayNode
export type ConstellationNodeInternal = ConstellationNode & {
  _constellation: ConstellationMeta
  /**
   * The state fields this node actually declares.
   *
   * A referenced node carries everything `pull` read from chain so it reads
   * well and completes in an editor, but a reference is not a declaration —
   * only what was passed explicitly is pushed. Empty for a bare reference.
   */
  _declared: readonly string[]
}

type NewSafeProps = {
  /** Deployment nonce for CREATE2 address derivation. */
  nonce: bigint
  /** Number of owner signatures required to execute a transaction. */
  threshold: number
  /** Safe owner addresses or node references. */
  owners: readonly AddressOrRef[]
  /** Module addresses or node references to enable on the safe. */
  modules?: readonly AddressOrRef[]
  /** Whether this safe is a workspace vault. @default false */
  vault?: boolean
}

/** Configuration shared by both ways of declaring a roles modifier. */
type RolesConfig = {
  /** The safe that this roles modifier controls. Defaults to the new safe with the same label, when one exists. */
  target?: AddressOrRef
  /** The account that calls will be executed from. Defaults to `target` value */
  avatar?: AddressOrRef
  /** The account that is allowed to update the configuration of the Roles Mod. Defaults to `target` value */
  owner?: AddressOrRef
  /** MultiSend contract addresses for batched transactions. Defaults to `['0x38869bf66a61cf6bdb996a6ae40d5853fd43b526', '0x9641d764fc13c8b624c04430c7356c1c7c8102e2']` */
  multisend?: readonly Address[]
  /** Role definitions to configure on this modifier. Pass `null` for a key to
   * clear that role; unmentioned roles are left untouched. */
  roles?: Record<string, RoleDef | null>
  /** Spending allowances to configure on this modifier, keyed by name. Pass
   * `null` for a key to clear that allowance; unmentioned allowances are
   * left untouched. */
  allowances?: Record<string, AllowanceSpec | null>
}

/** Declare a brand-new roles modifier (address derived via CREATE2 from `nonce`). */
type NewRolesByNonce = RolesConfig & {
  /** Deployment nonce for CREATE2 address derivation. */
  nonce: bigint
}

/** Bind to a roles modifier already deployed on-chain at a known address, to
 * reconfigure its roles/allowances. Use this for mods not (yet) imported into
 * the workspace — pass the address instead of a deployment `nonce`. */
type ExistingRolesByAddress = RolesConfig & {
  /** Address of the existing Roles mod to bind to and reconfigure. */
  address: Address
}

type NewRolesProps = NewRolesByNonce | ExistingRolesByAddress

/** Configuration shared by both ways of declaring a delay modifier. */
type DelayConfig = {
  /** The safe that this delay modifier controls. Defaults to the new safe with the same label, when one exists. */
  target?: AddressOrRef
  /** The account that calls will be executed from. Defaults to `target` value */
  avatar?: AddressOrRef
  /** The account that is allowed to update the configuration of the Delay Mod. Defaults to `target` value */
  owner?: AddressOrRef
  /** Module addresses or node references allowed to queue transactions through
   * this delay. A complete array replaces the enabled modules. */
  modules?: readonly AddressOrRef[]
}

/** Declare a brand-new delay modifier (address derived via CREATE2 from `nonce`). */
type NewDelayByNonce = DelayConfig & {
  /** Deployment nonce for CREATE2 address derivation. */
  nonce: bigint
  /** Seconds a queued transaction waits before it becomes executable. */
  cooldown: bigint
  /** Seconds a transaction stays executable once its cooldown has passed. */
  expiration: bigint
}

/** Bind to a delay modifier already deployed on-chain at a known address, to
 * reconfigure its cooldown, expiration or modules. Use this for mods not (yet)
 * imported into the workspace — pass the address instead of a deployment
 * `nonce`. */
type ExistingDelayByAddress = DelayConfig & {
  /** Address of the existing Delay mod to bind to and reconfigure. */
  address: Address
  /** Seconds a queued transaction waits before it becomes executable. */
  cooldown?: bigint
  /** Seconds a transaction stays executable once its cooldown has passed. */
  expiration?: bigint
}

type NewDelayProps = NewDelayByNonce | ExistingDelayByAddress

type ExistingNodeAccessor<
  Type extends string,
  K extends string,
  E,
  Ch extends ChainId,
  NP extends Record<string, any>,
> = Readonly<Prettify<E & { type: Type; label: K; chain: Ch }>> &
  (<
    const O extends {
      [P in Exclude<keyof E & string, 'id' | 'label'>]?: any
    } & Partial<NP> = {},
  >(
    overrides?: {
      [P in Exclude<keyof E & string, 'id' | 'label'>]?: any
    } & Partial<NP> &
      O
  ) => Readonly<
    Prettify<
      Omit<E, keyof O> & O & Partial<NP> & { type: Type; label: K; chain: Ch }
    >
  >)

type NewNodeAccessor<
  Type extends string,
  Ch extends ChainId,
  NP extends Record<string, any>,
> = Readonly<Prettify<{ type: Type; label: string; chain: Ch }>> &
  // `const` so a node reads back the values it was written with — `threshold: 2`
  // rather than `number`. Every prop it widens into is already `readonly`, so
  // the tuples this infers stay assignable.
  (<const P extends NP>(
    props: P
  ) => Readonly<Prettify<P & { type: Type; label: string; chain: Ch }>>)

type EntityAccessor<
  Type extends string,
  Entries extends Record<string, any>,
  Ch extends ChainId = ChainId,
  NP extends Record<string, any> = Record<string, any>,
> = {
  readonly [K in keyof Entries & string]: ExistingNodeAccessor<
    Type,
    K,
    Entries[K],
    Ch,
    NP
  >
} & {
  readonly [key: string]: NewNodeAccessor<Type, Ch, NP>
}

type UserAccessor<C extends CodegenData, Ch extends number> = {
  readonly [K in keyof C['users'] &
    string]: C['users'][K]['personalSafes'][Ch]['address']
}

type ConstellationResult<
  C extends CodegenData,
  W extends keyof C['accounts'] = keyof C['accounts'],
  Ch extends ChainId = ChainId,
> = {
  /** Access existing safes by label or create new ones with a new label.
   * Only SAFE-typed accounts are suggested in IntelliSense. */
  safe: EntityAccessor<'SAFE', SafeEntries<C, W, Ch>, Ch, NewSafeProps>
  /** Access existing roles modifiers by label or create new ones with a
   * new label. Only ROLES-typed accounts are suggested in IntelliSense. */
  roles: EntityAccessor<'ROLES', RolesEntries<C, W, Ch>, Ch, NewRolesProps>
  /** Access existing delay modifiers by label or create new ones with a
   * new label. Only DELAY-typed accounts are suggested in IntelliSense. */
  delay: EntityAccessor<'DELAY', DelayEntries<C, W, Ch>, Ch, NewDelayProps>
  /** Resolve a user's personal safe address on the constellation's chain. */
  user: UserAccessor<C, Ch>
}

/** @internal */
export type ConstellationMeta = {
  label: string
  chain: ChainId
  workspaceId: UUID
}

const EMPTY_CODEGEN: CodegenData = { users: {}, accounts: {} }

// Until `zodiac pull-org` has run there is no codegen, and a constellation that
// only declares new nodes can still be pushed. Naming an existing account then
// reads as declaring a new one.
function loadCodegen(): CodegenData {
  const require = createRequire(import.meta.url)
  try {
    return require(resolveZodiacDir()) as CodegenData
  } catch (error: any) {
    if (error?.code === 'MODULE_NOT_FOUND') return EMPTY_CODEGEN
    throw error
  }
}

/**
 * Creates a constellation scoped to a workspace and chain.
 *
 * Bracket access names an account of that workspace **on that chain** — a
 * vault, or a node an earlier constellation deployed. A label the chain has no
 * account for reads as a new node instead, so it has to be given the config it
 * is deployed with.
 *
 * ```ts
 * const eth = constellation({ workspace: 'GG', label: 'my constellation', chain: 1 })
 *
 * const dao = eth.safe['GG DAO']              // the safe of that name on chain 1
 * const roles = eth.roles['GG DAO']           // the roles mod of that name
 * const newSafe = eth.safe['New Safe']({ nonce: 0n, threshold: 2, owners: [...], modules: [...] })
 * const timelock = eth.delay['Timelock']({ nonce: 0n, target: dao, cooldown: 86400n, expiration: 0n })
 * ```
 *
 * Names come from the last `pull-org`, so an account deployed since then is
 * not one yet.
 */
export function constellation<
  const C extends CodegenData = GeneratedCodegen,
  const W extends keyof C['accounts'] & string = keyof C['accounts'] & string,
  const Ch extends ChainId = ChainId,
>(
  opts: ConstellationOpts<C> & { workspace: W; chain: Ch },
  internal?: ConstellationInternalOpts<C>
): ConstellationResult<C, W, Ch> {
  const codegen: CodegenData = internal?.codegen ?? loadCodegen()

  const ws = codegen.accounts[opts.workspace]
  const safesByLabel: Record<string, Account> = {}
  const rolesByLabel: Record<string, Account> = {}
  const delaysByLabel: Record<string, Account> = {}
  if (ws) {
    // Only this chain's accounts are in scope. A label resolved from another
    // chain would hand back an address that names nothing here, and the node
    // would still be pushed under this constellation's chain.
    const onThisChain = (byChain: AccountsByChain): AccountsByLabel =>
      byChain[opts.chain] ?? {}

    for (const [label, account] of Object.entries(onThisChain(ws.safes))) {
      safesByLabel[label] = account
    }
    for (const [label, account] of Object.entries(onThisChain(ws.rolesMods))) {
      rolesByLabel[label] = account
    }
    for (const [label, account] of Object.entries(onThisChain(ws.delays))) {
      delaysByLabel[label] = account
    }
  }

  const meta: ConstellationMeta = {
    label: opts.label,
    chain: opts.chain,
    workspaceId: (ws?.workspaceId ?? '') as UUID,
  }

  function makeNodeRef(
    data: Record<string, any>,
    declared: readonly string[]
  ): Readonly<Record<string, any>> {
    return Object.freeze({
      ...data,
      chain: opts.chain,
      _constellation: meta,
      _declared: declared,
    })
  }

  function entityAccessor(
    registry: Record<string, Record<string, any>>,
    type: string
  ) {
    const cache = new Map<string, Record<string, any>>()
    return new Proxy({} as Record<string, any>, {
      get(_target: any, name: string) {
        if (typeof name !== 'string') return undefined
        const cached = cache.get(name)
        if (cached) return cached
        const existing = registry[name]
        // Bracket-access keys in the generated codegen carry a
        // ` (0xChecksummed…)` suffix when multiple workspace accounts share
        // a label. The label sent in the push spec should be the clean
        // original, so prefer `existing.label` when it's available.
        const specLabel: string = existing?.label ?? name
        const fn = (overrides?: Record<string, any>) =>
          makeNodeRef(
            {
              type,
              ...(existing || {}),
              ...overrides,
              label: specLabel,
            },
            Object.keys(overrides ?? {})
          )
        // Bare access — `eth.safe['Treasury']` rather than a call — declares
        // nothing. It reads as the account it names, and pushes as a reference.
        Object.assign(fn, {
          type,
          ...(existing || {}),
          label: specLabel,
          chain: opts.chain,
          _constellation: meta,
          _declared: [],
        })
        cache.set(name, fn)
        return fn
      },
    })
  }

  function userAccessor() {
    return new Proxy(
      {},
      {
        get(_target: any, name: string) {
          const user = codegen.users[name]
          if (!user) throw new Error(`Unknown user: ${name}`)
          const personalSafe = user.personalSafes[opts.chain]
          if (!personalSafe) {
            throw new Error(
              `User ${name} has no personal safe on chain ${opts.chain}`
            )
          }
          return personalSafe.address
        },
      }
    )
  }

  const safe = entityAccessor(safesByLabel, 'SAFE')
  const roles = entityAccessor(rolesByLabel, 'ROLES')
  const delay = entityAccessor(delaysByLabel, 'DELAY')

  return {
    safe,
    roles,
    delay,
    user: userAccessor(),
  } as ConstellationResult<C, W, Ch>
}
