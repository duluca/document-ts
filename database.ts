'use strict'

import * as fs from 'fs'
import { MongoClient, MongoClientOptions, Db } from 'mongodb'

let dbInstance: Db

export async function connect(
  mongoUri: string,
  isProduction: boolean = false,
  certFileUri?: string) {
  console.log('Connecting to db...')

  let mongoOptions: MongoClientOptions = {}

  if(certFileUri) {
    let certFileBuf = [fs.readFileSync(certFileUri)]

    mongoOptions = {
      mongos: {
        ssl: true,
        sslValidate: true,
        sslCA: certFileBuf,
        poolSize: 1
      }
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
