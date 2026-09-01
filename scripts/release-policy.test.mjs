import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { gzipSync } from 'node:zlib'

import {
  inspectTarball,
  releaseSourceTag,
  validatePackageFiles,
  validateProvenance,
  validateReleaseManifestIdentity,
} from './release-artifact.mjs'
import { validateWorkflowRunEvent } from './verify-github-release-context.mjs'
import {
  validateReleaseTag,
  validateReleaseTagRulesets,
  validateSignedReleaseTagObject,
} from './verify-release-context.mjs'
import {
  parseYamlPolicy,
  verifyCiWorkflowDocument,
  verifyCodeQlWorkflowDocument,
  verifyGitHubReleaseWorkflowDocument,
  verifyReleaseWorkflowDocument,
  verifySecurityConfiguration,
  verifyWorkflowActionPins,
} from './verify-security-config.mjs'

const releaseWorkflow = readFileSync(
  new URL('../.github/workflows/release.yml', import.meta.url),
  'utf8'
)
const githubReleaseWorkflow = readFileSync(
  new URL('../.github/workflows/github-release.yml', import.meta.url),
  'utf8'
)
const codeQlWorkflow = readFileSync(
  new URL('../.github/workflows/codeql.yml', import.meta.url),
  'utf8'
)
const ciWorkflow = readFileSync(
  new URL('../.github/workflows/ci.yml', import.meta.url),
  'utf8'
)
const noEgressWorkflow = readFileSync(
  new URL('../.github/workflows/no-egress-integration.yml', import.meta.url),
  'utf8'
)
const toolchainWorkflow = readFileSync(
  new URL('../.github/workflows/toolchain-maintenance.yml', import.meta.url),
  'utf8'
)
const packageManifest = readFileSync(new URL('../package.json', import.meta.url), 'utf8')

const allowedFiles = [
  { path: 'LICENSE', size: 1, mode: 0o644 },
  { path: 'README.md', size: 1, mode: 0o644 },
  { path: 'dist/index.d.ts', size: 1, mode: 0o644 },
  { path: 'dist/index.js', size: 1, mode: 0o644 },
  { path: 'dist/index.js.map', size: 1, mode: 0o644 },
  { path: 'package.json', size: 1, mode: 0o644 },
]

function writeTarOctal(header, offset, length, value) {
  const encoded = `${value.toString(8).padStart(length - 2, '0')}\0 `
  header.write(encoded, offset, length, 'ascii')
}

function tarEntry(path, content = '', { type = '0', mode = 0o644 } = {}) {
  const bytes = Buffer.from(content)
  const header = Buffer.alloc(512)
  header.write(path, 0, 100, 'utf8')
  writeTarOctal(header, 100, 8, mode)
  writeTarOctal(header, 108, 8, 0)
  writeTarOctal(header, 116, 8, 0)
  writeTarOctal(header, 124, 12, bytes.length)
  writeTarOctal(header, 136, 12, 0)
  header.fill(0x20, 148, 156)
  header.write(type, 156, 1, 'ascii')
  header.write('ustar\0', 257, 6, 'ascii')
  header.write('00', 263, 2, 'ascii')
  const checksum = header.reduce((total, byte) => total + byte, 0)
  writeTarOctal(header, 148, 8, checksum)
  return Buffer.concat([header, bytes, Buffer.alloc((512 - (bytes.length % 512)) % 512)])
}

function tarball(entries, { end = true, trailing = Buffer.alloc(0) } = {}) {
  return gzipSync(
    Buffer.concat([
      ...entries.map(({ path, content, options }) => tarEntry(path, content, options)),
      end ? Buffer.alloc(1024) : Buffer.alloc(0),
      trailing,
    ])
  )
}

function validManifest() {
  return {
    schemaVersion: 1,
    package: { name: 'document-ts', version: '7.0.0' },
    source: {
      repository: 'https://github.com/duluca/document-ts.git',
      tag: 'v7.0.0',
      commit: 'a'.repeat(40),
    },
    artifact: { filename: 'document-ts-7.0.0.tgz' },
  }
}

test('package policy accepts only metadata and compiled outputs', () => {
  assert.doesNotThrow(() => validatePackageFiles(allowedFiles))
})

