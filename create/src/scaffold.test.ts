import { describe, expect, it } from 'bun:test'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { emptyDir, isEmptyDir, scaffold, toPackageName } from './scaffold'

const templateDir = join(import.meta.dir, '..', 'templates', 'constellation')

const scaffoldProject = () => {
  const targetDir = join(mkdtempSync(join(tmpdir(), 'zodiac-create-')), 'org')
  scaffold({ templateDir, targetDir, name: 'my-org', sdkVersion: '2.8.0' })
  return targetDir
}

describe('scaffold', () => {
  it('copies the template', () => {
    const targetDir = scaffoldProject()

    expect(existsSync(join(targetDir, 'constellation', 'index.ts'))).toBe(true)
    expect(existsSync(join(targetDir, 'zodiac.config.ts'))).toBe(true)
  })

  it('names the ignore file for git', () => {
    const targetDir = scaffoldProject()

    expect(existsSync(join(targetDir, '.gitignore'))).toBe(true)
    expect(existsSync(join(targetDir, '_gitignore'))).toBe(false)
  })

  it('names the package and depends on this release of the SDK', () => {
    const packageJson = JSON.parse(
      readFileSync(join(scaffoldProject(), 'package.json'), 'utf8')
    )

    expect(packageJson.name).toBe('my-org')
    expect(packageJson.dependencies['@zodiaceco/sdk']).toBe('^2.8.0')
  })
})

describe('isEmptyDir', () => {
  it('counts a directory with only a git repository as empty', () => {
    const dir = mkdtempSync(join(tmpdir(), 'zodiac-create-'))
    mkdirSync(join(dir, '.git'))

    expect(isEmptyDir(dir)).toBe(true)
    expect(isEmptyDir(join(dir, 'missing'))).toBe(true)

    writeFileSync(join(dir, 'notes.md'), '')
    expect(isEmptyDir(dir)).toBe(false)
  })
})

describe('emptyDir', () => {
  it('keeps the git repository', () => {
    const dir = mkdtempSync(join(tmpdir(), 'zodiac-create-'))
    mkdirSync(join(dir, '.git'))
    writeFileSync(join(dir, 'notes.md'), '')

    emptyDir(dir)

    expect(existsSync(join(dir, '.git'))).toBe(true)
    expect(existsSync(join(dir, 'notes.md'))).toBe(false)
  })
})

describe('toPackageName', () => {
  it('makes a package name of the directory', () => {
    expect(toPackageName('/projects/My Org')).toBe('my-org')
    expect(toPackageName('./.Treasury_Ops!')).toBe('treasury_ops')
    expect(toPackageName('/projects/!!!')).toBe('zodiac-constellation')
  })
})
