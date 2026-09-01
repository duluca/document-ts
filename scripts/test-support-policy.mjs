import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const temporaryDirectory = mkdtempSync(path.join(tmpdir(), 'document-ts-support-'))

try {
  const result = spawnSync(
    process.execPath,
    [
      path.join(root, 'scripts/generate-support-docs.mjs'),
      '--check',
      '--matrix',
      'tests/fixtures/support-matrix-widened.json',
    ],
    { cwd: root, encoding: 'utf8' }
  )

  if (result.status === 0) {
    throw new Error('A runtime contract wider than its tested tuples unexpectedly passed')
  }
  const output = `${result.stdout}\n${result.stderr}`
  if (!output.includes('must exactly enumerate tested tuple versions')) {
    throw new Error(`Unexpected support-policy failure:\n${output}`)
  }

  const lifecycleMatrix = JSON.parse(
    readFileSync(path.join(root, 'support-matrix.json'), 'utf8')
  )
  lifecycleMatrix.githubActions.checkout.runtimeEol = '2026-09-15'
  const lifecycleMatrixPath = path.join(
    temporaryDirectory,
    'action-runtime-near-eol.json'
  )
  writeFileSync(lifecycleMatrixPath, `${JSON.stringify(lifecycleMatrix, null, 2)}\n`)
  const lifecycleResult = spawnSync(
    process.execPath,
    [
      path.join(root, 'scripts/check-support-lifecycle.mjs'),
      '--offline',
      '--matrix',
      lifecycleMatrixPath,
    ],
    {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, SUPPORT_CHECK_NOW: '2026-08-31T12:00:00Z' },
    }
  )
  const lifecycleOutput = `${lifecycleResult.stdout}\n${lifecycleResult.stderr}`
  if (
    lifecycleResult.status === 0 ||
    !lifecycleOutput.includes(
      'actions/checkout v7.0.1 runtime Node.js 24 reaches end of life'
    )
  ) {
    throw new Error(
      `Action runtime lifecycle warning was not raised:\n${lifecycleOutput}`
    )
  }

  console.log(
    'Rejected a widened runtime contract and warned before the pinned action runtime EOL.'
  )
} finally {
  rmSync(temporaryDirectory, { force: true, recursive: true })
}
