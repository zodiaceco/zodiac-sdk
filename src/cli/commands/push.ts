import { dirname, resolve } from 'node:path'
import { config as loadDotenv } from 'dotenv'
import open from 'open'
import { recordContracts } from '../../allow/project'
import { ConstellationRejectedError, push, specify } from '../../push'
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
  /** Print what would be pushed instead of pushing it, without an API key. */
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
