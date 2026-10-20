import { describe, it, expect, mock } from 'bun:test'
import * as actions from '../actions'
import { custom, defikit, swap, transfer } from '../actions'
import { constellation } from '../constellation'
import { push } from '../push'
import * as codegen from './codegen.mock'

const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'

function mockApi() {
  const mockApply = mock(() => Promise.resolve({ ok: true }))
  const api = { applyConstellation: mockApply } as any
  const lastPayload = () => (mockApply.mock.calls[0] as any)[1] as any
  return { api, lastPayload }
}
const WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'

describe('actions', () => {
  it('publishes the four helpers and nothing else', () => {
    // `@zodiaceco/sdk/actions` is a published entrypoint: everything exported
    // here is API we owe consumers. Entry shapes and the rendering `push()`
    // does live in ./permissionEntries so they stay private.
    expect(Object.keys(actions).sort()).toEqual([
      'custom',
      'defikit',
      'swap',
      'transfer',
    ])
  })

  it('describes a swap by its parameters', () => {
    expect(
      swap({ label: 'Rebalance stables', sell: [USDC], buy: [WETH] })
    ).toEqual({
      label: 'Rebalance stables',
      action: { type: 'swap', sell: [USDC], buy: [WETH] },
    })
  })

  it('describes a swap by the allowance keys that cap each side', () => {
    expect(
      swap({
        label: 'Rebalance stables',
        sell: [USDC],
        buy: [WETH],
        sellAllowance: 'usdc_sell',
        buyAllowance: 'weth_buy',
      })
    ).toEqual({
      label: 'Rebalance stables',
      action: {
        type: 'swap',
        sell: [USDC],
        buy: [WETH],
        sellAllowance: 'usdc_sell',
        buyAllowance: 'weth_buy',
      },
    })
  })

  it('takes the key of an allowance passed to a swap', () => {
    const allowance = {
      key: '0x757364635f73656c6c0000000000000000000000000000000000000000000000',
      refill: 0n,
      maxRefill: 0n,
      period: 0n,
      balance: 0n,
      timestamp: 0n,
    } as const

    expect(
      swap({
        label: 'Rebalance stables',
        sell: [USDC],
        buy: [WETH],
        sellAllowance: allowance,
      }).action
    ).toEqual({
      type: 'swap',
      sell: [USDC],
      buy: [WETH],
      sellAllowance: allowance.key,
    })
  })

  it('describes a transfer by the allowance key that caps it', () => {
    // An encoded key here, not a label: `AllowanceSpec` is typed from the
    // published api-types, which still pins `key` to hex. Both forms resolve
    // to the same on-chain key, and the label form types once api-types ships
    // the relaxed schema.
    const allowance = {
      key: '0x757364635f7061796f7574730000000000000000000000000000000000000000',
      refill: 0n,
      maxRefill: 0n,
      period: 0n,
      balance: 0n,
      timestamp: 0n,
    } as const

    expect(
      transfer({
        label: 'Grant payouts',
        tokens: [USDC],
        to: [WETH],
        allowance,
      })
    ).toEqual({
      label: 'Grant payouts',
      action: {
        type: 'transfer',
        tokens: [USDC],
        to: [WETH],
        allowance:
          '0x757364635f7061796f7574730000000000000000000000000000000000000000',
      },
    })
  })

  it('takes the bridge destination from the recipient nodes', () => {
    const gno = constellation(
      { workspace: 'GG', label: 'test', chain: 100 },
      { codegen }
    )

    expect(
      transfer({
        label: 'Grant payouts',
        tokens: [USDC],
        bridge: [{ to: [gno.safe['Treasury']], receive: [WETH] }],
      })
    ).toEqual({
      label: 'Grant payouts',
      action: {
        type: 'transfer',
        tokens: [USDC],
        to: [],
        bridge: [
          {
            chain: 100,
            to: ['0x9999000000000000000000000000000000009999'],
            receive: [WETH],
          },
        ],
      },
    })
  })

  it('takes a named chain when the recipients are plain addresses', () => {
    expect(
      transfer({
        label: 'Grant payouts',
        tokens: [USDC],
        bridge: [{ chain: 42161, to: [WETH], receive: [WETH] }],
      }).action.bridge?.[0].chain
    ).toBe(42161)
  })

  it('refuses a bridge target whose recipient contradicts its chain', () => {
    const gno = constellation(
      { workspace: 'GG', label: 'test', chain: 100 },
      { codegen }
    )

    expect(() =>
      transfer({
        label: 'Grant payouts',
        tokens: [USDC],
        bridge: [{ chain: 42161, to: [gno.safe['Treasury']], receive: [WETH] }],
      })
    ).toThrow('spans chains "42161" and "100"')
  })

  it('refuses pushing a same-chain recipient that lives on another chain', async () => {
    const { api } = mockApi()
    const gno = constellation(
      { workspace: 'GG', label: 'test', chain: 100 },
      { codegen }
    )
    const eth = constellation(
      { workspace: 'GG', label: 'test', chain: 1 },
      { codegen }
    )
    const safe = eth.safe['GG DAO']

    const roles = eth.roles['New Roles']({
      nonce: 0n,
      owner: safe,
      target: safe,
      avatar: safe,
      roles: {
        treasury_ops: {
          members: [],
          permissions: [
            transfer({
              label: 'Grant payouts',
              tokens: [USDC],
              to: [gno.safe['Treasury']],
            }),
          ],
        },
      },
    })

    expect(() => push([safe, roles], { api })).toThrow(
      'lives on chain "100", but the role is on chain "1"'
    )
  })

  it('refuses bridging to one chain twice', () => {
    expect(() =>
      transfer({
        label: 'Grant payouts',
        tokens: [USDC],
        bridge: [
          { chain: 42161, to: [WETH], receive: [WETH] },
          { chain: 42161, to: [USDC], receive: [USDC] },
        ],
      })
    ).toThrow('bridges to chain "42161" twice')
  })

  it('refuses same-chain recipients that span chains', () => {
    const eth = constellation(
      { workspace: 'GG', label: 'test', chain: 1 },
      { codegen }
    )
    const gno = constellation(
      { workspace: 'GG', label: 'test', chain: 100 },
      { codegen }
    )

    expect(() =>
      transfer({
        label: 'Grant payouts',
        tokens: [USDC],
        to: [eth.safe['GG DAO'], gno.safe['Treasury']],
      })
    ).toThrow('span chains "1" and "100"')
  })

  it("refuses pushing a bridge to the role's own chain", async () => {
    const { api } = mockApi()
    const eth = constellation(
      { workspace: 'GG', label: 'test', chain: 1 },
      { codegen }
    )
    const safe = eth.safe['GG DAO']

    const roles = eth.roles['New Roles']({
      nonce: 0n,
      owner: safe,
      target: safe,
      avatar: safe,
      roles: {
        treasury_ops: {
          members: [],
          permissions: [
            transfer({
              label: 'Grant payouts',
              tokens: [USDC],
              bridge: [{ to: [safe], receive: [WETH] }],
            }),
          ],
        },
      },
    })

    expect(() => push([safe, roles], { api })).toThrow(
      '"Grant payouts" bridges to chain "1", the role\'s own chain'
    )
  })

  it('refuses a bridge target with no chain to go on', () => {
    expect(() =>
      transfer({
        label: 'Grant payouts',
        tokens: [USDC],
        bridge: [{ to: [WETH], receive: [WETH] }],
      })
    ).toThrow('needs a `chain`')
  })

  it('takes a node recipient as the address it lives at', () => {
    const eth = constellation(
      { workspace: 'GG', label: 'test', chain: 1 },
      { codegen }
    )

    expect(
      transfer({
        label: 'Grant payouts',
        tokens: [USDC],
        to: [eth.safe['GG DAO']],
      })
    ).toEqual({
      label: 'Grant payouts',
      action: {
        type: 'transfer',
        tokens: [USDC],
        to: ['0xcccc00000000000000000000000000000000cccc'],
      },
    })
  })

  it('keeps a node recipient that has no address yet', () => {
    const eth = constellation(
      { workspace: 'GG', label: 'test', chain: 1 },
      { codegen }
    )
    const safe = eth.safe['Ops Safe']({ nonce: 0n, threshold: 1, owners: [] })

    expect(
      transfer({ label: 'Rebalance', tokens: [USDC], to: [safe] }).action.to
    ).toEqual([safe])
  })

  it('refuses a bridge recipient that has no address yet', () => {
    const gno = constellation(
      { workspace: 'GG', label: 'test', chain: 100 },
      { codegen }
    )

    expect(() =>
      transfer({
        label: 'Grant payouts',
        tokens: [USDC],
        bridge: [
          {
            to: [gno.safe['Ops Safe']({ nonce: 0n, threshold: 1, owners: [] })],
            receive: [WETH],
          },
        ],
      })
    ).toThrow('"Ops Safe" has no address yet')
  })

  it('takes an allowance key as a plain label', () => {
    expect(
      transfer({
        label: 'Grant payouts',
        tokens: [USDC],
        to: [WETH],
        allowance: 'usdc_payouts',
      }).action.allowance
    ).toBe('usdc_payouts')
  })

  it('labels a bag of plain permissions', () => {
    const permission = { targetAddress: USDC, selector: '0xa9059cbb' } as const

    expect(custom({ label: 'Bot ops', permissions: [permission] })).toEqual({
      label: 'Bot ops',
      permissions: [permission],
    })
  })

  it('records a DeFi Kit call without fetching anything', () => {
    expect(
      defikit.aave_v3.deposit({
        label: 'Aave deposits',
        market: 'Core',
        targets: ['WETH'],
      })
    ).toEqual({
      label: 'Aave deposits',
      defiKit: {
        protocol: 'aave_v3',
        verb: 'deposit',
        params: { market: 'Core', targets: ['WETH'] },
      },
    })
  })
})

