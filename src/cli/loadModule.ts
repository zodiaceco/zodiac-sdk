import { createJiti } from 'jiti'

const jiti = createJiti(import.meta.url, {
  // Exports as the module declares them: `push` tells a default export from
  // the named ones it pushes.
  interopDefault: false,
  // The SDK the project's files import is the one running this CLI, so what
  // its functions mark on a node is what `push()` checks.
  nativeModules: ['@zodiaceco/sdk'],
})

/**
 * Imports a project file — `zodiac.config.ts` or a constellation entrypoint —
 * under any runtime. Node only strips types from files whose imports name
 * them in full, but projects import `./roles` the way bundlers resolve it.
 */
export const loadModule = (path: string): Promise<Record<string, any>> =>
  jiti.import(path)
