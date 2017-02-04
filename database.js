'use strict';
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : new P(function (resolve) { resolve(result.value); }).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
const fs = require("fs");
const mongodb_1 = require("mongodb");
let dbInstance;
function connect(mongoUri, isProduction = false, certFileUri) {
    return __awaiter(this, void 0, void 0, function* () {
        console.log('Connecting to db...');
        let mongoOptions = {};
        if (certFileUri) {
            let certFileBuf = [fs.readFileSync(certFileUri)];
            mongoOptions = {
                mongos: {
                    ssl: true,
                    sslValidate: true,
                    sslCA: certFileBuf,
                    poolSize: 1
                }
            };
        }
        if (isProduction === false) {
            mongoOptions = {};
        }
        dbInstance = yield mongodb_1.MongoClient.connect(mongoUri, mongoOptions);
    });
}
exports.connect = connect;
function getDbInstance() {
    if (!dbInstance) {
        throw 'Database is not yet instantiated';
    }
    return dbInstance;
}
exports.getDbInstance = getDbInstance;
//# sourceMappingURL=database.js.map