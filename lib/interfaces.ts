import { Collection, ObjectID } from 'mongodb'

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
  (): Collection
}

export interface IDocument {
  _id: ObjectID,
  collectionName: string
}

export interface IPaginationResult<TDocument extends IDocument> {
  data: TDocument[],
  total: number
}