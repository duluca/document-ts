import { AggregationCursor, Cursor, FindOneOptions, FindOneAndReplaceOption, MongoCountPreferences } from 'mongodb';
import { IDocument, ICollectionProvider, IPaginationResult, Func, IQueryParameters } from './interfaces';
export declare abstract class CollectionFactory<TDocument extends IDocument> {
    collectionName: string;
    private documentType;
    searchableProperties: string[];
    constructor(collectionName: string, documentType: any, searchableProperties?: string[]);
    sanitizeId(filter: Object): void;
    readonly collection: ICollectionProvider;
    aggregate<T>(pipeline: Object[]): AggregationCursor<T>;
    protected readonly undefinedObject: TDocument;
    findOne(filter: Object, options?: FindOneOptions): Promise<TDocument>;
    findOneAndUpdate(filter: Object, update: Object, options?: FindOneAndReplaceOption): Promise<TDocument>;
    findWithPagination<T>(queryParams: Object, aggregationCursor?: Func<AggregationCursor<T>>, query?: string | Object, searchableProperties?: string[], hydrate?: boolean): Promise<IPaginationResult<any>>;
    getTotal<T>(aggregationCursor?: AggregationCursor<T>, query?: {}): Promise<number>;
    getCursor<T>(query: string | Object, searchableProperties: string[]): Cursor<T>;
    fieldsArrayToObject(fields: string[]): Object;
    find(query: Object, fields?: Object, skip?: number, limit?: number, timeout?: number): Promise<TDocument[]>;
    hydrateObject(document: any): TDocument | undefined;
    count(query: Object, options?: MongoCountPreferences): Promise<number>;
    private tokenize(searchText);
    buildTokenizedQueryObject(filter: string, searchableProperties: string[]): Object;
    buildQueryParameters(query?: any): IQueryParameters | undefined;
    sortKeyToObject(sortKey: string | Object): Object;
    sortKeyOrListToObject(sortKeyOrList: string | Object[] | Object): Object[];
    buildQuery<T>(cursor: Cursor<T> | AggregationCursor<T>, parameters?: IQueryParameters): Cursor<T> | AggregationCursor<T>;
}
