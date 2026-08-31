/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from '@jest/globals'

import {
  Collection,
  MongoNetworkError,
  MongoServerError,
  ObjectId,
  UpdateFilter,
  UpdateResult,
} from 'mongodb'

import {
  close,
  connect,
  Document,
  DocumentConflictException,
  DocumentException,
  DocumentHydrationException,
  DocumentIdentifierException,
  DocumentValidationException,
  getDbInstance,
  IDocument,
} from '../src/index'
import { testMongoUri } from './mongoTest'
import { IUser, User, UserCollection } from './user'

const uri = testMongoUri('document_security')

interface ITestRecord extends IDocument {
  value?: string
}

class ChildValue {
  constructor(public value = '') {}
}

class TestDocument extends Document<ITestRecord> implements ITestRecord {
  public appliedUndefined = false
  public ownCallback = () => true
  public value?: string

  constructor(collectionName = 'test-documents', data?: Partial<ITestRecord>) {
    super(collectionName)
    if (data !== undefined) {
      this.fillData(data)
    }
  }

  protected applyData(data?: Partial<ITestRecord>): void {
    if (!data) {
      this.appliedUndefined = true
      return
    }
    Object.assign(this, data)
  }

  protected getCalculatedPropertiesToInclude(): string[] {
    return []
  }

  protected getPropertiesToExclude(): string[] {
    return []
  }

  public hydrateChildren(
    children: Array<ChildValue | { value: string }>
  ): ChildValue[] | undefined {
    return this.hydrateInterfaceArray(
      ChildValue,
      (child) => new ChildValue(child.value),
      children
    )
  }
}

class InvalidBsonDocument extends TestDocument {
  public override toBSON(): object {
    return []
  }
}

