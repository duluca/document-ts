import { Db, MongoClientOptions } from 'mongodb';
export declare function connect(mongoUri: string, isProduction?: boolean, connectionRetryWait?: number, connectionRetryMax?: number, certFileUri?: string, overrideOptions?: MongoClientOptions): Promise<void>;
export declare function close(force?: boolean): Promise<void>;
export declare function connectionStatus(): boolean;
export declare function getDbInstance(): Db;
