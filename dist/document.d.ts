import { CollectionInsertOneOptions, DeleteWriteOpResultObject, ObjectID, ReplaceOneOptions } from 'mongodb';
import { IDocument } from './interfaces';
import { ISerializable } from './serializer';
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
