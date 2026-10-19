import { describe, expect, it } from 'bun:test'
import { detectPackageManager, runScript } from './packageManager'

describe('detectPackageManager', () => {
  it('reads the package manager from its user agent', () => {
    expect(detectPackageManager('pnpm/10.18.0 npm/? node/v24.14.0')).toBe(
      'pnpm'
    )
    expect(detectPackageManager('bun/1.3.12 npm/? node/v24.3.0')).toBe('bun')
    expect(detectPackageManager('yarn/4.9.1 npm/? node/v24.14.0')).toBe('yarn')
  })

  it('falls back to npm', () => {
    expect(detectPackageManager('')).toBe('npm')
    expect(detectPackageManager('deno/2.5.0')).toBe('npm')
  })
})

describe('runScript', () => {
  it('runs a script the way each package manager does', () => {
    expect(runScript('npm', 'push')).toEqual(['npm', 'run', 'push'])
    expect(runScript('bun', 'push')).toEqual(['bun', 'run', 'push'])
    expect(runScript('pnpm', 'push')).toEqual(['pnpm', 'push'])
    expect(runScript('yarn', 'push')).toEqual(['yarn', 'push'])
  })
})
