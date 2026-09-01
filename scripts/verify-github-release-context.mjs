import { execFileSync } from 'node:child_process'
import { lstatSync, readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  validateProvenanceStatement,
  validateReleaseManifestIdentity,
  verifyReleaseBundle,
} from './release-artifact.mjs'

const EXPECTED_REPOSITORY = 'duluca/document-ts'
const EXPECTED_REPOSITORY_URL = 'https://github.com/duluca/document-ts.git'
const EXPECTED_WORKFLOW_NAME = 'Publish npm package'
const EXPECTED_WORKFLOW_PATH = '.github/workflows/release.yml'
const RELEASE_DIRECTORY = resolve('release-artifacts')
const MAX_EVIDENCE_BYTES = 2 * 1024 * 1024

function fail(message) {
  throw new Error(message)
}

function assertPlainObject(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    fail(`${label} must be an object`)
  }
  return value
}

function readBoundedJson(path, maximumBytes, label) {
  const stat = lstatSync(path)
  if (!stat.isFile() || stat.isSymbolicLink()) fail(`${label} is not a regular file`)
  if (stat.size > maximumBytes) fail(`${label} exceeds its size limit`)
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    fail(`${label} is not valid JSON`)
  }
}

function git(...args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim()
}

async function githubJson(path, token) {
  if (!token) fail('GITHUB_TOKEN is required to verify the triggering workflow run')
  const response = await fetch(`https://api.github.com${path}`, {
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${token}`,
      'user-agent': 'document-ts-github-release-verifier',
      'x-github-api-version': '2022-11-28',
    },
  })
  if (!response.ok) fail(`GitHub verification failed with HTTP ${response.status}`)
  return response.json()
}

function validateStableTag(tag) {
  if (!/^v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/.test(tag)) {
    fail('Triggering workflow ref is not an exact stable semantic-version tag')
  }
  return tag
}

export function validateWorkflowRunEvent(event, apiRun) {
  assertPlainObject(event, 'workflow_run event')
  const eventRun = assertPlainObject(event.workflow_run, 'event workflow_run')
  assertPlainObject(apiRun, 'API workflow run')

  if (event.action !== 'completed') fail('workflow_run action is not completed')
  if (event.repository?.full_name !== EXPECTED_REPOSITORY) {
    fail('Event repository identity is incorrect')
  }
  if (!Number.isSafeInteger(apiRun.id) || apiRun.id <= 0 || eventRun.id !== apiRun.id) {
    fail('Workflow run ID is invalid or changed between event and API')
  }
  for (const [label, actual, expected] of [
    ['name', apiRun.name, EXPECTED_WORKFLOW_NAME],
    ['event', apiRun.event, 'push'],
    ['status', apiRun.status, 'completed'],
    ['conclusion', apiRun.conclusion, 'success'],
    ['repository', apiRun.repository?.full_name, EXPECTED_REPOSITORY],
    ['head repository', apiRun.head_repository?.full_name, EXPECTED_REPOSITORY],
  ]) {
    if (actual !== expected)
      fail(`Triggering workflow ${label} is ${actual ?? '(missing)'}`)
  }
  const tag = validateStableTag(apiRun.head_branch)
  if (apiRun.path !== EXPECTED_WORKFLOW_PATH) {
    fail(`Triggering workflow path is ${apiRun.path ?? '(missing)'}`)
  }
  const commit = apiRun.head_sha
  if (!/^[0-9a-f]{40}$/.test(commit))
    fail('Triggering workflow SHA is not a full Git SHA')
  if (apiRun.head_commit?.id !== commit)
    fail('Triggering workflow head commit is inconsistent')

  for (const [key, normalize = (value) => value] of [
    ['name'],
    ['event'],
    ['status'],
    ['conclusion'],
    ['head_branch'],
    ['head_sha'],
    ['path'],
  ]) {
    if (normalize(eventRun[key]) !== normalize(apiRun[key])) {
      fail(`Event workflow run ${key} does not match the GitHub API`)
    }
  }
  if (
    eventRun.repository?.full_name !== EXPECTED_REPOSITORY ||
    eventRun.head_repository?.full_name !== EXPECTED_REPOSITORY
  ) {
    fail('Event workflow run did not originate in the expected repository')
  }
  return { runId: apiRun.id, tag, commit }
}

function verifyLocalReleaseCommit(tag, commit) {
  const remote = git('remote', 'get-url', 'origin')
  if (
    remote !== EXPECTED_REPOSITORY_URL &&
    remote !== 'https://github.com/duluca/document-ts' &&
    remote !== 'git@github.com:duluca/document-ts.git'
  ) {
    fail(`Unexpected origin remote: ${remote}`)
  }
  if (git('status', '--porcelain', '--untracked-files=all') !== '') {
    fail('Trusted verifier checkout is not clean before artifact download')
  }
  try {
    execFileSync('git', ['cat-file', '-e', `${commit}^{commit}`])
    execFileSync('git', ['merge-base', '--is-ancestor', commit, 'origin/main'])
  } catch {
    fail('Triggering commit is not reachable from origin/main')
  }
  if (git('cat-file', '-t', `refs/tags/${tag}`) !== 'tag') {
    fail('Triggering tag is not an annotated tag in the trusted checkout')
  }
  if (git('rev-list', '-n', '1', `refs/tags/${tag}`) !== commit) {
    fail('Triggering tag does not resolve to the workflow commit')
  }
}

async function verifyRemoteReleaseTag(tag, commit, token) {
  const reference = await githubJson(
    `/repos/${EXPECTED_REPOSITORY}/git/ref/tags/${encodeURIComponent(tag)}`,
    token
  )
  if (reference.object?.type !== 'tag' || !/^[0-9a-f]{40}$/.test(reference.object?.sha)) {
    fail('Release tag is not an annotated GitHub tag')
  }
  const tagObject = await githubJson(
    `/repos/${EXPECTED_REPOSITORY}/git/tags/${reference.object.sha}`,
    token
  )
  if (tagObject.tag !== tag) fail('GitHub tag object name is incorrect')
  if (tagObject.object?.type !== 'commit' || tagObject.object?.sha !== commit) {
    fail('GitHub tag object does not point to the workflow commit')
  }
  if (
    tagObject.verification?.verified !== true ||
    tagObject.verification?.reason !== 'valid'
  ) {
    fail('GitHub did not verify a valid release-tag signature')
  }
}

export function validateReleaseTagRulesets(rulesets, tag) {
  validateStableTag(tag)
  if (!Array.isArray(rulesets)) fail('Repository tag rulesets response is invalid')
  const protectiveRuleset = rulesets.find((ruleset) => {
    if (
      ruleset?.target !== 'tag' ||
      ruleset?.enforcement !== 'active' ||
      ruleset?.source !== EXPECTED_REPOSITORY ||
      !Array.isArray(ruleset.bypass_actors) ||
      ruleset.bypass_actors.length !== 0
    ) {
      return false
    }
    const condition = ruleset.conditions?.ref_name
    if (
      !Array.isArray(condition?.include) ||
      !condition.include.includes('refs/tags/v*') ||
      !Array.isArray(condition.exclude) ||
      condition.exclude.length !== 0
    ) {
      return false
    }
    const ruleTypes = new Set(ruleset.rules?.map(({ type }) => type))
    return ['update', 'deletion', 'required_signatures'].every((type) =>
      ruleTypes.has(type)
    )
  })
  if (!protectiveRuleset) {
    fail(
      'No active, no-bypass v* tag ruleset blocks updates/deletion and requires signatures'
    )
  }
  return protectiveRuleset
}

async function verifyOperationalReleaseControls(tag, token) {
  const immutableReleases = await githubJson(
    `/repos/${EXPECTED_REPOSITORY}/immutable-releases`,
    token
  )
  if (immutableReleases.enabled !== true) {
    fail('Repository immutable releases are not enabled')
  }
  const summaries = await githubJson(
    `/repos/${EXPECTED_REPOSITORY}/rulesets?targets=tag&includes_parents=true&per_page=100`,
    token
  )
  if (!Array.isArray(summaries) || summaries.length === 0) {
    fail('Repository has no active tag ruleset candidates')
  }
  const rulesets = []
  for (const summary of summaries) {
    if (!Number.isSafeInteger(summary?.id) || summary.id <= 0) {
      fail('Repository returned an invalid tag ruleset ID')
    }
    rulesets.push(
      await githubJson(`/repos/${EXPECTED_REPOSITORY}/rulesets/${summary.id}`, token)
    )
  }
  validateReleaseTagRulesets(rulesets, tag)
}

export function validateFinalReleaseEvidence(manifest, directory = RELEASE_DIRECTORY) {
  validateReleaseManifestIdentity(manifest, { requireSourceTag: true })
  const expectedFiles = [
    'INTEGRITY',
    'SHA256SUMS',
    'SHA512SUMS',
    manifest.artifact.filename,
    'npm-audit-signatures.json',
    'npm-provenance-statement.json',
    'release-manifest.json',
  ].sort()
  const actualFiles = readdirSync(directory).sort()
  if (JSON.stringify(actualFiles) !== JSON.stringify(expectedFiles)) {
    fail('Release evidence directory contains missing or unexpected entries')
  }

  const audit = readBoundedJson(
    resolve(directory, 'npm-audit-signatures.json'),
    MAX_EVIDENCE_BYTES,
    'npm signature audit'
  )
  if (audit.invalid?.length || audit.missing?.length) {
    fail('npm signature audit contains invalid or missing signatures')
  }
  const verifiedPackage = audit.verified?.find(
    ({ name, version }) =>
      name === manifest.package.name && version === manifest.package.version
  )
  if (
    !verifiedPackage ||
    verifiedPackage.attestations?.provenance?.predicateType !==
      'https://slsa.dev/provenance/v1'
  ) {
    fail('npm signature audit does not verify the released package provenance')
  }
  const statement = readBoundedJson(
    resolve(directory, 'npm-provenance-statement.json'),
    MAX_EVIDENCE_BYTES,
    'npm provenance statement'
  )
  validateProvenanceStatement(statement, manifest)
  return manifest
}

async function preArtifactValidation() {
  if (process.env.GITHUB_EVENT_NAME !== 'workflow_run') {
    fail('GitHub release verifier must run only for workflow_run events')
  }
  if (process.env.GITHUB_REPOSITORY !== EXPECTED_REPOSITORY) {
    fail('GitHub release verifier is running in the wrong repository')
  }
  const eventPath = process.env.GITHUB_EVENT_PATH
  if (!eventPath) fail('GITHUB_EVENT_PATH is required')
  const event = readBoundedJson(eventPath, MAX_EVIDENCE_BYTES, 'workflow_run event')
  const eventRunId = event.workflow_run?.id
  if (!Number.isSafeInteger(eventRunId) || eventRunId <= 0)
    fail('Event run ID is invalid')
  const token = process.env.GITHUB_TOKEN
  const apiRun = await githubJson(
    `/repos/${EXPECTED_REPOSITORY}/actions/runs/${eventRunId}`,
    token
  )
  const trusted = validateWorkflowRunEvent(event, apiRun)
  verifyLocalReleaseCommit(trusted.tag, trusted.commit)
  await verifyRemoteReleaseTag(trusted.tag, trusted.commit, token)
  process.stdout.write(
    `run_id=${trusted.runId}\ntag=${trusted.tag}\ncommit=${trusted.commit}\n`
  )
}

function bundleValidation() {
  const expectedTag = process.env.EXPECTED_TAG
  const expectedCommit = process.env.EXPECTED_COMMIT
  validateStableTag(expectedTag)
  if (!/^[0-9a-f]{40}$/.test(expectedCommit)) fail('Expected commit is invalid')
  const manifest = verifyReleaseBundle(RELEASE_DIRECTORY, true)
  validateReleaseManifestIdentity(manifest, {
    expectedTag,
    expectedCommit,
    requireSourceTag: true,
  })
  validateFinalReleaseEvidence(manifest, RELEASE_DIRECTORY)
  process.stdout.write(
    `tag=${manifest.source.tag}\nartifact=release-artifacts/${manifest.artifact.filename}\n`
  )
}

async function prePublicationValidation() {
  if (process.env.GITHUB_REPOSITORY !== EXPECTED_REPOSITORY) {
    fail('GitHub release verifier is running in the wrong repository')
  }
  const tag = validateStableTag(process.env.EXPECTED_TAG)
  const commit = process.env.EXPECTED_COMMIT
  if (!/^[0-9a-f]{40}$/.test(commit)) fail('Expected commit is invalid')
  const token = process.env.GITHUB_TOKEN
  await verifyOperationalReleaseControls(tag, token)
  await verifyRemoteReleaseTag(tag, commit, token)
  console.error(`Reverified protected release tag ${tag} at ${commit}`)
}

async function main() {
  const command = process.argv[2]
  if (command === 'pre') await preArtifactValidation()
  else if (command === 'bundle') bundleValidation()
  else if (command === 'pre-publish') await prePublicationValidation()
  else fail('Expected one of: pre, bundle, pre-publish')
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}
