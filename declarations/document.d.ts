import * as mongodb from 'mongodb';
export interface Func<TResult> {
    (): TResult;
}
export interface IQueryParameters {
    filter?: string;
    skip?: number;
    limit?: number;
    sortKeyOrList?: string | Object[] | Object;
}
export interface ICollectionProvider {
    (): mongodb.Collection;
}
export interface IDocument {
    _id: mongodb.ObjectID;
    collectionName: string;
}
export interface IPaginationResult<TDocument extends IDocument> {
    data: TDocument[];
    total: number;
}
export declare function DocumentException(message: string): void;
export declare abstract class Document<TDocument extends IDocument> implements IDocument {
    collectionName: string;
    _id: mongodb.ObjectID;
    constructor(collectionName: string, document?: TDocument);
    protected abstract getCalculatedPropertiesToInclude(): string[];
    protected abstract getPropertiesToExclude(): string[];
    protected readonly collection: mongodb.Collection;
    protected fillData(data: any): void;
    private hasObjectId();
    save(options?: mongodb.CollectionInsertOneOptions | mongodb.ReplaceOneOptions): Promise<boolean>;
    delete(): Promise<mongodb.DeleteWriteOpResultObject>;
    private fieldsToSerialize();
    toJSON(): any;
}
export declare function serialize(document: any, keys?: string[]): any;
