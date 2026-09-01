import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import {
  lstatSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, posix, resolve } from 'node:path'
import { gunzipSync } from 'node:zlib'

const MAX_PACKED_BYTES = 100 * 1024
const MAX_UNPACKED_BYTES = 250 * 1024
const MAX_TAR_BYTES = 1024 * 1024
const MAX_MANIFEST_BYTES = 512 * 1024
const EXPECTED_PACKAGE_NAME = 'document-ts'
const EXPECTED_REPOSITORY = 'https://github.com/duluca/document-ts.git'
const REQUIRED_ROOT_FILES = ['LICENSE', 'README.md', 'package.json']
const FORBIDDEN_PATH_PARTS = [
  '.env',
  '.github',
  'coverage',
  'coveralls',
  'src',
  'test_results',
  'tests',
]
const RELEASE_DIRECTORY = resolve('release-artifacts')

function fail(message) {
  throw new Error(message)
}

function digest(buffer, algorithm, encoding = 'hex') {
  return createHash(algorithm).update(buffer).digest(encoding)
}

function readTarString(buffer, offset, length) {
  const value = buffer.subarray(offset, offset + length)
  const nul = value.indexOf(0)
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(
      value.subarray(0, nul === -1 ? value.length : nul)
    )
  } catch {
    fail('Tar header contains invalid UTF-8')
  }
}

function readTarOctal(buffer, offset, length) {
  const value = readTarString(buffer, offset, length).trim()
  if (value === '') return 0
  if (!/^[0-7]+$/.test(value)) fail(`Invalid tar octal field: ${value}`)
  const parsed = Number.parseInt(value, 8)
  if (!Number.isSafeInteger(parsed) || parsed < 0) fail('Tar numeric field is unsafe')
  return parsed
}

function validateTarChecksum(header) {
  const expected = readTarOctal(header, 148, 8)
  let actual = 0
  for (let index = 0; index < header.length; index += 1) {
    actual += index >= 148 && index < 156 ? 0x20 : header[index]
  }
  if (actual !== expected) fail('Tar header checksum is invalid')
}

function validateCanonicalPackagePath(path, allowDirectory = false) {
  if (
    typeof path !== 'string' ||
    path.length === 0 ||
    path.includes('\0') ||
    path.includes('\\') ||
    path.startsWith('/')
  ) {
    fail(`Package path is not canonical: ${JSON.stringify(path)}`)
  }
  const canonical = allowDirectory && path.endsWith('/') ? path.slice(0, -1) : path
  const components = canonical.split('/')
  if (
    canonical.length === 0 ||
    components.some(
      (component) => component === '' || component === '.' || component === '..'
    ) ||
    posix.normalize(canonical) !== canonical
  ) {
    fail(`Package path is not canonical: ${path}`)
  }
  return canonical
}

function compareCanonicalPaths(left, right) {
  if (left.path < right.path) return -1
  if (left.path > right.path) return 1
  return 0
}

