/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { describe, expect, test, beforeEach, afterEach } from '@jest/globals'

import { AggregationCursor, Filter, ObjectId } from 'mongodb'

import { close, connect, getDbInstance } from '../src/index'
import { testMongoUri } from './mongoTest'
import { IUser, User, UserCollection } from './user'

const uri = testMongoUri('document')

describe('Document', () => {
  beforeEach(async () => {
    await close()
    await connect({ uri })
    await getDbInstance().dropDatabase()
  })

  afterEach(async () => {
    await close()
  })

  test('should store a user', async () => {
    const expectedException = null
    let actualException = null

    try {
      const user = new User()
      await user.create('Doguhan', 'Uluca', 'duluca@gmail.com', 'user')
    } catch (ex) {
      actualException = ex
    }

    expect(expectedException).toEqual(actualException)
  })

  test('should store multiple users', async () => {
    const expectedException = null
    let actualException = null

    try {
      for (let i = 0; i < 5; i++) {
        const user = new User()
        await user.create(`${i}`, `${i}`, `${i}@gmail.com`, 'user')
      }
    } catch (ex) {
      actualException = ex
    }

    expect(expectedException).toEqual(actualException)
  })

  test('should hydrate multiple users', async () => {
    const expectedException = null
    let actualException = null

    try {
      for (let i = 0; i < 5; i++) {
        const user = new User()
        await user.create(`${i}`, `${i}`, `${i}@gmail.com`, 'user')
      }

      for (let i = 0; i < 5; i++) {
        const foundUser = await UserCollection.findOne({ lastName: `${i}` })
        const expectedFullName = `${i} ${i}`
        expect(expectedFullName).toEqual(foundUser.fullName)
      }
    } catch (ex) {
      actualException = ex
    }

    expect(expectedException).toEqual(actualException)
  })

  test('should overwrite record with same id', async () => {
    const expectedException = null
    let actualException = null

    try {
      const user = new User()
      await user.create('Doguhan', 'Uluca', 'duluca@gmail.com', 'user')
      await user.create('Doguhan', 'Uluca1', 'duluca@gmail.com', 'user')
    } catch (ex) {
      actualException = ex
    }

    const results = await UserCollection.find<User>({ firstName: 'Doguhan' })
    expect(expectedException).toEqual(actualException)
    expect(results.total).toEqual(1)
    expect(results.data[0].lastName).toEqual('Uluca1')
  })

  test('should fail to store two users with same email (unique index)', async () => {
    await UserCollection.createIndexes()

    const user = new User({
      firstName: 'Doguhan',
      lastName: 'Uluca',
      email: 'duluca@gmail.com',
      role: 'user',
    } as IUser)
    await user.save()
    const user1 = new User({
      firstName: 'Doguhan1',
      lastName: 'Uluca1',
      email: 'duluca@gmail.com',
      role: 'user',
    } as IUser)
    await expect(user1.save()).rejects.toMatchObject({
      code: 'DOCUMENT_DUPLICATE_KEY',
      message: 'Document conflicts with an existing unique value.',
    })
  })

  test('should create a user with array values', async () => {
    const expectedException = null
    let actualException = null

    try {
      const user = new User()
      await user.create('Doguhan', 'Uluca', 'duluca@gmail.com', 'user', '123456', [
        { hue: 'red', alpha: 0.5 },
      ])
    } catch (ex) {
      actualException = ex
    }

    expect(expectedException).toEqual(actualException)

    const results = await UserCollection.find<User>({ firstName: 'Doguhan' })

    expect(results.total).toEqual(1)
    expect(results.data[0].colors[0].hue).toEqual('red')
  })

  test('should save a user with array values', async () => {
    const expectedException = null
    let actualException = null

    try {
      const user = new User({
        firstName: 'Doguhan',
        lastName: 'Uluca',
        email: 'duluca@gmail.com',
        role: 'user',
        colors: [{ hue: 'red', alpha: 0.5 }],
      })
      await user.save()
    } catch (ex) {
      actualException = ex
    }

    expect(expectedException).toEqual(actualException)

    const results = await UserCollection.find<User>({ firstName: 'Doguhan' })

    expect(results.total).toEqual(1)
    expect(results.data[0].colors[0].hue).toEqual('red')
  })

  test('should find with pagination given string skip and limit', async () => {
    const expectedException = null
    let actualException = null
    const expectedRecordCount = 20

    try {
      for (let i = 0; i < expectedRecordCount; i++) {
        const user = new User()
        await user.create(`${i}`, `${i}`, `${i}@gmail.com`, 'user')
      }
    } catch (ex) {
      actualException = ex
    }

    expect(expectedException).toEqual(actualException)

    const results = await UserCollection.findWithPagination<User>({
      skip: 10,
      limit: 10,
    })
    expect(expectedRecordCount).toBe(results.total)
    expect(results.data).toHaveLength(10)
    expect(results.data[0].firstName).toBe('10')
  })

  test('should find with pagination', async () => {
    const expectedException = null
    let actualException = null
    const expectedRecordCount = 20

    try {
      for (let i = 0; i < expectedRecordCount; i++) {
        const user = new User()
        await user.create(`${i}`, `${i}`, `${i}@gmail.com`, 'user')
      }
    } catch (ex) {
      actualException = ex
    }

    expect(expectedException).toEqual(actualException)

    const results = await UserCollection.findWithPagination<User>({ skip: 10, limit: 10 })
    expect(expectedRecordCount).toBe(results.total)
    expect(results.data).toHaveLength(10)
    expect(results.data[0].firstName).toBe('10')
  })

  test('should find with pagination and sort', async () => {
    const expectedException = null
    let actualException = null
    const expectedRecordCount = 20

    try {
      for (let i = 0; i < expectedRecordCount; i++) {
        const user = new User()
        await user.create(`${i}`, `${i}`, `${i}@gmail.com`, 'user')
      }
    } catch (ex) {
      actualException = ex
    }

    expect(expectedException).toEqual(actualException)

    const results = await UserCollection.findWithPagination<User>({
      sortKeyOrList: ['firstName'],
    })
    expect(expectedRecordCount).toBe(results.total)
    expect(results.data).toHaveLength(20)
    expect(results.data[0].firstName).toBe('0')
  })

  test('should find with pagination and sort desc', async () => {
    const expectedException = null
    let actualException = null
    const expectedRecordCount = 20

    try {
      for (let i = 0; i < expectedRecordCount; i++) {
        const user = new User()
        await user.create(`${i}`, `${i}`, `${i}@gmail.com`, 'user')
      }
    } catch (ex) {
      actualException = ex
    }

    expect(expectedException).toEqual(actualException)

    const results = await UserCollection.findWithPagination<User>({
      sortKeyOrList: ['-firstName'],
    })
    expect(expectedRecordCount).toBe(results.total)
    expect(results.data).toHaveLength(20)
    expect(results.data[0].firstName).toBe('9')
  })

  test('should find with pagination and aggregate query asc', async () => {
    const expectedException = null
    let actualException = null
    const expectedRecordCount = 20

    try {
      for (let i = 0; i < expectedRecordCount; i++) {
        const user = new User()
        await user.create(`${i}`, `${i}`, `${i}@gmail.com`, 'user')
      }
    } catch (ex) {
      actualException = ex
    }

    const aggregateQueryGetter = () => UserCollection.userSearchQuery('')

    expect(expectedException).toEqual(actualException)
    const results = await UserCollection.findWithPagination<{
      _id: ObjectId
      email: string
    }>({ skip: 10, limit: 10 }, aggregateQueryGetter)
    expect(expectedRecordCount).toBe(results.total)
    expect(results.data).toHaveLength(10)
    expect(results.data[0].email).toBe('10@gmail.com')
    expect((results.data[0] as any).firstName).toBeUndefined()
  })

  test('should find with pagination and aggregate query desc', async () => {
    const expectedException = null
    let actualException = null
    const expectedRecordCount = 20

    try {
      for (let i = 0; i < expectedRecordCount; i++) {
        const user = new User()
        await user.create(`${i}`, `${i}`, `${i}@gmail.com`, 'user')
      }
    } catch (ex) {
      actualException = ex
    }

    const aggregateQueryGetter = () => UserCollection.userSearchQuery('')

    expect(expectedException).toEqual(actualException)
    const results = await UserCollection.findWithPagination<{
      _id: ObjectId
      email: string
    }>({ skip: 10, limit: 10 }, aggregateQueryGetter)
    expect(expectedRecordCount).toBe(results.total)
    expect(results.data).toHaveLength(10)
    expect(results.data[0].email).toBe('10@gmail.com')
    expect((results.data[0] as any).firstName).toBeUndefined()
  })

  test('should find with pagination and query filter and text index', async () => {
    const expectedException = null
    let actualException = null
    const expectedRecordCount = 20
    const searchText = 'smith jones'
    const expectedSearchResults = 1

    await UserCollection.createIndexes()

    try {
      let user = new User()
      for (let i = 0; i < expectedRecordCount; i++) {
        user = new User()
        await user.create(`${i}`, `${i}`, `${i}@gmail.com`, 'user')
      }

      user = new User()
      await user.create('Ali', 'Smith', 'efg@gmail.com', 'user')
      user = new User()
      await user.create('Veli', 'Tepeli', 'veli@gmail.com', 'user')
      user = new User()
      await user.create('Justin', 'Thunderclaps', 'thunderdome@hotmail.com', 'user')
      user = new User()
      await user.create('Tim', 'John', 'jt23@hotmail.com', 'user')
      user = new User()
      await user.create('Obladi', 'Oblada', 'apple@smith.com', 'user')
      user = new User()
      await user.create('Smith', 'Jones', 'jones.smith@icloud.com', 'user')
    } catch (ex) {
      console.log(ex)
      actualException = ex
    }

    expect(expectedException).toEqual(actualException)
    const results = await UserCollection.findWithPagination<{
      _id: ObjectId
      email: string
      fullName: string
    }>({
      filter: searchText,
      projectionKeyOrList: ['email', 'fullName', '_id', 'firstName', 'lastName'],
    })

    expect(expectedSearchResults).toBe(results.total)
    expect(results.data).toHaveLength(expectedSearchResults)
    expect((results.data[0] as any).password).toBeUndefined()
    expect((results.data[0] as any).colors).toBeUndefined()
    expect((results.data[0] as any).firstName).toBe('Smith')
    expect(results.data[0]._id).toBeDefined()
    expect(results.data[0].fullName).toBe('Smith Jones')
    expect(results.data[0].email).toBe('jones.smith@icloud.com')
  })

  test('should find with pagination and aggregate query and text index', async () => {
    const expectedException = null
    let actualException = null
    const expectedRecordCount = 20
    const searchText = 'smith'
    const expectedSearchResults = 3

    await UserCollection.createIndexes()

    try {
      let user = new User()
      for (let i = 0; i < expectedRecordCount; i++) {
        user = new User()
        await user.create(`${i}`, `${i}`, `${i}@gmail.com`, 'user')
      }

      user = new User()
      await user.create('Ali', 'Smith', 'efg@gmail.com', 'user')
      user = new User()
      await user.create('Veli', 'Tepeli', 'veli@gmail.com', 'user')
      user = new User()
      await user.create('Justin', 'Thunderclaps', 'thunderdome@hotmail.com', 'user')
      user = new User()
      await user.create('Tim', 'John', 'jt23@hotmail.com', 'user')
      user = new User()
      await user.create('Obladi', 'Oblada', 'apple@smith.com', 'user')
      user = new User()
      await user.create('Smith', 'Jones', 'jones.smith@icloud.com', 'user')
    } catch (ex) {
      actualException = ex
    }
    const aggregateQueryGetter = () => UserCollection.userSearchQuery(searchText)

    expect(expectedException).toEqual(actualException)
    const results = await UserCollection.findWithPagination<{
      _id: ObjectId
      email: string
    }>({}, aggregateQueryGetter)
    expect(expectedSearchResults).toBe(results.total)
    expect(results.data).toHaveLength(expectedSearchResults)
    expect((results.data[0] as any).firstName).toBeUndefined()
    expect(results.data.some((record) => record.email === 'apple@smith.com')).toBeTruthy()
    expect(results.data.some((record) => record.email === 'efg@gmail.com')).toBeTruthy()
    expect(
      results.data.some((record) => record.email === 'jones.smith@icloud.com')
    ).toBeTruthy()
  })

  test('should keep tenant scope, total, and model redaction in one aggregation', async () => {
    const users = UserCollection.collection()
    await users.insertMany([
      {
        tenantId: 'tenant-a',
        email: 'a1@example.com',
        firstName: 'A',
        lastName: 'One',
        role: 'user',
        password: 'tenant-a-secret-1',
        colors: [],
      },
      {
        tenantId: 'tenant-a',
        email: 'a2@example.com',
        firstName: 'A',
        lastName: 'Two',
        role: 'user',
        password: 'tenant-a-secret-2',
        colors: [],
      },
      {
        tenantId: 'tenant-b',
        email: 'b1@example.com',
        firstName: 'B',
        lastName: 'One',
        role: 'user',
        password: 'tenant-b-secret',
        colors: [],
      },
    ] as unknown as User[])
    const aggregate = jest.spyOn(users, 'aggregate')
    const aggregateQueryGetter = () =>
      users.aggregate([
        {
          $project: {
            tenantId: 1,
            email: 1,
            firstName: 1,
            lastName: 1,
            password: 1,
          },
        },
      ]) as unknown as AggregationCursor<{
        _id: ObjectId
        tenantId: string
        email: string
        password: string
      }>

    const results = await UserCollection.findWithPagination<{
      _id: ObjectId
      tenantId: string
      email: string
      password: string
    }>({ limit: 1 }, aggregateQueryGetter, {
      tenantId: 'tenant-a',
    } as unknown as Filter<User>)

    expect(aggregate).toHaveBeenCalledTimes(1)
    expect(results.total).toBe(2)
    expect(results.data).toHaveLength(1)
    expect(results.data[0].tenantId).toBe('tenant-a')
    expect((results.data[0] as any).password).toBeUndefined()
    expect(JSON.stringify(results)).not.toContain('tenant-b-secret')
  })

  test('should reject aggregation stages that can reintroduce unscoped records', async () => {
    const users = UserCollection.collection()
    await users.insertMany([
      {
        tenantId: 'tenant-a',
        email: 'a@example.com',
        firstName: 'A',
        lastName: 'User',
        role: 'user',
        password: 'tenant-a-secret',
        colors: [],
      },
      {
        tenantId: 'tenant-b',
        email: 'b@example.com',
        firstName: 'B',
        lastName: 'User',
        role: 'user',
        password: 'tenant-b-secret',
        colors: [],
      },
    ] as unknown as User[])

    const unsafePipelines: object[][] = [
      [{ $unionWith: { coll: User.collectionName } }],
      [
        {
          $lookup: {
            from: User.collectionName,
            pipeline: [],
            as: 'foreignRecords',
          },
        },
        { $unwind: '$foreignRecords' },
        { $replaceRoot: { newRoot: '$foreignRecords' } },
      ],
      [
        {
          $graphLookup: {
            from: User.collectionName,
            startWith: '$_id',
            connectFromField: '_id',
            connectToField: '_id',
            as: 'foreignRecords',
          },
        },
        { $unwind: '$foreignRecords' },
        { $replaceRoot: { newRoot: '$foreignRecords' } },
      ],
      [{ $facet: { leaked: [{ $unionWith: User.collectionName }] } }],
    ]

    for (const pipeline of unsafePipelines) {
      const cursor = users.aggregate(pipeline)
      const execute = jest.spyOn(cursor, 'toArray')

      await expect(
        UserCollection.findWithPagination(
          {},
          () => cursor as unknown as AggregationCursor<User>,
          { tenantId: 'tenant-a' } as unknown as Filter<User>
        )
      ).rejects.toMatchObject({ code: 'DOCUMENT_VALIDATION_FAILED' })
      expect(execute).not.toHaveBeenCalled()
    }
  })

  test('should reject projection expressions that alias excluded fields', async () => {
    const user = new User()
    await user.create('Private', 'User', 'private@example.com', 'user', 'private-value')
    const aggregationFactory = jest.fn(
      () =>
        UserCollection.collection().aggregate([]) as unknown as AggregationCursor<User>
    )
    const parameters = {
      projectionKeyOrList: { firstName: 1, exposed: '$password' },
    } as unknown as Partial<import('../src').IQueryParameters>

    await expect(UserCollection.findWithPagination(parameters)).rejects.toMatchObject({
      code: 'DOCUMENT_VALIDATION_FAILED',
    })
    await expect(
      UserCollection.findWithPagination<User>(parameters, aggregationFactory)
    ).rejects.toMatchObject({ code: 'DOCUMENT_VALIDATION_FAILED' })
    expect(aggregationFactory).not.toHaveBeenCalled()

    const cursor = UserCollection.collection().aggregate([
      { $project: { leaked: '$password', _id: 1 } },
    ]) as unknown as AggregationCursor<User>
    const execute = jest.spyOn(cursor, 'toArray')
    await expect(
      UserCollection.findWithPagination<User>({}, () => cursor)
    ).rejects.toMatchObject({ code: 'DOCUMENT_VALIDATION_FAILED' })
    expect(execute).not.toHaveBeenCalled()
  })

  test('should fail closed when safe pagination projects out identity', async () => {
    const user = new User()
    await user.create('Projected', 'User', 'projected@example.com', 'user')
    const projection = { _id: 0, email: 1 } as const

    await expect(
      UserCollection.findWithPagination({ projectionKeyOrList: projection })
    ).rejects.toMatchObject({ code: 'DOCUMENT_INVALID_HYDRATION' })

    const raw = await UserCollection.findWithPagination<{
      email: string
      _id: ObjectId
    }>({ projectionKeyOrList: projection, rawOutput: true })
    expect(raw.data).toHaveLength(1)
    expect(raw.data[0].email).toBe('projected@example.com')
    expect((raw.data[0] as any)._id).toBeUndefined()
  })

  test('should reject undefined mandatory scope with ignoreUndefined enabled', async () => {
    await close()
    await connect({ uri, mongoClientOptions: { ignoreUndefined: true } })
    const users = UserCollection.collection()
    await users.insertMany([
      {
        tenantId: 'tenant-a',
        email: 'a@example.com',
        firstName: 'A',
        lastName: 'User',
        role: 'user',
        colors: [],
      },
      {
        tenantId: 'tenant-b',
        email: 'b@example.com',
        firstName: 'B',
        lastName: 'User',
        role: 'user',
        colors: [],
      },
    ] as unknown as User[])
    const unsafeScope = { tenantId: undefined } as unknown as Filter<User>

    await expect(
      UserCollection.findWithPagination({}, undefined, unsafeScope)
    ).rejects.toMatchObject({ code: 'DOCUMENT_VALIDATION_FAILED' })

    const cursor = users.aggregate([]) as unknown as AggregationCursor<User>
    const execute = jest.spyOn(cursor, 'toArray')
    await expect(
      UserCollection.findWithPagination<User>({}, () => cursor, unsafeScope)
    ).rejects.toMatchObject({ code: 'DOCUMENT_VALIDATION_FAILED' })
    expect(execute).not.toHaveBeenCalled()
  })

  test('should honor aggregation searchable-property overrides and explicit raw output', async () => {
    const users = UserCollection.collection()
    await users.insertMany([
      {
        tenantId: 'tenant-a',
        email: 'a@example.com',
        firstName: 'A',
        lastName: 'User',
        role: 'user',
        password: 'tenant-a-secret',
        colors: [],
      },
      {
        tenantId: 'tenant-b',
        email: 'b@example.com',
        firstName: 'B',
        lastName: 'User',
        role: 'user',
        password: 'tenant-b-secret',
        colors: [],
      },
    ] as unknown as User[])
    const aggregateQueryGetter = () =>
      users.aggregate([
        {
          $project: {
            tenantId: 1,
            email: 1,
            password: 1,
          },
        },
      ]) as unknown as AggregationCursor<{
        _id: ObjectId
        tenantId: string
        email: string
        password: string
      }>

    const results = await UserCollection.findWithPagination<{
      _id: ObjectId
      tenantId: string
      email: string
      password: string
    }>({ filter: 'tenant-b', rawOutput: true }, aggregateQueryGetter, undefined, [
      'tenantId',
    ])

    expect(results.total).toBe(1)
    expect(results.data).toHaveLength(1)
    expect(results.data[0].tenantId).toBe('tenant-b')
    expect(results.data[0].password).toBe('tenant-b-secret')
  })

  test('should find with pagination using simple find', async () => {
    const expectedException = null
    let actualException = null
    const expectedRecordCount = 20

    try {
      for (let i = 0; i < expectedRecordCount; i++) {
        const user = new User()
        await user.create(`${i}`, `${i}`, `${i}@gmail.com`, 'user')
      }
    } catch (ex) {
      actualException = ex
    }

    expect(expectedException).toEqual(actualException)

    const results = await UserCollection.find<User>({}, null, 10, 10)
    expect(results.data).toHaveLength(10)
    expect(results.data[0].firstName).toBe('10')
  })

  test('should find a user', async () => {
    const expectedFirstName = 'Doguhan'

    const user = new User()
    await user.create(expectedFirstName, 'Uluca', 'duluca@gmail.com', 'user')
    const foundUser = await UserCollection.findOne({ lastName: 'Uluca' })

    expect(expectedFirstName).toEqual(foundUser.firstName)
  })

  test('should find no records', async () => {
    const expectedFirstName = 'Doguhan'

    const user = new User()
    await user.create(expectedFirstName, 'Uluca', 'duluca@gmail.com', 'user')
    const foundUser = await UserCollection.findOne({ lastName: 'asdfasd' })

    expect(foundUser).toBeNull()
  })

  test('should find a user by id', async () => {
    const expectedFirstName = 'Doguhan'

    const user = new User()
    await user.create(expectedFirstName, 'Uluca', 'duluca@gmail.com', 'user')
    const foundUser = await UserCollection.findOne({ lastName: 'Uluca' })

    const foundByIdUser = await UserCollection.findOne({
      _id: foundUser._id,
    })

    expect(expectedFirstName).toEqual(foundByIdUser.firstName)
  })

  test('should find a user by hex id', async () => {
    const expectedFirstName = 'Doguhan'

    const user = new User()
    await user.create(expectedFirstName, 'Uluca', 'duluca@gmail.com', 'user')
    const foundUser = await UserCollection.findOne({ lastName: 'Uluca' })

    const foundByIdUser = await UserCollection.findOne({
      _id: foundUser._id.toHexString() as any,
    })

    expect(expectedFirstName).toEqual(foundByIdUser.firstName)
  })

  test('should find and update a user', async () => {
    const expectedFirstName = 'Master'

    const user = new User()
    await user.create(expectedFirstName, 'Uluca', 'duluca@gmail.com', 'user')

    const updatedUser = await UserCollection.findOneAndUpdate(
      { lastName: 'Uluca' },
      {
        $set: {
          firstName: 'Master',
        },
      }
    )

    const foundUser = await UserCollection.findOne({ lastName: 'Uluca' })

    expect(expectedFirstName).toEqual(updatedUser.firstName)
    expect(expectedFirstName).toEqual(foundUser.firstName)
  })

  test('should find a user with fullName', async () => {
    const expectedFullName = 'Doguhan Uluca'

    const user = new User()
    await user.create('Doguhan', 'Uluca', 'duluca@gmail.com', 'user')
    const foundUser = await UserCollection.findOne({ lastName: 'Uluca' })

    expect(expectedFullName).toEqual(foundUser.fullName)
  })

  test('should find a user with password', async () => {
    const expectedPassword = 'acme'

    const user = new User()
    await user.create('Doguhan', 'Uluca', 'duluca@gmail.com', 'user', 'acme')
    const foundUser = await UserCollection.findOne({ lastName: 'Uluca' })

    expect(foundUser).toBeDefined()

    const isMatch = await foundUser.comparePassword(expectedPassword)

    expect(isMatch).toBeTruthy()
  })

  test('should update user', async () => {
    const expectedFirstName = 'Blehamy'

    const user = new User()
    await user.create('Doguhan', 'Uluca', 'duluca@gmail.com', 'user')
    const foundUser = await UserCollection.findOne({ lastName: 'Uluca' })

    const foundByIdUser = await UserCollection.findOne({
      _id: foundUser._id,
    })

    foundByIdUser.firstName = 'Blehamy'

    const result = await foundByIdUser.save()

    expect(result).toBeTruthy()
    expect(expectedFirstName).toEqual(foundByIdUser.firstName)
  })

  test('should return truthy when saving user with no changes', async () => {
    const user = new User()
    await user.create('Doguhan', 'Uluca', 'duluca@gmail.com', 'user')
    const foundUser = await UserCollection.findOne({ lastName: 'Uluca' })

    const foundByIdUser = await UserCollection.findOne({
      _id: foundUser._id,
    })

    const result = await foundByIdUser.save()

    expect(result).toBeTruthy()
  })
})
