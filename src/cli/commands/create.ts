import { spawnSync } from 'node:child_process'

// Named after the package, so `npm create @zodiaceco`, `pnpm dlx` and `bunx`
// all find it.
const BIN = 'create'

/**
 * The command that runs `@zodiaceco/create` at `version` with `args`, through
 * the package manager running this, so the project gets installed with it.
 */
export const createCommand = (
  version: string,
  args: string[],
  userAgent: string | undefined = process.env.npm_config_user_agent
): string[] => {
  const pkg = `@zodiaceco/create@${version}`
  const [name, managerVersion = ''] = userAgent?.split(' ')[0]?.split('/') ?? []

  switch (name) {
    case 'bun':
      return ['bunx', '--package', pkg, BIN, ...args]
    case 'pnpm':
      return ['pnpm', '--package', pkg, 'dlx', BIN, ...args]
    // Yarn 1 has no `dlx`.
    case 'yarn':
      if (Number.parseInt(managerVersion) >= 2) {
        return ['yarn', 'dlx', '--package', pkg, BIN, ...args]
      }
  }
  return ['npx', '--yes', '--package', pkg, BIN, ...args]
}

/** `zodiac create`: starts a project the way `npm create @zodiaceco` does. */
export const create = (version: string, args: string[]) => {
  const [command, ...rest] = createCommand(version, args)
  const { status, error } = spawnSync(command!, rest, {
    stdio: 'inherit',
    // Windows starts package managers through their `.cmd` shims.
    shell: process.platform === 'win32',
  })

  if (error) throw error
  process.exitCode = status ?? 1
}
