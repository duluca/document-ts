/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { describe, expect, test, beforeEach, afterEach } from '@jest/globals'

import { MongoMemoryServer } from 'mongodb-memory-server'

import { close, connect } from '../src/index'
import { User, UserCollection } from './user'

let mongoServerInstance: MongoMemoryServer
// jasmine.DEFAULT_TIMEOUT_INTERVAL = 10000

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

  test('should get an error when query is null with pagination', async () => {
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

    await expect(UserCollection.findWithPagination<User>(undefined)).rejects.toBeTruthy()
  })
})
