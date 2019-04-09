'use strict'

import MongoMemoryServer from 'mongodb-memory-server'

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

    let isMatch = await foundUser.comparePassword(expectedPassword)

    expect(isMatch).toBeTruthy()
  })
})
