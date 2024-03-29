import { AggregationCursor, Filter, FindOptions, CountDocumentsOptions, UpdateFilter, FindCursor, Sort, SortDirection, FindOneAndUpdateOptions } from 'mongodb';
import { Func, ICollectionProvider, IDbRecord, IDocument, IFilter, IPaginationResult, IQueryParameters } from './interfaces';
import { ISerializable } from './serializer';
export declare abstract class CollectionFactory<TDocument extends IDocument & ISerializable> {
    collectionName: string;
    private documentType;
    searchableProperties: string[];
    constructor(collectionName: string, documentType: any, searchableProperties?: string[]);
    sanitizeId(filter: IFilter): void;
    get collection(): ICollectionProvider<TDocument>;
    aggregate(pipeline: object[]): AggregationCursor<TDocument>;
    findOne(filter: Filter<TDocument>, options?: FindOptions): Promise<TDocument | null>;
    findOneAndUpdate(filter: Filter<TDocument>, update: TDocument | UpdateFilter<TDocument>, options?: FindOneAndUpdateOptions): Promise<TDocument | null>;
    findWithPagination<TReturnType extends IDbRecord>(queryParams: Partial<IQueryParameters> & object, aggregationCursorFunc?: Func<AggregationCursor<TReturnType>>, query?: string | object, searchableProperties?: string[], hydrate?: boolean, debugQuery?: boolean): Promise<IPaginationResult<TReturnType>>;
    private buildCursor;
    private findCursorStrategy;
    private aggregationCursorStrategy;
    getTotal(aggregationCursor?: AggregationCursor, builtQuery?: {}): Promise<number>;
    getQuery(query: string | object | undefined, searchableProperties: string[]): object;
    getCursor<TReturnType>(builtQuery: object, projection: object): FindCursor<TReturnType>;
    fieldsArrayToObject(fields: string[]): object;
    find<TReturnType extends IDbRecord>(query: Filter<TDocument>, options?: FindOptions, skip?: number, limit?: number, hydrate?: boolean, debugQuery?: boolean): Promise<IPaginationResult<TReturnType>>;
    hydrateObject(document: unknown): TDocument & ISerializable;
    count(query: Filter<TDocument>, options?: CountDocumentsOptions): Promise<number>;
    private tokenize;
    buildTokenizedQueryObject(filter: string, searchableProperties: string[]): object;
    sortKeyToSortTuple(key: string): [string, SortDirection];
    sortKeyOrListToSort(sortKeyOrList: string | string[]): Sort;
    keyToObject(sortKey: string | object, negativeValue: number): object;
    keyOrListToObject(sortKeyOrList: string | object[] | object, negativeValue: number): object[];
    buildQuery<TReturnType>(cursor: FindCursor<TReturnType> | AggregationCursor<TReturnType>, parameters?: IQueryParameters): FindCursor<TReturnType> | AggregationCursor<TReturnType>;
}
