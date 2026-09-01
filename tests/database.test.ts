import { afterEach, describe, expect, jest, test } from '@jest/globals'
import { Db, MongoClient, ObjectId, ReadPreference } from 'mongodb'

import {
  close,
  connect,
  connectionStatus,
  DatabaseConnectionError,
  DatabaseConnectionOptions,
  getDbInstance,
} from '../src/index'

interface Deferred<T> {
  promise: Promise<T>
  reject: (reason?: unknown) => void
  resolve: (value: T) => void
}

interface MockClient {
  client: MongoClient
  close: jest.MockedFunction<MongoClient['close']>
  db: Db
  dbMethod: jest.MockedFunction<MongoClient['db']>
}

const baseOptions: DatabaseConnectionOptions = {
  uri: 'mongodb://localhost:27017/testDb',
  retry: { maxAttempts: 1, waitSeconds: 0 },
}

describe('Database connection lifecycle', () => {
  afterEach(async () => {
    await close()
    jest.restoreAllMocks()
  })

  test('throws when the database has not been instantiated', () => {
    expect(getDbInstance).toThrow('Database is not yet instantiated')
    expect(connectionStatus()).toBe(false)
  })

  test('shares one in-flight connection for normalized equivalent configurations', async () => {
    const pendingClient = deferred<MongoClient>()
    const mockClient = createMockClient('shared')
    const connectSpy = jest
      .spyOn(MongoClient, 'connect')
      .mockReturnValue(pendingClient.promise)

    const firstConnection = connect({
      ...baseOptions,
      uri: 'MONGODB://LOCALHOST:27017,SECONDARY:27018/testDb?retryWrites=true&appName=document-ts',
      mongoClientOptions: { serverSelectionTimeoutMS: 50, maxPoolSize: 4 },
    })
    expect(connectSpy).toHaveBeenCalledWith(
      'mongodb://localhost:27017,secondary:27018/testDb?appName=document-ts&retryWrites=true',
      expect.any(Object)
    )
    const secondConnection = connect({
      ...baseOptions,
      uri: 'mongodb://localhost:27017,secondary:27018/testDb?appName=document-ts&retryWrites=true',
      mongoClientOptions: { maxPoolSize: 4, serverSelectionTimeoutMS: 50 },
    })

    expect(secondConnection).toBe(firstConnection)
    expect(connectSpy).toHaveBeenCalledTimes(1)

    pendingClient.resolve(mockClient.client)
    await Promise.all([firstConnection, secondConnection])

    expect(connectionStatus()).toBe(true)
    expect(getDbInstance()).toBe(mockClient.db)
    expect(
      connect({
        ...baseOptions,
        uri: 'mongodb://localhost:27017,secondary:27018/testDb?appName=document-ts&retryWrites=true',
        mongoClientOptions: { maxPoolSize: 4, serverSelectionTimeoutMS: 50 },
      })
    ).toBe(firstConnection)
    expect(connectSpy).toHaveBeenCalledTimes(1)
  })

  test('rejects a conflicting configuration without replacing an in-flight client', async () => {
    const pendingClient = deferred<MongoClient>()
    const mockClient = createMockClient('first')
    const connectSpy = jest
      .spyOn(MongoClient, 'connect')
      .mockReturnValue(pendingClient.promise)

    const firstConnection = connect(baseOptions)

    await expect(
      connect({
        ...baseOptions,
        mongoClientOptions: { maxPoolSize: 2 },
      })
    ).rejects.toMatchObject({ code: 'ERR_CONNECTION_CONFIG_CONFLICT' })
    expect(connectSpy).toHaveBeenCalledTimes(1)

    pendingClient.resolve(mockClient.client)
    await firstConnection
    expect(getDbInstance()).toBe(mockClient.db)
  })

  test('rejects the outstanding connect and closes its client once when close wins the race', async () => {
    const pendingClient = deferred<MongoClient>()
    const mockClient = createMockClient('cancelled')
    jest.spyOn(MongoClient, 'connect').mockReturnValue(pendingClient.promise)

    const connection = connect(baseOptions)
    const connectionResult = connection.catch((error: unknown) => error)
    const closing = close()

    expect(connectionStatus()).toBe(false)
    expect(getDbInstance).toThrow('Database is not yet instantiated')

    pendingClient.resolve(mockClient.client)
    await expect(connectionResult).resolves.toMatchObject({
      code: 'ERR_CONNECTION_CLOSED',
    })
    await closing

    expect(mockClient.close).toHaveBeenCalledTimes(1)
    expect(connectionStatus()).toBe(false)
    expect(getDbInstance).toThrow('Database is not yet instantiated')
  })

  test('clears a failed generation so the next connection can succeed', async () => {
    const mockClient = createMockClient('retry')
    const connectSpy = jest
      .spyOn(MongoClient, 'connect')
      .mockRejectedValueOnce(new Error('first attempt failed'))
      .mockResolvedValueOnce(mockClient.client)

    await expect(connect(baseOptions)).rejects.toThrow('first attempt failed')
    expect(connectionStatus()).toBe(false)
    expect(getDbInstance).toThrow('Database is not yet instantiated')

    await connect(baseOptions)

    expect(connectSpy).toHaveBeenCalledTimes(2)
    expect(getDbInstance()).toBe(mockClient.db)
  })

  test('closes a client whose database selection fails before retrying', async () => {
    const invalidClient = createMockClient('invalid')
    const validClient = createMockClient('valid')
    invalidClient.dbMethod.mockImplementation(() => {
      throw new Error('database selection failed')
    })
    const connectSpy = jest
      .spyOn(MongoClient, 'connect')
      .mockResolvedValueOnce(invalidClient.client)
      .mockResolvedValueOnce(validClient.client)

    await connect({
      ...baseOptions,
      retry: { maxAttempts: 2, waitSeconds: 0 },
    })

    expect(connectSpy).toHaveBeenCalledTimes(2)
    expect(invalidClient.close).toHaveBeenCalledTimes(1)
    expect(getDbInstance()).toBe(validClient.db)
  })

  test('allows a different configuration only after close resolves', async () => {
    const firstClient = createMockClient('first')
    const secondClient = createMockClient('second')
    const connectSpy = jest
      .spyOn(MongoClient, 'connect')
      .mockResolvedValueOnce(firstClient.client)
      .mockResolvedValueOnce(secondClient.client)

    await connect(baseOptions)

    await expect(
      connect({ ...baseOptions, uri: 'mongodb://localhost:27017/otherDb' })
    ).rejects.toMatchObject({ code: 'ERR_CONNECTION_CONFIG_CONFLICT' })

    await close()
    await connect({ ...baseOptions, uri: 'mongodb://localhost:27017/otherDb' })

    expect(connectSpy).toHaveBeenCalledTimes(2)
    expect(firstClient.close).toHaveBeenCalledTimes(1)
    expect(secondClient.close).not.toHaveBeenCalled()
    expect(getDbInstance()).toBe(secondClient.db)
  })

  test('shares one close operation and rejects connect calls while it is closing', async () => {
    const pendingClose = deferred<undefined>()
    const mockClient = createMockClient('closing')
    mockClient.close.mockReturnValue(pendingClose.promise)
    jest.spyOn(MongoClient, 'connect').mockResolvedValue(mockClient.client)

    await connect(baseOptions)
    const firstClose = close(true)
    const secondClose = close()

    expect(secondClose).toBe(firstClose)
    await expect(connect(baseOptions)).rejects.toMatchObject({
      code: 'ERR_CONNECTION_CLOSED',
    })

    pendingClose.resolve(undefined)
    await Promise.all([firstClose, secondClose])
    expect(mockClient.close).toHaveBeenCalledTimes(1)
    expect(mockClient.close).toHaveBeenCalledWith(true)
  })

  test('cancels a pending retry without starting another driver connection', async () => {
    const connectSpy = jest
      .spyOn(MongoClient, 'connect')
      .mockRejectedValue(new Error('temporarily unavailable'))

    const connection = connect({
      ...baseOptions,
      retry: { maxAttempts: 2, waitSeconds: 60 },
    })
    const connectionResult = connection.catch((error: unknown) => error)
    await new Promise((resolve) => setImmediate(resolve))

    const closing = close()
    await expect(connectionResult).resolves.toMatchObject({
      code: 'ERR_CONNECTION_CLOSED',
    })
    await closing

    expect(connectSpy).toHaveBeenCalledTimes(1)
  })

  test('retries the configured number of times before exposing the final error', async () => {
    const connectSpy = jest
      .spyOn(MongoClient, 'connect')
      .mockRejectedValueOnce(new Error('first failure'))
      .mockRejectedValueOnce(new Error('second failure'))

    await expect(
      connect({
        ...baseOptions,
        retry: { maxAttempts: 2, waitSeconds: 0 },
      })
    ).rejects.toThrow('second failure')
    expect(connectSpy).toHaveBeenCalledTimes(2)
  })
})

