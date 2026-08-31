import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { isDeepStrictEqual } from 'node:util'
import { isAlias, parseDocument, visit } from 'yaml'

const RELEASE_WORKFLOW = '.github/workflows/release.yml'
const GITHUB_RELEASE_WORKFLOW = '.github/workflows/github-release.yml'
const CODEQL_WORKFLOW = '.github/workflows/codeql.yml'
const CI_WORKFLOW = '.github/workflows/ci.yml'
const EXPECTED_NODE_VERSION = '22.23.2'
const EXPECTED_NPM_VERSION = '12.0.2'
const EXPECTED_MONGO_IMAGE =
  'mongo:7.0.40@sha256:b6421fd6d1c5ded6377b397d8983e2f82e2100dc5123332dcfda2065a472be5b'
const REVIEWED_WORKFLOWS = [
  '.github/workflows/ci.yml',
  '.github/workflows/codeql.yml',
  '.github/workflows/github-release.yml',
  '.github/workflows/no-egress-integration.yml',
  '.github/workflows/release.yml',
  '.github/workflows/toolchain-maintenance.yml',
]
const REVIEWED_SEMANTIC_DIGESTS = {
  '.github/workflows/ci.yml':
    'b580f39443f75325766003daff4305bd37192009ec9d7cb06a90a3ce77decfa2',
  '.github/workflows/no-egress-integration.yml':
    '459f5cf868239a5798c57d154ffb730d99e511e796baad8e3b8ebed23613c731',
  '.github/workflows/toolchain-maintenance.yml':
    '09a5206231bbfba1db4749b79b4a7d3d6e7f24aa586b7b7a4a35df1a34f2024b',
}

function fail(message) {
  throw new Error(message)
}

function assertPlainObject(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    fail(`${label} must be an object`)
  }
  return value
}

function assertExactKeys(value, expected, label) {
  assertPlainObject(value, label)
  const actual = Object.keys(value).sort()
  const wanted = [...expected].sort()
  if (!isDeepStrictEqual(actual, wanted)) {
    fail(
      `${label} keys are ${JSON.stringify(actual)}; expected ${JSON.stringify(wanted)}`
    )
  }
}

function assertEqual(actual, expected, label) {
  if (!isDeepStrictEqual(actual, expected)) {
    fail(`${label} does not match the reviewed policy`)
  }
}

export function parseYamlPolicy(source, label) {
  const document = parseDocument(source, {
    merge: false,
    prettyErrors: true,
    strict: true,
    uniqueKeys: true,
  })
  if (document.errors.length > 0) {
    fail(
      `${label} is invalid YAML: ${document.errors.map(({ message }) => message).join('; ')}`
    )
  }
  visit(document, {
    Node(_, node) {
      if (isAlias(node)) fail(`${label} may not contain YAML aliases`)
    },
  })
  return assertPlainObject(document.toJS({ maxAliasCount: 0 }), label)
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalize(value[key])])
    )
  }
  return value
}

export function semanticPolicyDigest(source, label) {
  return createHash('sha256')
    .update(JSON.stringify(canonicalize(parseYamlPolicy(source, label))))
    .digest('hex')
}

function assertReviewedSemanticPolicy(source, path) {
  const expected = REVIEWED_SEMANTIC_DIGESTS[path]
  if (!expected || semanticPolicyDigest(source, path) !== expected) {
    fail(`${path} does not match its reviewed semantic policy`)
  }
}

function walk(value, visitor, path = '$') {
  if (Array.isArray(value)) {
    value.forEach((item, index) => walk(item, visitor, `${path}[${index}]`))
    return
  }
  if (value === null || typeof value !== 'object') return
  for (const [key, child] of Object.entries(value)) {
    visitor(key, child, `${path}.${key}`)
    walk(child, visitor, `${path}.${key}`)
  }
}

function trackedFiles() {
  return execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {
    encoding: 'utf8',
  })
    .trim()
    .split('\n')
    .filter(Boolean)
}

function read(path) {
  return readFileSync(path, 'utf8')
}

