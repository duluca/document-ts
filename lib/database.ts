'use strict'

import { readFileSync } from 'fs'
import { MongoClient, MongoClientOptions, Db } from 'mongodb'

let dbInstance: Db

export async function connect(
  mongoUri: string,
  isProduction = false,
  connectionRetryWait = 5,
  connectionRetryMax = 10,
  certFileUri?: string) {

  let mongoOptions: MongoClientOptions = {}

  if(certFileUri) {
    let certFileBuf = [readFileSync(certFileUri)]

    mongoOptions = {
      ssl: true,
      sslValidate: true,
      sslCA: certFileBuf,
      poolSize: 1
    }
  }

  if(isProduction === false) {
    mongoOptions = {}
  }

  let retryAttempt = 0
  let lastException

  while(retryAttempt < connectionRetryMax && !dbInstance) {
    try {
      dbInstance = await MongoClient.connect(mongoUri, mongoOptions)
    } catch(ex) {
      retryAttempt++
      lastException = ex
      console.log(ex.message)
      console.log(`${retryAttempt}: Retrying in ${connectionRetryWait}s...`)
      await sleep(connectionRetryWait)
    }
  }

  if(!dbInstance) {
    throw lastException
  }
}

function sleep(seconds: number) {
  return new Promise(resolve => setTimeout(resolve, seconds * 1000));
}

export function getDbInstance(): Db {
  if(!dbInstance) {
    throw 'Database is not yet instantiated'
  }
  return dbInstance
}
