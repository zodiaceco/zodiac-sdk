import { describe, it, expect } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { constellation } from '../constellation'
import * as codegen from './codegen.mock'

describe('constellation API', () => {
  describe('initialization', () => {
    it('creates a constellation scoped to a chain', () => {
      const eth = constellation(
        { workspace: 'GG', label: 'My Test Constellation', chain: 1 },
        { codegen }
      )

      expect(eth.safe).toBeDefined()
      expect(eth.roles).toBeDefined()
      expect(eth.delay).toBeDefined()
      expect(eth.user).toBeDefined()
    })
  })

  describe('before `pull-org`', () => {
    it('declares new nodes', () => {
      const originalCwd = process.cwd()
      process.chdir(mkdtempSync(join(tmpdir(), 'zodiac-no-codegen-')))

      try {
        const eth = constellation({ workspace: 'GG', label: 'l', chain: 1 })

        expect(
          eth.safe['New Safe']({ nonce: 0n, threshold: 1, owners: [] })
        ).toMatchObject({ type: 'SAFE', label: 'New Safe' })
      } finally {
        process.chdir(originalCwd)
      }
    })
  })

  describe('existing safe — bracket access', () => {
    function setup() {
      return constellation(
        { workspace: 'GG', label: 'l', chain: 1 },
        { codegen }
      )
    }

    it('returns a node ref', () => {
      const eth = setup()
      const treasury = eth.safe['Treasury']
      expect(treasury.label).toBe('Treasury')
      expect(treasury.address).toBe(
        codegen.accounts.GG.safes[1].Treasury.address
      )
    })

    it('returns a node ref with existing properties merged with overrides', () => {
      const eth = setup()
      const ggDao = eth.safe['GG DAO']({ threshold: 5 })

      expect(ggDao.label).toBe('GG DAO')
      expect(ggDao.address).toBe(codegen.accounts.GG.safes[1]['GG DAO'].address)
      expect(ggDao.threshold).toBe(5)
      expect(ggDao.type).toBe('SAFE')
    })

    it('returns a frozen (non-callable) node ref when invoked', () => {
      const eth = setup()
      const ggDao = eth.safe['GG DAO']()
      expect(Object.isFrozen(ggDao)).toBe(true)
    })

    it('rejects overriding id, label, or unknown props', () => {
      const eth = setup()
      // @ts-expect-error — id is not overridable
      eth.safe['GG DAO']({ id: 'fake-id' })
      // @ts-expect-error — label is not overridable
      eth.safe['GG DAO']({ label: 'fake-label' })
      // @ts-expect-error — unknown prop is not allowed
      eth.safe['GG DAO']({ unknown: 'this does not exist' })
    })
  })

  describe('new safe — bracket access with new key', () => {
    function setup() {
      return constellation(
        { workspace: 'GG', label: 'l', chain: 1 },
        { codegen }
      )
    }

    it('creates a new node with all required fields', () => {
      const eth = setup()

      const newSafe = eth.safe['New Safe']({
        nonce: 0n,
        threshold: 2,
        owners: [
          eth.user['Alice Sample'],
          '0xb8e48df6818d3cbc648b3e8ec248a4f547135f7a',
        ],
        modules: [eth.roles['GG DAO']],
      })

      expect(newSafe.label).toBe('New Safe')
      expect(newSafe.nonce).toBe(0n)
      expect(newSafe.threshold).toBe(2)
      expect(newSafe.type).toBe('SAFE')
    })

    it('returns a frozen (non-callable) node ref', () => {
      const eth = setup()
      const newSafe = eth.safe['Brand New']({
        nonce: 1n,
        threshold: 1,
        owners: ['0xb8e48df6818d3cbc648b3e8ec248a4f547135f7a'],
        modules: [],
      })
      expect(Object.isFrozen(newSafe)).toBe(true)
    })

    it('rejects new node with missing required props', () => {
      const eth = setup()
      // @ts-expect-error — missing threshold, owners, modules
      eth.safe['Brand New']({ nonce: 0n })
    })
  })

  describe('new roles — bracket access with new key', () => {
    it('creates a new roles mod with explicit target', () => {
      const eth = constellation(
        { workspace: 'GG', label: 'l', chain: 1 },
        { codegen }
      )
      const ggDao = eth.safe['GG DAO']

      const newRoles = eth.roles['New Roles']({
        nonce: 123n,
        owner: ggDao,
        target: ggDao,
        avatar: ggDao,
      })

      expect(newRoles.type).toBe('ROLES')
      expect(newRoles.nonce).toBe(123n)
      expect(newRoles.target).toBe(ggDao)
    })

    it('binds to an existing roles mod by address (no nonce)', () => {
      const eth = constellation(
        { workspace: 'GG', label: 'l', chain: 1 },
        { codegen }
      )

      const existingRoles = eth.roles['Existing roles mod']({
        address: '0x88A51CcB262d04B334065Ad425928dF79c4CB7d7',
        roles: {},
      })

      expect(existingRoles.type).toBe('ROLES')
      expect(existingRoles.address).toBe(
        '0x88A51CcB262d04B334065Ad425928dF79c4CB7d7'
      )
      expect(existingRoles.label).toBe('Existing roles mod')
    })

    it('rejects a roles mod declared with neither nonce nor address', () => {
      const eth = constellation(
        { workspace: 'GG', label: 'l', chain: 1 },
        { codegen }
      )
      // @ts-expect-error — must provide either `nonce` (new) or `address` (existing)
      eth.roles['Incomplete']({ roles: {} })
    })
  })

  describe('new delay — bracket access with new key', () => {
    function setup() {
      return constellation(
        { workspace: 'GG', label: 'l', chain: 1 },
        { codegen }
      )
    }

    it('creates a new delay mod with a cooldown and an expiration', () => {
      const eth = setup()
      const ggDao = eth.safe['GG DAO']

      const timelock = eth.delay['New Timelock']({
        nonce: 7n,
        owner: ggDao,
        target: ggDao,
        avatar: ggDao,
        cooldown: 86400n,
        expiration: 604800n,
      })

      expect(timelock.type).toBe('DELAY')
      expect(timelock.nonce).toBe(7n)
      expect(timelock.cooldown).toBe(86400n)
      expect(timelock.expiration).toBe(604800n)
      expect(timelock.target).toBe(ggDao)
    })

    it('binds to an existing delay mod by address (no nonce)', () => {
      const eth = setup()

      const existing = eth.delay['Existing delay mod']({
        address: '0x88A51CcB262d04B334065Ad425928dF79c4CB7d7',
        cooldown: 3600n,
      })

      expect(existing.type).toBe('DELAY')
      expect(existing.address).toBe(
        '0x88A51CcB262d04B334065Ad425928dF79c4CB7d7'
      )
      expect(existing.label).toBe('Existing delay mod')
    })

    it('rejects a new delay that says nothing about how long it holds', () => {
      const eth = setup()
      // @ts-expect-error — a new delay declares both cooldown and expiration
      eth.delay['Incomplete']({ nonce: 0n })
    })

    it('rejects a delay declared with neither nonce nor address', () => {
      const eth = setup()
      // @ts-expect-error — must provide either `nonce` (new) or `address` (existing)
      eth.delay['Incomplete']({ cooldown: 1n, expiration: 1n })
    })
  })

  describe('existing delay — bracket access', () => {
    function setup() {
      return constellation(
        { workspace: 'GG', label: 'l', chain: 1 },
        { codegen }
      )
    }

    it('returns a node ref for a delay the workspace holds', () => {
      const eth = setup()
      const timelock = eth.delay['Timelock']

      expect(timelock.type).toBe('DELAY')
      expect(timelock.label).toBe('Timelock')
      expect(timelock.address).toBe(
        codegen.accounts.GG.delays[1].Timelock.address
      )
    })

    it('reads a label from another chain as a new node', () => {
      const gno = constellation(
        { workspace: 'GG', label: 'l', chain: 100 },
        { codegen }
      )

      const timelock = gno.delay['Timelock']
      // @ts-expect-error — not an account on this chain
      expect(timelock.address).toBeUndefined()
    })

    it('can be enabled as a module on a safe', () => {
      const eth = setup()
      const timelock = eth.delay['Timelock']

      const safe = eth.safe['New Safe']({
        nonce: 0n,
        threshold: 1,
        owners: [eth.user['Alice Sample']],
        modules: [timelock],
      })

      expect(safe.modules).toContain(timelock)
    })
  })

  describe('user accessor', () => {
    function setup() {
      return constellation(
        { workspace: 'GG', label: 'l', chain: 1 },
        { codegen }
      )
    }

    it('resolves a known user to their address', () => {
      const eth = setup()
      const addr = eth.user['Alice Sample']
      expect(addr).toBe(codegen.users['Alice Sample'].personalSafes[1].address)
    })

    it('throws for unknown users', () => {
      const eth = setup()
      // @ts-expect-error static check already warns
      expect(() => eth.user['Does not exist']).toThrow('Unknown user')
    })
  })

  describe('node references are usable in other nodes', () => {
    function setup() {
      return constellation(
        { workspace: 'GG', label: 'l', chain: 1 },
        { codegen }
      )
    }

    it('roles ref can be passed as a module to a safe', () => {
      const eth = setup()

      const ggDaoRoles = eth.roles['GG DAO']
      const newSafe = eth.safe['Managed Safe']({
        nonce: 0n,
        threshold: 1,
        owners: [eth.user['Alice Sample']],
        modules: [ggDaoRoles],
      })

      expect(newSafe.modules).toContain(ggDaoRoles)
    })

    it('safe ref can be passed as target to a new roles mod', () => {
      const eth = setup()

      const ggDao = eth.safe['GG DAO']
      const newRoles = eth.roles['New Roles']({
        nonce: 1n,
        owner: ggDao,
        target: ggDao,
        avatar: ggDao,
      })

      expect(newRoles.target).toBe(ggDao)
    })

    it('supports circular refs between new nodes', () => {
      const eth = setup()

      const safe = eth.safe['New Safe']({
        nonce: 0n,
        threshold: 1,
        owners: [eth.user['Alice Sample']],
        modules: [eth.roles['New Roles']],
        vault: true,
      })
      const roles = eth.roles['New Roles']({
        nonce: 0n,
        target: safe,
      })

      expect(roles.target).toBe(safe)
      expect(safe.modules).toContain(eth.roles['New Roles'])
    })
  })

  describe('chain scoping', () => {
    it('resolves a label to the account on the constellation chain', () => {
      const eth = constellation(
        { workspace: 'GG', label: 'l', chain: 1 },
        { codegen }
      )
      const gno = constellation(
        { workspace: 'GG', label: 'l', chain: 100 },
        { codegen }
      )

      // The same label, two accounts. Neither key is disambiguated, because a
      // constellation only ever sees one of the two chains.
      expect(eth.safe['Treasury'].address).toBe(
        codegen.accounts.GG.safes[1].Treasury.address
      )
      expect(gno.safe['Treasury'].address).toBe(
        codegen.accounts.GG.safes[100].Treasury.address
      )
    })

    it('does not resolve a label that lives on another chain', () => {
      const gno = constellation(
        { workspace: 'GG', label: 'l', chain: 100 },
        { codegen }
      )

      // `GG DAO` is a mainnet safe. Its address names nothing on Gnosis, and
      // the node would be pushed as chain 100 regardless — so it reads as a
      // new node instead.
      const ggDao = gno.safe['GG DAO']
      // @ts-expect-error — not an account on this chain
      expect(ggDao.address).toBeUndefined()
    })
  })

  describe('workspace scoping', () => {
    it('only exposes vaults from the selected workspace', () => {
      const gg = constellation(
        { workspace: 'GG', label: 'l', chain: 1 },
        { codegen }
      )

      // GG workspace vaults are accessible
      const treasury = gg.safe['Treasury']
      expect(treasury.label).toBe('Treasury')

      const ggDao = gg.safe['GG DAO']
      expect(ggDao.label).toBe('GG DAO')

      // Ops Fund is NOT in the GG workspace — accessing it returns a node
      // without any pre-filled properties from codegen
      const opsFund = gg.safe['Ops Fund']
      // @ts-expect-error
      expect(opsFund.address).toBeUndefined()
    })

    it('roles accessor is also scoped to the workspace', () => {
      const gg = constellation(
        { workspace: 'GG', label: 'l', chain: 1 },
        { codegen }
      )

      const roles = gg.roles['GG DAO']
      expect(roles.label).toBe('GG DAO')
      expect(roles.type).toBe('ROLES')

      // Ops Fund roles should have no codegen data
      const opsFundRoles = gg.roles['Ops Fund']
      // @ts-expect-error
      expect(opsFundRoles.address).toBeUndefined()
    })
  })
})
