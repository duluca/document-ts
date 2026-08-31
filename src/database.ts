import { createHash } from 'crypto'

import { Db, MongoClient, MongoClientOptions, ReadPreference } from 'mongodb'

export interface ConnectionRetryPolicy {
  /** Maximum number of driver connection attempts. */
  maxAttempts?: number
  /** Delay between attempts, in seconds. */
  waitSeconds?: number
}

export interface ConnectionTlsPolicy {
  /** Enables TLS for the MongoDB connection. */
  enabled: boolean
  /** PEM file containing the trusted certificate authority chain. */
  caFile?: string
}

export interface DatabaseConnectionOptions {
  /** MongoDB connection string, including the database name when applicable. */
  uri: string
  /** Enables fail-closed production TLS validation. */
  production?: boolean
  /** Retry behavior for initial connection failures. */
  retry?: ConnectionRetryPolicy
  /** TLS policy applied after the driver options. */
  tls?: ConnectionTlsPolicy
  /** MongoDB 6-compatible driver options. */
  mongoClientOptions?: MongoClientOptions
}

export type DatabaseConnectionErrorCode =
  | 'ERR_CONNECTION_CLOSED'
  | 'ERR_CONNECTION_CONFIG_CONFLICT'
  | 'ERR_INVALID_CONNECTION_OPTIONS'

export class DatabaseConnectionError extends Error {
  constructor(
    public readonly code: DatabaseConnectionErrorCode,
    message: string
  ) {
    super(message)
    this.name = 'DatabaseConnectionError'
  }
}

interface NormalizedConnectionOptions {
  fingerprint: string
  mongoClientOptions: MongoClientOptions
  retryMaxAttempts: number
  retryWaitMilliseconds: number
  uri: string
}

interface ConnectionGeneration {
  client: MongoClient | null
  clientClosePromise: Promise<void> | null
  closeForce: boolean
  closePromise: Promise<void> | null
  closeRequested: boolean
  closeSignal: Promise<void>
  connectPromise: Promise<void>
  db: Db | null
  fingerprint: string
  phase: 'connecting' | 'connected' | 'closing'
  resolveCloseSignal: () => void
}

const DEFAULT_RETRY_MAX_ATTEMPTS = 10
const DEFAULT_RETRY_WAIT_SECONDS = 5

let activeGeneration: ConnectionGeneration | null = null
const valueIdentity = new WeakMap<object, number>()
let nextValueIdentity = 1

export function connect(options: DatabaseConnectionOptions): Promise<void> {
  let normalizedOptions: NormalizedConnectionOptions

  try {
    normalizedOptions = normalizeConnectionOptions(options)
  } catch (error: unknown) {
    return Promise.reject(normalizeConnectionFailure(error))
  }

  if (activeGeneration) {
    if (activeGeneration.phase === 'closing') {
      return Promise.reject(connectionClosedError())
    }

    if (activeGeneration.fingerprint !== normalizedOptions.fingerprint) {
      return Promise.reject(
        new DatabaseConnectionError(
          'ERR_CONNECTION_CONFIG_CONFLICT',
          'A MongoDB connection with a different configuration is already active'
        )
      )
    }

    return activeGeneration.connectPromise
  }

  let resolveCloseSignal: () => void = () => undefined
  const closeSignal = new Promise<void>((resolve) => {
    resolveCloseSignal = resolve
  })

  const generation: ConnectionGeneration = {
    client: null,
    clientClosePromise: null,
    closeForce: false,
    closePromise: null,
    closeRequested: false,
    closeSignal,
    connectPromise: Promise.resolve(),
    db: null,
    fingerprint: normalizedOptions.fingerprint,
    phase: 'connecting',
    resolveCloseSignal,
  }

  activeGeneration = generation
  generation.connectPromise = connectGeneration(generation, normalizedOptions)

  return generation.connectPromise
}

export function close(force = false): Promise<void> {
  const generation = activeGeneration
  if (!generation) {
    return Promise.resolve()
  }

  if (generation.closePromise) {
    return generation.closePromise
  }

  generation.closeRequested = true
  generation.closeForce = force
  generation.phase = 'closing'
  generation.resolveCloseSignal()
  generation.closePromise = closeGeneration(generation, force)

  return generation.closePromise
}

