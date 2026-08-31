import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const immutableImagePattern =
  /^[a-z0-9][a-z0-9._/-]*:\d+\.\d+\.\d+(?:-[a-z0-9._-]+)?@sha256:[a-f0-9]{64}$/
const matrix = JSON.parse(await readFile(path.join(root, 'support-matrix.json'), 'utf8'))
const primary = matrix.tuples.find((tuple) => tuple.id === matrix.primary)

if (!primary) throw new Error(`Unknown primary support tuple: ${matrix.primary}`)
for (const [name, value] of [
  ['NODE_IMAGE', primary.nodeImage],
  ['MONGO_IMAGE', primary.mongodbImage],
]) {
  if (!immutableImagePattern.test(value)) {
    throw new Error(`${name} is not an immutable exact image reference`)
  }
  console.log(`${name}=${value}`)
}