function verifyNoReusableRegistryCredential(files, reader = read) {
  const prohibited = [
    ['NPM', 'TOKEN'].join('_'),
    ['NODE', 'AUTH', 'TOKEN'].join('_'),
    ['_', 'auth', 'Token'].join(''),
  ]
  for (const path of files) {
    const content = reader(path)
    const match = prohibited.find((term) => content.includes(term))
    if (match) fail(`${path} contains a prohibited reusable registry credential marker`)
  }
  if (files.some((path) => /(^|\/)\.npmrc$/.test(path))) {
    fail('A registry configuration file is tracked')
  }
}

export function verifyWorkflowActionPins(source, path = 'workflow.yml') {
  const workflow = parseYamlPolicy(source, path)
  let references = 0
  walk(workflow, (key, reference, location) => {
    if (key !== 'uses') return
    references += 1
    if (typeof reference !== 'string') fail(`${location} must be a string`)
    if (reference.startsWith('./')) {
      if (
        !/^\.\/[A-Za-z0-9._/-]+$/.test(reference) ||
        reference.includes('/../') ||
        reference.endsWith('/..')
      ) {
        fail(`${path} has an unsafe local action reference: ${reference}`)
      }
      return
    }
    const separator = reference.lastIndexOf('@')
    if (separator === -1) fail(`${path} has an unpinned action: ${reference}`)
    const action = reference.slice(0, separator)
    const revision = reference.slice(separator + 1)
    if (!/^[0-9a-f]{40}$/.test(revision)) {
      fail(`${path} action is not pinned to a full commit SHA: ${reference}`)
    }
    if (!action.startsWith('actions/') && !action.startsWith('github/codeql-action/')) {
      fail(`${path} uses an action outside the reviewed allowlist: ${action}`)
    }
  })
  if (references === 0) fail(`${path} has no action references`)
  return workflow
}

function actionName(reference) {
  return typeof reference === 'string'
    ? reference.slice(0, reference.lastIndexOf('@'))
    : ''
}

function assertActionStep(step, name, action, withValue, label) {
  const keys = ['name', 'uses']
  if (withValue !== undefined) keys.push('with')
  assertExactKeys(step, keys, label)
  assertEqual(step.name, name, `${label}.name`)
  assertEqual(actionName(step.uses), action, `${label}.uses`)
  if (withValue !== undefined) assertEqual(step.with, withValue, `${label}.with`)
}

function normalizedRun(value) {
  if (typeof value !== 'string') fail('Workflow run command must be a string')
  return value.replace(/\r\n/g, '\n').trim()
}

function assertRunStep(step, name, run, label, env) {
  const keys = ['name', 'run']
  if (env !== undefined) keys.push('env')
  assertExactKeys(step, keys, label)
  assertEqual(step.name, name, `${label}.name`)
  assertEqual(normalizedRun(step.run), normalizedRun(run), `${label}.run`)
  if (env !== undefined) assertEqual(step.env, env, `${label}.env`)
}

function assertReleaseJobBase(job, expectedKeys, label) {
  assertExactKeys(job, expectedKeys, label)
  assertEqual(job['runs-on'], 'ubuntu-24.04', `${label}.runs-on`)
}

