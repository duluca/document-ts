"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : new P(function (resolve) { resolve(result.value); }).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
const mongodb = require("mongodb");
const _ = require("lodash");
const database_1 = require("./database");
function DocumentException(message) {
    this.message = message;
    this.name = 'DocumentException';
}
exports.DocumentException = DocumentException;
const defaultExcludes = ['collectionName', 'includes', 'excludes'];
class Document {
    constructor(collectionName, document) {
        this.collectionName = collectionName;
        if (document) {
            this.fillData(document);
        }
    }
    get collection() {
        return database_1.getDbInstance().collection(this.collectionName);
    }
    fillData(data) {
        Object.keys(data).forEach((key) => { this[key] = data[key]; });
    }
    hasObjectId() {
        if (this._id && this._id.generationTime) {
            return mongodb.ObjectID.isValid(this._id.generationTime);
        }
        return false;
    }
    save(options) {
        return __awaiter(this, void 0, void 0, function* () {
            if (!this.hasObjectId()) {
                let result = yield this.collection.insertOne(this, options);
                if (result.insertedCount > 0) {
                    this.fillData(result.ops[0]);
                }
                return result.insertedCount == 1;
            }
            else {
                let result = yield this.collection.updateOne({ _id: this._id }, this, options);
                return result.modifiedCount == 1;
            }
        });
    }
    delete() {
        let document = this;
        let collection = this.collection;
        return collection.deleteOne({ _id: document._id });
    }
    fieldsToSerialize() {
        let document = this;
        let excludes = defaultExcludes.concat(document.getPropertiesToExclude());
        let includes = document.getCalculatedPropertiesToInclude();
        let keys = _.remove(Object.keys(document), function (key) {
            return !_.includes(excludes, key);
        });
        return keys.concat(includes);
    }
    toJSON() {
        return serialize(this, this.fieldsToSerialize());
    }
}
exports.Document = Document;
function serialize(document, keys) {
    if (!keys && document && typeof document.toJSON === 'function') {
        return document.toJSON();
    }
    else if (!keys) {
        return {};
    }
    keys = _.uniq(keys);
    let serializationTarget = {};
    for (let key of keys) {
        let child = document[key];
        if (child && typeof child.toJSON === 'function') {
            serializationTarget[key] = child.toJSON();
        }
        else if (Array.isArray(child)) {
            serializationTarget[key] = [];
            for (let cc of child) {
                if (typeof cc === 'object') {
                    serializationTarget[key].push(serialize(cc));
                }
                else {
                    serializationTarget[key].push(cc);
                }
            }
        }
        else {
            serializationTarget[key] = child;
        }
    }
    return serializationTarget;
}
exports.serialize = serialize;
//# sourceMappingURL=document.js.map