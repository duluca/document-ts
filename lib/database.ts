'use strict'

import { readFileSync } from 'fs'
import { MongoClient, MongoClientOptions, Db } from 'mongodb'

let dbInstance: Db

export async function connect(
  mongoUri: string,
  isProduction: boolean = false,
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

  dbInstance = await MongoClient.connect(mongoUri, mongoOptions)
}

export function getDbInstance(): Db {
  if(!dbInstance) {
    throw 'Database is not yet instantiated'
  }
  return dbInstance
}