export function inspectTarball(tarball) {
  if (!Buffer.isBuffer(tarball) || tarball.length > MAX_PACKED_BYTES) {
    fail('Tarball is not a bounded buffer')
  }
  let archive
  try {
    archive = gunzipSync(tarball, { maxOutputLength: MAX_TAR_BYTES })
  } catch (error) {
    fail(
      `Tarball decompression failed: ${error instanceof Error ? error.message : error}`
    )
  }
  const files = []
  let offset = 0
  let zeroBlocks = 0

  while (offset + 512 <= archive.length) {
    const header = archive.subarray(offset, offset + 512)
    if (header.every((byte) => byte === 0)) {
      zeroBlocks += 1
      offset += 512
      if (zeroBlocks === 2) {
        if (archive.subarray(offset).some((byte) => byte !== 0)) {
          fail('Tar archive contains data after its end marker')
        }
        return files.sort(compareCanonicalPaths)
      }
      continue
    }
    if (zeroBlocks !== 0) fail('Tar archive contains an incomplete end marker')
    validateTarChecksum(header)

    const name = readTarString(header, 0, 100)
    const prefix = readTarString(header, 345, 155)
    const archivePath = prefix === '' ? name : `${prefix}/${name}`
    const size = readTarOctal(header, 124, 12)
    const mode = readTarOctal(header, 100, 8)
    const type = String.fromCharCode(header[156] || 48)
    const dataOffset = offset + 512
    const dataEnd = dataOffset + size
    const nextOffset = dataOffset + Math.ceil(size / 512) * 512

    if (dataEnd > archive.length || nextOffset > archive.length) {
      fail(`Tar entry exceeds archive bounds: ${archivePath}`)
    }
    if (!archivePath.startsWith('package/')) {
      fail(`Tar entry is outside the package directory: ${archivePath}`)
    }
    const packagePath = archivePath.slice('package/'.length)

    if (type === '0' || type === '\0') {
      const path = validateCanonicalPackagePath(packagePath)
      const content = archive.subarray(dataOffset, dataEnd)
      files.push({
        path,
        size,
        mode,
        sha256: digest(content, 'sha256'),
      })
    } else if (type === '5') {
      if (size !== 0) fail(`Tar directory entry has data: ${archivePath}`)
      validateCanonicalPackagePath(packagePath, true)
    } else {
      fail(`Unsupported non-regular tar entry ${archivePath} (type ${type})`)
    }

    offset = nextOffset
  }

  fail('Tar archive is truncated or has no complete end marker')
}

function isAllowedFile(path) {
  if (REQUIRED_ROOT_FILES.includes(path)) return true
  return /^dist\/.+\.(?:d\.ts|js|js\.map)$/.test(path)
}

export function validatePackageFiles(files) {
  const paths = files.map(({ path }) => validateCanonicalPackagePath(path))
  if (new Set(paths).size !== paths.length) fail('Package contains duplicate paths')

  for (const required of REQUIRED_ROOT_FILES) {
    if (!paths.includes(required)) fail(`Package is missing ${required}`)
  }
  if (!paths.some((path) => path.startsWith('dist/'))) {
    fail('Package contains no compiled dist files')
  }

  for (const file of files) {
    const lowerPath = file.path.toLowerCase()
    if (!isAllowedFile(file.path)) fail(`Package path is not allowed: ${file.path}`)
    if (FORBIDDEN_PATH_PARTS.some((part) => lowerPath.includes(part))) {
      fail(`Package path contains a forbidden component: ${file.path}`)
    }
    if ((file.mode & 0o111) !== 0) fail(`Package file is executable: ${file.path}`)
  }
}

function validateSizes(packedSize, unpackedSize) {
  if (packedSize > MAX_PACKED_BYTES) {
    fail(`Packed artifact is ${packedSize} bytes; limit is ${MAX_PACKED_BYTES}`)
  }
  if (unpackedSize > MAX_UNPACKED_BYTES) {
    fail(`Unpacked artifact is ${unpackedSize} bytes; limit is ${MAX_UNPACKED_BYTES}`)
  }
}

function readPackage() {
  return JSON.parse(readFileSync('package.json', 'utf8'))
}

function assertPlainObject(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    fail(`${label} must be an object`)
  }
  return value
}

function expectedArtifactFilename(name, version) {
  if (name !== EXPECTED_PACKAGE_NAME) fail(`Unexpected package name: ${name}`)
  if (!/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/.test(version)) {
    fail(`Package version is not an exact stable semantic version: ${version}`)
  }
  return `${name}-${version}.tgz`
}

export function releaseSourceTag(environment = process.env) {
  return environment.GITHUB_REF_TYPE === 'tag'
    ? (environment.GITHUB_REF_NAME ?? null)
    : null
}

