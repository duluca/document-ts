import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const matrix = JSON.parse(await readFile(path.join(root, 'support-matrix.json'), 'utf8'))
const fixtureIndex = process.argv.indexOf('--fixture')
const fixture =
  fixtureIndex === -1
    ? undefined
    : JSON.parse(
        await readFile(path.resolve(root, process.argv[fixtureIndex + 1]), 'utf8')
      )
const fixtureDigests = fixture?.digests ?? fixture
const fixtureTags = fixture?.tags ?? {}

function splitReference(reference) {
  const separator = reference.lastIndexOf('@sha256:')
  if (separator === -1) throw new Error(`Image is not digest pinned: ${reference}`)
  const tagged = reference.slice(0, separator)
  const expected = `sha256:${reference.slice(separator + '@sha256:'.length)}`
  const colon = tagged.lastIndexOf(':')
  if (colon === -1) throw new Error(`Image has no exact tag: ${reference}`)
  const repository = tagged.slice(0, colon)
  const tag = tagged.slice(colon + 1)
  const dockerRepository = repository.includes('/') ? repository : `library/${repository}`
  return { tagged, expected, dockerRepository, repository, tag }
}

async function resolveDigest(reference) {
  const parsed = splitReference(reference)
  if (fixture) return { ...parsed, actual: fixtureDigests[parsed.tagged] }
  const tokenResponse = await fetch(
    `https://auth.docker.io/token?service=registry.docker.io&scope=repository:${parsed.dockerRepository}:pull`
  )
  if (!tokenResponse.ok)
    throw new Error(`Docker authentication failed: ${tokenResponse.status}`)
  const { token } = await tokenResponse.json()
  const manifest = await fetch(
    `https://registry-1.docker.io/v2/${parsed.dockerRepository}/manifests/${parsed.tag}`,
    {
      method: 'HEAD',
      headers: {
        authorization: `Bearer ${token}`,
        accept:
          'application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json',
      },
    }
  )
  if (!manifest.ok)
    throw new Error(`Manifest lookup failed for ${parsed.tagged}: ${manifest.status}`)
  return { ...parsed, actual: manifest.headers.get('docker-content-digest') }
}

async function resolveTags(parsed) {
  if (fixture) return fixtureTags[parsed.repository] ?? [parsed.tag]

  let next = `https://hub.docker.com/v2/repositories/${parsed.dockerRepository}/tags?page_size=100&ordering=last_updated`
  const tags = []
  for (let page = 0; next && page < 5; page++) {
    const response = await fetch(next)
    if (!response.ok) {
      throw new Error(`Tag lookup failed for ${parsed.repository}: ${response.status}`)
    }
    const body = await response.json()
    tags.push(...body.results.map((result) => result.name))
    next = body.next
  }
  return tags
}

function parseVersionTag(tag) {
  const match = tag.match(/^(\d+)\.(\d+)\.(\d+)(.*)$/)
  if (!match) return undefined
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    suffix: match[4],
    tag,
  }
}

function compareVersions(left, right) {
  return (
    left.major - right.major ||
    left.minor - right.minor ||
    left.patch - right.patch
  )
}

function latestPermittedTag(parsed, tags) {
  const current = parseVersionTag(parsed.tag)
  if (!current) throw new Error(`Cannot determine update line for ${parsed.tagged}`)
  const repositoryName = parsed.repository.split('/').at(-1)
  const candidates = tags
    .map(parseVersionTag)
    .filter(Boolean)
    .filter((candidate) => candidate.major === current.major)
    .filter((candidate) => candidate.suffix === current.suffix)
    .filter(
      (candidate) => repositoryName !== 'mongo' || candidate.minor === current.minor
    )
    .sort(compareVersions)
  return candidates.at(-1)?.tag ?? parsed.tag
}

const references = [
  ...new Set(matrix.tuples.flatMap((tuple) => [tuple.nodeImage, tuple.mongodbImage])),
]
const proposals = []
for (const reference of references) {
  const result = await resolveDigest(reference)
  if (!result.actual) throw new Error(`No resolved digest for ${result.tagged}`)
  if (result.actual !== result.expected) {
    proposals.push({
      kind: 'digest',
      tagged: result.tagged,
      expected: result.expected,
      actual: result.actual,
    })
  }

  const latestTag = latestPermittedTag(result, await resolveTags(result))
  if (latestTag !== result.tag) {
    const latestReference = `${result.repository}:${latestTag}@sha256:${'0'.repeat(64)}`
    const latest = await resolveDigest(latestReference)
    if (!latest.actual) throw new Error(`No resolved digest for ${latest.tagged}`)
    proposals.push({
      kind: 'tag',
      tagged: result.tagged,
      expected: result.expected,
      actual: `${latest.tagged}@${latest.actual}`,
    })
  }
}

if (proposals.length) {
  console.log('# Container digest update proposal\n')
  console.log(
    'Review and replace these tracked digests; do not update them without a passing CI run.\n'
  )
  for (const proposal of proposals) {
    if (proposal.kind === 'digest') {
      console.log(
        `- Digest changed for \`${proposal.tagged}\`: \`${proposal.expected}\` -> \`${proposal.actual}\``
      )
    } else {
      console.log(
        `- New permitted patch tag for \`${proposal.tagged}\`: \`${proposal.actual}\``
      )
    }
  }
  process.exitCode = 2
} else {
  console.log(
    `All ${references.length} pinned container tag(s) still resolve to their reviewed digests.`
  )
}
