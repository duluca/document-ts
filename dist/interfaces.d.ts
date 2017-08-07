import { ObjectID, Collection } from 'mongodb';
export interface IDocument {
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
}
export interface IPaginationResult<TDocument extends IDocument> {
    data: TDocument[];
    total: number;
}
export interface IFilter {
    [index: string]: any;
}
