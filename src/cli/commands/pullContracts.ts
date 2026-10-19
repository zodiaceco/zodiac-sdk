import fs from 'node:fs'
import path from 'node:path'
import type { ProjectConfig } from '../config'
import { resolveAbisDir } from '../config'
import { resolveZodiacDir } from '../../paths'
import { abiFilePath, walkContracts, writeAbi } from '../../allow/abi'
import { fetchAbi } from '../../allow/fetch'
import { chainIdFor } from '../../allow/networks'
import { generateAllowTypes, writeGenerated } from '../../allow/codegen'
import { recordContracts } from '../../allow/project'

type Status = 'ok' | 'fetched' | 'missing'

type PullContractsOptions = {
  /**
   * Write the typings to this file, relative to the project root, as a module
   * exporting `AllowKit` rather than augmenting the global one.
   */
  module?: string
}

export const pullContracts = async (
  config: ProjectConfig,
  { module }: PullContractsOptions = {}
) => {
  if (!config.contracts || Object.keys(config.contracts).length === 0) {
    console.log('No contracts defined in config, skipping.')
    // Contracts pulled before are gone from the config, so from `allow` too.
    if (module == null) recordContracts(config)
    return
  }

  const abisDir = resolveAbisDir(config)
  const generatedFile =
    module == null
      ? path.join(resolveZodiacDir(config.rootDir), 'allow.d.ts')
      : path.resolve(config.rootDir, module)

  let missing = 0
  let fetched = 0
  let existing = 0

  for (const node of walkContracts(config.contracts)) {
    const file = abiFilePath(abisDir, node)

    if (fs.existsSync(file)) {
      existing++
      report(node.chain, node.segments, node.address, 'ok', file)
      continue
    }

    let chainId: number
    try {
      chainId = chainIdFor(node.chain)
    } catch (error) {
      missing++
      report(
        node.chain,
        node.segments,
        node.address,
        'missing',
        file,
        (error as Error).message
      )
      continue
    }

    const abi = await fetchAbi(chainId, node.address)
    if (!abi) {
      missing++
      report(
        node.chain,
        node.segments,
        node.address,
        'missing',
        file,
        `api.abi.pub returned no ABI for chain ${chainId}`
      )
      continue
    }
    writeAbi(abisDir, node, abi)
    fetched++
    report(node.chain, node.segments, node.address, 'fetched', file)
  }

  console.log('')
  console.log(
    `Contracts summary: ${existing} existing, ${fetched} fetched, ${missing} missing.`
  )
  if (missing > 0) {
    console.log('')
    console.log('Missing ABIs must be provided manually. Paste the contract')
    console.log(
      'ABI JSON at the paths listed above and re-run `zodiac pull-contracts`.'
    )
  }

  const source = generateAllowTypes(abisDir, config.contracts, {
    module: module != null,
  })
  writeGenerated(generatedFile, source)
  console.log('')
  console.log(`Wrote typings to ${path.relative(process.cwd(), generatedFile)}`)

  // What `allow` from `@zodiaceco/sdk` is built from. A module of typings is
  // for code that builds its own kit.
  if (module == null) recordContracts(config)

  if (missing > 0) process.exit(1)
}

function report(
  chain: string,
  segments: string[],
  address: string,
  status: Status,
  file: string,
  reason?: string
) {
  const label = `${chain}.${segments.join('.')}`.padEnd(40, ' ')
  const tag = {
    ok: '  cached  ',
    fetched: '  fetched ',
    missing: '  MISSING ',
  }[status]
  const suffix = reason ? ` — ${reason}` : ''
  console.log(`${tag} ${label} ${address}${suffix}`)
  if (status === 'missing') {
    console.log(`            → paste ABI at ${file}`)
  }
}
