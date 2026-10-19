import { config as loadDotenv } from 'dotenv'
import { existsSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'path'
import { CONFIG_EXTENSIONS } from '../paths'
import { loadModule } from './loadModule'
import { findProjectRoot } from './projectRoot'

export type Contracts = {
  [chain: string]: ContractsNode
}
export type ContractsNode = `0x${string}` | { [name: string]: ContractsNode }

export interface ZodiacConfig {
  /**
   * API key authorizing this directory against a Zodiac org.
   *
   * Optional — defaults to `process.env.ZODIAC_API_KEY` (populated by
   * `zodiac init`). Set this explicitly only when you need to override
   * the env var from inside the config file.
   */
  apiKey?: `zodiac_${string}`
  /**
   * Contracts the `allow` kit should know about, keyed by chain prefix.
   * Nested objects are allowed for grouping related addresses.
   */
  contracts?: Contracts
  /**
   * Directory where fetched ABIs are stored and read from.
   * Resolved relative to the project root (config file's directory).
   * Defaults to `./abis`.
   */
  abisDir?: string
}

/** User-provided config plus the project root, without an API key. */
export interface ProjectConfig extends Omit<ZodiacConfig, 'apiKey'> {
  rootDir: string
}

/** User-provided config plus the resolved API key + project root. */
export interface ResolvedConfig extends ProjectConfig {
  apiKey: `zodiac_${string}`
}

/**
 * Loose base used as the *inference* constraint for `defineConfig`.
 * `contracts` is `Record<string, unknown>` here so `const T` can preserve the
 * caller's exact address literals rather than collapsing them into the
 * recursive `ContractsNode` union.
 */
type DefineConfigInput = {
  apiKey?: `zodiac_${string}`
  contracts?: Record<string, unknown>
  abisDir?: string
}

/**
 * Recursive leaf-level check: every leaf in `contracts` must be
 * `` `0x${string}` ``; any other value collapses the branch to `never`,
 * which surfaces as a type error at the call site.
 */
type ValidateContracts<C> = {
  [K in keyof C]: C[K] extends `0x${string}`
    ? C[K]
    : C[K] extends object
      ? ValidateContracts<C[K]>
      : never
}

export const defineConfig = <const T extends DefineConfigInput>(
  config: T & {
    contracts?: ValidateContracts<NonNullable<T['contracts']>>
  }
): T => config

const CONFIG_BASENAME = 'zodiac.config'

const DEFAULT_CONFIG_PATH = `${CONFIG_BASENAME}.ts`

const CONFIG_STUB = `import { defineConfig } from "@zodiaceco/sdk/cli/config";

export default defineConfig({
  contracts: {
    // Add contracts the \`allow\` kit should know about, keyed by chain prefix.
    // Run \`zodiac pull-contracts\` after editing.
    //
    // eth: {
    //   weth: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
    // },
  },
});
`

type LoadConfigOptions = {
  /**
   * Called when neither `config.apiKey` nor `process.env.ZODIAC_API_KEY` is
   * set. Receives the resolved project root and must return a freshly minted
   * API key. Typically wired to the interactive `init()` flow.
   *
   * If omitted, `loadConfig` throws when no key is found.
   */
  onMissingKey?: (rootDir: string) => Promise<string>
  /**
   * When the config file doesn't exist, write a minimal stub before
   * loading. Used by the CLI's `pull` commands so first-time setup
   * works without the user having to scaffold the file themselves.
   */
  createIfMissing?: boolean
}

/**
 * Write a starter `zodiac.config.ts` if no file exists at `absolutePath`.
 * Returns `true` if a file was written.
 */
export const ensureConfigStub = (absolutePath: string): boolean => {
  if (existsSync(absolutePath)) return false
  writeFileSync(absolutePath, CONFIG_STUB, 'utf8')
  return true
}

/**
 * Turn a (possibly-default) config path into an absolute path under
 * `projectRoot`. When the caller didn't pass an explicit path, probe
 * for `zodiac.config.{ts,mts,cts,js,mjs,cjs}` and use whichever exists;
 * fall back to the canonical `.ts` name so a not-found error is
 * still phrased in terms users recognise.
 */
const resolveConfigPath = (projectRoot: string, configPath: string): string => {
  const explicit = resolve(projectRoot, configPath)
  if (configPath !== DEFAULT_CONFIG_PATH) return explicit

  for (const ext of CONFIG_EXTENSIONS) {
    const candidate = resolve(projectRoot, `${CONFIG_BASENAME}${ext}`)
    if (existsSync(candidate)) return candidate
  }
  return explicit
}

/**
 * The config without an API key, for commands that never call the Zodiac API
 * (`pull-contracts`). An `apiKey` in the file is left out rather than checked.
 */
export async function loadProjectConfig(
  configPath: string = DEFAULT_CONFIG_PATH,
  options: Pick<LoadConfigOptions, 'createIfMissing'> = {}
): Promise<ProjectConfig> {
  const { config, rootDir } = await readConfig(configPath, options)
  const { apiKey: _, ...rest } = config

  return { ...rest, rootDir }
}

export async function loadConfig(
  configPath: string = DEFAULT_CONFIG_PATH,
  options: LoadConfigOptions = {}
): Promise<ResolvedConfig> {
  const { config, rootDir } = await readConfig(configPath, options)

  // `init` writes the API key and URL to the project's `.env`, which a CLI run
  // from a subdirectory would not have loaded. Variables already set win.
  loadDotenv({ path: resolve(rootDir, '.env'), quiet: true })

  const apiKey = await resolveApiKey(config, rootDir, options)

  return { ...config, apiKey, rootDir }
}

const readConfig = async (
  configPath: string,
  options: Pick<LoadConfigOptions, 'createIfMissing'>
): Promise<{ config: ZodiacConfig; rootDir: string }> => {
  // Resolve relative paths (including the default) against the nearest
  // package.json ancestor — that's where users expect the config to live,
  // regardless of which subdir they ran the CLI from.
  const projectRoot = findProjectRoot()
  const absolutePath = resolveConfigPath(projectRoot, configPath)

  if (options.createIfMissing && ensureConfigStub(absolutePath)) {
    console.log(`✅ Created ${absolutePath}`)
  }

  // Checked up front: each runtime reports a missing module differently.
  if (!existsSync(absolutePath)) {
    throw new Error(`Config file not found: ${absolutePath}`)
  }

  const mod = await loadModule(absolutePath)

  const config = (mod.default ?? mod.config) as ZodiacConfig | undefined
  if (!config) {
    throw new Error(
      `Config file must export a default value or a named "config" export: ${absolutePath}`
    )
  }

  return { config, rootDir: dirname(absolutePath) }
}

const resolveApiKey = async (
  config: ZodiacConfig,
  rootDir: string,
  { onMissingKey }: LoadConfigOptions
): Promise<`zodiac_${string}`> => {
  if (config.apiKey != null) {
    if (!isApiKey(config.apiKey)) {
      throw new Error(
        '`apiKey` in zodiac.config.ts is malformed: a valid Zodiac API key starts with "zodiac_". Either remove the field to use ZODIAC_API_KEY, or run `zodiac init` to mint a fresh key.'
      )
    }
    return config.apiKey
  }

  const fromEnv = process.env.ZODIAC_API_KEY
  if (fromEnv != null && fromEnv !== '') {
    if (!isApiKey(fromEnv)) {
      throw new Error(
        'ZODIAC_API_KEY is set but malformed: a valid Zodiac API key starts with "zodiac_". Run `zodiac init` to mint a fresh key.'
      )
    }
    return fromEnv
  }

  if (onMissingKey == null) {
    throw new Error(
      'No Zodiac API key found. Set ZODIAC_API_KEY in your environment, or run `zodiac init` to generate one.'
    )
  }

  const minted = await onMissingKey(rootDir)
  if (!isApiKey(minted)) {
    throw new Error(
      `onMissingKey returned an invalid Zodiac API key (expected a value starting with "zodiac_").`
    )
  }
  return minted
}

const isApiKey = (value: string | undefined): value is `zodiac_${string}` =>
  value != null && value.startsWith('zodiac_')

export { DEFAULT_ABIS_DIR, resolveAbisDir } from '../paths'
