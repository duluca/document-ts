import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const guard = path.join(root, 'scripts/no-mongodb-download-network-guard.cjs')
const temporaryDirectory = mkdtempSync(path.join(tmpdir(), 'document-ts-network-guard-'))

try {
  const probes = [
    ['fastdl.mongodb.org', `require('node:dns').lookup('fastdl.mongodb.org', () => {})`],
    [
      'downloads.mongodb.com',
      `require('node:https').get('https://downloads.mongodb.com/test')`,
    ],
    [
      'fastdl.mongodb.org',
      `require('node:net').connect({ host: 'fastdl.mongodb.org', port: 443 })`,
    ],
  ]
  for (const [host, source] of probes) {
    const log = path.join(temporaryDirectory, `${host}-${Math.random()}.log`)
    const result = spawnSync(process.execPath, ['--require', guard, '-e', source], {
      encoding: 'utf8',
      env: { ...process.env, DOCUMENT_TS_DOWNLOAD_ATTEMPT_LOG: log },
    })
    if (result.status === 0) throw new Error(`${host} request was not blocked`)
    if (!readFileSync(log, 'utf8').includes(host)) {
      throw new Error(`${host} request was blocked without an audit record`)
    }
  }

  const allowed = spawnSync(
    process.execPath,
    [
      '--require',
      guard,
      '-e',
      `require('node:dns').lookup('localhost', (error) => process.exitCode = error ? 1 : 0)`,
    ],
    { encoding: 'utf8' }
  )
  if (allowed.status !== 0) throw new Error('The guard blocked a local MongoDB host')

  console.log(
    'MongoDB binary-download hosts are blocked and recorded; local hosts remain allowed.'
  )
} finally {
  rmSync(temporaryDirectory, { force: true, recursive: true })
}
