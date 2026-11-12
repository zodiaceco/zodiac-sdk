import { describe, expect, it } from 'bun:test'
import { readFile } from 'node:fs/promises'
import type { allow } from 'defi-kit/eth'
import { generate, outputPath } from '../../scripts/generate-defikit-types'
import { defikit } from '../actions'
import type { DeFiKitParams } from '../defiKit.generated'

// `defikit()` is typed against a flattened copy of DeFi Kit's parameters, so
// that DeFi Kit stays a devDependency. These checks keep the copy in step with
// the installed defi-kit.

type Kit = typeof allow
type KitParams = {
  [Protocol in keyof Kit]: {
    [Verb in keyof Kit[Protocol]]: Kit[Protocol][Verb] extends () => unknown
      ? {}
      : Kit[Protocol][Verb] extends (params: infer Params) => unknown
        ? Params
        : never
  }
}
type Equals<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false

// Fails type-checking when the copy differs from defi-kit's own types.
const sameAsDefiKit: Equals<DeFiKitParams, KitParams> = true

describe('DeFi Kit types', () => {
  it('match the installed defi-kit (run `bun run generate:defikit`)', async () => {
    expect(sameAsDefiKit).toBe(true)
    expect(await readFile(outputPath, 'utf8')).toBe(await generate())
  }, 30_000)

  it('refuse parameters the kit does not take', () => {
    const typeErrors = () => [
      // @ts-expect-error not a market of the kit
      defikit.aave_v3.deposit({ label: 'x', market: 'Nope', targets: [] }),
      defikit.aave_v3.deposit({
        label: 'x',
        market: 'Core',
        // @ts-expect-error not a token the market lists
        targets: ['NOPE'],
      }),
      // @ts-expect-error a label is required
      defikit.aave_v3.deposit({ market: 'Core', targets: ['WETH'] }),
      // @ts-expect-error not a protocol of the kit
      defikit.nope_v1,
    ]
    expect(typeErrors).toBeFunction()
  })
})
