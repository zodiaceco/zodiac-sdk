#!/usr/bin/env bun
// Writes src/defiKit.generated.ts: the parameters of every verb of the DeFi
// Kit allow kit for Ethereum, flattened into plain types.
//
// `defikit()` only needs DeFi Kit's types, and DeFi Kit's own declarations
// pull in its runtime dependencies (zod 3, eth-sdk, its token and pool data).
// Flattening the parameters keeps DeFi Kit a devDependency: an installed SDK
// types `defikit()` without DeFi Kit in its tree.
//
// Run `bun run generate:defikit` after updating defi-kit. A test fails while
// the committed file is behind the installed defi-kit.

import { Project, ts, type Type } from 'ts-morph'
import { format, resolveConfig } from 'prettier'
import { fileURLToPath } from 'node:url'
import { readFile, writeFile } from 'node:fs/promises'

const root = fileURLToPath(new URL('..', import.meta.url))
export const outputPath = `${root}src/defiKit.generated.ts`

/** Unions this long or longer that occur more than once get an alias. */
const MIN_HOISTED_LENGTH = 200

export const generate = async (): Promise<string> => {
  const { version } = JSON.parse(
    await readFile(`${root}node_modules/defi-kit/package.json`, 'utf8')
  )

  const project = new Project({
    tsConfigFilePath: `${root}tsconfig.json`,
    skipAddingFilesFromTsConfig: true,
  })
  const file = project.createSourceFile(
    `${root}src/__defiKit.ts`,
    `import type { allow } from 'defi-kit/eth'\nexport type Kit = typeof allow`,
    { overwrite: true }
  )
  const kit = file.getTypeAliasOrThrow('Kit').getType()

  // Unions that occur more than once, by their text, and the name of the
  // first place each occurs.
  const unions = new Map<string, { name: string; count: number }>()

  const print = (type: Type, indent: string, name: string): string => {
    if (type.isUnion()) {
      const members = [
        ...new Set(type.getUnionTypes().map((m) => print(m, indent, name))),
      ]
      const boolean = members.includes('true') && members.includes('false')
      const text = [
        ...members.filter((m) => !boolean || (m !== 'true' && m !== 'false')),
        ...(boolean ? ['boolean'] : []),
      ].join(' | ')
      if (text.length >= MIN_HOISTED_LENGTH) {
        const union = unions.get(text)
        if (union) union.count++
        else unions.set(text, { name, count: 1 })
      }
      return text
    }
    if (type.isStringLiteral() || type.isNumberLiteral()) {
      return JSON.stringify(type.getLiteralValue())
    }
    if (
      type.isBooleanLiteral() ||
      type.isTemplateLiteral() ||
      type.isString() ||
      type.isNumber() ||
      type.isBoolean() ||
      type.isUndefined() ||
      type.isNull() ||
      type.isUnknown() ||
      type.isAny() ||
      type.getFlags() & ts.TypeFlags.BigInt
    ) {
      return type.getText()
    }
    if (type.isArray() || type.isReadonlyArray()) {
      const element = print(type.getArrayElementTypeOrThrow(), indent, name)
      return `${type.isReadonlyArray() ? 'readonly ' : ''}(${element})[]`
    }
    if (type.isTuple()) {
      const elements = type
        .getTupleElements()
        .map((element, i) => print(element, indent, `${name}${i}`))
      return `[${elements.join(', ')}]`
    }
    if (type.isObject() && type.getCallSignatures().length === 0) {
      const inner = `${indent}  `
      const properties = type.getProperties().map((property) => {
        const optional = property.isOptional()
        const propertyType = property.getTypeAtLocation(file)
        const text = print(
          optional ? propertyType.getNonNullableType() : propertyType,
          inner,
          `${name}${pascalCase(property.getName())}`
        )
        return `${inner}${property.getName()}${optional ? '?' : ''}: ${text}`
      })
      return properties.length === 0
        ? '{}'
        : `{\n${properties.join('\n')}\n${indent}}`
    }
    throw new Error(`Cannot flatten ${name}: ${type.getText()}`)
  }

  const protocols = kit.getProperties().map((protocol) => {
    const verbs = protocol
      .getTypeAtLocation(file)
      .getProperties()
      .map((verb) => {
        const signatures = verb.getTypeAtLocation(file).getCallSignatures()
        const parameters = signatures[0]?.getParameters() ?? []
        if (signatures.length !== 1 || parameters.length > 1) {
          throw new Error(
            `${protocol.getName()}.${verb.getName()} is not a function of one parameter`
          )
        }
        const params =
          parameters.length === 0
            ? '{}'
            : print(
                parameters[0]!.getTypeAtLocation(file),
                '    ',
                pascalCase(`${protocol.getName()}_${verb.getName()}`)
              )
        return `    ${verb.getName()}: ${params}`
      })
    return `  ${protocol.getName()}: {\n${verbs.join('\n')}\n  }`
  })

  let body = `export type DeFiKitParams = {\n${protocols.join('\n')}\n}\n`

  // Longest first, so a union is replaced before any union it contains.
  const hoisted = [...unions]
    .filter(([, { count }]) => count > 1)
    .sort(([a], [b]) => b.length - a.length)
  const aliases: string[] = []
  for (const [text, { name }] of hoisted) {
    body = body.replaceAll(text, name)
    aliases.push(`type ${name} = ${text}\n`)
  }

  const source = [
    `// Generated by scripts/generate-defikit-types.ts from defi-kit@${version}`,
    `// (defi-kit/eth). Do not edit: run \`bun run generate:defikit\` instead.`,
    '',
    '/** The parameters of each verb of the DeFi Kit allow kit for Ethereum. */',
    body,
    ...aliases,
  ].join('\n')

  return format(source, {
    ...(await resolveConfig(outputPath)),
    filepath: outputPath,
  })
}

const pascalCase = (text: string) =>
  text
    .split(/[^a-zA-Z0-9]+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join('')

if (import.meta.main) {
  await writeFile(outputPath, await generate())
  console.log(`Wrote ${outputPath}`)
}