export function validateReleaseManifestIdentity(
  manifest,
  { expectedTag, expectedCommit, requireSourceTag = false } = {}
) {
  assertPlainObject(manifest, 'Release manifest')
  if (manifest.schemaVersion !== 1) fail('Release manifest schema version is not 1')
  const packageIdentity = assertPlainObject(manifest.package, 'Manifest package')
  const source = assertPlainObject(manifest.source, 'Manifest source')
  const artifact = assertPlainObject(manifest.artifact, 'Manifest artifact')
  const expectedFilename = expectedArtifactFilename(
    packageIdentity.name,
    packageIdentity.version
  )

  if (source.repository !== EXPECTED_REPOSITORY) {
    fail('Release manifest repository identity is incorrect')
  }
  if (!/^[0-9a-f]{40}$/.test(source.commit)) {
    fail('Release manifest commit is not a full lowercase Git SHA')
  }
  if (source.tag !== null && source.tag !== `v${packageIdentity.version}`) {
    fail('Release manifest tag does not match the package version')
  }
  if (requireSourceTag && source.tag === null) fail('Release manifest has no source tag')
  if (expectedTag !== undefined && source.tag !== expectedTag) {
    fail('Release manifest tag does not match the trusted workflow run')
  }
  if (expectedCommit !== undefined && source.commit !== expectedCommit) {
    fail('Release manifest commit does not match the trusted workflow run')
  }
  if (artifact.filename !== expectedFilename) {
    fail(`Release artifact filename must be exactly ${expectedFilename}`)
  }
  if (
    basename(artifact.filename) !== artifact.filename ||
    artifact.filename.includes('/') ||
    artifact.filename.includes('\\') ||
    artifact.filename.includes('\0') ||
    artifact.filename.includes('\n') ||
    artifact.filename.includes('\r')
  ) {
    fail('Release artifact filename is unsafe')
  }
  return manifest
}

function readBoundedRegularFile(path, maximumBytes, label) {
  const stat = lstatSync(path)
  if (!stat.isFile() || stat.isSymbolicLink()) fail(`${label} is not a regular file`)
  if (stat.size > maximumBytes) fail(`${label} exceeds its size limit`)
  return readFileSync(path)
}

function runGit(...args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim()
}

