import { InsertOneOptions, DeleteResult, ObjectId, UpdateOptions } from 'mongodb'

import { getDbInstance } from './database'
import { DocumentException } from './documentException'
import { IDocument } from './interfaces'
import { ISerializable, SerializationStrategy, Serialize } from './serializer'

const defaultExcludes = ['collectionName', 'includes', 'excludes']

export abstract class Document<TDocument extends IDocument>
  implements IDocument, ISerializable
{
  // tslint:disable-next-line: semicolon
  public '_id': ObjectId;
  [index: string]: unknown

  constructor(public collectionName: string, document?: Partial<TDocument>) {
    if (document) {
      this.fillData(document)
    }
  }

  protected abstract getCalculatedPropertiesToInclude(): string[]

  protected abstract getPropertiesToExclude(): string[]

  protected abstract fillData(data?: Partial<TDocument>): void

  protected hydrateInterface<TInterface extends TObject, TObject extends object>(
    objectType: new () => TObject,
    hydrator: (data: Partial<TInterface>) => TObject,
    element: Partial<TInterface>
  ) {
    return element instanceof objectType ? element : hydrator(element)
  }

  protected hydrateInterfaceArray<TInterface extends TObject, TObject extends object>(
    objectType: new () => TObject,
    hydrator: (data: Partial<TInterface>) => TObject,
    objectArray: Partial<TInterface>[]
  ): TObject[] | undefined {
    if (!objectArray || objectArray.length === 0) {
      return undefined
    }
    return objectArray.map((e) => this.hydrateInterface(objectType, hydrator, e))
  }

  private hasObjectId(): boolean {
    if (this._id && this._id.getTimestamp()) {
      return ObjectId.isValid(this._id)
    }

    return false
  }

  async save(options?: InsertOneOptions | UpdateOptions): Promise<boolean> {
    try {
      if (!this.hasObjectId()) {
        try {
          const result = await getDbInstance()
            .collection(this.collectionName)
            .insertOne(this, options)

          if (result.acknowledged) {
            this._id = result.insertedId
          }
          return result.acknowledged
        } catch (ex: unknown) {
          console.error(ex instanceof Error ? ex.message : ex)

          if (ex instanceof Error || typeof ex === 'string') {
            throw new DocumentException(ex)
          }
          return false
        }
      } else {
        const result = await getDbInstance()
          .collection(this.collectionName)
          .updateOne({ _id: this._id }, { $set: this }, options)
        return (
          result.modifiedCount === 1 ||
          result.matchedCount === 1 ||
          result.upsertedCount === 1
        )
      }
    } catch (ex) {
      console.error(ex)
      return false
    }
  }

  delete(): Promise<DeleteResult> {
    const collection = getDbInstance().collection(this.collectionName)
    return collection.deleteOne({ _id: this._id })
  }

  private fieldsToSerialize(excludes: string[] = [], includes: string[] = []) {
    excludes = defaultExcludes.concat(excludes)

    const keys: string[] = []
    Object.keys(this).forEach((item) => {
      if (!(excludes.indexOf(item) > -1)) {
        keys.push(item)
      }
    })
    return keys.concat(includes)
  }

  toJSON(): object {
    const fields = this.fieldsToSerialize(
      this.getPropertiesToExclude(),
      this.getCalculatedPropertiesToInclude()
    )
    return Serialize(SerializationStrategy.JSON, this, fields)
  }

  toBSON(): object {
    const fields = this.fieldsToSerialize(this.getCalculatedPropertiesToInclude())
    return Serialize(SerializationStrategy.BSON, this, fields)
  }
}
