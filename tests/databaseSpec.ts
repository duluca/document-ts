'use strict'

import { MongoMemoryServer } from 'mongodb-memory-server'

import { close, connect } from '../dist/index'

let mongoServerInstance: MongoMemoryServer
jasmine.DEFAULT_TIMEOUT_INTERVAL = 10000

describe('Database', function() {
  beforeEach(async () => {
    mongoServerInstance = new MongoMemoryServer({ instance: { dbName: 'testDb' } })
  })

  afterEach(async () => {
    await close()
    await mongoServerInstance.stop()
  })

  it('should connect', async () => {
    const expectedException = null
    let actualException = null

    const uri = await mongoServerInstance.getConnectionString()

    try {
      await connect(uri)
    } catch (ex) {
      actualException = ex
    }

    expect(expectedException).toEqual(actualException)
  })

  it('should fail to connect with no cert', async () => {
    const expectedException = new Error(
      "ENOENT: no such file or directory, open 'server/compose-ca.pem'"
    )
    let actualException = null

    const uri = await mongoServerInstance.getConnectionString()

    try {
      await connect(
        uri,
        true,
        null,
        null,
        'server/compose-ca.pem'
      )
    } catch (ex) {
      actualException = ex
    }

    expect(expectedException).toEqual(actualException)
  })

  it('should fail to connect with no cert', async () => {
    const expectedException = null
    let actualException = null

    const uri = await mongoServerInstance.getConnectionString()

    try {
      await connect(
        uri,
        false,
        null,
        null
      )
    } catch (ex) {
      actualException = ex
    }

    expect(expectedException).toEqual(actualException)
  })
})
