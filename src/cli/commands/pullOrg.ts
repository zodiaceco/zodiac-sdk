import type {
  Address,
  ChainId,
  ResolveConstellationPayload,
} from '@zodiaceco/api-types'
import type { ResolvedConfig } from '../config'
import { ApiClient } from '../../api'
import { getAddress } from 'ethers'
import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { resolveZodiacDir } from '../../paths'

/**
 * Writes `value` as source: as a JavaScript expression, or as the type
 * TypeScript gives that expression `as const`, which makes every property
 * `readonly`, every array a `readonly` tuple and every value its literal type.
 */
const toSource = (value: unknown, as: 'value' | 'type', indent = 0): string => {
  const pad = '  '.repeat(indent)
  const childPad = '  '.repeat(indent + 1)
  const readonly = as === 'type' ? 'readonly ' : ''

  if (value === null) return 'null'
  if (typeof value === 'bigint') return `${value}n`
  if (typeof value === 'string') return JSON.stringify(value)
  if (typeof value === 'number' || typeof value === 'boolean')
    return String(value)
  if (Array.isArray(value)) {
    if (value.length === 0) return `${readonly}[]`
    return `${readonly}[\n${value.map((v) => `${childPad}${toSource(v, as, indent + 1)}`).join(',\n')},\n${pad}]`
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
    if (entries.length === 0) return '{}'
    const separator = as === 'type' ? ';' : ','
    const props = entries.map(
      ([k, v]) =>
        `${childPad}${readonly}${isBareKey(k) ? k : JSON.stringify(k)}: ${toSource(v, as, indent + 1)}${separator}`
    )
    return `{\n${props.join('\n')}\n${pad}}`
  }
  return String(value)
}

type NodeType = 'SAFE' | 'ROLES' | 'DELAY'

/**
 * An account written as the specification node that names it and declares
 * nothing else.
 *
 * The `ref` is required of every node and has to be distinct, but nothing
 * reads it back — the result comes aligned with the request.
 *
 * Spelled out per type rather than passed through: `/accounts` answers with
 * the same three names as an enum, whose members are types of their own, and
 * a node is only a node once it says which of the three it is.
 */
const asNodeReference = (
  {
    type,
    chain,
    address,
  }: { type: string; chain: ChainId; address: Lowercase<Address> },
  index: number
): ResolveConstellationPayload['specification'][number] => {
  const node = { ref: `account_${index}`, chain, address }

  switch (asNodeType(type)) {
    case 'SAFE':
      return { ...node, type: 'SAFE' }
    case 'ROLES':
      return { ...node, type: 'ROLES' }
    case 'DELAY':
      return { ...node, type: 'DELAY' }
  }
}

const asNodeType = (type: string): NodeType => {
  if (type === 'SAFE' || type === 'ROLES' || type === 'DELAY') {
    return type
  }

  throw new Error(`Cannot describe an account of type "${type}"`)
}

/**
 * Whether a key can be written without quotes. Chain ids are grouping keys in
 * the generated data, and an unquoted number keys the `as const` type by chain
 * id — quoted, it would key by a string the callers never hold.
 */
const isBareKey = (key: string): boolean =>
  /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(key) || /^\d+$/.test(key)

