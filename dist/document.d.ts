import { InsertOneOptions, DeleteResult, ObjectId, UpdateOptions } from 'mongodb';
import { IDocument } from './interfaces';
import { ISerializable } from './serializer';
export declare abstract class Document<TDocument extends IDocument> implements IDocument, ISerializable {
    collectionName: string;
    '_id': ObjectId;
    [index: string]: unknown;
    constructor(collectionName: string, document?: Partial<TDocument>);
    protected abstract getCalculatedPropertiesToInclude(): string[];
    protected abstract getPropertiesToExclude(): string[];
    protected abstract fillData(data?: Partial<TDocument>): void;
    protected hydrateInterface<TInterface extends TObject, TObject extends object>(objectType: new () => TObject, hydrator: (data: Partial<TInterface>) => TObject, element: Partial<TInterface>): TObject;
    protected hydrateInterfaceArray<TInterface extends TObject, TObject extends object>(objectType: new () => TObject, hydrator: (data: Partial<TInterface>) => TObject, objectArray: Partial<TInterface>[]): TObject[] | undefined;
    private hasObjectId;
    save(options?: InsertOneOptions | UpdateOptions): Promise<boolean>;
    delete(): Promise<DeleteResult>;
    private fieldsToSerialize;
    toJSON(): object;
    toBSON(): object;
}
