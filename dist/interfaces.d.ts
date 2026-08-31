import { Collection, FindOptions, ObjectId, Sort, WithId } from 'mongodb';
import { ISerializable } from './serializer';
export interface IDbRecord extends WithId<object> {
    _id: ObjectId;
}
export interface IDocument extends IDbRecord {
    readonly _id: ObjectId;
    readonly collectionName: string;
}
export type ICollectionProvider<TDocument extends IDocument | ISerializable> = () => Collection<TDocument>;
export type Func<TResult> = () => TResult;
export interface IQueryParameters {
    filter?: string | undefined;
    skip?: number | undefined;
    limit?: number | undefined;
    sortKeyOrList?: string | string[];
    mongoSortOverride?: Sort | undefined;
    projectionKeyOrList?: IProjectionInput | undefined;
    rawOutput?: boolean | undefined;
    debugQuery?: boolean | undefined;
    maxTimeMS?: number | undefined;
}
export type IProjectionValue = 0 | 1;
export type IProjectionInput = string | string[] | Record<string, IProjectionValue> | Array<string | Record<string, IProjectionValue>>;
export interface IFindOptions extends Omit<FindOptions, 'projection'> {
    projection?: Record<string, IProjectionValue> | undefined;
    rawOutput?: boolean | undefined;
    debugQuery?: boolean | undefined;
}
export interface IPaginationResult<TDocument extends IDocument | object> {
    data: TDocument[];
    total: number;
}
export interface IFilter {
    [index: string]: unknown;
}
