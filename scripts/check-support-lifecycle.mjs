import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
function argumentValue(name, fallback) {
  const index = process.argv.indexOf(name)
  if (index === -1) return fallback
  const value = process.argv[index + 1]
  if (!value) throw new Error(`${name} requires a path`)
  return path.resolve(root, value)
}

const matrixPath = argumentValue('--matrix', path.join(root, 'support-matrix.json'))
const matrix = JSON.parse(await readFile(matrixPath, 'utf8'))
const now = new Date(process.env.SUPPORT_CHECK_NOW ?? Date.now())
const findings = []
const offline = process.argv.includes('--offline')

function checkDate(identifier, component, dateValue) {
  const date = new Date(`${dateValue}T23:59:59Z`)
  const days = Math.ceil((date.getTime() - now.getTime()) / 86_400_000)
  if (days < 0)
    findings.push(`${identifier}: ${component} reached end of life on ${dateValue}`)
  else if (days <= 90)
    findings.push(
      `${identifier}: ${component} reaches end of life in ${days} days (${dateValue})`
    )
}

async function fetchSource(url, format = 'text') {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Support source failed (${response.status}): ${url}`)
  return format === 'json' ? response.json() : response.text()
}

function expectedNodeStatus(schedule) {
  const timestamp = now.getTime()
  if (timestamp >= new Date(`${schedule.end}T00:00:00Z`).getTime()) return 'End-of-life'
  if (
    schedule.maintenance &&
    timestamp >= new Date(`${schedule.maintenance}T00:00:00Z`).getTime()
  ) {
    return 'Maintenance LTS'
  }
  if (schedule.lts && timestamp >= new Date(`${schedule.lts}T00:00:00Z`).getTime()) {
    return 'Active LTS'
  }
  return 'Current'
}

function driverRangeIncludes(page, version) {
  const [targetMajor, targetMinor] = version.split('.').map(Number)
  for (const match of page.matchAll(/(\d+)\.(\d+)\s+to\s+(\d+)\.(\d+)/g)) {
    const [, startMajor, startMinor, endMajor, endMinor] = match.map(Number)
    if (
      targetMajor === startMajor &&
      targetMajor === endMajor &&
      targetMinor >= startMinor &&
      targetMinor <= endMinor
    ) {
      return true
    }
  }
  return page.includes(version)
}

async function checkAuthoritativeSources(tuple) {
  const [schedule, releases, compatibilityPage, driverPage, lifecyclePage] =
    await Promise.all([
      fetchSource(matrix.sources.nodeSchedule, 'json'),
      fetchSource(matrix.sources.nodeReleaseIndex, 'json'),
      fetchSource(matrix.sources.mongodbCompatibility),
      fetchSource(matrix.sources.mongodbDriverDocs),
      fetchSource(matrix.sources.mongodbLifecycle),
    ])

  const nodeSchedule = schedule[`v${tuple.nodeLine}`]
  if (!nodeSchedule) {
    findings.push(
      `${tuple.id}: Node.js ${tuple.nodeLine} is absent from the release schedule`
    )
  } else {
    if (nodeSchedule.end !== tuple.nodeEol) {
      findings.push(
        `${tuple.id}: tracked Node.js EOL ${tuple.nodeEol} differs from ${nodeSchedule.end}`
      )
    }
    const liveStatus = expectedNodeStatus(nodeSchedule)
    if (liveStatus !== tuple.nodeStatus) {
      findings.push(
        `${tuple.id}: tracked Node.js status ${tuple.nodeStatus} differs from ${liveStatus}`
      )
    }
  }

  const nodeRelease = releases.find((release) => release.version === `v${tuple.node}`)
  if (!nodeRelease) {
    findings.push(
      `${tuple.id}: Node.js ${tuple.node} is absent from the official archive`
    )
  } else {
    if (nodeRelease.npm !== tuple.npm) {
      findings.push(
        `${tuple.id}: npm ${tuple.npm} is not bundled with Node.js ${tuple.node} (${nodeRelease.npm} is)`
      )
    }
    if (!nodeRelease.lts) {
      findings.push(`${tuple.id}: Node.js ${tuple.node} is not an LTS release`)
    }
  }

  const lowerDriverPage = driverPage.toLowerCase()
  const documentedDriverVersion = tuple.mongodbDriver.split('.').slice(0, 2).join('.')
  if (
    lowerDriverPage.includes('archived and no longer supported') ||
    !driverPage.includes(`mongodb@${documentedDriverVersion}`)
  ) {
    findings.push(
      `${tuple.id}: MongoDB Node driver ${tuple.mongodbDriver} is no longer documented as supported`
    )
  }
  if (
    !compatibilityPage.includes(`Node.js v${tuple.nodeLine}`) ||
    !compatibilityPage.includes(
      `MongoDB ${tuple.mongodbServer.split('.').slice(0, 2).join('.')}`
    ) ||
    !driverRangeIncludes(compatibilityPage, tuple.mongodbDriver)
  ) {
    findings.push(
      `${tuple.id}: the official compatibility table no longer covers Node ${tuple.nodeLine}, driver ${tuple.mongodbDriver}, and MongoDB ${tuple.mongodbServer}`
    )
  }

  const expectedMongoDate = new Intl.DateTimeFormat('en-US', {
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
    year: 'numeric',
  }).format(new Date(`${tuple.mongodbServerEol}T12:00:00Z`))
  if (
    !lifecyclePage.includes(
      `MongoDB ${tuple.mongodbServer.split('.').slice(0, 2).join('.')}`
    ) ||
    !lifecyclePage.includes(expectedMongoDate)
  ) {
    findings.push(
      `${tuple.id}: tracked MongoDB EOL ${tuple.mongodbServerEol} is absent from the official lifecycle schedule`
    )
  }
}

for (const tuple of matrix.tuples) {
  checkDate(tuple.id, `Node.js ${tuple.node}`, tuple.nodeEol)
  checkDate(tuple.id, `MongoDB server ${tuple.mongodbServer}`, tuple.mongodbServerEol)
  if (!offline) await checkAuthoritativeSources(tuple)
}

const checkout = matrix.githubActions?.checkout
if (!checkout) {
  findings.push('github-actions: actions/checkout runtime metadata is missing')
} else {
  checkDate(
    'github-actions',
    `actions/checkout ${checkout.release} runtime Node.js ${checkout.runtimeLine}`,
    checkout.runtimeEol
  )
  if (!offline) {
    const [metadata, schedule] = await Promise.all([
      fetchSource(matrix.sources.checkoutActionMetadata),
      fetchSource(matrix.sources.nodeSchedule, 'json'),
    ])
    const declaredRuntime = metadata.match(/^\s*using:\s*['"]?(node\d+)/m)?.[1]
    if (declaredRuntime !== checkout.runtime) {
      findings.push(
        `github-actions: actions/checkout ${checkout.release} declares ${declaredRuntime ?? 'no JavaScript runtime'} instead of ${checkout.runtime}`
      )
    }
    const runtimeSchedule = schedule[`v${checkout.runtimeLine}`]
    if (!runtimeSchedule || runtimeSchedule.end !== checkout.runtimeEol) {
      findings.push(
        `github-actions: tracked ${checkout.runtime} EOL ${checkout.runtimeEol} differs from ${runtimeSchedule?.end ?? 'the missing Node.js schedule entry'}`
      )
    }
  }
}

if (findings.length) {
  console.log('# Supported toolchain lifecycle action required\n')
  for (const finding of findings) console.log(`- ${finding}`)
  process.exitCode = 1
} else {
  console.log(
    `All ${matrix.tuples.length} supported toolchain tuple(s) are outside the 90-day lifecycle warning window.`
  )
}
