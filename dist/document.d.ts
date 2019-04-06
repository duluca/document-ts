import { ObjectID, CollectionInsertOneOptions, ReplaceOneOptions, DeleteWriteOpResultObject } from 'mongodb';
import { ISerializable } from './serializer';
import { IDocument } from './interfaces';
export declare abstract class Document<TDocument extends IDocument> implements IDocument, ISerializable {
    collectionName: string;
    '_id': ObjectID;
    [index: string]: any;
    constructor(collectionName: string, document?: TDocument);
    protected abstract getCalculatedPropertiesToInclude(): string[];
    protected abstract getPropertiesToExclude(): string[];
    protected fillData(data: any): void;
    private hasObjectId;
    save(options?: CollectionInsertOneOptions | ReplaceOneOptions): Promise<boolean>;
    delete(): Promise<DeleteWriteOpResultObject>;
    private fieldsToSerialize;
    toJSON(): Object;
    toBSON(): Object;
}
