/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { jest, describe, expect, test, beforeEach, afterEach } from '@jest/globals'

import { MongoMemoryServer } from 'mongodb-memory-server'

import { close, connect, connectionStatus, getDbInstance } from '../src/index'

let mongoServerInstance: MongoMemoryServer

describe('Database', () => {
  describe('disconnected', () => {
    beforeEach(async () => {
      await close()
      if (mongoServerInstance) {
        await mongoServerInstance.stop()
        mongoServerInstance = null
      }
    })

    test('should throw exception given not instantiated', async () => {
      const expectedException = new Error('Database is not yet instantiated')
      let actualException = null

      try {
        getDbInstance()
      } catch (ex) {
        actualException = ex
      }

      expect(actualException).toEqual(expectedException)
    })

    test('should return connected status false when disconnected', async () => {
      const expectedStatus = false
      let actualStatus = null

      actualStatus = connectionStatus()

      expect(actualStatus).toEqual(expectedStatus)
    })

    test('should retry when unable to connect', async () => {
      let actualException = null

      jest.spyOn(console, 'log')

      try {
        await connect('asdfasdf', true, 0.01, 2, null, {})
      } catch (ex) {
        actualException = ex
      }

      expect(actualException).toBeDefined()
      expect(console.log).toHaveBeenCalledTimes(5)
    })
  })

  describe('connected', () => {
    beforeEach(async () => {
      mongoServerInstance = await MongoMemoryServer.create({
        instance: { dbName: 'testDb' },
      })
    })

    afterEach(async () => {
      await close()
      await mongoServerInstance.stop()
    })

    test('should connect', async () => {
      const expectedException = null
      let actualException = null
      const expectedStatus = true
      let actualStatus = null

      const uri = mongoServerInstance.getUri()
      try {
        await connect(uri)
        actualStatus = connectionStatus()
      } catch (ex) {
        actualException = ex
      }

      expect(actualException).toEqual(expectedException)
      expect(actualStatus).toEqual(expectedStatus)
    })

    test('should fail to connect with invalid cert', async () => {
      const expectedException = new Error(
        "ENOENT: no such file or directory, open 'server/compose-ca.pem'"
      )
      let actualException = null

      const uri = mongoServerInstance.getUri()

      try {
        await connect(uri, true, null, null, 'server/compose-ca.pem')
      } catch (ex) {
        actualException = ex
      }

      expect(actualException.message).toEqual(expectedException.message)
    })

    test('should fail to connect with no cert', async () => {
      const expectedException = null
      let actualException = null

      const uri = mongoServerInstance.getUri()

      try {
        await connect(uri, false, null, null)
      } catch (ex) {
        actualException = ex
      }

      expect(actualException).toEqual(expectedException)
    })
  })
})
