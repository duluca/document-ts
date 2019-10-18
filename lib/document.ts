import {
  CollectionInsertOneOptions,
  DeleteWriteOpResultObject,
  ObjectID,
  ReplaceOneOptions,
} from 'mongodb'

import { getDbInstance } from './database'
import { DocumentException } from './documentException'
import { IDocument } from './interfaces'
import { ISerializable, SerializationStrategy, Serialize } from './serializer'

const defaultExcludes = ['collectionName', 'includes', 'excludes']

export abstract class Document<TDocument extends IDocument>
  implements IDocument, ISerializable {
  public '_id': ObjectID
  [index: string]: any

  constructor(public collectionName: string, document?: Partial<TDocument>) {
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

  protected hydrateInterfaceArray<TInterface extends TObject, TObject extends Object>(
    objectArray: Partial<TInterface>[],
    hydrator: (object: Partial<TInterface>) => TObject,
    objectType: { new (): TObject }
  ): TObject[] {
    if (!objectArray || objectArray.length === 0) {
      return []
    }

    return objectArray.map(e => (e instanceof objectType ? e : hydrator(e)))
  }

  private hasObjectId(): Boolean {
    if (this._id && this._id.generationTime) {
      return ObjectID.isValid(this._id.generationTime)
    }

    return false
  }

  async save(options?: CollectionInsertOneOptions | ReplaceOneOptions): Promise<boolean> {
    try {
      if (!this.hasObjectId()) {
        try {
          let result = await getDbInstance()
            .collection(this.collectionName)
            .insertOne(this, options)

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
          .updateOne({ _id: this._id }, { $set: this }, options)
        return (
          result.modifiedCount == 1 ||
          result.matchedCount == 1 ||
          result.upsertedCount == 1
        )
      }
    } catch (ex) {
      console.error(ex)
      return false
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

    let keys = new Array()
    Object.keys(document).forEach(item => {
      if (!(excludes.indexOf(item) > -1)) {
        keys.push(item)
      }
    })
    return keys.concat(includes)
  }

  toJSON(): Object {
    let fields = this.fieldsToSerialize(
      this.getPropertiesToExclude(),
      this.getCalculatedPropertiesToInclude()
    )
    return Serialize(SerializationStrategy.JSON, this, fields)
  }

  toBSON(): Object {
    let fields = this.fieldsToSerialize(this.getCalculatedPropertiesToInclude())
    return Serialize(SerializationStrategy.BSON, this, fields)
  }
}
