import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
function argumentValue(name, fallback) {
  const index = process.argv.indexOf(name)
  if (index === -1) return fallback
  const value = process.argv[index + 1]
  if (!value) throw new Error(`${name} requires a path`)
  return path.resolve(root, value)
}

const matrixPath = argumentValue('--matrix', path.join(root, 'support-matrix.json'))
const packagePath = argumentValue('--package', path.join(root, 'package.json'))
const matrix = JSON.parse(await readFile(matrixPath, 'utf8'))
const packageJson = JSON.parse(await readFile(packagePath, 'utf8'))
const readmePath = path.join(root, 'README.md')
const readme = await readFile(readmePath, 'utf8')
const primary = matrix.tuples.find((entry) => entry.id === matrix.primary)

if (!primary) throw new Error(`Unknown primary support tuple: ${matrix.primary}`)

for (const [contractField, tupleField] of Object.entries({
  node: 'node',
  npm: 'npm',
})) {
  const exactVersions = [
    ...new Set(matrix.tuples.map((entry) => entry[tupleField])),
  ].join(' || ')
  if (matrix.packageContract[contractField] !== exactVersions) {
    throw new Error(
      `packageContract.${contractField} must exactly enumerate tested tuple versions as ${exactVersions}; received ${matrix.packageContract[contractField]}`
    )
  }
}

const expectedMetadata = {
  node: packageJson.engines?.node,
  npm: packageJson.engines?.npm,
  mongodbDriver: packageJson.peerDependencies?.mongodb,
  packageManager: packageJson.packageManager,
  nodeSelector: (await readFile(path.join(root, '.node-version'), 'utf8')).trim(),
}
const requiredMetadata = {
  node: matrix.packageContract.node,
  npm: matrix.packageContract.npm,
  mongodbDriver: matrix.packageContract.mongodbDriver,
  packageManager: `npm@${primary.npm}`,
  nodeSelector: primary.node,
}

for (const [field, expected] of Object.entries(requiredMetadata)) {
  if (expectedMetadata[field] !== expected) {
    throw new Error(`${field} must be ${expected}; received ${expectedMetadata[field]}`)
  }
}

const header = '<!-- support-matrix:start -->'
const footer = '<!-- support-matrix:end -->'
const rows = matrix.tuples
  .map(
    (entry) =>
      `| ${entry.node} | ${entry.npm} | ${entry.mongodbDriver} | ${entry.mongodbServer} | ${entry.nodeStatus} |`
  )
  .join('\n')
const generated = `${header}
## Supported Toolchain

This table is generated from \`support-matrix.json\`. The checked-in matrix is the source of truth for supported and continuously tested combinations.

| Node.js | npm | MongoDB driver | MongoDB server | Node status |
| --- | --- | --- | --- | --- |
${rows}

Package ranges: Node.js \`${matrix.packageContract.node}\`; npm \`${matrix.packageContract.npm}\`; MongoDB driver \`${matrix.packageContract.mongodbDriver}\`.

Compatibility is reviewed against the [Node.js release schedule](${matrix.sources.nodeLifecycle}), [Node.js archive](${matrix.sources.nodeArchive}), [MongoDB driver compatibility table](${matrix.sources.mongodbCompatibility}), and [MongoDB lifecycle schedule](${matrix.sources.mongodbLifecycle}).

GitHub workflows pin [actions/checkout ${matrix.githubActions.checkout.release}](${matrix.sources.checkoutActionRelease}) by full commit SHA. Its declared ${matrix.githubActions.checkout.runtime} runtime is verified from the pinned action metadata and tracked against the Node.js lifecycle schedule.
${footer}`

let expectedReadme
if (readme.includes(header) && readme.includes(footer)) {
  expectedReadme = readme.replace(new RegExp(`${header}[\\s\\S]*?${footer}`), generated)
} else {
  expectedReadme = readme.replace('## Quick Start', `${generated}\n\n## Quick Start`)
}

if (process.argv.includes('--check')) {
  if (expectedReadme !== readme) {
    throw new Error('README support table is stale; run npm run support:generate')
  }
  console.log('README support table and package metadata match support-matrix.json.')
} else {
  await writeFile(readmePath, expectedReadme)
  console.log('Updated README support table from support-matrix.json.')
}
