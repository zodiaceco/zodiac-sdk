import type { Address, ChainId } from '@zodiaceco/api-types'
import type { Permission } from 'zodiac-roles-sdk'
import type { NodeRef } from './constellation'

/**
 * The shapes a role's `permissions` travel to the API in, and the one piece of
 * rendering `push()` still does. Internal: the helpers that build these live in
 * `./actions`, and nothing here is part of the published interface beyond the
 * `PermissionEntry` type that module re-exports.
 */

/**
 * The base url of the DeFi Kit API. Annotations point back at it so that a role
 * can be read as presets again, and so that a DeFi Kit entry written in code is
 * indistinguishable from one configured in the app.
 */
const DEFI_KIT_BASE_URL = 'https://kit.kpk.io/api/v1'

/** The chains DeFi Kit serves, by the prefix it addresses them with. */
const DEFI_KIT_CHAIN_PREFIXES: Record<number, string> = {
  1: 'eth',
  10: 'oeth',
  100: 'gno',
  8453: 'base',
  42161: 'arb1',
}

/** Renders a DeFi Kit entry into the annotation it stands for on `chain`. */
export const toAnnotation = (
  { defiKit: { protocol, verb, params } }: DeFiKitEntry,
  chain: ChainId
) => {
  const prefix = DEFI_KIT_CHAIN_PREFIXES[chain]

  if (prefix == null) {
    throw new Error(`DeFi Kit does not serve chain "${chain}"`)
  }

  return {
    uri: `${DEFI_KIT_BASE_URL}/permissions/${prefix}/${protocol}/${verb}?${searchParams(params)}`,
    schema: `${DEFI_KIT_BASE_URL}/openapi.json`,
  }
}

export const isDeFiKitEntry = (entry: PermissionEntry): entry is DeFiKitEntry =>
  typeof entry === 'object' && entry !== null && 'defiKit' in entry

/**
 * The chains of the node recipients a `transfer()`'s same-chain `to` named.
 * Symbol-keyed so it never serializes; `push()` checks it against the chain of
 * the roles node the entry ends up on. A transfer to a node on another chain
 * would permit sending funds to an address that may not exist there.
 */
// Registered, so a node marked by another copy of the SDK — the project's,
// when the CLI runs from elsewhere — is still checked.
export const recipientChains = Symbol.for('@zodiaceco/sdk:recipientChains')

export const assertRecipientChains = (
  entry: PermissionEntry,
  chain: ChainId
): void => {
  const chains = (entry as { [recipientChains]?: readonly ChainId[] })[
    recipientChains
  ]

  for (const recipientChain of chains ?? []) {
    if (recipientChain !== chain) {
      const label = 'label' in entry ? `"${entry.label}"` : 'a transfer'
      throw new Error(
        `A recipient of ${label} lives on chain "${recipientChain}", but the role is on chain "${chain}". Use \`bridge\` for cross-chain recipients.`
      )
    }
  }

  if (!('action' in entry) || entry.action.type !== 'transfer') {
    return
  }

  for (const target of entry.action.bridge ?? []) {
    if (target.chain === chain) {
      throw new Error(
        `"${entry.label}" bridges to chain "${chain}", the role's own chain. Name those recipients in \`to\` instead.`
      )
    }
  }
}

/**
 * Search params are appended one value at a time, the form annotation uris are
 * normalized to before they are matched back against a preset.
 */
const searchParams = (params: Record<string, DeFiKitParamValue>) => {
  const searchParams = new URLSearchParams()

  for (const [name, value] of Object.entries(params)) {
    if (value == null) {
      continue
    }

    for (const entry of Array.isArray(value) ? value : [value]) {
      searchParams.append(name, String(entry))
    }
  }

  return searchParams
}

/**
 * An allowance key. Authored as a plain label, the way a role key is, and
 * encoded to bytes32 when the constellation is deployed. An already-encoded
 * key still works — `encodeKey` passes 32-byte hex through unchanged.
 */
export type AllowanceKey = string

export type SwapEntry = {
  label: string
  action: {
    type: 'swap'
    sell: Address[]
    buy: Address[]
    sellAllowance?: AllowanceKey
    buyAllowance?: AllowanceKey
  }
}

export type TransferEntry = {
  label: string
  action: {
    type: 'transfer'
    tokens: Address[]
    to: Address[]
    bridge?: { chain: ChainId; to: Address[]; receive: Address[] }[]
    allowance?: AllowanceKey
  }
}

/**
 * A permission's target, written either as an address or as another node in the
 * same constellation.
 *
 * A policy is usually pushed alongside the accounts it governs, so the address
 * a permission points at often does not exist yet. Naming the node instead
 * sends a reference, and the address is substituted once it is derived at
 * deploy — the same way a node is named as an owner, a module or an avatar.
 *
 * `NodeRef` for the same reason those fields use it: an uninvoked accessor is
 * a forward reference to a node, and is how two nodes that need each other are
 * written. It carries the label a reference resolves by without being a
 * complete node.
 */
export type PermissionTarget = `0x${string}` | NodeRef

type WithNodeTarget<P> = P extends { targetAddress: `0x${string}` }
  ? Omit<P, 'targetAddress'> & { targetAddress: PermissionTarget }
  : P

/** A `zodiac-roles-sdk` permission that may name a node as its target. */
export type ConstellationPermission = WithNodeTarget<Permission>

export type LabelledPermissions = {
  label: string
  permissions: ConstellationPermission[]
}

export type DeFiKitEntry = {
  label: string
  defiKit: {
    protocol: string
    verb: string
    params: Record<string, DeFiKitParamValue>
  }
}

export type DeFiKitParamValue =
  | string
  | number
  | boolean
  | readonly (string | number | boolean)[]
  | null
  | undefined

/**
 * One entry of a role's `permissions`. A bare permission stays valid, but every
 * labelled form names something the app can show as a single card.
 */
export type PermissionEntry =
  | ConstellationPermission
  | LabelledPermissions
  | SwapEntry
  | TransferEntry
  | DeFiKitEntry

/** A role's full permission list — the type `permissions.ts` files satisfy. */
export type Permissions = readonly PermissionEntry[]
