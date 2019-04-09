import { includes as _includes, remove as _remove } from 'lodash'
import {
  CollectionInsertOneOptions,
  DeleteWriteOpResultObject,
  ObjectID,
  ReplaceOneOptions,
} from 'mongodb'

import { getDbInstance } from './database'
import { DocumentException } from './documentException'
import { IDocument } from './interfaces'
import { ISerializable, serializationStrategy, serialize } from './serializer'

const defaultExcludes = ['collectionName', 'includes', 'excludes']

export abstract class Document<TDocument extends IDocument>
  implements IDocument, ISerializable {
  public '_id': ObjectID
  [index: string]: any

  constructor(public collectionName: string, document?: TDocument) {
    if (document) {
      this.fillData(document)
    }
  }

  protected abstract getCalculatedPropertiesToInclude(): string[]

  protected abstract getPropertiesToExclude(): string[]

  protected fillData(data: any) {
    Object.keys(data).forEach(key => {
      this[key] = data[key]
    })
  }

  private hasObjectId(): Boolean {
    if (this._id && this._id.generationTime) {
      return ObjectID.isValid(this._id.generationTime)
    }

    return false
  }

  async save(options?: CollectionInsertOneOptions | ReplaceOneOptions): Promise<boolean> {
    if (!this.hasObjectId()) {
      try {
        let result = await getDbInstance()
          .collection(this.collectionName)
          .insert(this, options)

        if (result.insertedCount > 0) {
          this.fillData(result.ops[0])
        }
        return result.insertedCount == 1
      } catch (ex) {
        console.error(ex)
        throw new DocumentException(ex)
      }
    } else {
      let result = await getDbInstance()
        .collection(this.collectionName)
        .updateOne({ _id: this._id }, this, options)
      return result.modifiedCount == 1
    }
  }

  delete(): Promise<DeleteWriteOpResultObject> {
    let document = this
    let collection = getDbInstance().collection(this.collectionName)
    return collection.deleteOne({ _id: document._id })
  }

  private fieldsToSerialize(excludes: string[] = [], includes: string[] = []) {
    let document = this

    excludes = defaultExcludes.concat(excludes)

    let keys = _remove(Object.keys(document), function(key) {
      return !_includes(excludes, key)
    })
    return keys.concat(includes)
  }

  toJSON(): Object {
    let fields = this.fieldsToSerialize(
      this.getPropertiesToExclude(),
      this.getCalculatedPropertiesToInclude()
    )
    return serialize(serializationStrategy.toJSON, this, fields)
  }

  toBSON(): Object {
    let fields = this.fieldsToSerialize(this.getCalculatedPropertiesToInclude())
    return serialize(serializationStrategy.toBSON, this, fields)
  }
}
