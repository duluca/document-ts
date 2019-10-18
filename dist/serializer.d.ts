export interface ISerializable {
    toJSON(): Object;
    toBSON(): Object;
    [index: string]: any;
}
export declare enum SerializationStrategy {
    JSON = "toJSON",
    BSON = "toBSON"
}
export declare function Serialize(strategy: SerializationStrategy, document: ISerializable, keys?: string[]): Object;
