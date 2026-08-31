import { describe, expect, test } from '@jest/globals'
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { parse } from 'yaml'

function runScript(
  script: string,
  args: string[] = [],
  environment: Record<string, string> = {}
) {
  return spawnSync(process.execPath, [path.join(process.cwd(), script), ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...environment },
  })
}

describe('toolchain security policy', () => {
  test('installs before running the local high-severity audit gate', () => {
    const packageJson = JSON.parse(
      readFileSync(path.join(process.cwd(), 'package.json'), 'utf8')
    ) as { scripts: Record<string, string> }
    const ciWorkflow = readFileSync(
      path.join(process.cwd(), '.github/workflows/ci.yml'),
      'utf8'
    )
    expect(packageJson.scripts['audit:ci']).toBe('audit-ci --high')
    expect(ciWorkflow.indexOf('run: npm ci --ignore-scripts')).toBeLessThan(
      ciWorkflow.indexOf('npm run audit:ci')
    )
    expect(ciWorkflow).not.toContain('npx audit-ci')
    expect(ciWorkflow).not.toMatch(/audit-ci[^\n]*(?:--allowlist|-w\s)/)
  })

  test('the lockfile-installed audit gate rejects a high-severity fixture', () => {
    const result = runScript('scripts/test-audit-policy.mjs')
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('rejects a high-severity advisory')
  })

  test('accepts the reviewed MongoDB image', () => {
    const result = runScript('scripts/verify-test-image.mjs')
    expect(result.status).toBe(0)
  })

  test('rejects altered tracked image configurations before any Docker command runs', () => {
    const result = runScript('scripts/test-test-image-policy.mjs')
    expect(result.status).toBe(0)
    expect(result.stdout).toContain(
      'invalid image-policy cases for their expected reasons before startup'
    )
  })

  test('rejects a MongoDB image without a digest before tests start', () => {
    const result = runScript('scripts/verify-test-image.mjs', ['--image', 'mongo:7.0.40'])
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('image policy violation')
  })

  test('rejects a changed MongoDB digest before tests start', () => {
    const result = runScript('scripts/verify-test-image.mjs', [
      '--image',
      `mongo:7.0.40@sha256:${'a'.repeat(64)}`,
    ])
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('candidate does not match')
  })

  test('accepts unchanged registry digest fixtures', () => {
    const result = runScript('scripts/check-container-digests.mjs', [
      '--fixture',
      'tests/fixtures/container-digests-current.json',
    ])
    expect(result.status).toBe(0)
  })

  test('turns a changed upstream digest into an update proposal', () => {
    const result = runScript('scripts/check-container-digests.mjs', [
      '--fixture',
      'tests/fixtures/container-digests-changed.json',
    ])
    expect(result.status).toBe(2)
    expect(result.stdout).toContain('Container digest update proposal')
    expect(result.stdout).toContain('Digest changed')
  })

  test('turns a newer permitted image tag into an update proposal', () => {
    const result = runScript('scripts/check-container-digests.mjs', [
      '--fixture',
      'tests/fixtures/container-tags-changed.json',
    ])
    expect(result.status).toBe(2)
    expect(result.stdout).toContain('New permitted patch tag')
    expect(result.stdout).toContain('node:22.24.0-bookworm@sha256:')
  })

  test('runs the service-free policy job before the Mongo-backed build', () => {
    const workflow = parse(
      readFileSync(path.join(process.cwd(), '.github/workflows/ci.yml'), 'utf8')
    ) as {
      jobs: {
        policy: { services?: unknown; steps: Array<{ run?: string }> }
        build: { needs?: string; services?: Record<string, unknown> }
      }
    }
    expect(Object.keys(workflow.jobs)).toEqual(['policy', 'build'])
    expect(workflow.jobs.policy.services).toBeUndefined()
    expect(
      workflow.jobs.policy.steps.some((step) => step.run?.includes('audit:ci'))
    ).toBe(true)
    expect(workflow.jobs.build.needs).toBe('policy')
    expect(Object.keys(workflow.jobs.build.services ?? {})).toEqual(['mongodb'])
  })

  test('removes the retired CI provider configuration and privileged upload path', () => {
    for (const retiredPath of [
      '.circleci/config.yml',
      '.circleci/coverage-reporter.json',
      '.circleci/upload-coverage.mjs',
    ]) {
      expect(existsSync(path.join(process.cwd(), retiredPath))).toBe(false)
    }
    const ciWorkflow = readFileSync(
      path.join(process.cwd(), '.github/workflows/ci.yml'),
      'utf8'
    )
    expect(ciWorkflow).not.toMatch(/circleci|coveralls/i)
    const credentialMarkers = [
      ['NPM', 'TOKEN'].join('_'),
      ['NODE', 'AUTH', 'TOKEN'].join('_'),
    ]
    expect(ciWorkflow).not.toMatch(new RegExp(`\\b(?:${credentialMarkers.join('|')})\\b`))
    expect(ciWorkflow).not.toContain('id-token: write')
    expect(ciWorkflow).not.toMatch(/\bnpm publish\b/)
  })

  test('reports support lines that enter the lifecycle warning window', () => {
    const supported = runScript('scripts/check-support-lifecycle.mjs', ['--offline'], {
      SUPPORT_CHECK_NOW: '2026-08-31T12:00:00Z',
    })
    const expiring = runScript('scripts/check-support-lifecycle.mjs', ['--offline'], {
      SUPPORT_CHECK_NOW: '2027-03-01T12:00:00Z',
    })
    expect(supported.status).toBe(0)
    expect(expiring.status).toBe(1)
    expect(expiring.stdout).toContain('Node.js 22.23.2 reaches end of life')
  })
})
