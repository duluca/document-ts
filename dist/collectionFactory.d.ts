import { AggregationCursor, Cursor, FilterQuery, FindOneAndReplaceOption, FindOneOptions, MongoCountPreferences, UpdateQuery } from 'mongodb';
import { Func, ICollectionProvider, IDbRecord, IDocument, IFilter, IPaginationResult, IQueryParameters } from './interfaces';
export declare abstract class CollectionFactory<TDocument extends IDocument> {
    collectionName: string;
    private documentType;
    searchableProperties: string[];
    constructor(collectionName: string, documentType: any, searchableProperties?: string[]);
    sanitizeId(filter: IFilter): void;
    get collection(): ICollectionProvider<TDocument>;
    aggregate(pipeline: Object[]): AggregationCursor<TDocument>;
    findOne(filter: FilterQuery<TDocument>, options?: FindOneOptions): Promise<TDocument | null>;
    findOneAndUpdate(filter: FilterQuery<TDocument>, update: TDocument | UpdateQuery<TDocument>, options?: FindOneAndReplaceOption): Promise<TDocument | null>;
    findWithPagination<TReturnType extends IDbRecord>(queryParams: Partial<IQueryParameters> & Object, aggregationCursorFunc?: Func<AggregationCursor<TReturnType>>, query?: string | Object, searchableProperties?: string[], hydrate?: boolean, debugQuery?: boolean): Promise<IPaginationResult<TReturnType>>;
    private buildCursor;
    private cursorStrategy;
    private aggregationCursorStrategy;
    getTotal(aggregationCursor?: AggregationCursor, builtQuery?: {}): Promise<number>;
    getQuery(query: string | Object | undefined, searchableProperties: string[]): {};
    getCursor(builtQuery: {}, projection: {}): Cursor<TDocument>;
    fieldsArrayToObject(fields: string[]): Object;
    find<TReturnType extends IDbRecord>(query: FilterQuery<TDocument>, options?: FindOneOptions, skip?: number, limit?: number, hydrate?: boolean, debugQuery?: boolean): Promise<IPaginationResult<TReturnType>>;
    hydrateObject(document: unknown): TDocument | null;
    count(query: FilterQuery<TDocument>, options?: MongoCountPreferences): Promise<number>;
    private tokenize;
    buildTokenizedQueryObject(filter: string, searchableProperties: string[]): Object;
    keyToObject(sortKey: string | Object, negativeValue: number): Object;
    keyOrListToObject(sortKeyOrList: string | Object[] | Object, negativeValue: number): Object[];
    buildQuery<TReturnType>(cursor: Cursor<TDocument> | AggregationCursor<TReturnType>, parameters?: IQueryParameters): Cursor<TDocument> | AggregationCursor<TReturnType>;
}