export function connectionStatus(): boolean {
  return Boolean(
    activeGeneration?.phase === 'connected' &&
    activeGeneration.client &&
    activeGeneration.db
  )
}

export function getDbInstance(): Db {
  if (activeGeneration?.phase !== 'connected' || !activeGeneration.db) {
    throw new Error('Database is not yet instantiated')
  }

  return activeGeneration.db
}

async function connectGeneration(
  generation: ConnectionGeneration,
  options: NormalizedConnectionOptions
): Promise<void> {
  let lastError: unknown = new Error(
    'Unable to connect to the database, please verify that your configuration is correct'
  )

  try {
    for (let attempt = 1; attempt <= options.retryMaxAttempts; attempt++) {
      try {
        const client = await MongoClient.connect(options.uri, options.mongoClientOptions)
        generation.clientClosePromise = null
        generation.client = client

        if (generation.closeRequested || activeGeneration !== generation) {
          await closeClient(generation, generation.closeForce).catch(() => undefined)
          throw connectionClosedError()
        }

        generation.db = client.db()
        generation.phase = 'connected'
        return
      } catch (error: unknown) {
        if (isConnectionClosedError(error) || generation.closeRequested) {
          throw connectionClosedError()
        }

        if (generation.client) {
          await closeClient(generation, false)
        }

        lastError = error
        if (attempt < options.retryMaxAttempts) {
          const closeRequested = await waitForRetryOrClose(
            generation,
            options.retryWaitMilliseconds
          )
          if (closeRequested) {
            throw connectionClosedError()
          }
        }
      }
    }

    throw normalizeConnectionFailure(lastError)
  } catch (error: unknown) {
    generation.db = null
    try {
      await closeClient(generation, generation.closeForce)
    } catch {
      // The connection error remains the primary failure. close() observes the
      // shared close promise when it initiated cancellation.
    } finally {
      if (!generation.closeRequested && activeGeneration === generation) {
        activeGeneration = null
      }
    }

    throw error
  }
}

async function closeGeneration(
  generation: ConnectionGeneration,
  force: boolean
): Promise<void> {
  try {
    await generation.connectPromise.catch(() => undefined)
    generation.db = null
    await closeClient(generation, force)
  } finally {
    if (activeGeneration === generation) {
      activeGeneration = null
    }
  }
}

async function closeClient(
  generation: ConnectionGeneration,
  force: boolean
): Promise<void> {
  if (generation.clientClosePromise) {
    return generation.clientClosePromise
  }

  const client = generation.client
  if (!client) {
    return
  }

  generation.client = null
  generation.clientClosePromise = client.close(force)
  return generation.clientClosePromise
}

function normalizeConnectionOptions(
  options: DatabaseConnectionOptions
): NormalizedConnectionOptions {
  if (!options || typeof options !== 'object') {
    throw invalidOptionsError('connect() requires a connection-options object')
  }

  if (typeof options.uri !== 'string' || !options.uri.trim()) {
    throw invalidOptionsError('uri must be a non-empty MongoDB connection string')
  }

  const uri = normalizeMongoUri(options.uri)
  const retryMaxAttempts = normalizePositiveInteger(
    options.retry?.maxAttempts,
    DEFAULT_RETRY_MAX_ATTEMPTS,
    'retry.maxAttempts'
  )
  const retryWaitSeconds = normalizeNonNegativeNumber(
    options.retry?.waitSeconds,
    DEFAULT_RETRY_WAIT_SECONDS,
    'retry.waitSeconds'
  )
  const mongoClientOptions = buildMongoClientOptions(options, uri)
  const fingerprint = createHash('sha256')
    .update(uri)
    .update('\0')
    .update(stableSerialize(mongoClientOptions))
    .digest('hex')

  return {
    fingerprint,
    mongoClientOptions,
    retryMaxAttempts,
    retryWaitMilliseconds: retryWaitSeconds * 1000,
    uri,
  }
}

