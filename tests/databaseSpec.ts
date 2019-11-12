import { MongoMemoryServer } from 'mongodb-memory-server'

import { close, connect, connectionStatus, getDbInstance } from '../lib/index'

let mongoServerInstance: MongoMemoryServer
jasmine.DEFAULT_TIMEOUT_INTERVAL = 10000

describe('Database', () => {
  describe('disconnected', () => {
    beforeEach(async () => {
      await close()
      if (mongoServerInstance) {
        await mongoServerInstance.stop()
        mongoServerInstance = null
      }
    })

    it('should throw exception given not instantiated', async () => {
      const expectedException = new Error('Database is not yet instantiated')
      let actualException = null

      try {
        getDbInstance()
      } catch (ex) {
        actualException = ex
      }

      expect(actualException).toEqual(expectedException)
    })

    it('should return connected status false when disconnected', async () => {
      const expectedStatus = false
      let actualStatus = null

      actualStatus = connectionStatus()

      expect(actualStatus).toEqual(expectedStatus)
    })

    it('should retry when unable to connect', async () => {
      let actualException = null

      spyOn(console, 'log')

      try {
        await connect(
          'asdfasdf',
          true,
          0.01,
          2,
          null,
          {
            numberOfRetries: 0,
            reconnectTries: 0,
            reconnectInterval: 0,
          }
        )
      } catch (ex) {
        actualException = ex
      }

      expect(actualException).toBeDefined()
      expect(console.log).toHaveBeenCalledTimes(4)
    })
  })

  describe('connected', () => {
    beforeEach(() => {
      mongoServerInstance = new MongoMemoryServer({ instance: { dbName: 'testDb' } })
    })

    afterEach(async () => {
      await close()
      await mongoServerInstance.stop()
    })

    it('should connect', async () => {
      const expectedException = null
      let actualException = null
      const expectedStatus = true
      let actualStatus = null

      const uri = await mongoServerInstance.getConnectionString()
      try {
        await connect(uri)
        actualStatus = connectionStatus()
      } catch (ex) {
        actualException = ex
      }

      expect(actualException).toEqual(expectedException)
      expect(actualStatus).toEqual(expectedStatus)
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

      expect(actualException).toEqual(expectedException)
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

      expect(actualException).toEqual(expectedException)
    })
  })
})