test('package policy rejects generated reports and executable files', () => {
  assert.throws(
    () =>
      validatePackageFiles([
        ...allowedFiles,
        { path: 'coverage/report.json', size: 1, mode: 0o644 },
      ]),
    /not allowed|forbidden/
  )
  assert.throws(
    () =>
      validatePackageFiles(
        allowedFiles.map((file) =>
          file.path === 'dist/index.js' ? { ...file, mode: 0o755 } : file
        )
      ),
    /executable/
  )
})

test('release tags cannot retrofit provenance onto 6.3.0', () => {
  assert.throws(() => validateReleaseTag('v6.3.0', '6.3.0'), /newer than/)
  assert.throws(() => validateReleaseTag('v6.3.1', '6.4.0'), /does not match/)
  assert.throws(() => validateReleaseTag('v6.3.1-beta.1', '6.3.1-beta.1'), /exact form/)
  assert.doesNotThrow(() => validateReleaseTag('v6.3.1', '6.3.1'))
})

test('signed release tag identity binds its internal name and commit before publication', () => {
  const tagObject = {
    tag: 'v7.0.0',
    object: { type: 'commit', sha: 'a'.repeat(40) },
    verification: { verified: true, reason: 'valid' },
  }

  assert.doesNotThrow(() =>
    validateSignedReleaseTagObject(tagObject, 'v7.0.0', 'a'.repeat(40))
  )
  assert.throws(
    () => validateSignedReleaseTagObject(tagObject, 'v7.0.1', 'a'.repeat(40)),
    /name/
  )
  assert.throws(
    () => validateSignedReleaseTagObject(tagObject, 'v7.0.0', 'b'.repeat(40)),
    /workflow commit/
  )
})

test('CI branch refs cannot be mistaken for release tags', () => {
  assert.equal(
    releaseSourceTag({ GITHUB_REF_TYPE: 'branch', GITHUB_REF_NAME: '107/merge' }),
    null
  )
  assert.equal(
    releaseSourceTag({ GITHUB_REF_TYPE: 'tag', GITHUB_REF_NAME: 'v7.0.0' }),
    'v7.0.0'
  )
})

test('provenance policy binds repository, workflow, tag, commit, and bytes', () => {
  const manifest = {
    package: { name: 'document-ts', version: '7.0.0' },
    source: { tag: 'v7.0.0', commit: 'a'.repeat(40) },
    artifact: { sha512: 'b'.repeat(128) },
  }
  const statement = {
    subject: [
      {
        name: 'pkg:npm/document-ts@7.0.0',
        digest: { sha512: manifest.artifact.sha512 },
      },
    ],
    predicate: {
      buildDefinition: {
        externalParameters: {
          workflow: {
            repository: 'https://github.com/duluca/document-ts',
            path: '/.github/workflows/release.yml',
            ref: 'refs/tags/v7.0.0',
          },
        },
        resolvedDependencies: [
          {
            uri: 'git+https://github.com/duluca/document-ts@refs/tags/v7.0.0',
            digest: { gitCommit: manifest.source.commit },
          },
        ],
      },
    },
  }
  const attestations = {
    attestations: [
      {
        predicateType: 'https://slsa.dev/provenance/v1',
        bundle: {
          dsseEnvelope: {
            payload: Buffer.from(JSON.stringify(statement)).toString('base64'),
          },
        },
      },
    ],
  }

  assert.deepEqual(validateProvenance(attestations, manifest), statement)
  const wrongCommit = structuredClone(manifest)
  wrongCommit.source.commit = 'c'.repeat(40)
  assert.throws(() => validateProvenance(attestations, wrongCommit), /source commit/)
})

test('package policy rejects non-canonical paths before allowlist matching', () => {
  for (const path of [
    'dist/../../escape.js',
    '/dist/index.js',
    'dist\\index.js',
    'dist//index.js',
    'dist/./index.js',
    'dist/../index.js',
    'dist/index.js\0hidden',
  ]) {
    assert.throws(
      () =>
        validatePackageFiles([
          ...allowedFiles.filter(
            ({ path: allowedPath }) => allowedPath !== 'dist/index.js'
          ),
          { path, size: 1, mode: 0o644 },
        ]),
      /canonical|allowed|compiled/
    )
  }
})

test('tar inspection accepts a canonical checksummed npm-style archive', () => {
  const archive = tarball(
    allowedFiles.map(({ path, mode }) => ({
      path: `package/${path}`,
      content: path,
      options: { mode },
    }))
  )
  const files = inspectTarball(archive)
  assert.deepEqual(
    files.map(({ path }) => path),
    allowedFiles.map(({ path }) => path).sort()
  )
  assert.doesNotThrow(() => validatePackageFiles(files))
})

