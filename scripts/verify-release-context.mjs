import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { validateReleaseTagRulesets } from './verify-github-release-context.mjs'

export { validateReleaseTagRulesets }

const EXPECTED_REPOSITORY = 'https://github.com/duluca/document-ts.git'
const EXPECTED_WORKFLOW = 'release.yml'

function fail(message) {
  throw new Error(message)
}

function git(...args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim()
}

function parseVersion(value) {
  const match = value
    .trim()
    .replace(/^v/, '')
    .match(/^(\d+)\.(\d+)\.(\d+)/)
  if (!match) fail(`Invalid version: ${value}`)
  return match.slice(1).map(Number)
}

function atLeast(actual, minimum) {
  for (let index = 0; index < minimum.length; index += 1) {
    if (actual[index] > minimum[index]) return true
    if (actual[index] < minimum[index]) return false
  }
  return true
}

export function validateReleaseTag(tag, version) {
  if (!tag || !/^v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/.test(tag)) {
    fail('Release tag must have the exact form vX.Y.Z')
  }
  if (tag !== `v${version}`) fail(`Tag ${tag} does not match package version ${version}`)
  const parsed = parseVersion(version)
  if (!atLeast(parsed, [6, 3, 1])) {
    fail('Future releases must be newer than the unverified 6.3.0 publication')
  }
}

async function githubJson(path) {
  const token = process.env.GITHUB_TOKEN
  if (!token) fail('GITHUB_TOKEN is required to verify the protected signed tag')
  const response = await fetch(`https://api.github.com${path}`, {
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${token}`,
      'user-agent': 'document-ts-release-verifier',
      'x-github-api-version': '2022-11-28',
    },
  })
  if (!response.ok) fail(`GitHub tag verification failed with HTTP ${response.status}`)
  return response.json()
}

async function verifyRemoteTag(tag, commit) {
  const repository = process.env.GITHUB_REPOSITORY
  if (repository !== 'duluca/document-ts') {
    fail(`Unexpected GitHub repository: ${repository ?? '(missing)'}`)
  }
  const reference = await githubJson(
    `/repos/${repository}/git/ref/tags/${encodeURIComponent(tag)}`
  )
  if (reference.object?.type !== 'tag') fail('Release tag is not an annotated tag')
  const tagObject = await githubJson(
    `/repos/${repository}/git/tags/${reference.object.sha}`
  )
  validateSignedReleaseTagObject(tagObject, tag, commit)
}

export function validateSignedReleaseTagObject(tagObject, tag, commit) {
  if (tagObject?.tag !== tag)
    fail('Signed tag object name does not match the release tag')
  if (tagObject.object?.type !== 'commit' || tagObject.object?.sha !== commit) {
    fail('Signed tag does not point to the workflow commit')
  }
  if (tagObject.verification?.verified !== true)
    fail('GitHub did not verify the tag signature')
  if (tagObject.verification?.reason !== 'valid') {
    fail(`GitHub tag signature reason is ${tagObject.verification?.reason ?? 'missing'}`)
  }
}

async function verifyProtectedReleaseTag(tag) {
  const summaries = await githubJson(
    `/repos/${process.env.GITHUB_REPOSITORY}/rulesets?targets=tag&includes_parents=true&per_page=100`
  )
  if (!Array.isArray(summaries) || summaries.length === 0) {
    fail('Repository has no tag ruleset candidates')
  }
  const rulesets = []
  for (const summary of summaries) {
    if (!Number.isSafeInteger(summary?.id) || summary.id <= 0) {
      fail('Repository returned an invalid tag ruleset ID')
    }
    rulesets.push(
      await githubJson(`/repos/${process.env.GITHUB_REPOSITORY}/rulesets/${summary.id}`)
    )
  }
  validateReleaseTagRulesets(rulesets, tag)
}

async function main() {
  const packageJson = JSON.parse(readFileSync('package.json', 'utf8'))
  const tag = process.env.GITHUB_REF_NAME
  const commit = process.env.GITHUB_SHA
  validateReleaseTag(tag, packageJson.version)
  if (packageJson.repository?.url !== EXPECTED_REPOSITORY) {
    fail(`package.json repository must be ${EXPECTED_REPOSITORY}`)
  }
  const expectedWorkflowRef = `duluca/document-ts/.github/workflows/${EXPECTED_WORKFLOW}@refs/tags/${tag}`
  if (process.env.GITHUB_WORKFLOW_REF !== expectedWorkflowRef) {
    fail(`Release must run from .github/workflows/${EXPECTED_WORKFLOW}`)
  }
  if (process.env.GITHUB_REF_TYPE !== 'tag')
    fail('Release workflow was not triggered by a tag')
  if (
    process.env.GITHUB_REF !== `refs/tags/${tag}` ||
    process.env.GITHUB_REF_NAME !== tag
  ) {
    fail('Release workflow ref does not match the validated release tag')
  }

  const head = git('rev-parse', 'HEAD')
  if (!commit || head !== commit) fail('Workflow commit does not match checked-out HEAD')
  if (git('status', '--porcelain', '--untracked-files=all') !== '') {
    fail('Release checkout is not clean before the build')
  }
  if (git('cat-file', '-t', `refs/tags/${tag}`) !== 'tag') {
    fail('Release tag is not an annotated tag')
  }
  if (git('rev-list', '-n', '1', `refs/tags/${tag}`) !== head) {
    fail('Release tag does not resolve to checked-out HEAD')
  }
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', head, 'origin/main'])
  } catch {
    fail('Release commit is not reachable from origin/main')
  }

  const npmVersionText = execFileSync('npm', ['--version'], { encoding: 'utf8' })
  if (process.version !== 'v22.23.2') {
    fail(`Release requires Node 22.23.2; found ${process.version}`)
  }
  if (npmVersionText.trim() !== '12.0.2') {
    fail(`Release requires npm 12.0.2; found ${npmVersionText.trim()}`)
  }

  await verifyRemoteTag(tag, head)
  await verifyProtectedReleaseTag(tag)
  console.log(`Verified signed release context ${tag} at ${head}`)
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : ''
if (invokedPath === resolve(new URL(import.meta.url).pathname)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}
