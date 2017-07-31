import { Collection, ObjectID, CollectionInsertOneOptions, ReplaceOneOptions, DeleteWriteOpResultObject } from 'mongodb';
import { IDocument } from './interfaces';
export declare abstract class Document<TDocument extends IDocument> implements IDocument {
    collectionName: string;
    _id: ObjectID;
    constructor(collectionName: string, document?: TDocument);
    protected abstract getCalculatedPropertiesToInclude(): string[];
    protected abstract getPropertiesToExclude(): string[];
    protected readonly collection: Collection;
    protected fillData(data: any): void;
    private hasObjectId();
    save(options?: CollectionInsertOneOptions | ReplaceOneOptions): Promise<boolean>;
    delete(): Promise<DeleteWriteOpResultObject>;
    private fieldsToSerialize();
    toJSON(): any;
}
export declare function serialize(document: any, keys?: string[]): any;
