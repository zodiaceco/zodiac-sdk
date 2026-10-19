import { describe, expect, it, mock } from 'bun:test'

const mockCreate = mock()

mock.module('./commands/create', () => ({ create: mockCreate }))
mock.module('./checkForUpdate', () => ({
  checkForUpdate: () => Promise.resolve(undefined),
  ownVersion: () => '2.8.0',
}))

const { run } = await import('./run')

describe('zodiac create', () => {
  it('hands everything after `create` to @zodiaceco/create', async () => {
    await run(['node', 'zodiac', 'create', 'my-org', '--pm', 'bun', '--yes'])

    expect(mockCreate).toHaveBeenCalledWith('2.8.0', [
      'my-org',
      '--pm',
      'bun',
      '--yes',
    ])
  })

  it("hands it --help too, for @zodiaceco/create's own", async () => {
    mockCreate.mockClear()

    await run(['node', 'zodiac', 'create', '--help'])

    expect(mockCreate).toHaveBeenCalledWith('2.8.0', ['--help'])
  })
})