test('tar inspection rejects traversal, out-of-root, link, and trailing-data entries', () => {
  assert.throws(
    () =>
      inspectTarball(tarball([{ path: 'package/dist/../../escape.js', content: 'x' }])),
    /canonical/
  )
  assert.throws(
    () => inspectTarball(tarball([{ path: 'outside.txt', content: 'x' }])),
    /outside the package/
  )
  assert.throws(
    () =>
      inspectTarball(
        tarball([{ path: 'package/dist/link.js', content: '', options: { type: '2' } }])
      ),
    /Unsupported/
  )
  assert.throws(
    () =>
      inspectTarball(
        tarball([{ path: 'package/dist/index.js', content: 'x' }], {
          trailing: Buffer.from('not zero'),
        })
      ),
    /after its end marker/
  )
})

test('tar inspection rejects invalid checksums and truncated end markers', () => {
  const rawEntry = tarEntry('package/dist/index.js', 'x')
  rawEntry[10] ^= 1
  assert.throws(
    () => inspectTarball(gzipSync(Buffer.concat([rawEntry, Buffer.alloc(1024)]))),
    /checksum/
  )
  assert.throws(
    () =>
      inspectTarball(
        tarball([{ path: 'package/dist/index.js', content: 'x' }], { end: false })
      ),
    /truncated|end marker/
  )
})

test('release manifest identity rejects unsafe or mismatched artifact names', () => {
  assert.doesNotThrow(() =>
    validateReleaseManifestIdentity(validManifest(), {
      expectedTag: 'v7.0.0',
      expectedCommit: 'a'.repeat(40),
      requireSourceTag: true,
    })
  )
  for (const filename of [
    '../document-ts-7.0.0.tgz',
    '/tmp/document-ts-7.0.0.tgz',
    'document-ts-7.0.0.tgz\nartifact=x',
    'different-7.0.0.tgz',
  ]) {
    const manifest = validManifest()
    manifest.artifact.filename = filename
    assert.throws(() => validateReleaseManifestIdentity(manifest), /filename/)
  }
  const wrongRepository = validManifest()
  wrongRepository.source.repository = 'https://github.com/attacker/document-ts.git'
  assert.throws(() => validateReleaseManifestIdentity(wrongRepository), /repository/)
})

test('semantic workflow policy accepts the reviewed release configurations', () => {
  assert.doesNotThrow(() => verifyCiWorkflowDocument(ciWorkflow))
  assert.doesNotThrow(() => verifyReleaseWorkflowDocument(releaseWorkflow))
  assert.doesNotThrow(() => verifyGitHubReleaseWorkflowDocument(githubReleaseWorkflow))
  assert.doesNotThrow(() => verifyCodeQlWorkflowDocument(codeQlWorkflow))
})

test('semantic action policy ignores comment decoys and rejects mutable revisions', () => {
  const mutated = releaseWorkflow.replace(
    /actions\/checkout@[0-9a-f]{40}/,
    'actions/checkout@main # actions/checkout@aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
  )
  assert.throws(() => verifyWorkflowActionPins(mutated, 'mutated.yml'), /full commit SHA/)
})

test('security configuration rejects any unreviewed workflow publisher', () => {
  const sources = new Map([
    ['.github/workflows/ci.yml', ciWorkflow],
    ['.github/workflows/codeql.yml', codeQlWorkflow],
    ['.github/workflows/github-release.yml', githubReleaseWorkflow],
    ['.github/workflows/no-egress-integration.yml', noEgressWorkflow],
    ['.github/workflows/release.yml', releaseWorkflow],
    ['.github/workflows/toolchain-maintenance.yml', toolchainWorkflow],
    ['package.json', packageManifest],
    [
      '.github/workflows/attacker.yml',
      `name: Second publisher
on: workflow_dispatch
permissions:
  id-token: write
jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
      - run: npm publish --provenance
`,
    ],
  ])
  assert.throws(
    () =>
      verifySecurityConfiguration({
        files: [...sources.keys()],
        reader: (path) => sources.get(path),
      }),
    /workflow set|reviewed allowlist/
  )
})

