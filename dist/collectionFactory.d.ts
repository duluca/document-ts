import { AggregationCursor, Cursor, FindOneOptions, FindOneAndReplaceOption, MongoCountPreferences } from 'mongodb';
import { ICollectionProvider, IFilter, IDocument, Func, IPaginationResult, IQueryParameters } from './interfaces';
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
    findWithPagination(queryParams: Object, aggregationCursor?: Func<AggregationCursor<TDocument>>, query?: string | Object, searchableProperties?: string[], hydrate?: boolean): Promise<IPaginationResult<any>>;
    getTotal(aggregationCursor?: AggregationCursor<TDocument>, query?: {}): Promise<number>;
    getCursor(query: string | Object, searchableProperties: string[]): Cursor<TDocument>;
    fieldsArrayToObject(fields: string[]): Object;
    find(query: Object, fields?: Object, skip?: number, limit?: number, timeout?: number): Promise<TDocument[]>;
    hydrateObject(document: TDocument | undefined): TDocument | undefined;
    count(query: Object, options?: MongoCountPreferences): Promise<number>;
    private tokenize;
    buildTokenizedQueryObject(filter: string, searchableProperties: string[]): Object;
    buildQueryParameters(query?: any): IQueryParameters | undefined;
    sortKeyToObject(sortKey: string | Object): Object;
    sortKeyOrListToObject(sortKeyOrList: string | Object[] | Object): Object[];
    buildQuery(cursor: Cursor<TDocument> | AggregationCursor<TDocument>, parameters?: IQueryParameters): Cursor<TDocument> | AggregationCursor<TDocument>;
}