describe('push', () => {
  function rolesWith(permissions: any[], chain: 1 | 100 = 1) {
    const eth = constellation(
      { workspace: 'GG', label: 'test', chain },
      { codegen }
    )
    const safe = eth.safe['Ops Safe']({
      nonce: 0n,
      threshold: 1,
      owners: [],
    })

    return [
      safe,
      eth.roles['New Roles']({
        nonce: 0n,
        owner: safe,
        target: safe,
        avatar: safe,
        roles: { treasury_ops: { members: [], permissions } },
      }),
    ]
  }

  const rolesSpec = (payload: any) =>
    payload.specification[1].roles.treasury_ops

  it('sends entries as written, with addresses lowercased', async () => {
    const { api, lastPayload } = mockApi()

    await push(
      rolesWith([swap({ label: 'Swap', sell: [USDC], buy: [WETH] })]),
      {
        api,
      }
    )

    expect(rolesSpec(lastPayload()).permissions).toEqual([
      {
        label: 'Swap',
        action: {
          type: 'swap',
          sell: [USDC.toLowerCase()],
          buy: [WETH.toLowerCase()],
        },
      },
    ])
  })

  it('sends a recipient created in the same deployment as a reference', async () => {
    const { api, lastPayload } = mockApi()
    const eth = constellation(
      { workspace: 'GG', label: 'test', chain: 1 },
      { codegen }
    )
    const opsSafe = eth.safe['Ops Safe']({
      nonce: 0n,
      threshold: 1,
      owners: [],
    })
    const dao = eth.safe['GG DAO']

    await push(
      {
        opsSafe,
        dao,
        roles: eth.roles['New Roles']({
          nonce: 0n,
          target: dao,
          roles: {
            treasury_ops: {
              members: [],
              permissions: [
                transfer({
                  label: 'Rebalance',
                  tokens: [USDC],
                  to: [opsSafe, dao],
                }),
              ],
            },
          },
        }),
      },
      { api }
    )

    expect(
      lastPayload().specification[2].roles.treasury_ops.permissions[0].action.to
    ).toEqual(['$opsSafe', '0xcccc00000000000000000000000000000000cccc'])
  })

  it('sends an uninvoked accessor named as a recipient as a reference', async () => {
    const { api, lastPayload } = mockApi()
    const eth = constellation(
      { workspace: 'GG', label: 'test', chain: 1 },
      { codegen }
    )
    const dao = eth.safe['GG DAO']

    await push(
      {
        dao,
        roles: eth.roles['New Roles']({
          nonce: 0n,
          target: dao,
          roles: {
            treasury_ops: {
              members: [],
              permissions: [
                transfer({
                  label: 'Rebalance',
                  tokens: [USDC],
                  to: [eth.safe['Ops Safe']],
                }),
              ],
            },
          },
        }),
        opsSafe: eth.safe['Ops Safe']({ nonce: 0n, threshold: 1, owners: [] }),
      },
      { api }
    )

    expect(
      lastPayload().specification[1].roles.treasury_ops.permissions[0].action.to
    ).toEqual(['$opsSafe'])
  })

  it('renders a DeFi Kit entry into the annotation for the role"s chain', async () => {
    const { api, lastPayload } = mockApi()

    await push(
      rolesWith([
        defikit.aave_v3.deposit({
          label: 'Aave deposits',
          market: 'Core',
          targets: ['WETH', 'USDC'],
        }),
      ]),
      { api }
    )

    expect(rolesSpec(lastPayload()).permissions).toEqual([
      {
        label: 'Aave deposits',
        annotation: {
          uri: 'https://kit.kpk.io/api/v1/permissions/eth/aave_v3/deposit?market=Core&targets=WETH&targets=USDC',
          schema: 'https://kit.kpk.io/api/v1/openapi.json',
        },
      },
    ])
  })

  it('addresses the chain the constellation is on', async () => {
    const { api, lastPayload } = mockApi()

    await push(
      rolesWith(
        [defikit.aave_v3.stake({ label: 'Aave staking', targets: ['AAVE'] })],
        100
      ),
      { api }
    )

    expect(rolesSpec(lastPayload()).permissions[0].annotation.uri).toContain(
      '/permissions/gno/aave_v3/stake'
    )
  })

  it('refuses a DeFi Kit entry on a chain DeFi Kit does not serve', async () => {
    const { api } = mockApi()

    expect(() =>
      push(
        rolesWith(
          [defikit.aave_v3.stake({ label: 'x', targets: [] })],
          137 as any
        ),
        { api }
      )
    ).toThrow('DeFi Kit does not serve chain "137"')
  })
})
