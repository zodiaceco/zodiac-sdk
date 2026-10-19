import { readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'

/** The workspace every org starts with, and the one the template names. */
export const DEFAULT_WORKSPACE = 'Default workspace'

const ENTRYPOINT = join('constellation', 'index.ts')

/**
 * The workspaces of the org the project is authorized for, after `zodiac
 * pull` wrote their accounts to `.zodiac/`. None before.
 */
export const readWorkspaces = (projectDir: string): string[] => {
  try {
    const codegen = createRequire(import.meta.url)(join(projectDir, '.zodiac'))
    return Object.keys(codegen.accounts ?? {})
  } catch {
    return []
  }
}

/** Points the template's constellation at `workspace`. */
export const setWorkspace = (projectDir: string, workspace: string) => {
  const path = join(projectDir, ENTRYPOINT)
  const source = readFileSync(path, 'utf8')

  writeFileSync(
    path,
    // A callback, so `$&` and the like in the name stay as they are.
    source.replace(
      `workspace: ${JSON.stringify(DEFAULT_WORKSPACE)}`,
      () => `workspace: ${JSON.stringify(workspace)}`
    )
  )
}
