import { Collection, ObjectID } from 'mongodb';
export interface IDbRecord {
    _id: ObjectID;
}
export interface IDocument extends IDbRecord {
    _id: ObjectID;
    collectionName: string;
}
export interface ICollectionProvider<TDocument extends IDocument> {
    (): Collection<TDocument>;
}
export interface Func<TResult> {
    (): TResult;
}
export interface IQueryParameters {
    filter?: string;
    skip?: number;
    limit?: number;
    sortKeyOrList?: string | Object[] | Object;
    order?: string;
}
export interface IPaginationResult<TDocument extends IDocument | Object> {
    data: (TDocument | undefined)[];
    total: number;
}
export interface IFilter {
    [index: string]: any;
}