describe('Document security boundaries', () => {
  beforeAll(async () => {
    await connect({ uri })
  })

  beforeEach(async () => {
    await getDbInstance().dropDatabase()
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  afterAll(async () => {
    await close()
  })

  test('rejects reserved public hydration atomically', () => {
    const user = new User({ firstName: 'original' } as IUser)
    const payloads = [
      { lastName: 'partial', collectionName: 'admins' },
      { lastName: 'partial', _id: new ObjectId() },
      { lastName: 'partial', toJSON: null },
      { lastName: 'partial', toBSON: null },
      { lastName: 'partial', save: null },
      { lastName: 'partial', delete: null },
      { lastName: 'partial', fillData: null },
      JSON.parse('{"lastName":"partial","__proto__":{"polluted":true}}'),
    ]

    for (const payload of payloads) {
      expect(() => user.fillData(payload as Partial<IUser>)).toThrow(
        DocumentHydrationException
      )
      expect(user.lastName).toBeUndefined()
      expect(user.firstName).toBe('original')
      expect(user.collectionName).toBe(User.collectionName)
    }

    expect(Reflect.set(user, 'collectionName', 'admins')).toBe(false)
    expect(Reflect.set(user, '_id', new ObjectId())).toBe(false)
    expect(user.collectionName).toBe(User.collectionName)
    expect(user._id).toBeUndefined()
  })

  test('rejects malformed hydration inputs and protects own framework functions', () => {
    expect(() => new TestDocument('')).toThrow(DocumentValidationException)

    const document = new TestDocument()
    document.fillData()
    expect(document.appliedUndefined).toBe(true)
    expect(document.hydrateChildren([])).toBeUndefined()
    expect(
      document.hydrateChildren([new ChildValue('existing'), { value: 'new' }])
    ).toEqual([new ChildValue('existing'), new ChildValue('new')])

    expect(document.value).toBeUndefined()
  })

  test.each([
    ['null', () => null],
    ['array', () => []],
    [
      'inherited prototype',
      () => {
        const payload = {}
        Reflect.setPrototypeOf(payload, { inherited: true })
        return payload
      },
    ],
    [
      'accessor',
      () => {
        const payload = {}
        Object.defineProperty(payload, 'value', {
          enumerable: true,
          get: () => 'unsafe',
        })
        return payload
      },
    ],
    [
      'symbol',
      () => {
        const payload = { value: 'unsafe' }
        Object.defineProperty(payload, Symbol('unsafe'), { value: true })
        return payload
      },
    ],
    ['own framework function', () => ({ ownCallback: null })],
    ['function value', () => ({ arbitraryCallback: () => true })],
  ])('rejects %s hydration payloads', (_name, createPayload) => {
    const document = new TestDocument()
    expect(() => document.fillData(createPayload() as Partial<ITestRecord>)).toThrow(
      DocumentHydrationException
    )
    expect(document.value).toBeUndefined()
  })

  test('allows only private factory hydration to set a valid database identifier', async () => {
    const id = new ObjectId()
    const collection = getDbInstance().collection(User.collectionName)

    expect(() => new User({ _id: id } as Partial<IUser>)).toThrow(
      DocumentHydrationException
    )

    await collection.insertOne({
      _id: id,
      email: 'trusted@example.com',
      firstName: 'Trusted',
      lastName: 'Record',
      role: 'user',
      colors: [],
      __documentTsVersion: 0,
    })
    const hydrated = await UserCollection.findOne({ _id: id })
    expect(hydrated._id).toEqual(id)
    expect(hydrated.collectionName).toBe(User.collectionName)

    await collection.insertMany([
      {
        _id: new ObjectId(),
        email: 'reserved@example.com',
        collectionName: 'admins',
      },
      {
        _id: id.toHexString() as any,
        email: 'invalid@example.com',
      },
      {
        _id: new ObjectId(),
        __documentTsVersion: -1,
        email: 'invalid-version@example.com',
      },
    ])
    await expect(
      UserCollection.findOne({ email: 'reserved@example.com' })
    ).rejects.toBeInstanceOf(DocumentHydrationException)
    await expect(
      UserCollection.findOne({ email: 'invalid@example.com' })
    ).rejects.toBeInstanceOf(DocumentHydrationException)
    await expect(
      UserCollection.findOne({ email: 'invalid-version@example.com' })
    ).rejects.toBeInstanceOf(DocumentHydrationException)
  })

  test('rejects a projected database result without _id instead of creating a new model', async () => {
    const collection = getDbInstance().collection(User.collectionName)
    await collection.insertOne({
      email: 'projected@example.com',
      firstName: 'Projected',
      __documentTsVersion: 0,
    })

    await expect(
      UserCollection.findOne(
        { email: 'projected@example.com' },
        { projection: { _id: 0 } }
      )
    ).rejects.toBeInstanceOf(DocumentHydrationException)

    expect(await collection.countDocuments({ email: 'projected@example.com' })).toBe(1)
  })

  test.each([undefined, null, 'id', 42, {}, new Uint8Array(12)])(
    'rejects invalid instance identifier %p before any mutation',
    async (invalidId) => {
      const collection = getDbInstance().collection(User.collectionName)
      await collection.insertOne({ email: 'sentinel@example.com' })
      const insertSpy = jest.spyOn(Collection.prototype, 'insertOne')
      const updateSpy = jest.spyOn(Collection.prototype, 'updateOne')
      const deleteSpy = jest.spyOn(Collection.prototype, 'deleteOne')
      const user = new User({ email: 'invalid@example.com' } as IUser)
      Object.defineProperty(user, '_id', {
        configurable: true,
        enumerable: true,
        value: invalidId,
      })

      await expect(user.save()).rejects.toBeInstanceOf(DocumentIdentifierException)
      await expect(user.delete()).rejects.toBeInstanceOf(DocumentIdentifierException)

      expect(insertSpy).not.toHaveBeenCalled()
      expect(updateSpy).not.toHaveBeenCalled()
      expect(deleteSpy).not.toHaveBeenCalled()
      expect(await collection.countDocuments({})).toBe(1)
      expect(await collection.findOne({ email: 'sentinel@example.com' })).not.toBeNull()
    }
  )

  test('inserts without an identifier and uses exact identifier mutation filters', async () => {
    const collection = getDbInstance().collection(User.collectionName)
    const insertSpy = jest.spyOn(Collection.prototype, 'insertOne')
    const user = new User({
      email: 'valid@example.com',
      firstName: 'Before',
      lastName: 'User',
      role: 'admin',
    } as IUser)

    await expect(user.save()).resolves.toBe(true)
    expect(insertSpy).toHaveBeenCalledTimes(1)
    expect(user._id).toBeInstanceOf(ObjectId)

    const hydrated = await UserCollection.findOne({ _id: user._id })
    const updateSpy = jest.spyOn(Collection.prototype, 'updateOne')
    hydrated.firstName = 'After'
    ;(hydrated as any).includes = ['unsafe']
    ;(hydrated as any).excludes = ['unsafe']
    ;(hydrated as any).runtimeCallback = () => 'unsafe'

    await expect(hydrated.save()).resolves.toBe(true)
    expect(updateSpy).toHaveBeenCalledTimes(1)
    expect(updateSpy.mock.calls[0][0]).toEqual({ _id: user._id })
    const updateDocument = updateSpy.mock.calls[0][1]
    expect(Array.isArray(updateDocument)).toBe(true)
    expect(JSON.stringify(updateDocument)).not.toContain('"$set"')
    expect(JSON.stringify(updateDocument)).not.toContain('runtimeCallback')
    expect(JSON.stringify(updateDocument)).not.toContain('"collectionName"')
    expect(JSON.stringify(updateDocument)).not.toContain('"includes"')
    expect(JSON.stringify(updateDocument)).not.toContain('"excludes"')

    const stored = await collection.findOne({ _id: user._id })
    expect(stored?.firstName).toBe('After')
    expect(stored?.collectionName).toBeUndefined()
    expect(stored?.includes).toBeUndefined()
    expect(stored?.excludes).toBeUndefined()
    expect(stored?.runtimeCallback).toBeUndefined()

    const deleteSpy = jest.spyOn(Collection.prototype, 'deleteOne')
    await hydrated.delete()
    expect(deleteSpy).toHaveBeenCalledTimes(1)
    expect(deleteSpy.mock.calls[0][0]).toEqual({ _id: user._id })
    expect(await collection.countDocuments({})).toBe(0)
  })

  test('uses private collection identity when a public property shadows the getter', async () => {
    const user = new User({ email: 'private-identity@example.com' } as IUser)
    Object.defineProperty(user, 'collectionName', {
      configurable: true,
      enumerable: true,
      value: 'redirected-users',
      writable: true,
    })

    await expect(user.save()).resolves.toBe(true)
    expect(
      await getDbInstance()
        .collection(User.collectionName)
        .countDocuments({ email: 'private-identity@example.com' })
    ).toBe(1)
    expect(await getDbInstance().collection('redirected-users').countDocuments({})).toBe(
      0
    )

    await expect(user.delete()).resolves.toMatchObject({ deletedCount: 1 })
    expect(
      await getDbInstance()
        .collection(User.collectionName)
        .countDocuments({ email: 'private-identity@example.com' })
    ).toBe(0)
  })

  test('rejects stale unrelated and same-field saves without changing stored data', async () => {
    const original = new User({
      email: 'concurrency@example.com',
      firstName: 'Original',
      lastName: 'User',
      role: 'admin',
    } as IUser)
    await original.save()

    const revoker = await UserCollection.findOne({ _id: original._id })
    const staleUnrelated = await UserCollection.findOne({ _id: original._id })
    revoker.role = 'user'
    await revoker.save()
    staleUnrelated.firstName = 'Stale name'

    await expect(staleUnrelated.save()).rejects.toBeInstanceOf(DocumentConflictException)
    let stored = await getDbInstance()
      .collection(User.collectionName)
      .findOne({ _id: original._id })
    expect(stored?.role).toBe('user')
    expect(stored?.firstName).toBe('Original')

    const sameFieldWinner = await UserCollection.findOne({ _id: original._id })
    const sameFieldStale = await UserCollection.findOne({ _id: original._id })
    sameFieldWinner.role = 'revoked'
    await sameFieldWinner.save()
    sameFieldStale.role = 'restored'

    await expect(sameFieldStale.save()).rejects.toBeInstanceOf(DocumentConflictException)
    stored = await getDbInstance()
      .collection(User.collectionName)
      .findOne({ _id: original._id })
    expect(stored?.role).toBe('revoked')
    expect(stored?.firstName).toBe('Original')
  })

  test('findOneAndUpdate advances the revision and prevents a stale save from restoring data', async () => {
    const original = new User({
      email: 'factory-concurrency@example.com',
      firstName: 'Original',
      role: 'admin',
    } as IUser)
    await original.save()

    const stale = await UserCollection.findOne({ _id: original._id })
    const updated = await UserCollection.findOneAndUpdate(
      { _id: original._id },
      { $set: { role: 'revoked' } },
      { returnDocument: 'after' }
    )

    expect(updated.role).toBe('revoked')
    let stored = await getDbInstance()
      .collection(User.collectionName)
      .findOne({ _id: original._id })
    expect(stored?.__documentTsVersion).toBe(1)

    stale.firstName = 'Stale overwrite'
    stale.role = 'admin'
    await expect(stale.save()).rejects.toBeInstanceOf(DocumentConflictException)

    stored = await getDbInstance()
      .collection(User.collectionName)
      .findOne({ _id: original._id })
    expect(stored?.role).toBe('revoked')
    expect(stored?.firstName).toBe('Original')
    expect(stored?.__documentTsVersion).toBe(1)

    updated.firstName = 'Current update'
    await expect(updated.save()).resolves.toBe(true)
    stored = await getDbInstance()
      .collection(User.collectionName)
      .findOne({ _id: original._id })
    expect(stored?.firstName).toBe('Current update')
    expect(stored?.__documentTsVersion).toBe(2)
  })

  test('findOneAndUpdate adds its revision increment without mutating caller input', async () => {
    const id = new ObjectId()
    const update = {
      $set: { firstName: 'After' },
      $inc: { loginCount: 2 },
    }
    const driverSpy = jest
      .spyOn(Collection.prototype, 'findOneAndUpdate')
      .mockResolvedValueOnce({
        _id: id,
        email: 'versioned-update@example.com',
        firstName: 'After',
        __documentTsVersion: 4,
      })

    await expect(
      UserCollection.findOneAndUpdate(
        { _id: id },
        update as unknown as UpdateFilter<User>,
        { returnDocument: 'after' }
      )
    ).resolves.toBeInstanceOf(User)

    expect(driverSpy).toHaveBeenCalledTimes(1)
    expect(driverSpy.mock.calls[0][1]).toEqual({
      $set: { firstName: 'After' },
      $inc: { loginCount: 2, __documentTsVersion: 1 },
    })
    expect(update).toEqual({
      $set: { firstName: 'After' },
      $inc: { loginCount: 2 },
    })
  })

  test.each([
    { $set: { __documentTsVersion: 10 } },
    { $inc: { __documentTsVersion: -1 } },
    { $rename: { role: '__documentTsVersion' } },
    { __documentTsVersion: 0 },
  ])('rejects caller mutation of the managed revision: %p', async (update) => {
    const driverSpy = jest.spyOn(Collection.prototype, 'findOneAndUpdate')

    await expect(
      UserCollection.findOneAndUpdate(
        { email: 'revision@example.com' },
        update as unknown as UpdateFilter<User>
      )
    ).rejects.toBeInstanceOf(DocumentValidationException)
    expect(driverSpy).not.toHaveBeenCalled()
  })

  test('sanitizes duplicate-key errors and retains the native cause privately', async () => {
    const sensitiveEmail = 'private-duplicate@example.com'
    const nativeError = new MongoServerError({
      ok: 0,
      code: 11000,
      errmsg: `duplicate key for ${sensitiveEmail} at mongodb://user:password@host/db`,
      keyValue: { email: sensitiveEmail },
      ns: 'private.users',
    })
    jest.spyOn(Collection.prototype, 'insertOne').mockRejectedValueOnce(nativeError)
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    const consoleLog = jest.spyOn(console, 'log').mockImplementation(() => undefined)
    const user = new User({ email: sensitiveEmail } as IUser)

    const exception = (await user
      .save()
      .catch((error: unknown) => error)) as DocumentException

    expect(exception).toBeInstanceOf(DocumentException)
    expect(exception.code).toBe('DOCUMENT_DUPLICATE_KEY')
    expect(exception.message).toBe('Document conflicts with an existing unique value.')
    expect(exception.cause).toBe(nativeError)
    expect(Object.prototype.propertyIsEnumerable.call(exception, 'cause')).toBe(false)
    const serialized = JSON.stringify(exception)
    expect(serialized).not.toContain(sensitiveEmail)
    expect(serialized).not.toContain('keyValue')
    expect(serialized).not.toContain('private.users')
    expect(serialized).not.toContain('mongodb://')
    expect(serialized).not.toContain('password')
    expect(serialized).not.toContain('stack')
    expect(consoleError).not.toHaveBeenCalled()
    expect(consoleLog).not.toHaveBeenCalled()
  })

  test('maps insert network and update failures to a static operation error', async () => {
    const sensitiveValue = 'mongodb://user:password@host/db?email=private@example.com'
    const networkError = new MongoNetworkError(sensitiveValue)
    jest.spyOn(Collection.prototype, 'insertOne').mockRejectedValueOnce(networkError)
    const insertUser = new User({ email: 'network@example.com' } as IUser)

    const insertException = (await insertUser
      .save()
      .catch((error: unknown) => error)) as DocumentException
    expect(insertException.code).toBe('DOCUMENT_OPERATION_FAILED')
    expect(insertException.message).toBe('Document operation failed.')
    expect(insertException.cause).toBe(networkError)
    expect(JSON.stringify(insertException)).not.toContain(sensitiveValue)

    const persisted = new User({ email: 'update@example.com' } as IUser)
    await persisted.save()
    const hydrated = await UserCollection.findOne({ _id: persisted._id })
    const updateError = new Error(`namespace users contains ${sensitiveValue}`)
    jest.spyOn(Collection.prototype, 'updateOne').mockRejectedValueOnce(updateError)
    hydrated.firstName = 'Changed'

    const updateException = (await hydrated
      .save()
      .catch((error: unknown) => error)) as DocumentException
    expect(updateException.code).toBe('DOCUMENT_OPERATION_FAILED')
    expect(updateException.message).toBe('Document operation failed.')
    expect(updateException.cause).toBe(updateError)
    expect(JSON.stringify(updateException)).not.toContain(sensitiveValue)
  })

  test('maps an unacknowledged update to a typed failure', async () => {
    const user = new User({ email: 'acknowledged@example.com' } as IUser)
    await user.save()
    const hydrated = await UserCollection.findOne({ _id: user._id })
    jest.spyOn(Collection.prototype, 'updateOne').mockResolvedValueOnce({
      acknowledged: false,
      matchedCount: 0,
      modifiedCount: 0,
      upsertedCount: 0,
      upsertedId: null,
    } as UpdateResult)

    const exception = (await hydrated
      .save()
      .catch((error: unknown) => error)) as DocumentException
    expect(exception.code).toBe('DOCUMENT_OPERATION_FAILED')
    expect(exception.message).toBe('Document operation failed.')
  })

  test('maps an unacknowledged insert to a typed failure', async () => {
    jest.spyOn(Collection.prototype, 'insertOne').mockResolvedValueOnce({
      acknowledged: false,
      insertedId: new ObjectId(),
    })
    const user = new User({ email: 'unacknowledged-insert@example.com' } as IUser)

    const exception = (await user
      .save()
      .catch((error: unknown) => error)) as DocumentException
    expect(exception.code).toBe('DOCUMENT_OPERATION_FAILED')
    expect(exception.message).toBe('Document operation failed.')
  })

  test('rejects an existing-document upsert before calling the driver', async () => {
    const user = new User({ email: 'upsert@example.com' } as IUser)
    await user.save()
    const hydrated = await UserCollection.findOne({ _id: user._id })
    const updateSpy = jest.spyOn(Collection.prototype, 'updateOne')

    await expect(hydrated.save({ upsert: true })).rejects.toBeInstanceOf(
      DocumentValidationException
    )
    expect(updateSpy).not.toHaveBeenCalled()
  })

  test('rejects delete without an identifier and invalid BSON output', async () => {
    const newDocument = new TestDocument()
    await expect(newDocument.delete()).rejects.toBeInstanceOf(DocumentIdentifierException)

    const invalidBson = new InvalidBsonDocument()
    await expect(invalidBson.save()).rejects.toBeInstanceOf(DocumentValidationException)
  })
})
