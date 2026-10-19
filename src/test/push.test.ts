import { describe, it, expect, mock } from 'bun:test'
import { c, encodeKey, Operator, ParameterType } from 'zodiac-roles-sdk'
import { ApiRequestError } from '../api'
import { ConstellationRejectedError, push, specify } from '../push'
import { constellation } from '../constellation'
import * as codegen from './codegen.mock'
import * as treasury_ops from './policyRole.mock'

function mockApi() {
  const mockApply = mock(() => Promise.resolve({ ok: true }))
  const api = { applyConstellation: mockApply } as any
  const lastPayload = () => (mockApply.mock.calls[0] as any)[1] as any
  return { api, lastPayload }
}

describe('push', () => {
  function setup() {
    return constellation(
      { workspace: 'GG', label: 'test', chain: 1 },
      { codegen }
    )
  }

  // `pull` fills a referenced node with what it read from chain so it reads
  // well in an editor. Pushing that back would declare it, and an owner added
  // since the pull would be removed again by the deployment — a change nobody
  // wrote down. So a reference travels as a reference.
  it('pushes a referenced account as a reference, not a declaration', async () => {
    const eth = setup()

    const { api, lastPayload } = mockApi()
    await push([eth.safe['GG DAO']], { api })

    expect(lastPayload().specification[0]).toEqual({
      ref: '0',
      type: 'SAFE',
      chain: 1,
      address: '0xcccc00000000000000000000000000000000cccc',
      label: 'GG DAO',
      vault: true,
    })
  })

  it('pushes where the constellation is defined', async () => {
    const eth = setup()

    const { api, lastPayload } = mockApi()
    await push([eth.safe['GG DAO']], {
      api,
      source: 'https://github.com/gnosisguild/treasury',
    })

    expect(lastPayload().source).toBe('https://github.com/gnosisguild/treasury')
  })

  it('leaves the source out when it is not given', async () => {
    const eth = setup()

    const { api, lastPayload } = mockApi()
    await push([eth.safe['GG DAO']], { api })

    expect(lastPayload()).not.toHaveProperty('source')
  })

  it('pushes only the fields a reference declares', async () => {
    const eth = setup()

    const { api, lastPayload } = mockApi()
    await push([eth.safe['Treasury']({ threshold: 3 })], { api })

    const spec = lastPayload().specification[0]

    expect(spec.threshold).toBe(3)
    // Left alone rather than restated at whatever the pull happened to read.
    expect(spec).not.toHaveProperty('owners')
    expect(spec).not.toHaveProperty('modules')
    // The address is not one of those fields. It is which account this is —
    // without it the node would be a creation, and a deployer other than the
    // last one would derive a second account under the same label.
    expect(spec.address).toBe(codegen.accounts.GG.safes[1].Treasury.address)
  })

  it('pushes everything a new node declares', async () => {
    const eth = setup()
    const owners = ['0xaaaa00000000000000000000000000000000aaaa'] as const

    const { api, lastPayload } = mockApi()
    await push(
      [eth.safe['New Safe']({ nonce: 0n, threshold: 1, owners: [...owners] })],
      { api }
    )

    expect(lastPayload().specification[0]).toMatchObject({
      nonce: '0',
      threshold: 1,
      owners: [...owners],
    })
  })

  it('pushes a new delay with its bigints as strings', async () => {
    const eth = setup()
    const dao = eth.safe['GG DAO']
    const timelock = eth.delay['New Timelock']({
      nonce: 3n,
      owner: dao,
      target: dao,
      avatar: dao,
      cooldown: 86400n,
      expiration: 604800n,
    })

    const { api, lastPayload } = mockApi()
    await push({ dao, timelock }, { api })

    expect(lastPayload().specification[1]).toEqual({
      ref: 'timelock',
      type: 'DELAY',
      chain: 1,
      label: 'New Timelock',
      nonce: '3',
      owner: '$dao',
      target: '$dao',
      avatar: '$dao',
      cooldown: '86400',
      expiration: '604800',
    })
  })

  it('resolves a safe that names a delay as one of its modules', async () => {
    const eth = setup()
    const timelock = eth.delay['New Timelock']({
      nonce: 0n,
      owner: '0xaaaa00000000000000000000000000000000aaaa',
      target: '0xaaaa00000000000000000000000000000000aaaa',
      avatar: '0xaaaa00000000000000000000000000000000aaaa',
      cooldown: 60n,
      expiration: 0n,
    })
    const safe = eth.safe['New Safe']({
      nonce: 0n,
      threshold: 1,
      owners: ['0xaaaa00000000000000000000000000000000aaaa'],
      modules: [timelock],
    })

    const { api, lastPayload } = mockApi()
    await push({ timelock, safe }, { api })

    expect(lastPayload().specification[1].modules).toEqual(['$timelock'])
  })

  // A delay the workspace already holds travels as the account it names, not
  // as a declaration of the cooldown someone has since changed on chain.
  it('pushes a referenced delay as a reference', async () => {
    const eth = setup()

    const { api, lastPayload } = mockApi()
    await push([eth.delay['Timelock']], { api })

    const spec = lastPayload().specification[0]

    expect(spec).toMatchObject({
      ref: '0',
      type: 'DELAY',
      chain: 1,
      label: 'Timelock',
      address: codegen.accounts.GG.delays[1].Timelock.address,
    })
    expect(spec).not.toHaveProperty('cooldown')
    expect(spec).not.toHaveProperty('expiration')
  })

  it('resolves nested node refs to $ref strings', async () => {
    const eth = setup()
    const dao = eth.safe['GG DAO']
    const roles = eth.roles['New Roles']({
      nonce: 0n,
      target: dao,
      owner: dao,
      avatar: dao,
    })

    const { api, lastPayload } = mockApi()
    await push([dao, roles], { api })

    const spec = lastPayload().specification[1]
    expect(spec.target).toBe('$0')
    expect(spec.owner).toBe('$0')
    expect(spec.avatar).toBe('$0')
  })

  it('resolves a node named as a permission target', async () => {
    const eth = setup()
    const safe = eth.safe['New Safe']({
      nonce: 0n,
      threshold: 1,
      owners: ['0xaaaa00000000000000000000000000000000aaaa'],
    })
    const roles = eth.roles['New Roles']({
      nonce: 0n,
      target: safe,
      owner: safe,
      avatar: safe,
      roles: {
        emergency: {
          members: ['0xbbbb00000000000000000000000000000000bbbb'],
          // The policy governs a Safe that this same push creates, so the
          // permission names the node rather than an address nobody has yet.
          permissions: [{ targetAddress: safe, selector: '0xe009cfde' }],
        },
      },
    })

    const { api, lastPayload } = mockApi()
    await push({ safe, roles }, { api })

    const spec = lastPayload().specification[1]

    expect(spec.roles.emergency.permissions[0].targetAddress).toEqual('$safe')
  })

  it('resolves an uninvoked accessor named as a permission target', async () => {
    const eth = setup()
    // The forward-reference form: two nodes that need each other cannot both be
    // invoked first, so a permission has to be able to name the accessor.
    const safeRef = eth.safe['New Safe']
    const roles = eth.roles['New Roles']({
      nonce: 0n,
      target: safeRef,
      owner: safeRef,
      avatar: safeRef,
      roles: {
        emergency: {
          members: ['0xbbbb00000000000000000000000000000000bbbb'],
          permissions: [{ targetAddress: safeRef, selector: '0xe009cfde' }],
        },
      },
    })
    const safe = safeRef({
      nonce: 0n,
      threshold: 1,
      owners: ['0xaaaa00000000000000000000000000000000aaaa'],
    })

    const { api, lastPayload } = mockApi()
    await push({ safe, roles }, { api })

    const spec = lastPayload().specification[1]

    expect(spec.roles.emergency.permissions[0].targetAddress).toEqual('$safe')
  })

  it('resolves a node named as a permission target inside a labelled entry', async () => {
    const eth = setup()
    const safe = eth.safe['New Safe']({
      nonce: 0n,
      threshold: 1,
      owners: ['0xaaaa00000000000000000000000000000000aaaa'],
    })
    const roles = eth.roles['New Roles']({
      nonce: 0n,
      target: safe,
      owner: safe,
      avatar: safe,
      roles: {
        emergency: {
          members: ['0xbbbb00000000000000000000000000000000bbbb'],
          permissions: [
            {
              label: 'Disable the module',
              permissions: [{ targetAddress: safe, selector: '0xe009cfde' }],
            },
          ],
        },
      },
    })

    const { api, lastPayload } = mockApi()
    await push({ safe, roles }, { api })

    const entry = lastPayload().specification[1].roles.emergency.permissions[0]

    expect(entry.permissions[0].targetAddress).toEqual('$safe')
  })

  it('throws when a referenced node is not in the push list', async () => {
    const eth = setup()
    const dao = eth.safe['GG DAO']
    const roles = eth.roles['New Roles']({
      nonce: 0n,
      target: dao,
      owner: dao,
      avatar: dao,
    })

    const { api } = mockApi()
    expect(push([roles], { api })).rejects.toThrow(
      'Node "GG DAO" is referenced but not included in the push() call'
    )
  })

  it('uses array index as ref for array input', async () => {
    const eth = setup()
    const dao = eth.safe['GG DAO']
    const treasury = eth.safe['Treasury']

    const { api, lastPayload } = mockApi()
    await push([dao, treasury], { api })

    const specs = lastPayload().specification
    expect(specs[0].ref).toBe('0')
    expect(specs[1].ref).toBe('1')
  })

  it('uses object keys as refs', async () => {
    const eth = setup()
    const dao = eth.safe['GG DAO']
    const treasury = eth.safe['Treasury']

    const { api, lastPayload } = mockApi()
    await push({ dao, treasury }, { api })

    const specs = lastPayload().specification
    expect(specs[0].ref).toBe('dao')
    expect(specs[1].ref).toBe('treasury')
  })

  // A ref is the name a node is declared under, and export names are
  // conventionally camelCase. Rejecting them would make the documented way of
  // writing a constellation the one way it cannot be written.
  it('takes any identifier as a ref', async () => {
    const eth = setup()
    const { api, lastPayload } = mockApi()

    await push({ assetSafe: eth.safe['GG DAO'] }, { api })

    expect(lastPayload().specification[0].ref).toBe('assetSafe')
  })

  it('rejects a ref that opens a reference', async () => {
    const eth = setup()
    const { api } = mockApi()

    // `$treasury` already means "the node named treasury".
    expect(push({ $treasury: eth.safe['GG DAO'] }, { api })).rejects.toThrow(
      'Invalid ref "$treasury": a ref is a JavaScript identifier, and cannot start with "$"'
    )
  })

  it('rejects a ref that is not an identifier', async () => {
    const eth = setup()
    const { api } = mockApi()

    expect(push({ '2safe': eth.safe['GG DAO'] }, { api })).rejects.toThrow(
      'Invalid ref "2safe": a ref is a JavaScript identifier, and cannot start with "$"'
    )
  })

  it('converts bigint nonce to string', async () => {
    const eth = setup()
    const newSafe = eth.safe['New Safe']({
      nonce: 42n,
      threshold: 1,
      owners: [],
      modules: [],
    })

    const { api, lastPayload } = mockApi()
    await push([newSafe], { api })

    const spec = lastPayload().specification[0]
    expect(spec.nonce).toBe('42')
  })

  it('resolves refs in owners and modules arrays', async () => {
    const eth = setup()
    const dao = eth.safe['GG DAO']
    const roles = eth.roles['GG DAO']

    const newSafe = eth.safe['New Safe']({
      nonce: 0n,
      threshold: 2,
      owners: [eth.user['Alice Sample'], dao],
      modules: [roles],
    })

    const { api, lastPayload } = mockApi()
    await push({ dao, roles, new_safe: newSafe }, { api })

    const spec = lastPayload().specification[2]
    expect(spec.owners).toEqual([
      codegen.users['Alice Sample'].personalSafes[1].address,
      '$dao',
    ])
    expect(spec.modules).toEqual(['$roles'])
  })

  it('strips _constellation from spec output', async () => {
    const eth = setup()
    const dao = eth.safe['GG DAO']

    const { api, lastPayload } = mockApi()
    await push([dao], { api })

    const spec = lastPayload().specification[0]
    expect(spec._constellation).toBeUndefined()
  })

  it('passes label and chain from constellation metadata', async () => {
    const eth = constellation(
      { workspace: 'GG', label: 'my constellation', chain: 1 },
      { codegen }
    )
    const dao = eth.safe['GG DAO']

    const { api, lastPayload } = mockApi()
    await push([dao], { api })

    const payload = lastPayload()
    expect(payload.label).toBe('my constellation')
    expect(payload.chain).toBe(1)
  })

  it('resolves circular refs between new nodes', async () => {
    const eth = setup()

    const safe = eth.safe['New Safe']({
      nonce: 0n,
      threshold: 1,
      owners: [],
      modules: [eth.roles['New Roles']],
    })
    const roles = eth.roles['New Roles']({
      nonce: 0n,
      target: safe,
    })

    const { api, lastPayload } = mockApi()
    await push({ safe, roles }, { api })

    const specs = lastPayload().specification
    expect(specs[0].modules).toEqual(['$roles'])
    expect(specs[1].target).toBe('$safe')
  })

  it('preserves Record-form allowances so unmentioned entries are not cleared', async () => {
    const eth = setup()

    const usdm_user_payouts = {
      key: encodeKey('usdm_user_payouts'),
      refill: 1000n,
      maxRefill: 1000n,
      period: 86400n,
      balance: 1000n,
      timestamp: 0n,
    }

    const safe = eth.safe['GG DAO']
    const roles = eth.roles['GG DAO']({
      nonce: 0n,
      owner: safe,
      target: safe,
      avatar: safe,
      allowances: { usdm_user_payouts, deprecated: null },
    })

    const { api, lastPayload } = mockApi()
    await push({ safe, roles }, { api })

    const spec = lastPayload().specification[1]
    expect(spec.allowances).toEqual({
      usdm_user_payouts: {
        key: encodeKey('usdm_user_payouts'),
        refill: '1000',
        maxRefill: '1000',
        period: '86400',
        balance: '1000',
        timestamp: '0',
      },
      deprecated: null,
    })
  })

  it('preserves Record-form roles so unmentioned roles are not cleared', async () => {
    const eth = setup()

    const safe = eth.safe['GG DAO']
    const roles = eth.roles['GG DAO']({
      nonce: 0n,
      owner: safe,
      target: safe,
      avatar: safe,
      roles: {
        eth_wrapping: {
          members: [],
          permissions: [],
        },
        deprecated: null,
      },
    })

    const { api, lastPayload } = mockApi()
    await push({ safe, roles }, { api })

    const spec = lastPayload().specification[1]
    expect(spec.roles).toEqual({
      eth_wrapping: {
        key: 'eth_wrapping',
        members: [],
        permissions: [],
      },
      deprecated: null,
    })
  })

  it('sends the policy a role is marked as', async () => {
    const eth = setup()

    const safe = eth.safe['GG DAO']
    const roles = eth.roles['GG DAO']({
      nonce: 0n,
      owner: safe,
      target: safe,
      avatar: safe,
      roles: {
        treasury_ops: {
          members: [],
          permissions: [],
          policy: 'Treasury Ops',
          description: 'Day-to-day treasury operations',
        },
      },
    })

    const { api, lastPayload } = mockApi()
    await push({ safe, roles }, { api })

    expect(lastPayload().specification[1].roles.treasury_ops).toEqual({
      key: 'treasury_ops',
      members: [],
      permissions: [],
      policy: 'Treasury Ops',
      description: 'Day-to-day treasury operations',
    })
  })

  it('sends the policy a role folder exports', async () => {
    const eth = setup()

    const safe = eth.safe['GG DAO']
    const roles = eth.roles['GG DAO']({
      nonce: 0n,
      owner: safe,
      target: safe,
      avatar: safe,
      roles: { treasury_ops },
    })

    const { api, lastPayload } = mockApi()
    await push({ safe, roles }, { api })

    expect(lastPayload().specification[1].roles.treasury_ops).toEqual({
      key: 'treasury_ops',
      members: [],
      permissions: [],
      policy: 'Treasury Ops',
    })
  })

  it('sends no policy fields for a role that is no policy', async () => {
    const eth = setup()

    const safe = eth.safe['GG DAO']
    const roles = eth.roles['GG DAO']({
      nonce: 0n,
      owner: safe,
      target: safe,
      avatar: safe,
      roles: { eth_wrapping: { members: [], permissions: [] } },
    })

    const { api, lastPayload } = mockApi()
    await push({ safe, roles }, { api })

    const role = lastPayload().specification[1].roles.eth_wrapping

    expect(role).not.toHaveProperty('policy')
    expect(role).not.toHaveProperty('description')
  })

  it('refuses a description on a role that is no policy', () => {
    const eth = setup()

    const safe = eth.safe['GG DAO']
    eth.roles['GG DAO']({
      nonce: 0n,
      owner: safe,
      target: safe,
      avatar: safe,
      roles: {
        // @ts-expect-error — only a policy has a description
        eth_wrapping: {
          members: [],
          permissions: [],
          description: 'Wraps ETH',
        },
      },
    })
  })

  it('names the pushed node an issue of a refused constellation concerns', async () => {
    const eth = setup()

    const safe = eth.safe['GG DAO']
    const treasuryRoles = eth.roles['GG DAO']({
      nonce: 0n,
      owner: safe,
      target: safe,
      avatar: safe,
      roles: {
        treasury_ops: { members: [], permissions: [], policy: 'Treasury' },
      },
    })

    const api = {
      applyConstellation: mock(() =>
        Promise.reject(
          new ApiRequestError(
            'Some policies of this constellation cannot be held in Zodiac',
            {
              status: 400,
              statusText: 'Bad Request',
              details: {
                issues: [
                  {
                    path: [
                      'specification',
                      1,
                      'roles',
                      'treasury_ops',
                      'policy',
                    ],
                    message: 'Mark this role as that policy too.',
                  },
                ],
              },
            }
          )
        )
      ),
    } as any

    const pushed = push({ safe, treasuryRoles }, { api })

    await expect(pushed).rejects.toBeInstanceOf(ConstellationRejectedError)
    await expect(pushed).rejects.toThrow(
      'treasuryRoles ("GG DAO") › roles › treasury_ops › policy: Mark this role as that policy too.'
    )
  })

  it('throws for invalid nodes', async () => {
    const { api } = mockApi()
    expect(() => push([{ not: 'a node' } as any], { api })).toThrow(
      'unexpected node input'
    )
  })
  // A permission travels as JSON, which has no place for what only this side
  // can work out. Whatever would be lost on the way is settled before it goes.
  describe('hand-written permissions', () => {
    const TOKEN = '0x6b175474e89094c44da98b954eedeac495271d0f'
    const RECIPIENT = '0xbbbb00000000000000000000000000000000bbbb'

    const nodesWith = (permissions: any[]) => {
      const eth = setup()
      const dao = eth.safe['GG DAO']
      const roles = eth.roles['New Roles']({
        nonce: 0n,
        target: dao,
        owner: dao,
        avatar: dao,
        roles: { ops: { members: [], permissions } },
      })

      return { dao, roles }
    }

    const pushed = async (permissions: any[]) => {
      const { api, lastPayload } = mockApi()
      await push(nodesWith(permissions), { api })

      // What the API receives: a payload is serialized on its way there.
      return JSON.parse(JSON.stringify(lastPayload())).specification[1].roles
        .ops.permissions
    }

    it('sends a function named by its signature as its selector', async () => {
      expect(
        await pushed([
          { targetAddress: TOKEN, signature: 'transfer(address,uint256)' },
        ])
      ).toEqual([
        {
          targetAddress: TOKEN,
          selector: '0xa9059cbb',
          send: false,
          delegatecall: false,
        },
      ])
    })

    it('evaluates a condition that was left as a function', async () => {
      const [permission] = await pushed([
        {
          targetAddress: TOKEN,
          signature: 'transfer(address,uint256)',
          // Without the final call this is a function, which JSON drops.
          condition: c.calldataMatches([RECIPIENT], ['address', 'uint256']),
        },
      ])

      expect(permission.condition).toMatchObject({
        paramType: ParameterType.Calldata,
        operator: Operator.Matches,
      })
    })

    it('does the same inside a labelled group', async () => {
      const [entry] = await pushed([
        {
          label: 'Payouts',
          permissions: [
            {
              targetAddress: TOKEN,
              signature: 'transfer(address,uint256)',
              condition: c.calldataMatches([RECIPIENT], ['address', 'uint256']),
            },
          ],
        },
      ])

      expect(entry.label).toBe('Payouts')
      expect(entry.permissions[0].selector).toBe('0xa9059cbb')
      expect(entry.permissions[0].condition).toBeDefined()
    })

    it('keeps a node named as the target', async () => {
      const eth = setup()
      const safe = eth.safe['New Safe']({ nonce: 0n, threshold: 1, owners: [] })
      const roles = eth.roles['New Roles']({
        nonce: 0n,
        target: safe,
        owner: safe,
        avatar: safe,
        roles: {
          ops: {
            members: [],
            permissions: [
              { targetAddress: safe, signature: 'setGuard(address)' },
            ],
          },
        },
      })

      const { api, lastPayload } = mockApi()
      await push({ safe, roles }, { api })

      expect(
        lastPayload().specification[1].roles.ops.permissions[0]
      ).toMatchObject({ targetAddress: '$safe', selector: '0xe19a9dd9' })
    })

    it('keeps a permission that allows the whole target', async () => {
      expect(await pushed([{ targetAddress: TOKEN, send: true }])).toEqual([
        { targetAddress: TOKEN, send: true, delegatecall: false },
      ])
    })

    it('refuses a key no permission has, before anything is sent', async () => {
      const { api } = mockApi()

      expect(() =>
        push(
          nodesWith([
            {
              targetAddress: TOKEN,
              selector: '0xa9059cbb',
              conditon: c.calldataMatches([RECIPIENT], ['address', 'uint256']),
            },
          ]),
          { api }
        )
      ).toThrow('A permission of role "ops" has an unknown key "conditon"')
      expect(api.applyConstellation).not.toHaveBeenCalled()
    })

    it('refuses a signature that names no function', async () => {
      const { api } = mockApi()

      expect(() =>
        push(nodesWith([{ targetAddress: TOKEN, signature: 'transfer(' }]), {
          api,
        })
      ).toThrow(
        'A permission of role "ops" names the function "transfer(", which is not a function signature'
      )
    })

    it('refuses a function named twice', async () => {
      const { api } = mockApi()

      expect(() =>
        push(
          nodesWith([
            {
              targetAddress: TOKEN,
              selector: '0xa9059cbb',
              signature: 'transfer(address,uint256)',
            },
          ]),
          { api }
        )
      ).toThrow(
        'A permission of role "ops" names its function by both `selector` and `signature`'
      )
    })
  })
})

describe('specify', () => {
  it('answers what push would apply, per constellation', async () => {
    const eth = constellation(
      { workspace: 'GG', label: 'test', chain: 1 },
      { codegen }
    )
    const nodes = { dao: eth.safe['GG DAO'] }

    const { api, lastPayload } = mockApi()
    await push(nodes, { api })

    expect(specify(nodes)).toEqual([
      { workspaceId: expect.any(String), ...lastPayload() },
    ])
  })
})
