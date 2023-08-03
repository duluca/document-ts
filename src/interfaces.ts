import { Collection, ObjectId, Sort, WithId } from 'mongodb'

import { ISerializable } from './serializer'

export interface IDbRecord extends WithId<object> {
  _id: ObjectId
}

export interface IDocument extends IDbRecord {
  _id: ObjectId
  collectionName: string
}

export type ICollectionProvider<TDocument extends IDocument | ISerializable> =
  () => Collection<TDocument>

export type Func<TResult> = () => TResult

export interface IQueryParameters {
  filter?: string
  skip?: number | undefined
  limit?: number | undefined
  sortKeyOrList?: string | string[]
  mongoSortOverride?: Sort | undefined
  projectionKeyOrList?: string | object[] | object
}

export interface IPaginationResult<TDocument extends IDocument | object> {
  data: TDocument[]
  total: number
}
export interface IFilter {
  [index: string]: unknown
}
