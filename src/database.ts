import { readFileSync } from 'fs'

import { Db, MongoClient, MongoClientOptions, MongoError } from 'mongodb'

let dbInstance: Db | null
let mongoClient: MongoClient | null
let _connectionStatus = false

export async function connect(
  mongoUri: string,
  isProduction = false,
  connectionRetryWait = 5,
  connectionRetryMax = 10,
  certFileUri?: string,
  overrideOptions?: MongoClientOptions
) {
  let mongoOptions: MongoClientOptions = {}
  console.log(`Connecting to database... Prod mode: ${isProduction}.`)

  if (certFileUri) {
    const certFileBuf = [readFileSync(certFileUri)]

    mongoOptions = Object.assign(mongoOptions, {
      ssl: true,
      sslValidate: true,
      sslCA: certFileBuf,
      poolSize: 1,
    })
  }

  let retryAttempt = 0
  let lastException: MongoError | null = null

  if (!connectionRetryMax) {
    connectionRetryMax = 1
  }

  if (overrideOptions) {
    Object.assign(mongoOptions, overrideOptions)
  }

  while (retryAttempt < connectionRetryMax && !dbInstance) {
    try {
      mongoClient = await MongoClient.connect(mongoUri, mongoOptions)
      dbInstance = mongoClient.db()
      _connectionStatus = true
    } catch (ex: unknown) {
      _connectionStatus = false
      retryAttempt++
      if (ex instanceof Error) {
        console.log(ex.message)
      }
      if (ex instanceof MongoError) {
        lastException = ex
      }
      if (connectionRetryWait) {
        console.log(`${retryAttempt}: Retrying in ${connectionRetryWait}s...`)
        await sleep(connectionRetryWait)
      }
    }
  }

  if (!dbInstance) {
    if (!lastException) {
      throw new Error(
        'Unable to connect to the database, please verify that your configuration is correct'
      )
    }
    throw lastException
  }
}

function sleep(seconds: number) {
  return new Promise((resolve) => setTimeout(resolve, seconds * 1000))
}

export async function close(force = false) {
  if (mongoClient) {
    await mongoClient.close(force)
    dbInstance = null
    mongoClient = null
    _connectionStatus = false
  }
}

export function connectionStatus() {
  if (mongoClient) {
    return _connectionStatus
  }
  return false
}

export function getDbInstance(): Db {
  if (!dbInstance) {
    throw new Error('Database is not yet instantiated')
  }
  return dbInstance
}