export function verifyReleaseWorkflowDocument(source) {
  const release = verifyWorkflowActionPins(source, RELEASE_WORKFLOW)
  assertExactKeys(
    release,
    ['name', 'on', 'permissions', 'concurrency', 'jobs'],
    'release.yml'
  )
  assertEqual(release.name, 'Publish npm package', 'release.yml name')
  assertEqual(release.on, { push: { tags: ['v*.*.*'] } }, 'release.yml trigger')
  assertEqual(release.permissions, { contents: 'read' }, 'release.yml permissions')
  assertEqual(
    release.concurrency,
    { group: 'npm-release-${{ github.ref }}', 'cancel-in-progress': false },
    'release.yml concurrency'
  )
  assertExactKeys(
    release.jobs,
    ['build', 'publish', 'verify-publication'],
    'release jobs'
  )

  const build = release.jobs.build
  assertReleaseJobBase(
    build,
    ['name', 'permissions', 'runs-on', 'timeout-minutes', 'env', 'services', 'steps'],
    'release build job'
  )
  assertEqual(
    build.name,
    'Build verified artifact without publication authority',
    'build.name'
  )
  assertEqual(build.permissions, { contents: 'read' }, 'build.permissions')
  assertEqual(build['timeout-minutes'], 30, 'build.timeout-minutes')
  assertEqual(build.env, { MONGO_URI: 'mongodb://127.0.0.1:27017' }, 'build.env')
  assertEqual(
    build.services,
    { mongodb: { image: EXPECTED_MONGO_IMAGE, ports: ['27017:27017'] } },
    'build.services'
  )
  assertEqual(build.steps.length, 8, 'build step count')
  assertActionStep(
    build.steps[0],
    'Check out the signed tag',
    'actions/checkout',
    { 'fetch-depth': 0, 'fetch-tags': true, 'persist-credentials': false },
    'build.steps[0]'
  )
  assertActionStep(
    build.steps[1],
    'Set up Node.js',
    'actions/setup-node',
    { 'node-version': EXPECTED_NODE_VERSION, cache: 'npm' },
    'build.steps[1]'
  )
  assertRunStep(
    build.steps[2],
    'Pin the trusted-publishing npm client',
    `npm install --global npm@${EXPECTED_NPM_VERSION} --ignore-scripts`,
    'build.steps[2]'
  )
  assertRunStep(
    build.steps[3],
    'Verify the protected release context',
    `git fetch --no-tags origin '+refs/heads/main:refs/remotes/origin/main'
node --version
npm --version
npm run release:verify-context`,
    'build.steps[3]',
    { GITHUB_TOKEN: '${{ github.token }}' }
  )
  assertRunStep(
    build.steps[4],
    'Install locked dependencies',
    'npm ci --ignore-scripts',
    'build.steps[4]'
  )
  assertRunStep(
    build.steps[5],
    'Test and build the release source',
    `npm run security:config
npm run test:release-policy
npm run style
npm run lint
npm test
npm run build`,
    'build.steps[5]'
  )
  assertRunStep(
    build.steps[6],
    'Build and verify one release artifact',
    `npm run release:pack
npm run release:verify`,
    'build.steps[6]',
    {
      EXPECTED_COMMIT: '${{ github.sha }}',
      EXPECTED_TAG: '${{ github.ref_name }}',
    }
  )
  assertActionStep(
    build.steps[7],
    'Retain the release candidate',
    'actions/upload-artifact',
    {
      name: 'npm-release-candidate',
      path: 'release-artifacts/',
      'if-no-files-found': 'error',
      'retention-days': 7,
    },
    'build.steps[7]'
  )

  const publish = release.jobs.publish
  assertReleaseJobBase(
    publish,
    [
      'name',
      'needs',
      'permissions',
      'runs-on',
      'timeout-minutes',
      'environment',
      'steps',
    ],
    'release publish job'
  )
  assertEqual(publish.name, 'Publish approved artifact through OIDC', 'publish.name')
  assertEqual(publish.needs, 'build', 'publish.needs')
  assertEqual(
    publish.permissions,
    { contents: 'read', 'id-token': 'write' },
    'publish.permissions'
  )
  assertEqual(publish['timeout-minutes'], 15, 'publish.timeout-minutes')
  assertEqual(publish.environment, 'npm-release', 'publish.environment')
  assertEqual(publish.steps.length, 7, 'publish step count')
  assertActionStep(
    publish.steps[0],
    'Check out the signed tag',
    'actions/checkout',
    { 'fetch-depth': 0, 'fetch-tags': true, 'persist-credentials': false },
    'publish.steps[0]'
  )
  assertActionStep(
    publish.steps[1],
    'Set up Node.js',
    'actions/setup-node',
    { 'node-version': EXPECTED_NODE_VERSION },
    'publish.steps[1]'
  )
  assertRunStep(
    publish.steps[2],
    'Pin the trusted-publishing npm client',
    `npm install --global npm@${EXPECTED_NPM_VERSION} --ignore-scripts`,
    'publish.steps[2]'
  )
  assertRunStep(
    publish.steps[3],
    'Reverify the protected release context',
    `git fetch --no-tags origin '+refs/heads/main:refs/remotes/origin/main'
npm run release:verify-context`,
    'publish.steps[3]',
    { GITHUB_TOKEN: '${{ github.token }}' }
  )
  assertActionStep(
    publish.steps[4],
    'Download the unprivileged build output',
    'actions/download-artifact',
    { name: 'npm-release-candidate', path: 'release-artifacts' },
    'publish.steps[4]'
  )
  assertRunStep(
    publish.steps[5],
    'Verify the exact candidate again',
    'npm run release:verify',
    'publish.steps[5]',
    {
      EXPECTED_COMMIT: '${{ github.sha }}',
      EXPECTED_TAG: '${{ github.ref_name }}',
    }
  )
  assertRunStep(
    publish.steps[6],
    'Publish the verified artifact through npm OIDC',
    `artifact="$(find release-artifacts -maxdepth 1 -type f -name '*.tgz')"
test -n "$artifact"
test "$(printf '%s\\n' "$artifact" | wc -l | tr -d ' ')" = 1
publication_state="$(node scripts/release-artifact.mjs publication-state)"
if [ "$publication_state" = 'absent' ]; then
  npm run release:verify-context
  npm publish "$artifact" --access public --provenance --ignore-scripts
elif [ "$publication_state" = 'identical' ]; then
  echo 'The exact artifact is already published; continuing recovery verification.'
else
  echo "Unexpected publication state: $publication_state" >&2
  exit 1
fi`,
    'publish.steps[6]',
    { GITHUB_TOKEN: '${{ github.token }}' }
  )

  const verification = release.jobs['verify-publication']
  assertReleaseJobBase(
    verification,
    ['name', 'needs', 'permissions', 'runs-on', 'timeout-minutes', 'steps'],
    'release verification job'
  )
  assertEqual(
    verification.name,
    'Verify published bytes and provenance without OIDC authority',
    'verification.name'
  )
  assertEqual(verification.needs, 'publish', 'verification.needs')
  assertEqual(verification.permissions, { contents: 'read' }, 'verification.permissions')
  assertEqual(verification['timeout-minutes'], 10, 'verification.timeout-minutes')
  assertEqual(verification.steps.length, 7, 'verification step count')
  assertActionStep(
    verification.steps[0],
    'Check out the trusted release verifier',
    'actions/checkout',
    { ref: 'main', 'persist-credentials': false },
    'verification.steps[0]'
  )
  assertActionStep(
    verification.steps[1],
    'Set up Node.js',
    'actions/setup-node',
    { 'node-version': EXPECTED_NODE_VERSION },
    'verification.steps[1]'
  )
  assertRunStep(
    verification.steps[2],
    'Pin the signature-verification npm client',
    `npm install --global npm@${EXPECTED_NPM_VERSION} --ignore-scripts`,
    'verification.steps[2]'
  )
  assertActionStep(
    verification.steps[3],
    'Download the exact published candidate',
    'actions/download-artifact',
    { name: 'npm-release-candidate', path: 'release-artifacts' },
    'verification.steps[3]'
  )
  assertRunStep(
    verification.steps[4],
    'Verify registry bytes, signatures, and provenance',
    'npm run release:verify-registry',
    'verification.steps[4]'
  )
  assertExactKeys(verification.steps[5], ['name', 'if', 'run'], 'verification.steps[5]')
  assertEqual(
    verification.steps[5].name,
    'Report a post-publication verification incident',
    'verification.steps[5].name'
  )
  assertEqual(verification.steps[5].if, '${{ failure() }}', 'verification.steps[5].if')
  assertEqual(
    normalizedRun(verification.steps[5].run),
    "echo 'Publication succeeded but registry verification failed; preserve the run for incident triage.'",
    'verification.steps[5].run'
  )
  assertExactKeys(
    verification.steps[6],
    ['name', 'if', 'uses', 'with'],
    'verification.steps[6]'
  )
  assertEqual(
    verification.steps[6].name,
    'Retain verified release evidence',
    'verification.steps[6].name'
  )
  assertEqual(verification.steps[6].if, '${{ always() }}', 'verification.steps[6].if')
  assertEqual(
    actionName(verification.steps[6].uses),
    'actions/upload-artifact',
    'verification.steps[6].uses'
  )
  assertEqual(
    verification.steps[6].with,
    {
      name: 'npm-release-artifact',
      path: 'release-artifacts/',
      'if-no-files-found': 'error',
      'retention-days': 90,
    },
    'verification.steps[6].with'
  )

  let oidcWrites = 0
  walk(release, (key, value) => {
    if (value !== 'write') return
    if (key !== 'id-token') fail(`release.yml grants unexpected ${key}: write`)
    oidcWrites += 1
  })
  if (oidcWrites !== 1) fail('release.yml must grant OIDC exactly once')
  return release
}

