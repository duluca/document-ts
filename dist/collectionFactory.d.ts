import { AggregationCursor, Cursor, FindOneAndReplaceOption, FindOneOptions, MongoCountPreferences } from 'mongodb';
import { Func, ICollectionProvider, IDbRecord, IDocument, IFilter, IPaginationResult, IQueryParameters } from './interfaces';
export declare abstract class CollectionFactory<TDocument extends IDocument> {
    collectionName: string;
    private documentType;
    searchableProperties: string[];
    constructor(collectionName: string, documentType: any, searchableProperties?: string[]);
    sanitizeId(filter: IFilter): void;
    readonly collection: ICollectionProvider<TDocument>;
    aggregate(pipeline: Object[]): AggregationCursor<TDocument>;
    protected readonly undefinedObject: TDocument;
    findOne(filter: IFilter, options?: FindOneOptions): Promise<TDocument>;
    findOneAndUpdate(filter: IFilter, update: Object, options?: FindOneAndReplaceOption): Promise<TDocument>;
    findWithPagination<TReturnType extends IDbRecord>(queryParams: Partial<IQueryParameters> & Object, aggregationCursorFunc?: Func<AggregationCursor<TReturnType>>, query?: string | Object, searchableProperties?: string[], hydrate?: boolean): Promise<IPaginationResult<TReturnType>>;
    private buildCursor;
    private cursorStrategy;
    private aggregationCursorStrategy;
    getTotal(aggregationCursor?: AggregationCursor, query?: {}): Promise<number>;
    getCursor(query: string | Object, searchableProperties: string[]): Cursor<TDocument>;
    fieldsArrayToObject(fields: string[]): Object;
    find(query: Object, fields?: Object, skip?: number, limit?: number): Promise<TDocument[]>;
    hydrateObject(document: any): TDocument | undefined;
    count(query: Object, options?: MongoCountPreferences): Promise<number>;
    private tokenize;
    buildTokenizedQueryObject(filter: string, searchableProperties: string[]): Object;
    sortKeyToObject(sortKey: string | Object): Object;
    sortKeyOrListToObject(sortKeyOrList: string | Object[] | Object): Object[];
    buildQuery<TReturnType>(cursor: Cursor<TDocument> | AggregationCursor<TReturnType>, parameters?: IQueryParameters): Cursor<TDocument> | AggregationCursor<TReturnType>;
}