function writeReleaseFiles(outputDirectory, manifest) {
  const artifact = manifest.artifact
  writeFileSync(
    join(outputDirectory, 'release-manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`
  )
  writeFileSync(
    join(outputDirectory, 'SHA256SUMS'),
    `${artifact.sha256}  ${artifact.filename}\n`
  )
  writeFileSync(
    join(outputDirectory, 'SHA512SUMS'),
    `${artifact.sha512}  ${artifact.filename}\n`
  )
  writeFileSync(join(outputDirectory, 'INTEGRITY'), `${artifact.integrity}\n`)
}

export function buildReleaseArtifact(outputDirectory = RELEASE_DIRECTORY) {
  rmSync(outputDirectory, { recursive: true, force: true })
  mkdirSync(outputDirectory, { recursive: true })

  const stdout = execFileSync(
    'npm',
    ['pack', '--json', '--ignore-scripts', '--pack-destination', outputDirectory],
    { encoding: 'utf8' }
  )
  const packResults = JSON.parse(stdout)
  if (packResults.length !== 1) fail('npm pack did not produce exactly one artifact')

  const packResult = packResults[0]
  const packageJson = readPackage()
  const expectedFilename = expectedArtifactFilename(packageJson.name, packageJson.version)
  if (packResult.filename !== expectedFilename) {
    fail(`npm pack produced an unexpected filename: ${packResult.filename}`)
  }
  const artifactPath = join(outputDirectory, packResult.filename)
  const tarball = readFileSync(artifactPath)
  const files = inspectTarball(tarball)
  validatePackageFiles(files)

  const unpackedSize = files.reduce((total, file) => total + file.size, 0)
  validateSizes(tarball.length, unpackedSize)
  if (packResult.size !== tarball.length) fail('npm pack reported an incorrect size')
  if (packResult.unpackedSize !== unpackedSize) {
    fail('npm pack reported an incorrect unpacked size')
  }

  const integrity = `sha512-${digest(tarball, 'sha512', 'base64')}`
  if (packResult.integrity !== integrity) fail('npm pack integrity does not match bytes')

  const manifest = {
    schemaVersion: 1,
    package: {
      name: packageJson.name,
      version: packageJson.version,
    },
    source: {
      repository: packageJson.repository.url,
      tag: releaseSourceTag(),
      commit: process.env.GITHUB_SHA ?? runGit('rev-parse', 'HEAD'),
    },
    artifact: {
      filename: basename(artifactPath),
      size: tarball.length,
      unpackedSize,
      integrity,
      sha256: digest(tarball, 'sha256'),
      sha512: digest(tarball, 'sha512'),
      files,
    },
  }

  validateReleaseManifestIdentity(manifest)
  writeReleaseFiles(outputDirectory, manifest)
  console.log(`Validated ${manifest.artifact.filename}: ${manifest.artifact.integrity}`)
  return manifest
}

export function verifyReleaseBundle(outputDirectory = RELEASE_DIRECTORY, quiet = false) {
  const manifest = validateReleaseManifestIdentity(
    JSON.parse(
      readBoundedRegularFile(
        join(outputDirectory, 'release-manifest.json'),
        MAX_MANIFEST_BYTES,
        'Release manifest'
      ).toString('utf8')
    )
  )
  const tarballPath = join(outputDirectory, manifest.artifact.filename)
  const tarball = readBoundedRegularFile(tarballPath, MAX_PACKED_BYTES, 'Release tarball')
  const files = inspectTarball(tarball)
  validatePackageFiles(files)

  const unpackedSize = files.reduce((total, file) => total + file.size, 0)
  validateSizes(tarball.length, unpackedSize)
  const expectedFiles = JSON.stringify(manifest.artifact.files)
  if (JSON.stringify(files) !== expectedFiles) fail('Tar file manifest changed')

  const sha256 = digest(tarball, 'sha256')
  const sha512 = digest(tarball, 'sha512')
  const integrity = `sha512-${digest(tarball, 'sha512', 'base64')}`
  if (manifest.artifact.size !== tarball.length) fail('Packed size changed')
  if (manifest.artifact.unpackedSize !== unpackedSize) fail('Unpacked size changed')
  if (manifest.artifact.sha256 !== sha256) fail('SHA-256 changed')
  if (manifest.artifact.sha512 !== sha512) fail('SHA-512 changed')
  if (manifest.artifact.integrity !== integrity) fail('Integrity changed')

  const expectedSha256 = `${sha256}  ${manifest.artifact.filename}\n`
  const expectedSha512 = `${sha512}  ${manifest.artifact.filename}\n`
  if (
    readBoundedRegularFile(
      join(outputDirectory, 'SHA256SUMS'),
      1024,
      'SHA256SUMS'
    ).toString('utf8') !== expectedSha256
  ) {
    fail('SHA256SUMS does not match the artifact')
  }
  if (
    readBoundedRegularFile(
      join(outputDirectory, 'SHA512SUMS'),
      1024,
      'SHA512SUMS'
    ).toString('utf8') !== expectedSha512
  ) {
    fail('SHA512SUMS does not match the artifact')
  }
  if (
    readBoundedRegularFile(
      join(outputDirectory, 'INTEGRITY'),
      1024,
      'INTEGRITY'
    ).toString('utf8') !== `${integrity}\n`
  ) {
    fail('INTEGRITY does not match the artifact')
  }

  if (!quiet) {
    console.log(
      `Verified release bundle for ${manifest.package.name}@${manifest.package.version}`
    )
  }
  return manifest
}

function sleep(milliseconds) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds))
}

