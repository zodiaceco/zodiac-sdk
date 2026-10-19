export const PACKAGE_MANAGERS = ['npm', 'pnpm', 'yarn', 'bun'] as const

export type PackageManager = (typeof PACKAGE_MANAGERS)[number]

export const isPackageManager = (name: unknown): name is PackageManager =>
  PACKAGE_MANAGERS.includes(name as PackageManager)

/**
 * The package manager this runs under: `npm create`, `pnpm create`,
 * `yarn create` and `bun create` each say so in `npm_config_user_agent`.
 */
export const detectPackageManager = (
  userAgent: string | undefined = process.env.npm_config_user_agent
): PackageManager => {
  const name = userAgent?.split('/')[0]
  return isPackageManager(name) ? name : 'npm'
}

/** The command that runs a `package.json` script with `packageManager`. */
export const runScript = (
  packageManager: PackageManager,
  script: string
): string[] => {
  switch (packageManager) {
    case 'npm':
    case 'bun':
      return [packageManager, 'run', script]
    default:
      return [packageManager, script]
  }
}
