import { Command } from 'commander'
import { config as loadDotenv } from 'dotenv'
import { checkForUpdate, ownVersion } from './checkForUpdate'
import { create } from './commands/create'
import { init } from './commands/init'
import { loadConfig, loadProjectConfig } from './config'
import { pullOrg } from './commands/pullOrg'
import { pullContracts } from './commands/pullContracts'
import { pushEntrypoint } from './commands/push'

// Load `.env` from the current working directory before reading any env vars.
loadDotenv({ quiet: true })

const loadConfigOrInit = (configPath: string) =>
  loadConfig(configPath, {
    createIfMissing: true,
    onMissingKey: async (rootDir) => {
      console.log(
        'No ZODIAC_API_KEY found. Starting authorization to mint one for this directory…'
      )
      return init({ rootDir })
    },
  })

export const run = async (argv: string[] = process.argv) => {
  const program = new Command()

  program
    .name('zodiac')
    .description(
      'Zodiac SDK CLI – pull org data and contract ABIs, push constellations'
    )
    .version(ownVersion())
    .option(
      '-c, --config <path>',
      'path to the config file',
      'zodiac.config.ts'
    )

  // Started before the command so the registry round trip rides along with
  // the command's own work, printed after it so the notice is the last thing
  // on screen — and not at all when the command fails, where it would only
  // distract from the error. On stderr, so piped output stays clean.
  let updateNotice: Promise<string | null> = Promise.resolve(null)

  program.hook('preAction', () => {
    updateNotice = checkForUpdate()
  })

  program.hook('postAction', async () => {
    const notice = await updateNotice

    // A command that reports its own failure sets the exit code instead of
    // throwing, which still runs this hook.
    if (notice != null && !process.exitCode) {
      console.warn(`\n${notice}`)
    }
  })

  program
    .command('pull')
    .description(
      'Fetch Zodiac org data and contract ABIs, generating typed SDK functions. Authorizes this directory automatically on first run.'
    )
    .action(async (_opts, cmd) => {
      const config = await loadConfigOrInit(cmd.optsWithGlobals().config)
      await Promise.all([pullOrg(config), pullContracts(config)])
    })

  program
    .command('pull-org')
    .description('Fetch Zodiac users and accounts, generate TypeScript types')
    .action(async (_opts, cmd) => {
      const config = await loadConfigOrInit(cmd.optsWithGlobals().config)
      await pullOrg(config)
    })

  program
    .command('pull-contracts')
    .description(
      'Fetch contract ABIs, generate typed permissions kit. Needs no API key.'
    )
    .option(
      '--module <file>',
      'write the kit types to <file> as an exported `AllowKit` instead of augmenting the global one (for packages)'
    )
    .action(async (opts: { module?: string }, cmd) => {
      // Fetching ABIs never calls the Zodiac API, so this doesn't ask for a
      // key, let alone start authorization to mint one.
      const config = await loadProjectConfig(cmd.optsWithGlobals().config, {
        createIfMissing: true,
      })
      await pullContracts(config, { module: opts.module })
    })

  program
    .command('push')
    .description(
      'Push the nodes an entrypoint exports to Zodiac and open them for review. Projects that set up globals for their entrypoint call `pushEntrypoint` from `@zodiaceco/sdk/cli/push` after that setup instead.'
    )
    .argument(
      '[entrypoint]',
      'module exporting the nodes (default: constellation/index.ts in the project root)'
    )
    .option('--no-open', 'do not open the review pages in a browser')
    .option(
      '--dry-run',
      'print what would be pushed instead of pushing it (needs no API key)'
    )
    .option(
      '--source <url>',
      'where the constellations are defined (default: ZODIAC_SOURCE, or the git repository the entrypoint is checked out from)'
    )
    .action(
      async (
        entrypoint: string | undefined,
        opts: { open: boolean; source?: string; dryRun?: boolean },
        cmd
      ) => {
        await pushEntrypoint({
          entrypoint,
          openInBrowser: opts.open,
          config: cmd.optsWithGlobals().config,
          source: opts.source,
          dryRun: opts.dryRun,
        })
      }
    )

  program
    .command('create')
    .description(
      'Start a constellation project, like `npm create @zodiaceco` (`zodiac create --help` for its options)'
    )
    .argument('[directory]', 'where the project goes')
    // Everything after `create` is for `@zodiaceco/create`, `--help` included:
    // the values of its options too, which commander counts as arguments.
    .allowUnknownOption()
    .allowExcessArguments()
    .helpOption(false)
    .action(() => {
      create(ownVersion(), argv.slice(argv.indexOf('create') + 1))
    })

  program
    .command('init')
    .description(
      'Re-authorize this directory / mint a new API key (run automatically by `pull` on first use).'
    )
    .option(
      '--app-url <url>',
      'Override the Zodiac app URL (defaults to ZODIAC_APP_URL or app.zodiac.eco)'
    )
    .action(async (opts) => {
      await init({ appUrl: opts.appUrl })
    })

  await program.parseAsync(argv)
}
