'use strict'

import { ObjectID } from 'mongodb'
import { MongoMemoryServer } from 'mongodb-memory-server'

import { close, connect } from '../dist/index'
import { User, UserCollection } from './user'

let mongoServerInstance: MongoMemoryServer
jasmine.DEFAULT_TIMEOUT_INTERVAL = 10000

describe('Document', function() {
  beforeEach(async () => {
    mongoServerInstance = new MongoMemoryServer({ instance: { dbName: 'testDb' } })
    const uri = await mongoServerInstance.getConnectionString()
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
      let user = new User()
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
        let user = new User()
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
        let user = new User()
        await user.create(`${i}`, `${i}`, `${i}@gmail.com`, 'user')
      }

      for (let i = 0; i < 5; i++) {
        let foundUser = await UserCollection.findOne({ lastName: `${i}` })
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
      let user = new User()
      await user.create('Doguhan', 'Uluca', 'duluca@gmail.com', 'user')
    } catch (ex) {
      actualException = ex
    }

    expect(expectedException).toEqual(actualException)
  })

  it('should find with pagination', async () => {
    const expectedException = null
    let actualException = null
    const expectedRecordCount = 20

    try {
      for (let i = 0; i < expectedRecordCount; i++) {
        let user = new User()
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

  it('should find with pagination and aggregate query', async () => {
    const expectedException = null
    let actualException = null
    const expectedRecordCount = 20

    try {
      for (let i = 0; i < expectedRecordCount; i++) {
        let user = new User()
        await user.create(`${i}`, `${i}`, `${i}@gmail.com`, 'user')
      }
    } catch (ex) {
      actualException = ex
    }

    const aggregateQueryGetter = () => UserCollection.userSearchQuery('')

    expect(expectedException).toEqual(actualException)
    const results = await UserCollection.findWithPagination<{
      _id: ObjectID
      email: string
    }>({ skip: 10, limit: 10 }, aggregateQueryGetter)
    expect(expectedRecordCount).toBe(results.total)
    expect(results.data.length).toBe(10)
    expect(results.data[0].email).toBe('10@gmail.com')
    expect((results.data[0] as any).firstName).toBeUndefined()
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
      _id: ObjectID
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
        let user = new User()
        await user.create(`${i}`, `${i}`, `${i}@gmail.com`, 'user')
      }
    } catch (ex) {
      actualException = ex
    }

    expect(expectedException).toEqual(actualException)

    const results = await UserCollection.find({}, null, 10, 10)
    expect(results.length).toBe(10)
    expect(results[0].firstName).toBe('10')
  })

  it('should find a user', async () => {
    const expectedFirstName = 'Doguhan'

    let user = new User()
    await user.create(expectedFirstName, 'Uluca', 'duluca@gmail.com', 'user')
    let foundUser = await UserCollection.findOne({ lastName: 'Uluca' })

    expect(expectedFirstName).toEqual(foundUser.firstName)
  })

  it('should find a user with fullName', async () => {
    const expectedFullName = 'Doguhan Uluca'

    let user = new User()
    await user.create('Doguhan', 'Uluca', 'duluca@gmail.com', 'user')
    let foundUser = await UserCollection.findOne({ lastName: 'Uluca' })

    expect(expectedFullName).toEqual(foundUser.fullName)
  })

  it('should find a user with password', async () => {
    const expectedPassword = 'acme'

    let user = new User()
    await user.create('Doguhan', 'Uluca', 'duluca@gmail.com', 'user', 'acme')
    let foundUser = await UserCollection.findOne({ lastName: 'Uluca' })

    expect(foundUser).toBeDefined()

    let isMatch = await foundUser.comparePassword(expectedPassword)

    expect(isMatch).toBeTruthy()
  })
})