test('semantic release policy rejects decoy commands and widened authority', () => {
  const commandDecoy = releaseWorkflow.replace(
    'npm publish "$artifact" --access public --provenance --ignore-scripts',
    'echo \'npm publish "$artifact" --access public --provenance --ignore-scripts\''
  )
  assert.throws(
    () => verifyReleaseWorkflowDocument(commandDecoy),
    /publish\.steps\[6\]\.run/
  )

  const widened = releaseWorkflow.replace(
    'permissions:\n  contents: read',
    'permissions:\n  contents: write # contents: read'
  )
  assert.throws(() => verifyReleaseWorkflowDocument(widened), /permissions|unexpected/)

  const extraOidc = releaseWorkflow.replace(
    'build:\n    name:',
    'build:\n    permissions:\n      id-token: write\n    name:'
  )
  assert.throws(() => verifyReleaseWorkflowDocument(extraOidc), /unique|permissions|keys/)

  const wrongEnvironment = releaseWorkflow.replace(
    'environment: npm-release',
    'environment: attacker-environment # environment: npm-release'
  )
  assert.throws(() => verifyReleaseWorkflowDocument(wrongEnvironment), /environment/)
})

test('semantic release policy preserves pre-publication and incident controls', () => {
  const noFinalRulesetCheck = releaseWorkflow.replace(
    '            npm run release:verify-context\n            npm publish',
    '            echo ruleset-check-disabled\n            npm publish'
  )
  assert.throws(
    () => verifyReleaseWorkflowDocument(noFinalRulesetCheck),
    /publish\.steps\[6\]\.run/
  )

  const lifecycleScriptsEnabled = releaseWorkflow.replace(
    'run: npm ci --ignore-scripts',
    'run: npm ci'
  )
  assert.throws(
    () => verifyReleaseWorkflowDocument(lifecycleScriptsEnabled),
    /build\.steps\[4\]\.run/
  )

  const evidenceOnlyOnSuccess = releaseWorkflow.replace(
    '        if: ${{ always() }}\n        uses: actions/upload-artifact',
    '        uses: actions/upload-artifact'
  )
  assert.throws(
    () => verifyReleaseWorkflowDocument(evidenceOnlyOnSuccess),
    /verification\.steps\[6\]/
  )
})

test('semantic YAML policy rejects duplicate keys and aliases', () => {
  assert.throws(
    () => parseYamlPolicy('name: one\nname: two\n', 'duplicate.yml'),
    /unique|Map keys must be unique|invalid YAML/
  )
  assert.throws(
    () => parseYamlPolicy('base: &base { contents: read }\ncopy: *base\n', 'alias.yml'),
    /aliases/
  )
})

test('privileged workflow_run policy cannot download before trusted validation', () => {
  const rawRunId = githubReleaseWorkflow.replace(
    'run-id: ${{ steps.trusted.outputs.run_id }}',
    'run-id: ${{ github.event.workflow_run.id }}'
  )
  assert.throws(
    () => verifyGitHubReleaseWorkflowDocument(rawRunId),
    /artifact download|with/
  )

  const wrongOrder = githubReleaseWorkflow
    .replace(
      'node scripts/verify-github-release-context.mjs pre',
      'echo pre-validation-disabled'
    )
    .replace(
      'node scripts/verify-github-release-context.mjs bundle',
      'echo bundle-validation-disabled'
    )
  assert.throws(
    () => verifyGitHubReleaseWorkflowDocument(wrongOrder),
    /pre-artifact command/
  )

  const noDraft = githubReleaseWorkflow.replace('  --draft \\\n', '')
  assert.throws(() => verifyGitHubReleaseWorkflowDocument(noDraft), /publication/)

  const noTagRecheck = githubReleaseWorkflow.replace(
    'node scripts/verify-github-release-context.mjs pre-publish',
    'echo tag-recheck-disabled'
  )
  assert.throws(() => verifyGitHubReleaseWorkflowDocument(noTagRecheck), /publication/)
})

test('semantic CodeQL and CI policy rejects weakened scanning or a second publisher', () => {
  assert.throws(
    () =>
      verifyCodeQlWorkflowDocument(
        codeQlWorkflow.replace(
          'queries: security-extended',
          'queries: security-and-quality'
        )
      ),
    /CodeQL init|with/
  )
  assert.throws(
    () =>
      verifyCiWorkflowDocument(
        ciWorkflow.replace('npm run release:pack', 'npm publish --access public')
      ),
    /cannot publish|reviewed semantic policy/
  )
  assert.throws(
    () =>
      verifyCiWorkflowDocument(
        ciWorkflow.replace(
          'permissions:\n  contents: read',
          'permissions:\n  contents: read\n  id-token: write'
        )
      ),
    /permissions|OIDC|reviewed semantic policy/
  )
  assert.throws(
    () =>
      verifyCiWorkflowDocument(
        ciWorkflow.replace(
          '  build:\n    name:',
          '  build:\n    environment: npm-release\n    name:'
        )
      ),
    /deployment environment|reviewed semantic policy/
  )
})

