import { afterEach, describe, expect, it, mock, spyOn } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ApiRequestError } from '../../api'
import { ConstellationRejectedError } from '../../push'

const mockPush = mock()
const mockSpecify = mock()

mock.module('../../push', () => ({
  ConstellationRejectedError,
  push: mockPush,
  specify: mockSpecify,
}))

const { pushEntrypoint } = await import('./push')

/**
 * An entrypoint module exporting nothing to push, next to a config file
 * holding the API key to push with.
 */
const createProject = () => {
  const dir = mkdtempSync(join(tmpdir(), 'zodiac-push-test-'))
  const entrypoint = join(dir, 'index.ts')
  const config = join(dir, 'zodiac.config.ts')

  writeFileSync(entrypoint, 'export {}\n')
  writeFileSync(config, "export default { apiKey: 'zodiac_from_config' }\n")

  return { entrypoint, config }
}

describe('pushEntrypoint', () => {
  afterEach(() => {
    process.exitCode = 0
    mockPush.mockReset()
    mockSpecify.mockReset()
  })

  it('prints what Zodiac refused and fails without a stack trace', async () => {
    mockPush.mockRejectedValue(
      new ConstellationRejectedError(
        'Production',
        new ApiRequestError('Some policies cannot be held in Zodiac', {
          status: 400,
          statusText: 'Bad Request',
          details: {
            issues: [
              {
                path: ['specification', 0, 'roles', 'treasury_ops', 'policy'],
                message: 'Mark this role as that policy too.',
              },
            ],
          },
        }),
        () => 'opsRoles ("Ops Roles")'
      )
    )

    const error = spyOn(console, 'error').mockImplementation(() => {})

    await pushEntrypoint({ ...createProject(), openInBrowser: false })

    expect(error).toHaveBeenCalledWith(
      [
        'Zodiac refused the constellation "Production". Some policies cannot be held in Zodiac:',
        '  • opsRoles ("Ops Roles") › roles › treasury_ops › policy: Mark this role as that policy too.',
      ].join('\n')
    )
    expect(process.exitCode).toBe(1)

    error.mockRestore()
  })

  it('prints where each pushed constellation can be reviewed', async () => {
    mockPush.mockResolvedValue([{ id: '1', url: 'https://app.zodiac.eco/c/1' }])

    const log = spyOn(console, 'log').mockImplementation(() => {})

    await pushEntrypoint({ ...createProject(), openInBrowser: false })

    expect(log).toHaveBeenCalledWith(
      'Pushed constellation to: https://app.zodiac.eco/c/1'
    )

    log.mockRestore()
  })

  it('pushes with the API key from the config file', async () => {
    mockPush.mockResolvedValue([])

    await pushEntrypoint({ ...createProject(), openInBrowser: false })

    expect(mockPush).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ apiKey: 'zodiac_from_config' })
    )
  })

  it("pushes the project root's constellation by default, wherever it runs", async () => {
    mockPush.mockResolvedValue([])

    const { config } = createProject()
    const root = join(config, '..')

    mkdirSync(join(root, 'constellation'))
    writeFileSync(
      join(root, 'constellation', 'index.ts'),
      'export const ops = "from the root"\n'
    )

    await pushEntrypoint({ config, openInBrowser: false })

    expect(mockPush).toHaveBeenCalledWith(
      { ops: 'from the root' },
      expect.anything()
    )
  })

  it('loads an entrypoint that imports a directory', async () => {
    mockPush.mockResolvedValue([])

    const { entrypoint, config } = createProject()
    const root = join(config, '..')

    mkdirSync(join(root, 'roles'))
    writeFileSync(
      join(root, 'roles', 'index.ts'),
      'export const ops: string = "ops"\n'
    )
    writeFileSync(entrypoint, 'export { ops } from "./roles"\n')

    await pushEntrypoint({ entrypoint, config, openInBrowser: false })

    expect(mockPush).toHaveBeenCalledWith({ ops: 'ops' }, expect.anything())
  })

  it("loads the project's .env before the entrypoint", async () => {
    mockPush.mockResolvedValue([])

    const { entrypoint, config } = createProject()
    writeFileSync(join(config, '..', '.env'), 'FIXTURE_TREASURY=0x1234\n')
    writeFileSync(
      entrypoint,
      'export const treasury = process.env.FIXTURE_TREASURY\n'
    )

    try {
      await pushEntrypoint({ entrypoint, config, openInBrowser: false })
    } finally {
      delete process.env.FIXTURE_TREASURY
    }

    expect(mockPush).toHaveBeenCalledWith(
      { treasury: '0x1234' },
      expect.anything()
    )
  })

  it("points the entrypoint at the config's project", async () => {
    mockPush.mockResolvedValue([])

    const { entrypoint, config } = createProject()
    writeFileSync(
      entrypoint,
      'export const root = process.env.ZODIAC_PROJECT_ROOT\n'
    )

    await pushEntrypoint({ entrypoint, config, openInBrowser: false })

    expect(mockPush).toHaveBeenCalledWith(
      { root: join(config, '..') },
      expect.anything()
    )
    // Only while pushing: a script may go on to another project.
    expect(process.env.ZODIAC_PROJECT_ROOT).toBeUndefined()
  })

  it("builds the entrypoint's allow kit from the config, before any pull", async () => {
    mockSpecify.mockReturnValue([])

    const { entrypoint, config } = createProject()
    const root = join(config, '..')
    const weth = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2'

    writeFileSync(
      config,
      `export default { contracts: { eth: { weth: '${weth}' } } }\n`
    )
    mkdirSync(join(root, 'abis', 'eth'), { recursive: true })
    writeFileSync(
      join(root, 'abis', 'eth', 'weth.json'),
      JSON.stringify([
        {
          type: 'function',
          name: 'deposit',
          inputs: [],
          outputs: [],
          stateMutability: 'payable',
        },
      ])
    )
    writeFileSync(
      entrypoint,
      [
        `import { allow } from ${JSON.stringify(join(import.meta.dir, '..', '..', 'allow', 'project'))}`,
        'export const deposit = allow.eth.weth.deposit()',
        '',
      ].join('\n')
    )

    const log = spyOn(console, 'log').mockImplementation(() => {})
    try {
      await pushEntrypoint({ entrypoint, config, dryRun: true })
    } finally {
      log.mockRestore()
    }

    expect(mockSpecify).toHaveBeenCalledWith({
      deposit: expect.objectContaining({ targetAddress: weth }),
    })
  })

  it('prints what it would push without an API key on a dry run', async () => {
    mockSpecify.mockReturnValue([{ label: 'Ops', specification: [] }])

    const { entrypoint, config } = createProject()
    writeFileSync(config, 'export default {}\n')
    writeFileSync(entrypoint, 'export const ops = "ops"\n')

    const { ZODIAC_API_KEY } = process.env
    delete process.env.ZODIAC_API_KEY
    const log = spyOn(console, 'log').mockImplementation(() => {})

    try {
      await pushEntrypoint({ entrypoint, config, dryRun: true })

      expect(mockSpecify).toHaveBeenCalledWith({ ops: 'ops' })
      expect(log).toHaveBeenCalledWith(
        JSON.stringify([{ label: 'Ops', specification: [] }], null, 2)
      )
      expect(mockPush).not.toHaveBeenCalled()
    } finally {
      log.mockRestore()
      if (ZODIAC_API_KEY != null) process.env.ZODIAC_API_KEY = ZODIAC_API_KEY
    }
  })

  it('pushes the repository the entrypoint is checked out from as its source', async () => {
    mockPush.mockResolvedValue([])

    const project = createProject()
    const root = join(project.config, '..')

    spawnSync('git', ['init', '--quiet', root])
    spawnSync('git', [
      '-C',
      root,
      'remote',
      'add',
      'origin',
      'git@github.com:gnosisguild/treasury.git',
    ])

    const { GITHUB_SERVER_URL, GITHUB_REPOSITORY, ZODIAC_SOURCE } = process.env
    delete process.env.GITHUB_SERVER_URL
    delete process.env.GITHUB_REPOSITORY
    delete process.env.ZODIAC_SOURCE

    try {
      await pushEntrypoint({ ...project, openInBrowser: false })
    } finally {
      Object.assign(process.env, {
        GITHUB_SERVER_URL,
        GITHUB_REPOSITORY,
        ZODIAC_SOURCE,
      })
    }

    expect(mockPush).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        source: 'https://github.com/gnosisguild/treasury',
      })
    )
  })

  it('pushes the source it is given', async () => {
    mockPush.mockResolvedValue([])

    await pushEntrypoint({
      ...createProject(),
      openInBrowser: false,
      source: 'https://example.com/treasury',
    })

    expect(mockPush).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ source: 'https://example.com/treasury' })
    )
  })
})
