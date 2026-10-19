import { describe, expect, it } from 'bun:test'
import { createCommand } from './create'

describe('createCommand', () => {
  it('runs @zodiaceco/create at the version of the SDK', () => {
    expect(
      createCommand('2.8.0', ['my-org'], 'npm/11.6.0 node/v24.14.0')
    ).toEqual([
      'npx',
      '--yes',
      '--package',
      '@zodiaceco/create@2.8.0',
      'create',
      'my-org',
    ])
  })

  it('runs it through the package manager running the SDK', () => {
    expect(createCommand('2.8.0', [], 'bun/1.3.12 npm/? node/v24.3.0')).toEqual(
      ['bunx', '--package', '@zodiaceco/create@2.8.0', 'create']
    )
    expect(
      createCommand('2.8.0', [], 'pnpm/10.18.0 npm/? node/v24.14.0')
    ).toEqual(['pnpm', '--package', '@zodiaceco/create@2.8.0', 'dlx', 'create'])
    expect(
      createCommand('2.8.0', [], 'yarn/4.9.1 npm/? node/v24.14.0')
    ).toEqual(['yarn', 'dlx', '--package', '@zodiaceco/create@2.8.0', 'create'])
  })

  it('falls back to npx where there is no dlx', () => {
    expect(
      createCommand('2.8.0', [], 'yarn/1.22.19 npm/? node/v24.14.0')[0]
    ).toBe('npx')
    expect(createCommand('2.8.0', [], '')[0]).toBe('npx')
  })
})