function buildMongoClientOptions(
  options: DatabaseConnectionOptions,
  normalizedUri: string
): MongoClientOptions {
  const mongoClientOptions: MongoClientOptions = {
    ...options.mongoClientOptions,
  }

  if (options.tls) {
    if (typeof options.tls.enabled !== 'boolean') {
      throw invalidOptionsError('tls.enabled must be a boolean')
    }
    if (!options.tls.enabled && options.tls.caFile !== undefined) {
      throw invalidOptionsError('tls.caFile requires tls.enabled')
    }

    delete mongoClientOptions.ssl
    mongoClientOptions.tls = options.tls.enabled

    if (options.tls.caFile !== undefined) {
      if (typeof options.tls.caFile !== 'string' || !options.tls.caFile.trim()) {
        throw invalidOptionsError('tls.caFile must be a non-empty string')
      }
      if (options.tls.caFile !== options.tls.caFile.trim()) {
        throw invalidOptionsError('tls.caFile cannot have surrounding whitespace')
      }
      mongoClientOptions.tlsCAFile = options.tls.caFile
    } else {
      delete mongoClientOptions.tlsCAFile
    }
  }

  if (options.production) {
    validateProductionTls(options, mongoClientOptions, normalizedUri)
  }

  return mongoClientOptions
}

function validateProductionTls(
  options: DatabaseConnectionOptions,
  mongoClientOptions: MongoClientOptions,
  normalizedUri: string
): void {
  if (
    !options.tls?.enabled ||
    typeof options.tls.caFile !== 'string' ||
    !options.tls.caFile.trim()
  ) {
    throw invalidOptionsError('Production connections require TLS with a trusted CA file')
  }

  if (
    mongoClientOptions.tlsInsecure === true ||
    mongoClientOptions.tlsAllowInvalidCertificates === true ||
    mongoClientOptions.tlsAllowInvalidHostnames === true ||
    mongoClientOptions.rejectUnauthorized === false ||
    mongoClientOptions.checkServerIdentity !== undefined ||
    mongoClientOptions.ca !== undefined ||
    mongoClientOptions.secureContext !== undefined ||
    mongoClientOptions.servername !== undefined
  ) {
    throw invalidOptionsError(
      'Production connections cannot override or disable certificate or hostname verification'
    )
  }

  if (
    hasMongoUriOption(normalizedUri, 'tls', 'false') ||
    hasMongoUriOption(normalizedUri, 'ssl', 'false') ||
    hasMongoUriOption(normalizedUri, 'tlsinsecure', 'true') ||
    hasMongoUriOption(normalizedUri, 'tlsallowinvalidcertificates', 'true') ||
    hasMongoUriOption(normalizedUri, 'tlsallowinvalidhostnames', 'true')
  ) {
    throw invalidOptionsError(
      'Production connection URI cannot disable TLS certificate or hostname verification'
    )
  }
}

function normalizeMongoUri(uri: string): string {
  const trimmedUri = uri.trim()
  const hostNormalizedUri = normalizeMongoHosts(trimmedUri)
  const queryStart = hostNormalizedUri.indexOf('?')
  if (queryStart < 0) {
    return hostNormalizedUri
  }

  const query = new URLSearchParams(hostNormalizedUri.slice(queryStart + 1))
  query.sort()
  return `${hostNormalizedUri.slice(0, queryStart)}?${query.toString()}`
}

function normalizeMongoHosts(uri: string): string {
  const authorityStart = uri.indexOf('://') + 3
  if (authorityStart < 3) {
    return uri
  }

  const authorityEndCandidates = [
    uri.indexOf('/', authorityStart),
    uri.indexOf('?', authorityStart),
  ].filter((index) => index >= 0)
  const authorityEnd = authorityEndCandidates.length
    ? Math.min(...authorityEndCandidates)
    : uri.length
  const authority = uri.slice(authorityStart, authorityEnd)
  const credentialsEnd = authority.lastIndexOf('@')
  const credentials = credentialsEnd >= 0 ? authority.slice(0, credentialsEnd + 1) : ''
  const hosts = authority.slice(credentialsEnd + 1)
  const normalizedHosts = hosts
    .split(',')
    .map((host) => (host.toLowerCase().startsWith('%2f') ? host : host.toLowerCase()))
    .join(',')

  const normalizedScheme = uri.slice(0, authorityStart).toLowerCase()
  return `${normalizedScheme}${credentials}${normalizedHosts}${uri.slice(authorityEnd)}`
}

function hasMongoUriOption(uri: string, name: string, value: string): boolean {
  const queryStart = uri.indexOf('?')
  if (queryStart < 0) {
    return false
  }

  return [...new URLSearchParams(uri.slice(queryStart + 1))].some(
    ([optionName, optionValue]) =>
      optionName.toLowerCase() === name && optionValue.toLowerCase() === value
  )
}