async function fetchJson(url, token) {
  const headers = {
    accept: 'application/json',
    'user-agent': 'document-ts-release-verifier',
  }
  if (token) headers.authorization = `Bearer ${token}`
  const response = await fetch(url, { headers })
  if (!response.ok) fail(`GET ${url} failed with HTTP ${response.status}`)
  return response.json()
}

export async function getPublicationState(outputDirectory = RELEASE_DIRECTORY) {
  const manifest = verifyReleaseBundle(outputDirectory, true)
  const escapedName = encodeURIComponent(manifest.package.name).replace('%40', '@')
  const url = `https://registry.npmjs.org/${escapedName}/${encodeURIComponent(
    manifest.package.version
  )}`
  const response = await fetch(url, {
    headers: {
      accept: 'application/json',
      'user-agent': 'document-ts-release-verifier',
    },
  })
  if (response.status === 404) return 'absent'
  if (!response.ok) fail(`GET ${url} failed with HTTP ${response.status}`)
  const metadata = await response.json()
  if (metadata.dist?.integrity !== manifest.artifact.integrity) {
    fail(
      `${manifest.package.name}@${manifest.package.version} already exists with different bytes`
    )
  }
  return 'identical'
}

async function waitForRegistryMetadata(name, version, integrity) {
  const escapedName = encodeURIComponent(name).replace('%40', '@')
  const url = `https://registry.npmjs.org/${escapedName}/${encodeURIComponent(version)}`
  let lastError
  for (let attempt = 1; attempt <= 18; attempt += 1) {
    try {
      const metadata = await fetchJson(url)
      if (
        metadata.dist?.integrity === integrity &&
        metadata.dist?.attestations?.url &&
        metadata.dist?.attestations?.provenance?.predicateType ===
          'https://slsa.dev/provenance/v1'
      ) {
        return metadata
      }
      lastError = new Error('Registry metadata or provenance is not available yet')
    } catch (error) {
      lastError = error
    }
    if (attempt < 18) await sleep(10_000)
  }
  throw lastError
}

function decodeStatement(bundle) {
  const payload = bundle?.dsseEnvelope?.payload
  if (typeof payload !== 'string') fail('Provenance bundle has no DSSE payload')
  return JSON.parse(Buffer.from(payload, 'base64').toString('utf8'))
}

