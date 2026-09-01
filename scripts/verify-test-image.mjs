import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { isDeepStrictEqual } from 'node:util'

import { isAlias, parseDocument, visit } from 'yaml'

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const immutableImagePattern =
  /^[a-z0-9][a-z0-9._/-]*:\d+\.\d+\.\d+(?:-[a-z0-9._-]+)?@sha256:[a-f0-9]{64}$/
const reviewedActions = {
  checkout: 'actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1',
  setupNode: 'actions/setup-node@820762786026740c76f36085b0efc47a31fe5020',
  uploadArtifact: 'actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a',
}
const expectedCheckoutRuntime = {
  release: 'v7.0.1',
  revision: '3d3c42e5aac5ba805825da76410c181273ba90b1',
  runtime: 'node24',
  runtimeLine: '24',
  runtimeEol: '2028-04-30',
}

function fail(message) {
  throw new Error(`Test image policy violation: ${message}`)
}

function argumentValue(name, fallback) {
  const index = process.argv.indexOf(name)
  if (index === -1) return fallback
  const value = process.argv[index + 1]
  if (!value) fail(`${name} requires a path`)
  return path.resolve(repositoryRoot, value)
}

function parseYaml(name, contents) {
  const document = parseDocument(contents, { merge: false, uniqueKeys: true })
  if (document.errors.length) {
    fail(`${name} is not valid unambiguous YAML: ${document.errors[0].message}`)
  }
  if (document.warnings.length) {
    fail(
      `${name} cannot use YAML tags or ambiguous constructs: ${document.warnings[0].message}`
    )
  }
  let containsAlias = false
  visit(document, {
    Node(_key, node) {
      if (isAlias(node)) containsAlias = true
    },
  })
  if (containsAlias) fail(`${name} cannot use YAML aliases in security policy paths`)
  return document.toJS()
}

function validateImmutableImage(image) {
  if (!immutableImagePattern.test(image)) {
    fail(`expected an exact version and digest, received ${JSON.stringify(image)}`)
  }
}

function verifyCheckoutRuntimePolicy(matrix) {
  if (!isDeepStrictEqual(matrix.githubActions?.checkout, expectedCheckoutRuntime)) {
    fail('actions/checkout identity and runtime must match the reviewed support policy')
  }
  const expectedMetadata =
    `https://raw.githubusercontent.com/actions/checkout/` +
    `${expectedCheckoutRuntime.revision}/action.yml`
  if (matrix.sources?.checkoutActionMetadata !== expectedMetadata) {
    fail('actions/checkout runtime metadata must be fetched from the reviewed commit')
  }
}

function normalizeRun(run) {
  return typeof run === 'string' ? run.trimEnd() : run
}

function normalizeRunFields(value) {
  if (Array.isArray(value)) return value.map(normalizeRunFields)
  if (value === null || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value).map(([key, nested]) => [
      key,
      key === 'run' ? normalizeRun(nested) : normalizeRunFields(nested),
    ])
  )
}

function normalizeLines(value) {
  return normalizeRun(value)
    ?.split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
}

function objectKeysEqual(value, expected) {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    isDeepStrictEqual(Object.keys(value).sort(), [...expected].sort())
  )
}

function walk(value, callback) {
  if (Array.isArray(value)) {
    for (const item of value) walk(item, callback)
    return
  }
  if (value === null || typeof value !== 'object') return
  callback(value)
  for (const nested of Object.values(value)) walk(nested, callback)
}

function verifyActionPins(workflow, name, expectedCounts) {
  const counts = new Map(Object.values(reviewedActions).map((action) => [action, 0]))
  walk(workflow, (candidate) => {
    if (typeof candidate.uses !== 'string') return
    if (!counts.has(candidate.uses)) {
      fail(
        `${name} uses an unreviewed or floating action ${JSON.stringify(candidate.uses)}`
      )
    }
    counts.set(candidate.uses, counts.get(candidate.uses) + 1)
    if (candidate.uses === reviewedActions.checkout) {
      if (!isDeepStrictEqual(candidate.with, { 'persist-credentials': false })) {
        fail(`${name} checkout steps must disable persisted credentials`)
      }
    }
  })
  for (const [key, action] of Object.entries(reviewedActions)) {
    const expected = expectedCounts[key] ?? 0
    if (counts.get(action) !== expected) {
      fail(`${name} must contain exactly ${expected} reviewed ${key} step(s)`)
    }
  }
}

