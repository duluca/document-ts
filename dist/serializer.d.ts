export interface ISerializable extends Object {
    toJSON(): object;
    toBSON(): object;
    [index: string]: any;
}
export declare enum SerializationStrategy {
    JSON = "toJSON",
    BSON = "toBSON"
}
export declare function Serialize(strategy: SerializationStrategy, document: ISerializable, keys?: string[]): object;