export function validateProvenanceStatement(statement, manifest) {
  assertPlainObject(statement, 'Provenance statement')
  const expectedSubject = `pkg:npm/${manifest.package.name}@${manifest.package.version}`
  const subject = statement.subject?.find(({ name }) => name === expectedSubject)
  if (!subject) fail(`Provenance subject is not ${expectedSubject}`)
  if (subject.digest?.sha512 !== manifest.artifact.sha512) {
    fail('Provenance subject digest does not match the published tarball')
  }

  const workflow = statement.predicate?.buildDefinition?.externalParameters?.workflow
  const expectedRef = `refs/tags/${manifest.source.tag}`
  if (workflow?.repository !== 'https://github.com/duluca/document-ts') {
    fail('Provenance repository identity is incorrect')
  }
  if (workflow?.path?.replace(/^\//, '') !== '.github/workflows/release.yml') {
    fail('Provenance workflow identity is incorrect')
  }
  if (workflow?.ref !== expectedRef) fail('Provenance tag identity is incorrect')

  const source = statement.predicate?.buildDefinition?.resolvedDependencies?.find(
    ({ digest: sourceDigest }) => sourceDigest?.gitCommit
  )
  if (source?.digest?.gitCommit !== manifest.source.commit) {
    fail('Provenance source commit is incorrect')
  }
  return statement
}

export function validateProvenance(attestations, manifest) {
  const provenance = attestations.attestations?.find(
    ({ predicateType }) => predicateType === 'https://slsa.dev/provenance/v1'
  )
  if (!provenance) fail('Registry response has no SLSA provenance attestation')
  return validateProvenanceStatement(decodeStatement(provenance.bundle), manifest)
}

function auditPackageSignatures(name, version, outputDirectory) {
  const auditDirectory = mkdtempSync(join(tmpdir(), 'document-ts-signatures-'))
  try {
    writeFileSync(
      join(auditDirectory, 'package.json'),
      `${JSON.stringify({ name: 'signature-audit', version: '1.0.0', private: true })}\n`
    )
    execFileSync(
      'npm',
      ['install', '--ignore-scripts', '--no-audit', '--no-fund', `${name}@${version}`],
      { cwd: auditDirectory, stdio: 'pipe' }
    )
    const result = execFileSync(
      'npm',
      ['audit', 'signatures', '--json', '--include-attestations'],
      { cwd: auditDirectory, encoding: 'utf8' }
    )
    const audit = JSON.parse(result)
    if (audit.invalid?.length || audit.missing?.length) {
      fail('npm reported an invalid or missing registry signature')
    }
    const verifiedPackage = audit.verified?.find(
      (entry) => entry.name === name && entry.version === version
    )
    if (
      !verifiedPackage ||
      verifiedPackage.attestations?.provenance?.predicateType !==
        'https://slsa.dev/provenance/v1'
    ) {
      fail(`npm did not verify signatures and provenance for ${name}@${version}`)
    }
    writeFileSync(join(outputDirectory, 'npm-audit-signatures.json'), result)
  } finally {
    rmSync(auditDirectory, { recursive: true, force: true })
  }
}

export async function verifyRegistryArtifact(outputDirectory = RELEASE_DIRECTORY) {
  const manifest = verifyReleaseBundle(outputDirectory)
  if (!manifest.source.tag) fail('Release manifest has no source tag')
  const metadata = await waitForRegistryMetadata(
    manifest.package.name,
    manifest.package.version,
    manifest.artifact.integrity
  )

  const response = await fetch(metadata.dist.tarball)
  if (!response.ok) fail(`Registry tarball download failed with HTTP ${response.status}`)
  const registryTarball = Buffer.from(await response.arrayBuffer())
  const localTarball = readFileSync(join(outputDirectory, manifest.artifact.filename))
  if (!registryTarball.equals(localTarball)) {
    fail('Registry tarball bytes differ from the CI-verified artifact')
  }
  validatePackageFiles(inspectTarball(registryTarball))

  const attestations = await fetchJson(metadata.dist.attestations.url)
  const statement = validateProvenance(attestations, manifest)
  writeFileSync(
    join(outputDirectory, 'npm-provenance-statement.json'),
    `${JSON.stringify(statement, null, 2)}\n`
  )
  auditPackageSignatures(manifest.package.name, manifest.package.version, outputDirectory)
  console.log(
    `Verified registry bytes, signatures, and provenance for ${manifest.package.name}@${manifest.package.version}`
  )
}

async function main() {
  const command = process.argv[2]
  if (command === 'pack') buildReleaseArtifact()
  else if (command === 'verify-bundle') {
    const manifest = verifyReleaseBundle()
    const expectedTag = process.env.EXPECTED_TAG
    const expectedCommit = process.env.EXPECTED_COMMIT
    if ((expectedTag === undefined) !== (expectedCommit === undefined)) {
      fail('EXPECTED_TAG and EXPECTED_COMMIT must be provided together')
    }
    if (expectedTag !== undefined) {
      validateReleaseManifestIdentity(manifest, {
        expectedTag,
        expectedCommit,
        requireSourceTag: true,
      })
      console.log(`Bound release bundle to ${expectedTag} at ${expectedCommit}`)
    }
  } else if (command === 'publication-state') console.log(await getPublicationState())
  else if (command === 'verify-registry') await verifyRegistryArtifact()
  else {
    const available = [
      'pack',
      'verify-bundle',
      'publication-state',
      'verify-registry',
    ].join(', ')
    fail(`Expected one of: ${available}`)
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : ''
if (invokedPath === resolve(new URL(import.meta.url).pathname)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}
