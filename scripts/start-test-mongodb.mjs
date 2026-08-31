import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const composeFile = path.resolve(
  root,
  process.env.DOCUMENT_TS_TEST_COMPOSE_FILE ?? 'compose.test.yml'
)
const verifier = spawnSync(
  process.execPath,
  [
    path.join(root, 'scripts/verify-test-image.mjs'),
    '--compose-config',
    composeFile,
  ],
  { encoding: 'utf8', stdio: ['ignore', 'inherit', 'inherit'] }
)

if (verifier.error) throw verifier.error
if (verifier.status !== 0) process.exit(verifier.status ?? 1)

const docker = process.env.DOCUMENT_TS_DOCKER_COMMAND ?? 'docker'
const start = spawnSync(
  docker,
  ['compose', '-f', composeFile, 'up', '-d', '--wait'],
  { stdio: 'inherit' }
)
if (start.error) throw start.error
process.exit(start.status ?? 1)