test('security configuration rejects every tracked legacy CircleCI path', () => {
  const sources = new Map([
    ['.github/workflows/ci.yml', ciWorkflow],
    ['.github/workflows/codeql.yml', codeQlWorkflow],
    ['.github/workflows/github-release.yml', githubReleaseWorkflow],
    ['.github/workflows/no-egress-integration.yml', noEgressWorkflow],
    ['.github/workflows/release.yml', releaseWorkflow],
    ['.github/workflows/toolchain-maintenance.yml', toolchainWorkflow],
    ['.circleci/config.yml', 'version: 2.1\n'],
    ['package.json', packageManifest],
  ])
  assert.throws(
    () =>
      verifySecurityConfiguration({
        files: [...sources.keys()],
        reader: (path) => sources.get(path),
      }),
    /Legacy \.circleci paths are not allowed/
  )
})

function validWorkflowRun() {
  const commit = 'b'.repeat(40)
  const apiRun = {
    id: 12345,
    name: 'Publish npm package',
    event: 'push',
    status: 'completed',
    conclusion: 'success',
    path: '.github/workflows/release.yml',
    head_branch: 'v7.0.0',
    head_sha: commit,
    head_commit: { id: commit },
    repository: { full_name: 'duluca/document-ts' },
    head_repository: { full_name: 'duluca/document-ts' },
  }
  return {
    apiRun,
    event: {
      action: 'completed',
      repository: { full_name: 'duluca/document-ts' },
      workflow_run: structuredClone(apiRun),
    },
  }
}

test('workflow_run trust validation binds API identity, source, tag, and commit', () => {
  const { event, apiRun } = validWorkflowRun()
  assert.deepEqual(validateWorkflowRunEvent(event, apiRun), {
    runId: 12345,
    tag: 'v7.0.0',
    commit: 'b'.repeat(40),
  })

  for (const mutate of [
    (run) => (run.repository.full_name = 'attacker/fork'),
    (run) => (run.head_repository.full_name = 'attacker/fork'),
    (run) => (run.path = '.github/workflows/attacker.yml'),
    (run) => (run.head_branch = 'main'),
    (run) => (run.conclusion = 'failure'),
    (run) => (run.head_commit.id = 'c'.repeat(40)),
  ]) {
    const values = validWorkflowRun()
    mutate(values.apiRun)
    assert.throws(() => validateWorkflowRunEvent(values.event, values.apiRun))
  }

  const changedEvent = validWorkflowRun()
  changedEvent.event.workflow_run.head_sha = 'c'.repeat(40)
  assert.throws(
    () => validateWorkflowRunEvent(changedEvent.event, changedEvent.apiRun),
    /does not match/
  )

  const wrongWorkflowRef = validWorkflowRun()
  wrongWorkflowRef.apiRun.path = '.github/workflows/release.yml@refs/heads/attacker'
  wrongWorkflowRef.event.workflow_run.path = wrongWorkflowRef.apiRun.path
  assert.throws(
    () => validateWorkflowRunEvent(wrongWorkflowRef.event, wrongWorkflowRef.apiRun),
    /workflow path/
  )
})

test('pre-publication policy requires a no-bypass protected v* tag ruleset', () => {
  const ruleset = {
    id: 42,
    target: 'tag',
    source: 'duluca/document-ts',
    enforcement: 'active',
    bypass_actors: [],
    conditions: { ref_name: { include: ['refs/tags/v*'], exclude: [] } },
    rules: [{ type: 'update' }, { type: 'deletion' }, { type: 'required_signatures' }],
  }
  assert.equal(validateReleaseTagRulesets([ruleset], 'v7.0.0'), ruleset)
  for (const mutate of [
    (value) => value.bypass_actors.push({ actor_type: 'RepositoryRole' }),
    (value) => (value.enforcement = 'evaluate'),
    (value) => (value.conditions.ref_name.include = ['refs/tags/release-*']),
    (value) => value.rules.splice(0, 1),
  ]) {
    const changed = structuredClone(ruleset)
    mutate(changed)
    assert.throws(() => validateReleaseTagRulesets([changed], 'v7.0.0'), /ruleset/)
  }
})
