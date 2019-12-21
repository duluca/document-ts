import { Collection, ObjectID } from 'mongodb'

import { ISerializable } from './serializer'

export interface IDbRecord {
  _id: ObjectID
}

export interface IDocument extends IDbRecord {
  _id: ObjectID
  collectionName: string
}

export type ICollectionProvider<
  TDocument extends IDocument | ISerializable
> = () => Collection<TDocument>

export type Func<TResult> = () => TResult

export interface IQueryParameters {
  filter?: string
  skip?: number
  limit?: number
  sortKeyOrList?: string | object[] | object
  projectionKeyOrList?: string | object[] | object
}

export interface IPaginationResult<TDocument extends IDocument | object> {
  data: TDocument[]
  total: number
}
export interface IFilter {
  [index: string]: any
}