function normalizePositiveInteger(
  value: number | undefined,
  defaultValue: number,
  optionName: string
): number {
  const normalizedValue = value ?? defaultValue
  if (!Number.isInteger(normalizedValue) || normalizedValue < 1) {
    throw invalidOptionsError(`${optionName} must be a positive integer`)
  }
  return normalizedValue
}

function normalizeNonNegativeNumber(
  value: number | undefined,
  defaultValue: number,
  optionName: string
): number {
  const normalizedValue = value ?? defaultValue
  if (!Number.isFinite(normalizedValue) || normalizedValue < 0) {
    throw invalidOptionsError(`${optionName} must be a non-negative number`)
  }
  return normalizedValue
}

function stableSerialize(value: unknown, seen = new Map<object, string>()): string {
  if (value === null || typeof value === 'undefined') {
    return String(value)
  }

  if (typeof value === 'string') {
    return JSON.stringify(value)
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }

  if (typeof value === 'function') {
    return `function:${getValueIdentity(value)}`
  }

  if (typeof value === 'bigint') {
    return `bigint:${value.toString()}`
  }

  if (typeof value === 'symbol') {
    return `symbol:${value.description ?? ''}`
  }

  if (Buffer.isBuffer(value)) {
    return `buffer:${value.toString('base64')}`
  }

  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableSerialize(entry, seen)).join(',')}]`
  }

  if (value instanceof ReadPreference) {
    return `readPreference:${stableSerialize(
      {
        hedge: value.hedge,
        maxStalenessSeconds: value.maxStalenessSeconds,
        minWireVersion: value.minWireVersion,
        mode: value.mode,
        tags: value.tags,
      },
      seen
    )}`
  }

  const objectValue = value as object
  const priorReference = seen.get(objectValue)
  if (priorReference) {
    return `reference:${priorReference}`
  }

  const prototype: unknown = Object.getPrototypeOf(objectValue)
  const isPlainObject = prototype === Object.prototype || prototype === null
  if (!isPlainObject) {
    const constructor = objectValue.constructor
    const constructorName =
      typeof constructor === 'function' && constructor.name ? constructor.name : 'Object'
    return `${constructorName}:${getValueIdentity(objectValue)}`
  }

  const reference = `object-${seen.size}`
  seen.set(objectValue, reference)
  return `{${Object.entries(objectValue)
    .filter(([, entry]) => typeof entry !== 'undefined')
    .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
    .map(([key, entry]) => `${JSON.stringify(key)}:${stableSerialize(entry, seen)}`)
    .join(',')}}`
}

function getValueIdentity(value: object): number {
  const existingIdentity = valueIdentity.get(value)
  if (existingIdentity) {
    return existingIdentity
  }

  const identity = nextValueIdentity++
  valueIdentity.set(value, identity)
  return identity
}

function waitForRetryOrClose(
  generation: ConnectionGeneration,
  waitMilliseconds: number
): Promise<boolean> {
  if (generation.closeRequested) {
    return Promise.resolve(true)
  }

  return new Promise((resolve) => {
    const timeout = setTimeout(() => resolve(false), waitMilliseconds)
    generation.closeSignal.then(() => {
      clearTimeout(timeout)
      resolve(true)
    })
  })
}

function invalidOptionsError(message: string): DatabaseConnectionError {
  return new DatabaseConnectionError('ERR_INVALID_CONNECTION_OPTIONS', message)
}

function connectionClosedError(): DatabaseConnectionError {
  return new DatabaseConnectionError(
    'ERR_CONNECTION_CLOSED',
    'The MongoDB connection was closed before it became available'
  )
}

function isConnectionClosedError(error: unknown): boolean {
  return (
    error instanceof DatabaseConnectionError && error.code === 'ERR_CONNECTION_CLOSED'
  )
}

function normalizeConnectionFailure(error: unknown): Error {
  if (error instanceof Error) {
    return error
  }

  const safeError = new Error(
    'Unable to connect to the database, please verify that your configuration is correct'
  )
  Object.defineProperty(safeError, 'cause', {
    configurable: true,
    enumerable: false,
    value: error,
    writable: true,
  })
  return safeError
}