export function verifyCodeQlWorkflowDocument(source) {
  const codeql = verifyWorkflowActionPins(source, CODEQL_WORKFLOW)
  assertExactKeys(codeql, ['name', 'on', 'permissions', 'jobs'], 'codeql.yml')
  assertEqual(codeql.name, 'CodeQL', 'codeql.yml name')
  assertEqual(
    codeql.on,
    {
      pull_request: { branches: ['main'] },
      push: { branches: ['main'] },
      schedule: [{ cron: '31 8 * * 2' }],
    },
    'codeql.yml trigger'
  )
  assertEqual(
    codeql.permissions,
    { contents: 'read', 'security-events': 'write' },
    'codeql.yml permissions'
  )
  assertExactKeys(codeql.jobs, ['analyze'], 'codeql jobs')
  const analyze = codeql.jobs.analyze
  assertExactKeys(
    analyze,
    ['name', 'runs-on', 'timeout-minutes', 'steps'],
    'CodeQL analyze job'
  )
  assertEqual(analyze.name, 'Analyze JavaScript and TypeScript', 'CodeQL job name')
  assertEqual(analyze['runs-on'], 'ubuntu-24.04', 'CodeQL runner')
  assertEqual(analyze['timeout-minutes'], 20, 'CodeQL timeout')
  assertEqual(analyze.steps.length, 3, 'CodeQL step count')
  assertActionStep(
    analyze.steps[0],
    'Check out source',
    'actions/checkout',
    { 'persist-credentials': false },
    'CodeQL checkout'
  )
  assertActionStep(
    analyze.steps[1],
    'Initialize CodeQL',
    'github/codeql-action/init',
    {
      languages: 'javascript-typescript',
      'build-mode': 'none',
      queries: 'security-extended',
    },
    'CodeQL init'
  )
  assertActionStep(
    analyze.steps[2],
    'Analyze',
    'github/codeql-action/analyze',
    { category: '/language:javascript-typescript' },
    'CodeQL analyze'
  )
  return codeql
}

