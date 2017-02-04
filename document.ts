import * as mongodb from 'mongodb'
import * as _ from 'lodash'

import { getDbInstance } from './database'

export interface Func<TResult>
{
    (): TResult
}

export interface IQueryParameters {
  filter?: string,
  skip?: number,
  limit?: number,
  sortKeyOrList?: string | Object[] | Object
}

export interface ICollectionProvider {
  (): mongodb.Collection
}

export interface IDocument {
  _id: mongodb.ObjectID,
  collectionName: string
}

export interface IPaginationResult<TDocument extends IDocument> {
  data: TDocument[],
  total: number
}

export function DocumentException(message: string) {
  this.message = message
  this.name = 'DocumentException'
}

const defaultExcludes = [ 'collectionName', 'includes', 'excludes' ]

export abstract class Document<TDocument extends IDocument> implements IDocument {
  public _id: mongodb.ObjectID

  constructor(public collectionName: string, document?: TDocument) {
    if(document) {
      this.fillData(document)
    }
  }

  protected abstract getCalculatedPropertiesToInclude(): string []

  protected abstract getPropertiesToExclude(): string []

  protected get collection(): mongodb.Collection {
    return getDbInstance().collection(this.collectionName)
  }

  protected fillData(data) {
     Object.keys(data).forEach((key) => { this[key] = data[key];})
  }

  private hasObjectId(): Boolean {
    if(this._id && this._id.generationTime) {
      return mongodb.ObjectID.isValid(this._id.generationTime)
    }

    return false
  }

  async save(options?: mongodb.CollectionInsertOneOptions | mongodb.ReplaceOneOptions):
    Promise<boolean> {
    if(!this.hasObjectId()) {
      let result = await this.collection.insertOne(this, options)
      if(result.insertedCount > 0) {
        this.fillData(result.ops[0])
      }
      return result.insertedCount == 1
    }
    else {
      let result = await this.collection.updateOne({ _id: this._id }, this, options)
      return result.modifiedCount == 1
    }
  }

  delete(): Promise<mongodb.DeleteWriteOpResultObject> {
    let document = this
    let collection = this.collection
    return collection.deleteOne({ _id: document._id })
  }

  private fieldsToSerialize() {
    let document = this

    let excludes = defaultExcludes.concat(document.getPropertiesToExclude())
    let includes = document.getCalculatedPropertiesToInclude()

    let keys = _.remove(Object.keys(document), function(key) {
        return !_.includes(excludes, key)
    })
    return keys.concat(includes)
  }

  toJSON() {
    return serialize(this, this.fieldsToSerialize())
  }
}

export function serialize(document, keys?: string[]) {
  if(!keys && document && typeof document.toJSON === 'function') {
    return document.toJSON()
  } else if(!keys) {
    return {}
  }
    keys = _.uniq(keys)
    let serializationTarget = {}
    for(let key of keys) {
      let child = document[key]

      if(child && typeof child.toJSON === 'function') {
        serializationTarget[key]  = child.toJSON()
      } else if (Array.isArray(child)) {
        serializationTarget[key]  = []
        for(let cc of child) {
          if(typeof cc === 'object') {
            serializationTarget[key].push(serialize(cc))
          } else {
            serializationTarget[key].push(cc)
          }
        }
      } else {
        serializationTarget[key]  = child
      }
    }
    return serializationTarget
}

