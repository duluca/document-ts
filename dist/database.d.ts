import { Db } from 'mongodb';
export declare function connect(mongoUri: string, isProduction?: boolean, connectionRetryWait?: number, connectionRetryMax?: number, certFileUri?: string): any;
export declare function close(force?: boolean): any;
export declare function connectionStatus(): any;
export declare function getDbInstance(): Db;
