import { dirname, resolve } from 'node:path'
import { config as loadDotenv } from 'dotenv'
import open from 'open'
import { recordContracts } from '../../allow/project'
import { check, ConstellationRejectedError, push, specify } from '../../push'
import { loadConfig, loadProjectConfig } from '../config'
import { loadModule } from '../loadModule'
import { findSource } from '../source'

const DEFAULT_ENTRYPOINT = 'constellation/index.ts'

type PushEntrypointOptions = {
  /** The module whose named exports are the nodes to push, relative to the
   * working directory. @default constellation/index.ts in the project root */
  entrypoint?: string
  /** Open every pushed constellation's review page. @default true */
  openInBrowser?: boolean
  /** The config file whose API key to push with, as for `zodiac pull`. */
  config?: string
  /** Where the constellations are defined. @default the repository the
   * entrypoint is checked out from, see {@link findSource} */
  source?: string
  /**
   * Print what would be pushed instead of pushing it, and have Zodiac check it
   * as it would check a push, without storing anything. Without an API key it
   * is printed only.
   */
  dryRun?: boolean
}

/**
 * Pushes every node an entrypoint exports — each export name becomes the
 * node's ref — and prints where each constellation can be reviewed.
 *
 * A constellation Zodiac refuses is printed as the list of what it refused,
 * and the process exits with code 1. Projects that set up globals the
 * entrypoint relies on run their setup first and call this afterwards.
 */
export const pushEntrypoint = async ({
  entrypoint,
  openInBrowser = true,
  config: configPath,
  source,
  dryRun = false,
}: PushEntrypointOptions = {}) => {
  const projectConfig = await loadProjectConfig(configPath)
  const { rootDir } = projectConfig
  // Before the entrypoint, which may read it as it loads.
  loadDotenv({ path: resolve(rootDir, '.env'), quiet: true })
  // From the config as it is now, so `allow` knows every contract it lists,
  // pulled since or not: a fresh clone has no `.zodiac/`, but has the ABIs.
  recordContracts(projectConfig)

  // So the entrypoint's `allow` and `constellation()` read the `.zodiac/` of
  // this config, also when `--config` names one outside the working directory.
  // Only while pushing: a script may go on to another project.
  const { ZODIAC_PROJECT_ROOT } = process.env
  process.env.ZODIAC_PROJECT_ROOT = rootDir

  try {
    await pushProject(rootDir, {
      entrypoint,
      openInBrowser,
      config: configPath,
      source,
      dryRun,
    })
  } finally {
    if (ZODIAC_PROJECT_ROOT === undefined) {
      delete process.env.ZODIAC_PROJECT_ROOT
    } else {
      process.env.ZODIAC_PROJECT_ROOT = ZODIAC_PROJECT_ROOT
    }
  }
}

const pushProject = async (
  rootDir: string,
  {
    entrypoint,
    openInBrowser,
    config: configPath,
    source,
    dryRun,
  }: Required<Pick<PushEntrypointOptions, 'openInBrowser' | 'dryRun'>> &
    PushEntrypointOptions
) => {
  const entrypointPath =
    entrypoint == null
      ? resolve(rootDir, DEFAULT_ENTRYPOINT)
      : resolve(process.cwd(), entrypoint)
  const { default: defaultExport, ...nodes } = await loadModule(entrypointPath)

  if (defaultExport !== undefined) {
    console.warn(
      `warning: ${entrypointPath} has a default export which will be ignored. ` +
        `Use named exports — each export becomes a ref in the pushed spec.`
    )
  }

  if (dryRun) {
    console.log(JSON.stringify(specify(nodes), null, 2))

    await checkProject(nodes, {
      configPath,
      source: source ?? (await findSource(dirname(entrypointPath))),
    })
    return
  }

  const { apiKey } = await loadConfig(configPath)

  try {
    const results = await push(nodes, {
      apiKey,
      source: source ?? (await findSource(dirname(entrypointPath))),
    })

    for (const { url } of results) {
      console.log(`Pushed constellation to: ${url}`)

      if (openInBrowser) {
        await open(url)
      }
    }
  } catch (error) {
    if (!(error instanceof ConstellationRejectedError)) {
      throw error
    }

    console.error(error.message)
    process.exitCode = 1
  }
}

/**
 * Has Zodiac check what a dry run printed, the same way a push would be
 * checked. Status goes to stderr, so the printed specification can still be
 * piped on. A missing API key skips the check rather than failing, so a dry
 * run keeps working offline.
 */
const checkProject = async (
  nodes: Parameters<typeof check>[0],
  { configPath, source }: { configPath?: string; source?: string }
) => {
  const apiKey = await loadConfig(configPath, {
    onMissingKey: async () => {
      throw new MissingApiKeyError()
    },
  }).then(
    (config) => config.apiKey,
    (error: unknown) => {
      if (error instanceof MissingApiKeyError) {
        return null
      }

      throw error
    }
  )

  if (apiKey == null) {
    console.warn(
      'warning: not checked by Zodiac, as no API key was found. Set ZODIAC_API_KEY or run `zodiac init` to have dry runs checked.'
    )
    return
  }

  try {
    await check(nodes, { apiKey, source })

    console.error('Zodiac checked the constellations and found no issues.')
  } catch (error) {
    if (!(error instanceof ConstellationRejectedError)) {
      throw error
    }

    console.error(error.message)
    process.exitCode = 1
  }
}

class MissingApiKeyError extends Error {}
