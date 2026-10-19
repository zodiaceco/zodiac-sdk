import { describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { scaffold } from './scaffold'
import { readWorkspaces, setWorkspace } from './workspace'

const templateDir = join(import.meta.dir, '..', 'templates', 'constellation')

const scaffoldProject = () => {
  const targetDir = join(mkdtempSync(join(tmpdir(), 'zodiac-create-')), 'org')
  scaffold({ templateDir, targetDir, name: 'org', sdkVersion: '2.8.0' })
  return targetDir
}

describe('readWorkspaces', () => {
  it('reads the workspaces `zodiac pull` found', () => {
    const projectDir = scaffoldProject()
    mkdirSync(join(projectDir, '.zodiac'))
    writeFileSync(
      join(projectDir, '.zodiac', 'index.js'),
      'module.exports = { users: {}, accounts: { Treasury: {}, Ops: {} } }\n'
    )

    expect(readWorkspaces(projectDir)).toEqual(['Treasury', 'Ops'])
  })

  it('reads none before a pull', () => {
    expect(readWorkspaces(scaffoldProject())).toEqual([])
  })
})

describe('setWorkspace', () => {
  it('points the constellation at the workspace', () => {
    const projectDir = scaffoldProject()

    setWorkspace(projectDir, 'GG "Treasury"')

    expect(
      readFileSync(join(projectDir, 'constellation', 'index.ts'), 'utf8')
    ).toContain('workspace: "GG \\"Treasury\\"",')
  })

  it('keeps a name that looks like a replacement pattern', () => {
    const projectDir = scaffoldProject()

    setWorkspace(projectDir, "Ops $& $'")

    expect(
      readFileSync(join(projectDir, 'constellation', 'index.ts'), 'utf8')
    ).toContain(`workspace: "Ops $& $'",`)
  })
})