describe('Database production TLS policy', () => {
  afterEach(async () => {
    await close()
    jest.restoreAllMocks()
  })

  test('rejects production mode before connecting when TLS or the trusted CA is missing', async () => {
    const connectSpy = jest.spyOn(MongoClient, 'connect')

    await expect(connect({ ...baseOptions, production: true })).rejects.toMatchObject({
      code: 'ERR_INVALID_CONNECTION_OPTIONS',
    })
    await expect(
      connect({
        ...baseOptions,
        production: true,
        tls: { enabled: true },
      })
    ).rejects.toMatchObject({ code: 'ERR_INVALID_CONNECTION_OPTIONS' })

    expect(connectSpy).not.toHaveBeenCalled()
  })

  test.each([
    { tlsInsecure: true },
    { tlsAllowInvalidCertificates: true },
    { tlsAllowInvalidHostnames: true },
    { rejectUnauthorized: false },
    { checkServerIdentity: () => undefined },
    { ca: 'caller-controlled-ca' },
    { servername: 'caller-controlled.example' },
  ])('rejects production verification bypass option %#', async (unsafeOption) => {
    const connectSpy = jest.spyOn(MongoClient, 'connect')

    await expect(
      connect({
        ...baseOptions,
        production: true,
        tls: { enabled: true, caFile: '/tmp/test-ca.pem' },
        mongoClientOptions: unsafeOption,
      })
    ).rejects.toMatchObject({ code: 'ERR_INVALID_CONNECTION_OPTIONS' })

    expect(connectSpy).not.toHaveBeenCalled()
  })

  test.each([
    'tls=false',
    'ssl=false',
    'tlsInsecure=true',
    'tlsAllowInvalidCertificates=true',
    'tlsAllowInvalidHostnames=true',
    'tlsInsecure=true&tlsInsecure=false',
  ])('rejects production verification bypass in the URI: %s', async (query) => {
    const connectSpy = jest.spyOn(MongoClient, 'connect')

    await expect(
      connect({
        ...baseOptions,
        uri: `${baseOptions.uri}?${query}`,
        production: true,
        tls: { enabled: true, caFile: '/tmp/test-ca.pem' },
      })
    ).rejects.toMatchObject({ code: 'ERR_INVALID_CONNECTION_OPTIONS' })

    expect(connectSpy).not.toHaveBeenCalled()
  })

  test('rejects an insecure option in a multi-host production URI', async () => {
    const connectSpy = jest.spyOn(MongoClient, 'connect')

    await expect(
      connect({
        ...baseOptions,
        uri: 'mongodb://HOST-A:27017,HOST-B:27017/testDb?tlsInsecure=true',
        production: true,
        tls: { enabled: true, caFile: '/tmp/test-ca.pem' },
      })
    ).rejects.toMatchObject({ code: 'ERR_INVALID_CONNECTION_OPTIONS' })

    expect(connectSpy).not.toHaveBeenCalled()
  })

  test('applies the TLS policy after supported MongoClient options', async () => {
    const mockClient = createMockClient('production')
    const connectSpy = jest
      .spyOn(MongoClient, 'connect')
      .mockResolvedValue(mockClient.client)

    await connect({
      ...baseOptions,
      production: true,
      tls: { enabled: true, caFile: '/tmp/test-ca.pem' },
      mongoClientOptions: {
        maxPoolSize: 7,
        tls: false,
        tlsCAFile: '/tmp/caller-override.pem',
      },
    })

    expect(connectSpy).toHaveBeenCalledWith(
      baseOptions.uri,
      expect.objectContaining({
        maxPoolSize: 7,
        tls: true,
        tlsCAFile: '/tmp/test-ca.pem',
      })
    )
  })

  test('rejects invalid retry values before connecting', async () => {
    const connectSpy = jest.spyOn(MongoClient, 'connect')

    await expect(
      connect({ ...baseOptions, retry: { maxAttempts: 0 } })
    ).rejects.toBeInstanceOf(DatabaseConnectionError)
    await expect(
      connect({ ...baseOptions, retry: { waitSeconds: -1 } })
    ).rejects.toBeInstanceOf(DatabaseConnectionError)

    expect(connectSpy).not.toHaveBeenCalled()
  })

  test('rejects malformed option objects and inconsistent TLS policy before connecting', async () => {
    const connectSpy = jest.spyOn(MongoClient, 'connect')

    await expect(
      connect(null as unknown as DatabaseConnectionOptions)
    ).rejects.toMatchObject({ code: 'ERR_INVALID_CONNECTION_OPTIONS' })
    await expect(connect({ uri: '   ' })).rejects.toMatchObject({
      code: 'ERR_INVALID_CONNECTION_OPTIONS',
    })
    await expect(
      connect({
        ...baseOptions,
        tls: { enabled: 'yes' as unknown as boolean },
      })
    ).rejects.toMatchObject({ code: 'ERR_INVALID_CONNECTION_OPTIONS' })
    await expect(
      connect({
        ...baseOptions,
        tls: { enabled: false, caFile: '/tmp/test-ca.pem' },
      })
    ).rejects.toMatchObject({ code: 'ERR_INVALID_CONNECTION_OPTIONS' })
    await expect(
      connect({
        ...baseOptions,
        tls: { enabled: false, caFile: '' },
      })
    ).rejects.toMatchObject({ code: 'ERR_INVALID_CONNECTION_OPTIONS' })
    await expect(
      connect({
        ...baseOptions,
        production: true,
        tls: { enabled: true, caFile: 42 as unknown as string },
      })
    ).rejects.toMatchObject({ code: 'ERR_INVALID_CONNECTION_OPTIONS' })
    await expect(
      connect({
        ...baseOptions,
        production: true,
        tls: { enabled: true, caFile: null as unknown as string },
      })
    ).rejects.toMatchObject({ code: 'ERR_INVALID_CONNECTION_OPTIONS' })
    await expect(
      connect({
        ...baseOptions,
        production: true,
        tls: { enabled: true, caFile: '  /tmp/test-ca.pem  ' },
      })
    ).rejects.toMatchObject({ code: 'ERR_INVALID_CONNECTION_OPTIONS' })

    expect(connectSpy).not.toHaveBeenCalled()
  })

  test('delegates non-URL connection strings to the driver after local policy validation', async () => {
    const mockClient = createMockClient('invalid-uri')
    const connectSpy = jest
      .spyOn(MongoClient, 'connect')
      .mockResolvedValue(mockClient.client)

    await connect({
      uri: 'not-a-mongodb-uri',
      production: true,
      retry: { maxAttempts: 1, waitSeconds: 0 },
      tls: { enabled: true, caFile: '/tmp/test-ca.pem' },
    })

    expect(connectSpy).toHaveBeenCalledWith(
      'not-a-mongodb-uri',
      expect.objectContaining({ tls: true, tlsCAFile: '/tmp/test-ca.pem' })
    )
  })

  test('fingerprints structured MongoClient options without depending on key order', async () => {
    const pendingClient = deferred<MongoClient>()
    const mockClient = createMockClient('structured-options')
    const connectSpy = jest
      .spyOn(MongoClient, 'connect')
      .mockReturnValue(pendingClient.promise)
    const optionValues: NonNullable<DatabaseConnectionOptions['mongoClientOptions']> = {
      appName: undefined,
      ca: Buffer.from('trusted bytes'),
      checkServerIdentity: () => undefined,
      compressors: ['zlib'],
      driverInfo: Object.assign(Object.create(null) as Record<string, string>, {
        name: 'document-ts',
      }),
      pkFactory: { createPk: () => new ObjectId() },
      readPreference: new ReadPreference(
        'secondaryPreferred',
        [{ region: 'east', workload: 'reporting' }],
        { hedge: { enabled: true }, maxStalenessSeconds: 120 }
      ),
    }
    const equivalentOptionValues: Record<string, unknown> = {
      ...(optionValues as Record<string, unknown>),
      driverInfo: Object.assign(Object.create(null) as Record<string, string>, {
        name: 'document-ts',
      }),
      readPreference: new ReadPreference(
        'secondaryPreferred',
        [{ workload: 'reporting', region: 'east' }],
        { hedge: { enabled: true }, maxStalenessSeconds: 120 }
      ),
    }
    delete equivalentOptionValues.appName

    const firstConnection = connect({
      ...baseOptions,
      mongoClientOptions: optionValues,
    })
    const secondConnection = connect({
      ...baseOptions,
      mongoClientOptions:
        equivalentOptionValues as DatabaseConnectionOptions['mongoClientOptions'],
    })

    expect(secondConnection).toBe(firstConnection)
    expect(connectSpy).toHaveBeenCalledTimes(1)
    pendingClient.resolve(mockClient.client)
    await firstConnection
  })

  test('does not conflate different ReadPreference values', async () => {
    const pendingClient = deferred<MongoClient>()
    jest.spyOn(MongoClient, 'connect').mockReturnValue(pendingClient.promise)

    const firstConnection = connect({
      ...baseOptions,
      mongoClientOptions: {
        readPreference: new ReadPreference('secondary', [{ region: 'east' }]),
      },
    })

    await expect(
      connect({
        ...baseOptions,
        mongoClientOptions: {
          readPreference: new ReadPreference('secondary', [{ region: 'west' }]),
        },
      })
    ).rejects.toMatchObject({ code: 'ERR_CONNECTION_CONFIG_CONFLICT' })

    pendingClient.reject(new Error('test cleanup'))
    await expect(firstConnection).rejects.toThrow('test cleanup')
  })

  test('keeps unknown non-plain option instances identity-distinct', async () => {
    const pendingClient = deferred<MongoClient>()
    jest.spyOn(MongoClient, 'connect').mockReturnValue(pendingClient.promise)
    const firstOpaqueValue = Object.create({ kind: 'opaque' }) as object
    const secondOpaqueValue = Object.create({ kind: 'opaque' }) as object

    const firstConnection = connect({
      ...baseOptions,
      mongoClientOptions: {
        opaqueOption: firstOpaqueValue,
      } as unknown as DatabaseConnectionOptions['mongoClientOptions'],
    })

    await expect(
      connect({
        ...baseOptions,
        mongoClientOptions: {
          opaqueOption: secondOpaqueValue,
        } as unknown as DatabaseConnectionOptions['mongoClientOptions'],
      })
    ).rejects.toMatchObject({ code: 'ERR_CONNECTION_CONFIG_CONFLICT' })

    pendingClient.reject(new Error('test cleanup'))
    await expect(firstConnection).rejects.toThrow('test cleanup')
  })

  test('normalizes a non-Error driver rejection', async () => {
    jest.spyOn(MongoClient, 'connect').mockRejectedValue('connection failed')

    const failure = await connect(baseOptions).catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(Error)
    expect(failure).toHaveProperty(
      'message',
      'Unable to connect to the database, please verify that your configuration is correct'
    )
    expect(Object.getOwnPropertyDescriptor(failure, 'cause')).toMatchObject({
      configurable: true,
      enumerable: false,
      value: 'connection failed',
      writable: true,
    })
  })
})

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })

  return { promise, reject, resolve }
}

function createMockClient(databaseName: string): MockClient {
  const db = { databaseName } as Db
  const closeMock = jest.fn<MongoClient['close']>().mockResolvedValue(undefined)
  const dbMethod = jest.fn<MongoClient['db']>(() => db)
  const client = {
    close: closeMock,
    db: dbMethod,
  } as unknown as MongoClient

  return { client, close: closeMock, db, dbMethod }
}
