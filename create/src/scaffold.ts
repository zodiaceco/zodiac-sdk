import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { basename, join, resolve } from 'node:path'

type ScaffoldOptions = {
  /** The template to copy, e.g. `templates/constellation`. */
  templateDir: string
  /** Where the project goes. Created if missing. */
  targetDir: string
  /** The project's package name. */
  name: string
  /** The `@zodiaceco/sdk` release the project depends on, as `^version`. */
  sdkVersion: string
}

/** Copies the template into `targetDir` and makes it the project `name`. */
export const scaffold = ({
  templateDir,
  targetDir,
  name,
  sdkVersion,
}: ScaffoldOptions) => {
  mkdirSync(targetDir, { recursive: true })
  cpSync(templateDir, targetDir, { recursive: true })

  // npm leaves a package's `.gitignore` out, so the template keeps it as this.
  renameSync(join(targetDir, '_gitignore'), join(targetDir, '.gitignore'))

  const packageJsonPath = join(targetDir, 'package.json')
  const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'))

  packageJson.name = name
  packageJson.dependencies['@zodiaceco/sdk'] = `^${sdkVersion}`

  writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2) + '\n')
}

/** Whether `dir` is missing or holds nothing but a git repository. */
export const isEmptyDir = (dir: string) =>
  !existsSync(dir) || readdirSync(dir).every((entry) => entry === '.git')

/** Removes everything in `dir` but its git repository. */
export const emptyDir = (dir: string) => {
  for (const entry of readdirSync(dir)) {
    if (entry !== '.git') {
      rmSync(join(dir, entry), { recursive: true, force: true })
    }
  }
}

/** A valid package name after the directory the project goes in. */
export const toPackageName = (targetDir: string) =>
  basename(resolve(targetDir))
    .toLowerCase()
    .replace(/[^a-z0-9._~-]+/g, '-')
    .replace(/^[._-]+|-+$/g, '') || 'zodiac-constellation'
