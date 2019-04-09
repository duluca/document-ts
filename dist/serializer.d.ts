export interface ISerializable {
    toJSON(): Object;
    toBSON(): Object;
    [index: string]: any;
}
export declare enum serializationStrategy {
    toJSON = 0,
    toBSON = 1
}
export declare function serialize(strategy: serializationStrategy, document: ISerializable, keys?: string[]): Object;
