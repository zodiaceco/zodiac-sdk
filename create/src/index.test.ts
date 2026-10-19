import { describe, expect, it } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const cli = join(import.meta.dir, 'index.ts')

/** Runs the command without a terminal, as in CI, in a fresh directory. */
const create = (...args: string[]) => {
  const cwd = mkdtempSync(join(tmpdir(), 'zodiac-create-'))
  const { status, stdout, stderr } = spawnSync(
    'bun',
    [cli, ...args, '--no-install', '--no-git'],
    { cwd, encoding: 'utf8' }
  )
  return { cwd, status, output: stdout + stderr }
}

describe('create', () => {
  it('creates the project in the directory it is given', () => {
    const { cwd, status, output } = create('my-org')

    expect(status).toBe(0)
    expect(existsSync(join(cwd, 'my-org', 'constellation', 'index.ts'))).toBe(
      true
    )
    expect(output).toContain('cd my-org')
  })

  it('takes a default directory without a terminal to ask in', () => {
    const { cwd, status } = create()

    expect(status).toBe(0)
    expect(existsSync(join(cwd, 'zodiac-constellation', 'package.json'))).toBe(
      true
    )
  })

  it('leaves a directory that is not empty alone', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'zodiac-create-'))
    mkdirSync(join(cwd, 'my-org'))
    writeFileSync(join(cwd, 'my-org', 'notes.md'), '')

    const { status } = spawnSync(
      'bun',
      [cli, 'my-org', '--no-install', '--no-git'],
      { cwd, encoding: 'utf8' }
    )

    expect(status).toBe(1)
    expect(existsSync(join(cwd, 'my-org', 'notes.md'))).toBe(true)
    expect(existsSync(join(cwd, 'my-org', 'package.json'))).toBe(false)
  })

  it('empties a directory with --overwrite', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'zodiac-create-'))
    mkdirSync(join(cwd, 'my-org'))
    writeFileSync(join(cwd, 'my-org', 'notes.md'), '')

    const { status } = spawnSync(
      'bun',
      [cli, 'my-org', '--overwrite', '--no-install', '--no-git'],
      { cwd, encoding: 'utf8' }
    )

    expect(status).toBe(0)
    expect(existsSync(join(cwd, 'my-org', 'notes.md'))).toBe(false)
    expect(existsSync(join(cwd, 'my-org', 'package.json'))).toBe(true)
  })

  it('refuses a package manager it does not know', () => {
    const { status, output } = create('my-org', '--pm', 'deno')

    expect(status).toBe(1)
    expect(output).toContain('--pm must be one of npm, pnpm, yarn, bun')
  })

  it('commits the project to a repository of its own', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'zodiac-create-'))

    spawnSync('bun', [cli, 'my-org', '--no-install'], {
      cwd,
      encoding: 'utf8',
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: 'Test',
        GIT_AUTHOR_EMAIL: 'test@example.com',
        GIT_COMMITTER_NAME: 'Test',
        GIT_COMMITTER_EMAIL: 'test@example.com',
      },
    })

    const log = spawnSync('git', ['log', '--format=%s'], {
      cwd: join(cwd, 'my-org'),
      encoding: 'utf8',
    })
    expect(log.stdout.trim()).toBe('Initial commit from @zodiaceco/create')
  })
})
