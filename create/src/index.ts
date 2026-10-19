#!/usr/bin/env node
import * as prompts from '@clack/prompts'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import {
  detectPackageManager,
  isPackageManager,
  PACKAGE_MANAGERS,
  runScript,
  type PackageManager,
} from './packageManager'
import { emptyDir, isEmptyDir, scaffold, toPackageName } from './scaffold'
import { DEFAULT_WORKSPACE, readWorkspaces, setWorkspace } from './workspace'

const HELP = `Usage: npm create @zodiaceco [directory] [options]

Starts a Zodiac constellation project in [directory].

Options:
  --pm <name>      package manager to install with: ${PACKAGE_MANAGERS.join(', ')} (default: the one running this)
  --no-install     don't install dependencies
  --no-git         don't initialize a git repository
  --no-auth        don't connect the project to Zodiac
  --overwrite      empty a directory that isn't empty
  -y, --yes        don't ask, take the defaults
  -h, --help       print this help
  -v, --version    print the version
`

const DEFAULT_DIRECTORY = 'zodiac-constellation'

// Both resolve from `src/` as from `dist/`, one level below the package.
const ownVersion: string = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8')
).version
const templateDir = fileURLToPath(
  new URL('../templates/constellation', import.meta.url)
)

const main = async () => {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      pm: { type: 'string' },
      'no-install': { type: 'boolean' },
      'no-git': { type: 'boolean' },
      'no-auth': { type: 'boolean' },
      overwrite: { type: 'boolean' },
      yes: { type: 'boolean', short: 'y' },
      help: { type: 'boolean', short: 'h' },
      version: { type: 'boolean', short: 'v' },
    },
  })

  if (values.help) return console.log(HELP)
  if (values.version) return console.log(ownVersion)

  if (values.pm != null && !isPackageManager(values.pm)) {
    throw new UsageError(
      `--pm must be one of ${PACKAGE_MANAGERS.join(', ')}, not "${values.pm}".`
    )
  }

  // Without a terminal to answer in — CI, a pipe — take the defaults.
  const interactive = process.stdin.isTTY === true && !values.yes
  const packageManager: PackageManager =
    (values.pm as PackageManager | undefined) ?? detectPackageManager()

  prompts.intro('Zodiac constellation')

  const directory =
    positionals[0] ??
    (interactive
      ? orCancel(
          await prompts.text({
            message: 'Where should the project go?',
            placeholder: DEFAULT_DIRECTORY,
            defaultValue: DEFAULT_DIRECTORY,
          })
        )
      : DEFAULT_DIRECTORY)
  const targetDir = resolve(directory)

  if (!isEmptyDir(targetDir)) {
    const overwrite =
      values.overwrite ||
      (interactive &&
        orCancel(
          await prompts.confirm({
            message: `${directory} isn't empty. Remove what's in it?`,
            initialValue: false,
          })
        ))

    if (!overwrite) {
      throw new UsageError(
        `${directory} isn't empty. Pick another directory, or pass --overwrite.`
      )
    }
    emptyDir(targetDir)
  }

  scaffold({
    templateDir,
    targetDir,
    name: toPackageName(targetDir),
    sdkVersion: ownVersion,
  })
  prompts.log.success(`Created the project in ${directory}`)

  const install =
    !values['no-install'] &&
    (!interactive ||
      orCancel(
        await prompts.confirm({
          message: `Install dependencies with ${packageManager}?`,
        })
      ))
  const installed = install && run([packageManager, 'install'], targetDir)
  if (install && !installed) {
    prompts.log.warn(`Installing with ${packageManager} failed.`)
  }

  // Opens a browser to sign in, so only for someone at the terminal.
  const connect =
    installed &&
    interactive &&
    !values['no-auth'] &&
    orCancel(
      await prompts.confirm({
        message:
          'Connect the project to Zodiac now? This opens your browser to sign in.',
      })
    )
  const connected = connect && run(runScript(packageManager, 'pull'), targetDir)
  if (connect && !connected) {
    prompts.log.warn('Connecting to Zodiac failed.')
  }
  if (connected) await pickWorkspace(targetDir)

  // Last, so the first commit has the workspace picked.
  if (!values['no-git']) initGit(targetDir)

  const next = [
    `cd ${shellQuote(relative(process.cwd(), targetDir) || '.')}`,
    !installed && `${packageManager} install`,
    !connected && runScript(packageManager, 'pull').join(' '),
    'edit constellation/index.ts and constellation/roles/',
    runScript(packageManager, 'push').join(' '),
  ].filter(Boolean)

  prompts.note(next.join('\n'), 'Next steps')
  prompts.outro('README.md explains the rest.')
}

/** Points the constellation at the org's workspace, asking if it has several. */
const pickWorkspace = async (targetDir: string) => {
  const workspaces = readWorkspaces(targetDir)
  if (workspaces.length === 0) return

  const workspace =
    workspaces.length === 1
      ? workspaces[0]!
      : orCancel(
          await prompts.select({
            message: 'Which workspace is the constellation for?',
            options: workspaces.map((value) => ({ value, label: value })),
            initialValue: workspaces.includes(DEFAULT_WORKSPACE)
              ? DEFAULT_WORKSPACE
              : workspaces[0],
          })
        )

  if (workspace !== DEFAULT_WORKSPACE) {
    setWorkspace(targetDir, workspace)
    prompts.log.success(
      `The constellation is for the workspace "${workspace}".`
    )
  }
}

/** Commits the new project to a repository of its own, if git is there. */
const initGit = (targetDir: string) => {
  const git = (...args: string[]) =>
    spawnSync('git', args, { cwd: targetDir, stdio: 'ignore' }).status === 0

  if (!git('--version')) return
  // Part of a repository already, e.g. a monorepo: leave committing to it.
  if (git('rev-parse', '--is-inside-work-tree')) return

  if (!git('init', '--quiet')) return
  if (
    git('add', '--all') &&
    git('commit', '--quiet', '-m', 'Initial commit from @zodiaceco/create')
  ) {
    prompts.log.success('Initialized a git repository')
  } else {
    prompts.log.info('Initialized a git repository, without committing to it.')
  }
}

/** Runs a command in `cwd` with its output shown. True if it succeeded. */
const run = ([command, ...args]: string[], cwd: string) =>
  spawnSync(command!, args, {
    cwd,
    stdio: 'inherit',
    // Windows starts package managers through their `.cmd` shims.
    shell: process.platform === 'win32',
  }).status === 0

const shellQuote = (path: string) =>
  /^[\w./~-]+$/.test(path) ? path : `"${path.replace(/(["\\$`])/g, '\\$1')}"`

class UsageError extends Error {}

/** An answer, or the end of the run when it was cancelled with Ctrl-C. */
const orCancel = <T>(value: T): Exclude<T, symbol> => {
  if (prompts.isCancel(value)) {
    prompts.cancel('Cancelled.')
    process.exit(1)
  }
  return value as Exclude<T, symbol>
}

main().catch((error: unknown) => {
  if (error instanceof UsageError) {
    prompts.cancel(error.message)
  } else {
    console.error(error)
  }
  process.exit(1)
})
