import { readFileSync } from 'fs'

import { Db, MongoClient, MongoClientOptions } from 'mongodb'

let dbInstance: Db | null
let mongoClient: MongoClient | null

export async function connect(
  mongoUri: string,
  isProduction = false,
  connectionRetryWait = 5,
  connectionRetryMax = 10,
  certFileUri?: string,
  overrideOptions?: MongoClientOptions
) {
  const defaultMongoOptions: MongoClientOptions = {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  }

  let mongoOptions: MongoClientOptions = Object.assign(defaultMongoOptions)

  if (certFileUri) {
    let certFileBuf = [readFileSync(certFileUri)]

    mongoOptions = Object.assign(mongoOptions, {
      ssl: true,
      sslValidate: true,
      sslCA: certFileBuf,
      poolSize: 1,
    })
  }

  if (isProduction === false) {
    mongoOptions = Object.assign(defaultMongoOptions)
  }

  let retryAttempt = 0
  let lastException

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
    } catch (ex) {
      retryAttempt++
      lastException = ex
      console.log(ex.message)
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
    throw new Error(lastException)
  }
}

function sleep(seconds: number) {
  return new Promise(resolve => setTimeout(resolve, seconds * 1000))
}

export async function close(force = false) {
  if (mongoClient) {
    await mongoClient.close(force)
    dbInstance = null
    mongoClient = null
  }
}

export function connectionStatus() {
  if (mongoClient) {
    return mongoClient.isConnected()
  }
  return false
}

export function getDbInstance(): Db {
  if (!dbInstance) {
    throw 'Database is not yet instantiated'
  }
  return dbInstance
}
