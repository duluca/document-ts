'use strict'

import { readFileSync } from 'fs'

import { Db, MongoClient, MongoClientOptions } from 'mongodb'

let dbInstance: Db

export async function connect(
  mongoUri: string,
  isProduction = false,
  connectionRetryWait = 5,
  connectionRetryMax = 10,
  certFileUri?: string
) {
  let mongoOptions: MongoClientOptions = { useNewUrlParser: true }

  if (certFileUri) {
    let certFileBuf = [readFileSync(certFileUri)]

    mongoOptions = {
      ssl: true,
      sslValidate: true,
      sslCA: certFileBuf,
      poolSize: 1,
      useNewUrlParser: true,
    }
  }

  if (isProduction === false) {
    mongoOptions = { useNewUrlParser: true }
  }

  let retryAttempt = 0
  let lastException

  while (retryAttempt < connectionRetryMax && !dbInstance) {
    try {
      const client = await MongoClient.connect(mongoUri, mongoOptions)
      dbInstance = client.db()
    } catch (ex) {
      retryAttempt++
      lastException = ex
      console.log(ex.message)
      console.log(`${retryAttempt}: Retrying in ${connectionRetryWait}s...`)
      await sleep(connectionRetryWait)
    }
  }

  if (!dbInstance) {
    throw lastException
  }
}

function sleep(seconds: number) {
  return new Promise(resolve => setTimeout(resolve, seconds * 1000))
}

export function getDbInstance(): Db {
  if (!dbInstance) {
    throw 'Database is not yet instantiated'
  }
  return dbInstance
}
