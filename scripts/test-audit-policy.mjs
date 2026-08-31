import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { npmAudit } from 'audit-ci'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const temporaryDirectory = mkdtempSync(path.join(tmpdir(), 'document-ts-audit-gate-'))
const fakeNpm = path.join(temporaryDirectory, 'npm')
const originalPath = process.env.PATH

try {
  writeFileSync(
    fakeNpm,
    '#!/usr/bin/env node\nprocess.stdout.write(require("node:fs").readFileSync(process.env.DOCUMENT_TS_AUDIT_FIXTURE, "utf8"))\n'
  )
  chmodSync(fakeNpm, 0o700)
  process.env.PATH = `${temporaryDirectory}${path.delimiter}${originalPath ?? ''}`

  const config = {
    directory: root,
    high: true,
    'output-format': 'json',
    'report-type': 'summary',
  }

  process.env.DOCUMENT_TS_AUDIT_FIXTURE = path.join(
    root,
    'tests/fixtures/npm-audit-clean.json'
  )
  await npmAudit(config)

  process.env.DOCUMENT_TS_AUDIT_FIXTURE = path.join(
    root,
    'tests/fixtures/npm-audit-high.json'
  )
  let rejected = false
  try {
    await npmAudit(config)
  } catch (error) {
    rejected = error instanceof Error && error.message.includes('high vulnerabilities')
    if (!rejected) throw error
  }
  if (!rejected) throw new Error('The high-severity audit fixture did not fail the gate')
} finally {
  delete process.env.DOCUMENT_TS_AUDIT_FIXTURE
  process.env.PATH = originalPath
  rmSync(temporaryDirectory, { force: true, recursive: true })
}

console.log('Verified that the locked audit gate rejects a high-severity advisory.')
