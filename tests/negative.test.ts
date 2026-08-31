/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { describe, expect, test, beforeEach, afterEach } from '@jest/globals'

import { close, connect, getDbInstance } from '../src/index'
import { testMongoUri } from './mongoTest'
import { User, UserCollection } from './user'

const uri = testMongoUri('negative')

describe('Document', () => {
  beforeEach(async () => {
    await close()
    await connect({ uri })
    await getDbInstance().dropDatabase()
  })

  afterEach(async () => {
    await close()
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
