import { ObjectId } from 'mongodb'
import { MongoMemoryServer } from 'mongodb-memory-server'

import { close, connect } from '../src/index'
import { IUser, User, UserCollection } from './user'

let mongoServerInstance: MongoMemoryServer
jasmine.DEFAULT_TIMEOUT_INTERVAL = 10000

describe('Document', () => {
  beforeEach(async () => {
    mongoServerInstance = await MongoMemoryServer.create({
      instance: { dbName: 'testDb' },
    })
    const uri = mongoServerInstance.getUri()
    await connect(uri)
  })

  afterEach(async () => {
    await close()
    await mongoServerInstance.stop()
  })

  it('should store a user', async () => {
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

  it('should store multiple users', async () => {
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

  it('should hydrate multiple users', async () => {
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

  it('should store a user', async () => {
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

  it('should overwrite record with same id', async () => {
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

  it('should fail to store two users with same email (unique index)', async () => {
    const expectedResult = false
    let actualResult = true

    await UserCollection.createIndexes()

    spyOn(console, 'error')

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
    actualResult = await user1.save()

    expect(actualResult).toEqual(expectedResult)
    expect(console.error).toHaveBeenCalledTimes(2)
  })

  it('should create a user with array values', async () => {
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

  it('should save a user with array values', async () => {
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

  it('should find with pagination given string skip and limit', async () => {
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

    const dynamicInput: any = '10'

    const results = await UserCollection.findWithPagination<User>({
      skip: dynamicInput,
      limit: dynamicInput,
    })
    expect(expectedRecordCount).toBe(results.total)
    expect(results.data.length).toBe(10)
    expect(results.data[0].firstName).toBe('10')
  })

  it('should find with pagination', async () => {
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
    expect(results.data.length).toBe(10)
    expect(results.data[0].firstName).toBe('10')
  })

  it('should find with pagination and sort', async () => {
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
    expect(results.data.length).toBe(20)
    expect(results.data[0].firstName).toBe('0')
  })

  it('should find with pagination and sort desc', async () => {
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
    expect(results.data.length).toBe(20)
    expect(results.data[0].firstName).toBe('9')
  })

  it('should find with pagination and aggregate query asc', async () => {
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
    expect(results.data.length).toBe(10)
    expect(results.data[0].email).toBe('10@gmail.com')
    expect((results.data[0] as any).firstName).toBeUndefined()
  })

  it('should find with pagination and aggregate query desc', async () => {
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
    expect(results.data.length).toBe(10)
    expect(results.data[0].email).toBe('10@gmail.com')
    expect((results.data[0] as any).firstName).toBeUndefined()
  })

  it('should find with pagination and query filter and text index', async () => {
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
    expect(results.data.length).toBe(expectedSearchResults)
    expect((results.data[0] as any).password).toBeUndefined()
    expect((results.data[0] as any).colors).toBeUndefined()
    expect((results.data[0] as any).firstName).toBe('Smith')
    expect(results.data[0]._id).toBeDefined()
    expect(results.data[0].fullName).toBe('Smith Jones')
    expect(results.data[0].email).toBe('jones.smith@icloud.com')
  })

  it('should find with pagination and aggregate query and text index', async () => {
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
    expect(results.data.length).toBe(expectedSearchResults)
    expect((results.data[0] as any).firstName).toBeUndefined()
    expect(results.data[0].email).toBe('apple@smith.com')
  })

  it('should find with pagination using simple find', async () => {
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
    expect(results.data.length).toBe(10)
    expect(results.data[0].firstName).toBe('10')
  })

  it('should find a user', async () => {
    const expectedFirstName = 'Doguhan'

    const user = new User()
    await user.create(expectedFirstName, 'Uluca', 'duluca@gmail.com', 'user')
    const foundUser = await UserCollection.findOne({ lastName: 'Uluca' })

    expect(expectedFirstName).toEqual(foundUser.firstName)
  })

  it('should find no records', async () => {
    const expectedFirstName = 'Doguhan'

    const user = new User()
    await user.create(expectedFirstName, 'Uluca', 'duluca@gmail.com', 'user')
    const foundUser = await UserCollection.findOne({ lastName: 'asdfasd' })

    expect(foundUser).toBeNull()
  })

  it('should find a user by id', async () => {
    const expectedFirstName = 'Doguhan'

    const user = new User()
    await user.create(expectedFirstName, 'Uluca', 'duluca@gmail.com', 'user')
    const foundUser = await UserCollection.findOne({ lastName: 'Uluca' })

    const foundByIdUser = await UserCollection.findOne({
      _id: foundUser._id,
    })

    expect(expectedFirstName).toEqual(foundByIdUser.firstName)
  })

  it('should find a user by hex id', async () => {
    const expectedFirstName = 'Doguhan'

    const user = new User()
    await user.create(expectedFirstName, 'Uluca', 'duluca@gmail.com', 'user')
    const foundUser = await UserCollection.findOne({ lastName: 'Uluca' })

    const foundByIdUser = await UserCollection.findOne({
      _id: foundUser._id.toHexString() as any,
    })

    expect(expectedFirstName).toEqual(foundByIdUser.firstName)
  })

  it('should find and update a user', async () => {
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

  it('should find a user with fullName', async () => {
    const expectedFullName = 'Doguhan Uluca'

    const user = new User()
    await user.create('Doguhan', 'Uluca', 'duluca@gmail.com', 'user')
    const foundUser = await UserCollection.findOne({ lastName: 'Uluca' })

    expect(expectedFullName).toEqual(foundUser.fullName)
  })

  it('should find a user with password', async () => {
    const expectedPassword = 'acme'

    const user = new User()
    await user.create('Doguhan', 'Uluca', 'duluca@gmail.com', 'user', 'acme')
    const foundUser = await UserCollection.findOne({ lastName: 'Uluca' })

    expect(foundUser).toBeDefined()

    const isMatch = await foundUser.comparePassword(expectedPassword)

    expect(isMatch).toBeTruthy()
  })

  it('should update user', async () => {
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

  it('should return truthy when saving user with no changes', async () => {
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
