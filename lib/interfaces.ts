import { Collection, ObjectID } from 'mongodb'

export interface IDbRecord {
  _id: ObjectID
}

export interface IDocument extends IDbRecord {
  _id: ObjectID
  collectionName: string
}

export interface ICollectionProvider<TDocument extends IDocument> {
  (): Collection<TDocument>
}

export interface Func<TResult> {
  (): TResult
}

export interface IQueryParameters {
  filter?: string
  skip?: number
  limit?: number
  sortKeyOrList?: string | Object[] | Object
  projectionKeyOrList?: string | Object[] | Object
}

export interface IPaginationResult<TDocument extends IDocument | Object> {
  data: TDocument[]
  total: number
}
export interface IFilter {
  [index: string]: any
}