export function verifyGitHubReleaseWorkflowDocument(source) {
  const workflow = verifyWorkflowActionPins(source, GITHUB_RELEASE_WORKFLOW)
  assertExactKeys(workflow, ['name', 'on', 'permissions', 'jobs'], 'github-release.yml')
  assertEqual(
    workflow.name,
    'Attach verified npm artifact to GitHub release',
    'github-release.yml name'
  )
  assertEqual(
    workflow.on,
    { workflow_run: { workflows: ['Publish npm package'], types: ['completed'] } },
    'github-release.yml trigger'
  )
  assertEqual(
    workflow.permissions,
    { actions: 'read', contents: 'write' },
    'github-release.yml permissions'
  )
  assertExactKeys(workflow.jobs, ['attach'], 'github-release jobs')
  const attach = workflow.jobs.attach
  assertExactKeys(
    attach,
    ['if', 'runs-on', 'timeout-minutes', 'steps'],
    'github-release attach job'
  )
  assertEqual(
    attach.if,
    "github.event.workflow_run.conclusion == 'success' && github.event.workflow_run.event == 'push' && github.event.workflow_run.head_repository.full_name == github.repository",
    'github-release job condition'
  )
  assertEqual(attach['runs-on'], 'ubuntu-24.04', 'github-release runner')
  assertEqual(attach['timeout-minutes'], 10, 'github-release timeout')
  assertEqual(attach.steps.length, 6, 'github-release step count')
  assertActionStep(
    attach.steps[0],
    'Check out the trusted release verifier',
    'actions/checkout',
    {
      ref: 'main',
      'fetch-depth': 0,
      'fetch-tags': true,
      'persist-credentials': false,
    },
    'github-release checkout'
  )
  assertActionStep(
    attach.steps[1],
    'Set up Node.js',
    'actions/setup-node',
    { 'node-version': EXPECTED_NODE_VERSION },
    'github-release Node setup'
  )
  assertExactKeys(
    attach.steps[2],
    ['name', 'id', 'env', 'run'],
    'github-release pre-artifact validation'
  )
  assertEqual(
    attach.steps[2].name,
    'Validate the triggering run before handling its artifact',
    'github-release pre-artifact step name'
  )
  assertEqual(attach.steps[2].id, 'trusted', 'github-release trusted output ID')
  assertEqual(
    attach.steps[2].env,
    { GITHUB_TOKEN: '${{ github.token }}' },
    'github-release pre-artifact environment'
  )
  assertEqual(
    normalizedRun(attach.steps[2].run),
    normalizedRun(`git fetch --no-tags origin '+refs/heads/main:refs/remotes/origin/main'
node scripts/verify-github-release-context.mjs pre >> "$GITHUB_OUTPUT"`),
    'github-release pre-artifact command'
  )
  assertActionStep(
    attach.steps[3],
    'Download the verified release bundle',
    'actions/download-artifact',
    {
      name: 'npm-release-artifact',
      path: 'release-artifacts',
      'github-token': '${{ github.token }}',
      'run-id': '${{ steps.trusted.outputs.run_id }}',
    },
    'github-release artifact download'
  )
  assertExactKeys(
    attach.steps[4],
    ['name', 'id', 'env', 'run'],
    'github-release bundle validation'
  )
  assertEqual(
    attach.steps[4].name,
    'Verify downloaded artifact and source identity',
    'github-release bundle step name'
  )
  assertEqual(attach.steps[4].id, 'release', 'github-release bundle output ID')
  assertEqual(
    attach.steps[4].env,
    {
      EXPECTED_COMMIT: '${{ steps.trusted.outputs.commit }}',
      EXPECTED_TAG: '${{ steps.trusted.outputs.tag }}',
    },
    'github-release bundle environment'
  )
  assertEqual(
    normalizedRun(attach.steps[4].run),
    'node scripts/verify-github-release-context.mjs bundle >> "$GITHUB_OUTPUT"',
    'github-release bundle command'
  )
  assertRunStep(
    attach.steps[5],
    'Create a draft, attach all evidence, then publish the GitHub release',
    `set -euo pipefail
node scripts/verify-github-release-context.mjs pre-publish
if gh release view "$RELEASE_TAG" >/dev/null 2>&1; then
  echo "A GitHub release already exists for $RELEASE_TAG; refusing to replace it." >&2
  exit 1
fi
gh release create "$RELEASE_TAG" \\
  --draft \\
  --verify-tag \\
  --generate-notes \\
  --title "$RELEASE_TAG"
gh release upload "$RELEASE_TAG" \\
  "$RELEASE_ARTIFACT" \\
  release-artifacts/SHA256SUMS \\
  release-artifacts/SHA512SUMS \\
  release-artifacts/INTEGRITY \\
  release-artifacts/release-manifest.json \\
  release-artifacts/npm-audit-signatures.json \\
  release-artifacts/npm-provenance-statement.json
gh release edit "$RELEASE_TAG" --draft=false`,
    'github-release publication',
    {
      GH_TOKEN: '${{ github.token }}',
      GH_REPO: '${{ github.repository }}',
      GITHUB_TOKEN: '${{ github.token }}',
      EXPECTED_COMMIT: '${{ steps.trusted.outputs.commit }}',
      EXPECTED_TAG: '${{ steps.trusted.outputs.tag }}',
      RELEASE_TAG: '${{ steps.release.outputs.tag }}',
      RELEASE_ARTIFACT: '${{ steps.release.outputs.artifact }}',
    }
  )
  return workflow
}

