import * as mongodb from 'mongodb';
import { IDocument, ICollectionProvider, IPaginationResult, Func, IQueryParameters } from './document';
export declare abstract class CollectionFactory<TDocument extends IDocument> {
    collectionName: string;
    private documentType;
    searchableProperties: string[];
    constructor(collectionName: string, documentType: any, searchableProperties?: string[]);
    sanitizeId(filter: Object): void;
    readonly collection: ICollectionProvider;
    aggregate(pipeline: Object[]): mongodb.AggregationCursor;
    findOne(filter: Object, options?: mongodb.FindOneOptions): Promise<TDocument>;
    findOneAndUpdate(filter: Object, update: Object, options?: mongodb.FindOneAndReplaceOption): Promise<TDocument>;
    findWithPagination(queryParams: Object, aggregationCursor?: Func<mongodb.AggregationCursor>, query?: string | Object, searchableProperties?: string[], hydrate?: boolean): Promise<IPaginationResult<any>>;
    getTotal(aggregationCursor?: mongodb.AggregationCursor, query?: Object): Promise<number>;
    getCursor(query: string | Object, searchableProperties: string[]): mongodb.Cursor;
    fieldsArrayToObject(fields: string[]): Object;
    find(query: Object, fields?: Object, skip?: number, limit?: number, timeout?: number): Promise<TDocument[]>;
    hydrateObject(document: any): TDocument;
    count(query: Object, options?: mongodb.MongoCountPreferences): Promise<number>;
    private tokenize(searchText);
    buildTokenizedQueryObject(filter: string, searchableProperties: string[]): Object;
    buildQueryParameters(query?: any): IQueryParameters;
    sortKeyToObject(sortKey: string | Object): Object;
    sortKeyOrListToObject(sortKeyOrList: string | Object[] | Object): Object[];
    buildQuery(cursor: mongodb.Cursor | mongodb.AggregationCursor, parameters: IQueryParameters): mongodb.Cursor | mongodb.AggregationCursor;
}