export const pullOrg = async (config: ResolvedConfig) => {
  const client = new ApiClient({
    apiKey: config.apiKey,
  })

  const [users, workspaceAccounts] = await Promise.all([
    client.listUsers(),
    client.listAccounts(),
  ])

  // The generated accounts carry their onchain state so a node reads as the
  // account it names and completes in an editor. Only what a constellation
  // declares is ever pushed back, so this is for reading, not a declaration.
  //
  // Each account is named by its address and nothing else. `/resolve`
  // resolves a node it has no address for against the setup safe of whoever
  // holds the API key — which describes the account *that* caller would
  // deploy, not the one being asked about — and it merges declarations over
  // what it reads. Sending an address and no declarations leaves it nothing
  // to derive and nothing to merge, so the answer is the account itself, the
  // same for every key.
  //
  // Asking about every listed account is safe for the same reason: `/accounts`
  // admits one only once it has been seen to hold code, so every address here
  // is one that can be read from chain.
  const allAccounts = workspaceAccounts.flatMap((ws) => ws.accounts)
  const resolved = new Map<
    string,
    Awaited<ReturnType<typeof client.resolveConstellation>>['result'][number]
  >()

  if (allAccounts.length > 0) {
    const { result } = await client.resolveConstellation(
      workspaceAccounts[0].workspaceId, // any workspace works for the resolve route
      {
        specification: allAccounts.map(asNodeReference),
      }
    )

    // Aligned with the request, entry for entry.
    allAccounts.forEach((account, index) => {
      resolved.set(account.id, result[index])
    })
  }

  // Group accounts by type and then by chain into separate bracket-access
  // namespaces: `safes[chain]`, `rolesMods[chain]`, `delays[chain]`. This way
  // `eth.safe[...]` IntelliSense only suggests SAFE labels deployed on the
  // constellation's own chain, and the label-collision suffix only kicks in
  // where a label is genuinely ambiguous — same type, same chain.
  type AccountsByChain = Record<number, Record<string, unknown>>

  const accountsRecord: Record<string, unknown> = {}
  for (const ws of workspaceAccounts) {
    const safes: AccountsByChain = {}
    const rolesMods: AccountsByChain = {}
    const delays: AccountsByChain = {}

    const bucketsByType = {
      SAFE: safes,
      ROLES: rolesMods,
      DELAY: delays,
    } as const

    const isNodeType = (type: string): type is NodeType =>
      type === 'SAFE' || type === 'ROLES' || type === 'DELAY'

    // Accounts we only know by address — Safe owners, external role
    // members, route targets — carry no label. They can't key a
    // label-addressed namespace, so they stay out of the codegen.
    // Vault entries always carry one.

    // Count labels per namespace so we only suffix collisions a constellation
    // could actually run into. Two safes named `Treasury` on different chains
    // never compete for a key, because a constellation only ever sees one of
    // those chains.
    const namespaceKey = (type: NodeType, chain: number) => `${type}:${chain}`
    const labelCounts = new Map<string, Map<string, number>>()

    for (const account of ws.accounts) {
      const { label } = account
      if (label == null || !isNodeType(account.type)) continue
      const key = namespaceKey(account.type, account.chain)
      let counts = labelCounts.get(key)
      if (!counts) {
        counts = new Map()
        labelCounts.set(key, counts)
      }
      counts.set(label, (counts.get(label) ?? 0) + 1)
    }

    for (const account of ws.accounts) {
      const { label } = account
      if (label == null || !isNodeType(account.type)) continue
      const onChain = resolved.get(account.id)
      const counts = labelCounts.get(namespaceKey(account.type, account.chain))
      const key =
        (counts?.get(label) ?? 0) > 1
          ? `${label} (${getAddress(account.address)})`
          : label
      const byChain = bucketsByType[account.type]
      const byLabel = (byChain[account.chain] ??= {})
      byLabel[key] = {
        id: account.id,
        label,
        address: account.address,
        chain: account.chain,
        vault: account.vault,
        ...(onChain?.type === 'SAFE' && {
          threshold: onChain.threshold,
          owners: [...onChain.owners],
          modules: [...onChain.modules],
        }),
      }
    }

    accountsRecord[ws.workspaceName] = {
      workspaceId: ws.workspaceId,
      workspaceName: ws.workspaceName,
      safes,
      rolesMods,
      delays,
    }
  }

  const nameCount = new Map<string, number>()
  for (const user of users) {
    nameCount.set(user.fullName, (nameCount.get(user.fullName) ?? 0) + 1)
  }

  const usersRecord: Record<string, unknown> = {}
  for (const user of users) {
    const handle =
      nameCount.get(user.fullName)! > 1
        ? `${user.fullName} (${user.id})`
        : user.fullName
    usersRecord[handle] = {
      id: user.id,
      fullName: user.fullName,
      personalSafes: user.personalSafes,
    }
  }

  const outDir = resolveZodiacDir(config.rootDir)

  mkdirSync(outDir, { recursive: true })

  // Pin CJS so `require()` works regardless of the parent package.json's type
  writeFileSync(
    join(outDir, 'package.json'),
    JSON.stringify(
      {
        type: 'commonjs',
        main: 'index.js',
        types: 'index.d.ts',
      },
      null,
      2
    )
  )

  // What TypeScript emits for `export const users = { … } as const` and the
  // same for `accounts`, written out directly so that the CLI needs no
  // compiler.
  writeFileSync(
    join(outDir, 'index.js'),
    `"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.users = ${toSource(usersRecord, 'value')};
exports.accounts = ${toSource(accountsRecord, 'value')};
`
  )

  // Augment the SDK's global `ZodiacGeneratedCodegen` interface so
  // `constellation()`'s default type parameter picks up these literal shapes
  // automatically.
  writeFileSync(
    join(outDir, 'index.d.ts'),
    `export declare const users: ${toSource(usersRecord, 'type')};
export declare const accounts: ${toSource(accountsRecord, 'type')};
declare global {
  interface ZodiacGeneratedCodegen {
    users: typeof users;
    accounts: typeof accounts;
  }
}
`
  )
}