export function verifyCiWorkflowDocument(source) {
  const ci = verifyWorkflowActionPins(source, CI_WORKFLOW)
  assertExactKeys(
    ci,
    ['name', 'on', 'permissions', 'concurrency', 'defaults', 'jobs'],
    'ci.yml'
  )
  assertEqual(ci.name, 'CI', 'ci.yml name')
  assertEqual(
    ci.on,
    {
      pull_request: null,
      push: { branches: ['main'] },
      workflow_dispatch: null,
    },
    'ci.yml trigger'
  )
  assertEqual(ci.permissions, { contents: 'read' }, 'ci.yml permissions')
  assertExactKeys(ci.jobs, ['policy', 'build'], 'ci.yml jobs')
  walk(ci.jobs, (key, value, location) => {
    if (key === 'environment') {
      fail(`ci.yml cannot bind a deployment environment at ${location}`)
    }
    if (key === 'permissions') {
      fail(`ci.yml cannot widen permissions below the workflow boundary at ${location}`)
    }
    if (key === 'id-token') fail(`ci.yml cannot request OIDC at ${location}`)
    if (
      key === 'run' &&
      typeof value === 'string' &&
      value
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line !== '' && !line.startsWith('#'))
        .some((line) => /(^|[;&|]\s*)npm\s+publish(?:\s|$)/.test(line))
    ) {
      fail('ci.yml cannot publish packages')
    }
  })
  if (
    /\$\{\{\s*secrets(?:\.|\[)|\bGITHUB_TOKEN\b|\$\{\{\s*github\.token\s*\}\}/.test(
      source
    )
  ) {
    fail('ci.yml cannot consume repository credentials')
  }
  assertReviewedSemanticPolicy(source, CI_WORKFLOW)
  return ci
}

export function verifyPackageManifestValue(packageJson) {
  const expectedFiles = ['dist/**/*.js', 'dist/**/*.d.ts', 'dist/**/*.js.map']
  if (!isDeepStrictEqual(packageJson.files, expectedFiles)) {
    fail('package.json files allowlist is not the reviewed release allowlist')
  }
  if (packageJson.repository?.url !== 'https://github.com/duluca/document-ts.git') {
    fail('package.json repository URL is not canonical')
  }
}

export function verifySecurityConfiguration({ files, reader }) {
  if (files.some((path) => /^\.circleci(?:\/|$)/.test(path))) {
    fail('Legacy .circleci paths are not allowed')
  }
  verifyNoReusableRegistryCredential(files, reader)
  const workflows = files.filter((path) => /^\.github\/workflows\/.+\.ya?ml$/.test(path))
  if (workflows.length === 0) fail('No GitHub Actions workflows were found')
  if (!isDeepStrictEqual([...workflows].sort(), REVIEWED_WORKFLOWS)) {
    fail('GitHub Actions workflow set is not the reviewed allowlist')
  }
  for (const path of workflows) verifyWorkflowActionPins(reader(path), path)
  verifyCiWorkflowDocument(reader(CI_WORKFLOW))
  assertReviewedSemanticPolicy(
    reader('.github/workflows/no-egress-integration.yml'),
    '.github/workflows/no-egress-integration.yml'
  )
  assertReviewedSemanticPolicy(
    reader('.github/workflows/toolchain-maintenance.yml'),
    '.github/workflows/toolchain-maintenance.yml'
  )
  verifyReleaseWorkflowDocument(reader(RELEASE_WORKFLOW))
  verifyGitHubReleaseWorkflowDocument(reader(GITHUB_RELEASE_WORKFLOW))
  verifyCodeQlWorkflowDocument(reader(CODEQL_WORKFLOW))
  verifyPackageManifestValue(JSON.parse(reader('package.json')))
}

function main() {
  const files = trackedFiles()
  verifySecurityConfiguration({ files, reader: read })
  console.log('Verified semantic release credentials, package, and workflow policy')
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main()