function verifyWorkflowSafety(workflow, contents, name, permissions) {
  if (!isDeepStrictEqual(workflow.permissions, permissions)) {
    fail(`${name} must use the reviewed least-privilege permissions`)
  }
  const forbidden = [
    /pull_request_target/,
    /repository_dispatch/,
    /workflow_run/,
    /\$\{\{\s*secrets(?:\.|\[)/,
    /\bid-token\s*:\s*write\b/,
    /\b(?:npm|pnpm|yarn)\s+publish\b/,
    /\bNPM_TOKEN\b/,
    /\bNODE_AUTH_TOKEN\b/,
    /\bCOVERALLS(?:_|\b)/i,
    /\bCIRCLECI\b/i,
  ]
  if (forbidden.some((pattern) => pattern.test(contents))) {
    fail(
      `${name} cannot contain privileged triggers, credentials, or publication commands`
    )
  }
  if (
    permissions.issues !== 'write' &&
    /\$\{\{\s*github\.token\s*\}\}|\bGITHUB_TOKEN\b/.test(contents)
  ) {
    fail(`${name} cannot expose the GitHub token to untrusted build commands`)
  }
  walk(workflow, (candidate) => {
    if ('environment' in candidate) {
      fail(`${name} cannot bind a deployment environment`)
    }
    if (candidate.permissions !== undefined && candidate !== workflow) {
      fail(`${name} cannot widen permissions below the reviewed workflow boundary`)
    }
    if (
      'cache' in candidate ||
      'restore-keys' in candidate ||
      candidate.uses?.startsWith('actions/cache@')
    ) {
      fail(`${name} cannot restore mutable dependency caches`)
    }
  })
}

function verifyJobBase(job, name, expectedName, timeout) {
  if (job?.name !== expectedName) fail(`${name} must retain the stable check name`)
  if (job['runs-on'] !== 'ubuntu-24.04') {
    fail(`${name} must use the reviewed ubuntu-24.04 runner`)
  }
  if (job['timeout-minutes'] !== timeout) fail(`${name} must retain its reviewed timeout`)
  if (job.if !== undefined || job['continue-on-error'] !== undefined) {
    fail(`${name} cannot bypass failures`)
  }
}

function verifyContainer(job, expectedImage, name) {
  if (!isDeepStrictEqual(job?.container, { image: expectedImage })) {
    fail(`${name} container must exactly match the reviewed image`)
  }
}

function verifyCiWorkflow(contents, primary) {
  const workflow = parseYaml('CI workflow', contents)
  if (workflow.name !== 'CI') fail('CI workflow must retain its stable name')
  if (
    !isDeepStrictEqual(workflow.on, {
      pull_request: null,
      push: { branches: ['main'] },
      workflow_dispatch: null,
    })
  ) {
    fail(
      'CI workflow must use only the reviewed pull request, main push, and manual triggers'
    )
  }
  verifyWorkflowSafety(workflow, contents, 'CI workflow', { contents: 'read' })
  verifyActionPins(workflow, 'CI workflow', { checkout: 2, uploadArtifact: 2 })
  if (
    !isDeepStrictEqual(workflow.concurrency, {
      group: 'ci-${{ github.event.pull_request.number || github.ref }}',
      'cancel-in-progress': "${{ github.event_name == 'pull_request' }}",
    })
  ) {
    fail('CI workflow must retain reviewed concurrency isolation')
  }
  if (!isDeepStrictEqual(workflow.defaults, { run: { shell: 'bash' } })) {
    fail('CI workflow must use the reviewed default shell')
  }
  if (!objectKeysEqual(workflow.jobs, ['policy', 'build'])) {
    fail('CI workflow must define exactly the stable policy and build jobs')
  }

  const policy = workflow.jobs.policy
  verifyJobBase(policy, 'CI policy job', 'CI policy', 15)
  verifyContainer(policy, primary.nodeImage, 'CI policy job')
  if (policy.needs !== undefined || policy.services !== undefined) {
    fail('CI policy job must remain an independent service-free gate')
  }
  const expectedPolicySteps = [
    {
      name: 'Check out the source without retaining credentials',
      uses: reviewedActions.checkout,
      with: { 'persist-credentials': false },
    },
    {
      name: 'Verify the exact toolchain',
      run: [
        'test "$(node --version)" = "v22.23.2"',
        'test "$(npm --version)" = "10.9.8"',
      ].join('\n'),
    },
    {
      name: 'Install locked policy dependencies without a cache',
      run: 'npm ci --ignore-scripts',
    },
    {
      name: 'Enforce dependency, image, and support policy',
      run: [
        'npm run audit:ci',
        'npm run audit:policy:test',
        'npm run verify:test-image',
        'npm run verify:test-image:negative',
        'npm run verify:no-download-guard',
        'npm run support:check',
        'npm run support:policy:test',
      ].join('\n'),
    },
  ]
  const normalizedPolicySteps = policy.steps?.map((step) => ({
    ...step,
    ...(step.run === undefined ? {} : { run: normalizeRun(step.run) }),
  }))
  if (!isDeepStrictEqual(normalizedPolicySteps, expectedPolicySteps)) {
    fail('CI policy job must exactly match the reviewed service-free gate')
  }

  const build = workflow.jobs.build
  verifyJobBase(build, 'CI build job', 'Build, test, coverage, and package', 30)
  verifyContainer(build, primary.nodeImage, 'CI build job')
  if (build.needs !== 'policy') fail('CI build job must require the policy job')
  if (!objectKeysEqual(build.services, ['mongodb'])) {
    fail('CI build job must define only the reviewed MongoDB service')
  }
  const mongo = build.services.mongodb
  if (
    mongo?.image !== primary.mongodbImage ||
    mongo.options !==
      `--health-cmd "mongosh --quiet --eval 'db.runCommand({ ping: 1 }).ok'" ` +
        '--health-interval 5s --health-timeout 5s --health-retries 20' ||
    !objectKeysEqual(mongo, ['image', 'options'])
  ) {
    fail('CI MongoDB service must exactly use the reviewed image and health policy')
  }
  if (
    !isDeepStrictEqual(build.env, {
      MONGO_URI: 'mongodb://mongodb:27017',
      DOCUMENT_TS_DOWNLOAD_ATTEMPT_LOG: '/tmp/mongodb-download-attempts.log',
      JEST_JUNIT_OUTPUT_DIR: './test_results/',
    })
  ) {
    fail('CI build job must retain the reviewed isolated test environment')
  }
  const expectedStepNames = [
    'Check out the source without retaining credentials',
    'Verify the exact toolchain',
    'Install locked dependencies without a cache',
    'Run the complete build and test gate',
    'Build reviewable package evidence',
    'Retain coverage and test evidence',
    'Retain package evidence',
  ]
  if (
    !isDeepStrictEqual(
      build.steps?.map((step) => step.name),
      expectedStepNames
    )
  ) {
    fail('CI build job must retain the reviewed gate and evidence sequence')
  }
  const expectedBuildPreamble = [
    {
      name: 'Check out the source without retaining credentials',
      uses: reviewedActions.checkout,
      with: { 'persist-credentials': false },
    },
    {
      name: 'Verify the exact toolchain',
      run: [
        'test "$(node --version)" = "v22.23.2"',
        'test "$(npm --version)" = "10.9.8"',
      ].join('\n'),
    },
    {
      name: 'Install locked dependencies without a cache',
      run: 'npm ci --ignore-scripts',
    },
  ]
  const normalizedBuildPreamble = build.steps.slice(0, 3).map((step) => ({
    ...step,
    ...(step.run === undefined ? {} : { run: normalizeRun(step.run) }),
  }))
  if (!isDeepStrictEqual(normalizedBuildPreamble, expectedBuildPreamble)) {
    fail('CI build job must retain the reviewed checkout, toolchain, and install steps')
  }
  if (
    !isDeepStrictEqual(normalizeLines(build.steps[3].run), [
      'rm -f "$DOCUMENT_TS_DOWNLOAD_ATTEMPT_LOG"',
      'export NODE_OPTIONS="--require=$GITHUB_WORKSPACE/scripts/no-mongodb-download-network-guard.cjs"',
      'npm run audit:ci',
      'npm run style',
      'npm run lint',
      'npm run build',
      'npm run test:ci',
      'test ! -s "$DOCUMENT_TS_DOWNLOAD_ATTEMPT_LOG"',
    ])
  ) {
    fail('CI build job must run the complete reviewed gate before producing evidence')
  }
  if (
    !isDeepStrictEqual(normalizeLines(build.steps[4].run), [
      'package_evidence="$RUNNER_TEMP/ci-package"',
      'mkdir -p "$package_evidence"',
      'npm pack --pack-destination "$package_evidence"',
      'npm pack --dry-run --json > "$package_evidence/package-dry-run.json"',
    ])
  ) {
    fail('CI build job must create reviewable package evidence outside the package input')
  }
  const expectedEvidence = [
    {
      name: 'ci-coverage-${{ github.run_id }}',
      paths: ['coverage/lcov.info', 'test_results/junit.xml'],
    },
    {
      name: 'ci-package-${{ github.run_id }}',
      paths: ['${{ runner.temp }}/ci-package/'],
    },
  ]
  for (const [offset, evidence] of expectedEvidence.entries()) {
    const step = build.steps[5 + offset]
    if (
      step.uses !== reviewedActions.uploadArtifact ||
      step.with?.name !== evidence.name ||
      !isDeepStrictEqual(normalizeLines(step.with?.path), evidence.paths) ||
      step.with?.['if-no-files-found'] !== 'error' ||
      step.with?.['retention-days'] !== 14 ||
      step.with?.overwrite !== undefined
    ) {
      fail('CI evidence must use immutable, run-scoped reviewed artifacts')
    }
  }
}

function verifyComposeImages(contents, primary) {
  const expected = {
    services: {
      mongodb: {
        image: primary.mongodbImage,
        ports: ['127.0.0.1:27017:27017'],
      },
    },
  }
  if (!isDeepStrictEqual(parseYaml('local Compose', contents), expected)) {
    fail('local Compose must exactly match the reviewed loopback-only MongoDB service')
  }
}

function verifyNoEgressWorkflow(contents, primary) {
  const workflow = parseYaml('no-egress workflow', contents)
  if (workflow.name !== 'No-egress integration') {
    fail('no-egress workflow must retain its stable name')
  }
  if (!isDeepStrictEqual(workflow.on, { pull_request: null, workflow_dispatch: null })) {
    fail('no-egress workflow must retain reviewed triggers')
  }
  verifyWorkflowSafety(workflow, contents, 'no-egress workflow', { contents: 'read' })
  verifyActionPins(workflow, 'no-egress workflow', { checkout: 2 })
  if (!objectKeysEqual(workflow.jobs, ['policy', 'test'])) {
    fail('no-egress workflow must define exactly the stable policy and test jobs')
  }
  const policy = workflow.jobs.policy
  verifyJobBase(policy, 'no-egress policy job', 'No-egress policy', 15)
  verifyContainer(policy, primary.nodeImage, 'no-egress policy job')
  if (policy.services !== undefined || policy.needs !== undefined) {
    fail('no-egress policy job must remain an independent service-free gate')
  }
  const test = workflow.jobs.test
  verifyJobBase(test, 'no-egress test job', 'No-egress test', 30)
  if (test.needs !== 'policy') fail('no-egress test job must require the policy job')
  if (test.container !== undefined || test.services !== undefined) {
    fail('no-egress test job must control its isolated Docker network explicitly')
  }
  if (
    !isDeepStrictEqual(test.env, {
      NETWORK_NAME: 'document-ts-no-egress',
      MONGO_CONTAINER: 'document-ts-no-egress-mongo',
      DEPS_VOLUME: 'document-ts-no-egress-node-modules',
    })
  ) {
    fail('no-egress test job must retain isolated resource names')
  }
  if (
    !isDeepStrictEqual(
      policy.steps?.map((step) => step.name),
      [
        'Check out the source without retaining credentials',
        'Verify the exact toolchain',
        'Install locked policy dependencies',
        'Verify dependency, image, and support policy',
      ]
    ) ||
    !isDeepStrictEqual(
      test.steps?.map((step) => step.name),
      [
        'Check out the source without retaining credentials',
        'Resolve reviewed images from the support matrix',
        'Preload reviewed images and locked dependencies',
        'Verify policy before starting MongoDB',
        'Start the pinned service on an internal-only network',
        'Prove egress isolation and run the full gate',
        'Remove isolated test resources',
      ]
    )
  ) {
    fail('no-egress workflow must retain its reviewed policy and isolation sequence')
  }
  const [preflight, start, gate, cleanup] = test.steps.slice(3)
  if (
    !normalizeRun(preflight.run)?.includes('npm run verify:test-image:negative') ||
    !normalizeRun(start.run)?.includes('docker network create --internal') ||
    !normalizeRun(start.run)?.includes('"$MONGO_IMAGE"') ||
    !normalizeRun(gate.run)?.includes('--network "$NETWORK_NAME"') ||
    !normalizeRun(gate.run)?.includes(
      'npm run style && npm run lint && npm run build && npm test'
    ) ||
    cleanup.if !== 'always()'
  ) {
    fail('no-egress workflow must prove policy and isolation before the full test gate')
  }
  const checkoutStep = {
    name: 'Check out the source without retaining credentials',
    uses: reviewedActions.checkout,
    with: { 'persist-credentials': false },
  }
  const expectedPolicySteps = [
    checkoutStep,
    {
      name: 'Verify the exact toolchain',
      run: [
        'test "$(node --version)" = "v22.23.2"',
        'test "$(npm --version)" = "10.9.8"',
      ].join('\n'),
    },
    {
      name: 'Install locked policy dependencies',
      run: 'npm ci --ignore-scripts',
    },
    {
      name: 'Verify dependency, image, and support policy',
      run: [
        'npm run audit:ci',
        'npm run audit:policy:test',
        'npm run verify:test-image',
        'npm run verify:test-image:negative',
        'npm run verify:no-download-guard',
        'npm run support:check',
        'npm run support:policy:test',
      ].join('\n'),
    },
  ]
  const slash = '\\'
  const expectedTestSteps = [
    checkoutStep,
    {
      name: 'Resolve reviewed images from the support matrix',
      shell: 'bash',
      run: 'node scripts/resolve-test-images.mjs >> "$GITHUB_ENV"',
    },
    {
      name: 'Preload reviewed images and locked dependencies',
      shell: 'bash',
      run: [
        'set -euo pipefail',
        'docker pull "$NODE_IMAGE"',
        'docker pull "$MONGO_IMAGE"',
        'docker volume create "$DEPS_VOLUME"',
        `docker run --rm --pull never ${slash}`,
        `  --volume "$PWD:/workspace" ${slash}`,
        `  --volume "$DEPS_VOLUME:/workspace/node_modules" ${slash}`,
        `  --workdir /workspace ${slash}`,
        '  "$NODE_IMAGE" npm ci --ignore-scripts',
      ].join('\n'),
    },
    {
      name: 'Verify policy before starting MongoDB',
      shell: 'bash',
      run: [
        'set -euo pipefail',
        `docker run --rm --pull never ${slash}`,
        `  --network none ${slash}`,
        `  --volume "$PWD:/workspace" ${slash}`,
        `  --volume "$DEPS_VOLUME:/workspace/node_modules" ${slash}`,
        `  --workdir /workspace ${slash}`,
        '  "$NODE_IMAGE" npm run verify:test-image',
        `docker run --rm --pull never ${slash}`,
        `  --network none ${slash}`,
        `  --volume "$PWD:/workspace" ${slash}`,
        `  --volume "$DEPS_VOLUME:/workspace/node_modules" ${slash}`,
        `  --workdir /workspace ${slash}`,
        '  "$NODE_IMAGE" npm run verify:test-image:negative',
      ].join('\n'),
    },
    {
      name: 'Start the pinned service on an internal-only network',
      shell: 'bash',
      run: [
        'set -euo pipefail',
        'docker network create --internal "$NETWORK_NAME"',
        `docker run --detach --pull never ${slash}`,
        `  --name "$MONGO_CONTAINER" ${slash}`,
        `  --network "$NETWORK_NAME" ${slash}`,
        `  --network-alias mongodb ${slash}`,
        '  "$MONGO_IMAGE"',
        'for attempt in $(seq 1 30); do',
        `  if docker exec "$MONGO_CONTAINER" mongosh --quiet --eval 'db.runCommand({ ping: 1 }).ok' | grep -q 1; then`,
        '    exit 0',
        '  fi',
        '  sleep 1',
        'done',
        'docker logs "$MONGO_CONTAINER"',
        'exit 1',
      ].join('\n'),
    },
    {
      name: 'Prove egress isolation and run the full gate',
      shell: 'bash',
      run: [
        'set -euo pipefail',
        `docker run --rm --pull never ${slash}`,
        `  --network "$NETWORK_NAME" ${slash}`,
        `  "$NODE_IMAGE" ${slash}`,
        `  node -e 'const net=require("node:net");const socket=net.connect({host:"1.1.1.1",port:443});socket.setTimeout(1500);socket.on("connect",()=>process.exit(1));socket.on("error",()=>process.exit(0));socket.on("timeout",()=>process.exit(0))'`,
        `docker run --rm --pull never ${slash}`,
        `  --network "$NETWORK_NAME" ${slash}`,
        `  --volume "$PWD:/workspace" ${slash}`,
        `  --volume "$DEPS_VOLUME:/workspace/node_modules" ${slash}`,
        `  --workdir /workspace ${slash}`,
        `  --env MONGO_URI=mongodb://mongodb:27017 ${slash}`,
        `  --env NODE_OPTIONS=--require=/workspace/scripts/no-mongodb-download-network-guard.cjs ${slash}`,
        `  --env DOCUMENT_TS_DOWNLOAD_ATTEMPT_LOG=/tmp/mongodb-download-attempts.log ${slash}`,
        `  "$NODE_IMAGE" ${slash}`,
        `  sh -c 'rm -f "$DOCUMENT_TS_DOWNLOAD_ATTEMPT_LOG" && npm run style && npm run lint && npm run build && npm test && test ! -s "$DOCUMENT_TS_DOWNLOAD_ATTEMPT_LOG"'`,
      ].join('\n'),
    },
    {
      name: 'Remove isolated test resources',
      if: 'always()',
      shell: 'bash',
      run: [
        'docker rm --force "$MONGO_CONTAINER" 2>/dev/null || true',
        'docker network rm "$NETWORK_NAME" 2>/dev/null || true',
        'docker volume rm "$DEPS_VOLUME" 2>/dev/null || true',
      ].join('\n'),
    },
  ]
  const normalizeSteps = (steps) =>
    steps.map((step) => ({
      ...step,
      ...(step.run === undefined ? {} : { run: normalizeRun(step.run) }),
    }))
  if (
    !isDeepStrictEqual(normalizeSteps(policy.steps), expectedPolicySteps) ||
    !isDeepStrictEqual(normalizeSteps(test.steps), expectedTestSteps) ||
    !isDeepStrictEqual(workflow.concurrency, {
      group: 'no-egress-${{ github.workflow }}-${{ github.ref }}',
      'cancel-in-progress': true,
    })
  ) {
    fail('no-egress workflow must exactly match the reviewed isolation contract')
  }
}

function verifyMaintenanceWorkflow(contents) {
  const workflow = parseYaml('toolchain maintenance workflow', contents)
  verifyWorkflowSafety(workflow, contents, 'toolchain maintenance workflow', {
    contents: 'read',
    issues: 'write',
  })
  verifyActionPins(workflow, 'toolchain maintenance workflow', {
    checkout: 2,
    setupNode: 2,
  })
  const checkout = {
    name: 'Check out the source without retaining credentials',
    uses: reviewedActions.checkout,
    with: { 'persist-credentials': false },
  }
  const setupNode = {
    name: 'Set up the reviewed Node.js runtime',
    uses: reviewedActions.setupNode,
    with: { 'node-version': '22.23.2' },
  }
  const expected = {
    name: 'Toolchain maintenance',
    on: {
      schedule: [{ cron: '17 13 * * 1' }],
      workflow_dispatch: null,
    },
    permissions: { contents: 'read', issues: 'write' },
    concurrency: {
      group: 'toolchain-maintenance',
      'cancel-in-progress': false,
    },
    jobs: {
      lifecycle: {
        'runs-on': 'ubuntu-24.04',
        'timeout-minutes': 15,
        steps: [
          checkout,
          setupNode,
          {
            id: 'check',
            name: 'Check supported component lifecycles',
            shell: 'bash',
            run: [
              'set +e',
              'node scripts/check-support-lifecycle.mjs > lifecycle-report.md 2>&1',
              'echo "status=$?" >> "$GITHUB_OUTPUT"',
              'exit 0',
            ].join('\n'),
          },
          {
            name: 'Create or update lifecycle issue',
            if: "steps.check.outputs.status != '0'",
            env: { GH_TOKEN: '${{ github.token }}' },
            shell: 'bash',
            run: [
              'title="[maintenance] Supported toolchain lifecycle action required"',
              `number="$(gh issue list --state open --label dependencies --limit 1000 --json number,title --jq '.[] | select(.title == "[maintenance] Supported toolchain lifecycle action required") | .number' | head -n 1)"`,
              'if [ -n "$number" ]; then',
              '  gh issue edit "$number" --body-file lifecycle-report.md',
              'else',
              '  gh issue create --title "$title" --body-file lifecycle-report.md --label dependencies',
              'fi',
            ].join('\n'),
          },
        ],
      },
      'container-digests': {
        'runs-on': 'ubuntu-24.04',
        'timeout-minutes': 15,
        steps: [
          checkout,
          setupNode,
          {
            id: 'check',
            name: 'Check immutable container digests',
            shell: 'bash',
            run: [
              'set +e',
              'node scripts/check-container-digests.mjs > container-report.md 2>&1',
              'echo "status=$?" >> "$GITHUB_OUTPUT"',
              'exit 0',
            ].join('\n'),
          },
          {
            name: 'Create or update digest proposal',
            if: "steps.check.outputs.status != '0'",
            env: { GH_TOKEN: '${{ github.token }}' },
            shell: 'bash',
            run: [
              'title="[maintenance] Review changed CI container digests"',
              `number="$(gh issue list --state open --label dependencies --limit 1000 --json number,title --jq '.[] | select(.title == "[maintenance] Review changed CI container digests") | .number' | head -n 1)"`,
              'if [ -n "$number" ]; then',
              '  gh issue edit "$number" --body-file container-report.md',
              'else',
              '  gh issue create --title "$title" --body-file container-report.md --label dependencies --label security',
              'fi',
            ].join('\n'),
          },
        ],
      },
    },
  }
  if (!isDeepStrictEqual(normalizeRunFields(workflow), expected)) {
    fail(
      'toolchain maintenance workflow must exactly match the reviewed issue-write contract'
    )
  }
}

const matrixPath = argumentValue(
  '--matrix',
  path.join(repositoryRoot, 'support-matrix.json')
)
const matrix = JSON.parse(await readFile(matrixPath, 'utf8'))
if (!Array.isArray(matrix.tuples) || matrix.tuples.length !== 1) {
  fail('support matrix must contain exactly one continuously tested tuple')
}
const primary = matrix.tuples.find((entry) => entry.id === matrix.primary)
if (!primary) fail(`primary tuple ${JSON.stringify(matrix.primary)} does not exist`)
verifyCheckoutRuntimePolicy(matrix)
validateImmutableImage(primary.nodeImage)
validateImmutableImage(primary.mongodbImage)
if (!primary.nodeImage.startsWith(`node:${primary.node}-bookworm@sha256:`)) {
  fail('primary Node image repository and tag must match the tested Node tuple')
}
if (!primary.mongodbImage.startsWith(`mongo:${primary.mongodbServer}@sha256:`)) {
  fail('primary MongoDB image repository and tag must match the tested server tuple')
}

const imageArgument = process.argv.indexOf('--image')
if (imageArgument !== -1) {
  const candidate = process.argv[imageArgument + 1] ?? ''
  validateImmutableImage(candidate)
  if (candidate !== primary.mongodbImage)
    fail(`candidate does not match ${primary.mongodbImage}`)
  console.log(candidate)
  process.exit(0)
}

const ciWorkflowPath = argumentValue(
  '--ci-workflow',
  path.join(repositoryRoot, '.github/workflows/ci.yml')
)
const composeConfigPath = argumentValue(
  '--compose-config',
  path.join(repositoryRoot, 'compose.test.yml')
)
const noEgressWorkflowPath = argumentValue(
  '--no-egress-workflow',
  path.join(repositoryRoot, '.github/workflows/no-egress-integration.yml')
)
const maintenanceWorkflowPath = argumentValue(
  '--maintenance-workflow',
  path.join(repositoryRoot, '.github/workflows/toolchain-maintenance.yml')
)
const [ciWorkflow, composeConfig, noEgressWorkflow, maintenanceWorkflow] =
  await Promise.all([
    readFile(ciWorkflowPath, 'utf8'),
    readFile(composeConfigPath, 'utf8'),
    readFile(noEgressWorkflowPath, 'utf8'),
    readFile(maintenanceWorkflowPath, 'utf8'),
  ])
verifyCiWorkflow(ciWorkflow, primary)
verifyComposeImages(composeConfig, primary)
verifyNoEgressWorkflow(noEgressWorkflow, primary)
verifyMaintenanceWorkflow(maintenanceWorkflow)

const packageJson = JSON.parse(
  await readFile(path.join(repositoryRoot, 'package.json'), 'utf8')
)
const packageLock = await readFile(path.join(repositoryRoot, 'package-lock.json'), 'utf8')
for (const dependency of ['mongodb-memory-server', 'mongodb-memory-server-core']) {
  if (
    dependency in (packageJson.devDependencies ?? {}) ||
    packageLock.includes(`node_modules/${dependency}`)
  ) {
    fail(`${dependency} remains in the npm dependency graph`)
  }
}
const testFiles = (
  await readdir(path.join(repositoryRoot, 'tests'), { withFileTypes: true })
)
  .filter((entry) => entry.isFile() && entry.name.endsWith('.ts'))
  .map((entry) => entry.name)
for (const testFile of testFiles) {
  const source = await readFile(path.join(repositoryRoot, 'tests', testFile), 'utf8')
  if (/MongoMemoryServer|mongodb-memory-server/.test(source)) {
    fail(`${testFile} still invokes the removed MongoDB downloader`)
  }
}

console.log(
  `Verified ${primary.nodeImage} and ${primary.mongodbImage} across GitHub Actions, local Compose, and the lockfile policy.`
)
