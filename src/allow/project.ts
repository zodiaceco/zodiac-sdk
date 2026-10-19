/// <reference path="../zodiac-os-codegen.d.ts" />
import fs from 'node:fs'
import path from 'node:path'
import { findProjectRoot, resolveAbisDir, resolveZodiacDir } from '../paths'
import { buildAllowKit } from './runtime'

const CONTRACTS_FILE = 'contracts.json'

/** What `zodiac pull-contracts` records for the project's `allow` kit. */
export type ContractsManifest = {
  /** The ABIs directory, relative to the project root. */
  abisDir: string
  contracts: Record<string, any>
}

/** Records the contracts of the project at `rootDir` for its `allow` kit. */
export const writeContractsManifest = (
  rootDir: string,
  manifest: ContractsManifest
) => {
  const file = path.join(resolveZodiacDir(rootDir), CONTRACTS_FILE)

  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(manifest, null, 2) + '\n', 'utf8')
}

/**
 * Records the contracts of a project's config for its `allow` kit: their
 * ABIs, fetched by `zodiac pull-contracts`, sit in its ABIs directory.
 */
export const recordContracts = (config: {
  rootDir: string
  abisDir?: string
  contracts?: Record<string, any>
}) =>
  writeContractsManifest(config.rootDir, {
    abisDir: path.relative(config.rootDir, resolveAbisDir(config)) || '.',
    contracts: config.contracts ?? {},
  })

// By project and when its contracts were recorded: a program pushing several
// projects, or recording new contracts, gets each kit as it is now.
const kits = new Map<string, { recordedAt: number; kit: Record<string, any> }>()

const getKit = (): Record<string, any> => {
  const rootDir = findProjectRoot()
  const file = path.join(resolveZodiacDir(rootDir), CONTRACTS_FILE)

  if (!fs.existsSync(file)) {
    throw new Error(
      `No contracts pulled for the project at ${rootDir}. Add contracts to zodiac.config.ts and run \`zodiac pull-contracts\`.`
    )
  }

  const recordedAt = fs.statSync(file).mtimeMs
  const cached = kits.get(file)
  if (cached?.recordedAt === recordedAt) return cached.kit

  const { abisDir, contracts }: ContractsManifest = JSON.parse(
    fs.readFileSync(file, 'utf8')
  )
  const kit = buildAllowKit(path.resolve(rootDir, abisDir), contracts)

  kits.set(file, { recordedAt, kit })
  return kit
}

/**
 * The project's permission kit: `allow.<chain>.<contract>.<function>(...)` for
 * every contract in `zodiac.config.ts`, typed by `zodiac pull-contracts`.
 *
 * It is built on first use from what `zodiac pull-contracts` last pulled, for
 * the project the working directory is in.
 */
export const allow = new Proxy({} as AllowKit, {
  get: (_, key) => {
    // Probes like `await` or `console.log` aren't chains.
    if (typeof key === 'symbol' || key === 'then') return undefined

    const chain = getKit()[key]
    if (chain === undefined) {
      throw new Error(
        `\`allow.${key}\`: zodiac.config.ts lists no contracts on "${key}". Add them and run \`zodiac pull-contracts\`.`
      )
    }
    return chain
  },
  has: (_, key) => key in getKit(),
  ownKeys: () => Reflect.ownKeys(getKit()),
  getOwnPropertyDescriptor: (_, key) => {
    const value = getKit()[key as string]
    return value === undefined
      ? undefined
      : { value, enumerable: true, configurable: true }
  },
})
