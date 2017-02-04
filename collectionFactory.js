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
const bluebird = require("bluebird");
const _ = require("lodash");
const database_1 = require("./database");
class CollectionFactory {
    constructor(collectionName, documentType, searchableProperties = []) {
        this.collectionName = collectionName;
        this.documentType = documentType;
        this.searchableProperties = searchableProperties;
    }
    sanitizeId(filter) {
        var hasId = filter.hasOwnProperty('_id');
        if (hasId && typeof filter['_id'] !== 'object') {
            filter['_id'] = new mongodb.ObjectID(filter['_id']);
        }
    }
    get collection() {
        return () => database_1.getDbInstance().collection(this.collectionName);
    }
    aggregate(pipeline) {
        return this.collection().aggregate(pipeline);
    }
    findOne(filter, options) {
        return __awaiter(this, void 0, void 0, function* () {
            this.sanitizeId(filter);
            let document = yield this.collection().findOne(filter, options);
            if (document) {
                return new this.documentType(document);
            }
            return undefined;
        });
    }
    findOneAndUpdate(filter, update, options) {
        return __awaiter(this, void 0, void 0, function* () {
            this.sanitizeId(filter);
            let document = yield this.collection().findOneAndUpdate(filter, update, options);
            return this.hydrateObject(document);
        });
    }
    findWithPagination(queryParams, aggregationCursor, query, searchableProperties, hydrate = false) {
        return __awaiter(this, void 0, void 0, function* () {
            let collection = this;
            let options = this.buildQueryParameters(queryParams);
            let pagingCursor;
            let totalCursor;
            if (aggregationCursor) {
                pagingCursor = aggregationCursor();
                totalCursor = aggregationCursor();
            }
            let total = yield this.getTotal(totalCursor, query);
            if (pagingCursor && options.filter) {
                pagingCursor = pagingCursor.match(this.buildTokenizedQueryObject(options.filter, this.searchableProperties));
            }
            let cursor = pagingCursor || this.getCursor(query, searchableProperties || this.searchableProperties);
            let documents = this.buildQuery(cursor, options).toArray();
            return {
                data: yield bluebird.map(documents, function (document) {
                    return hydrate ? collection.hydrateObject(document) : document;
                }),
                total: total
            };
        });
    }
    getTotal(aggregationCursor, query) {
        return __awaiter(this, void 0, void 0, function* () {
            if (aggregationCursor) {
                let result = yield aggregationCursor.group({ _id: null, count: { $sum: 1 } }).toArray();
                return result.length > 0 ? result[0].count : 0;
            }
            else {
                return this.count(query);
            }
        });
    }
    getCursor(query, searchableProperties) {
        let builtQuery = {};
        if (typeof query === 'string') {
            builtQuery = this.buildTokenizedQueryObject(query, searchableProperties);
        }
        else {
            builtQuery = query;
        }
        return this.collection().find(builtQuery);
    }
    fieldsArrayToObject(fields) {
        let fieldsObject = {};
        _.each(fields, function (field) {
            fieldsObject[field] = 1;
        });
        return fieldsObject;
    }
    find(query, fields, skip, limit, timeout) {
        return __awaiter(this, void 0, void 0, function* () {
            let collection = this;
            let documents = this.collection().find(query, fields, skip, limit, timeout).toArray();
            return bluebird.map(documents, function (document) {
                return collection.hydrateObject(document);
            });
        });
    }
    hydrateObject(document) {
        if (document) {
            return new this.documentType(document);
        }
        return undefined;
    }
    count(query, options) {
        return __awaiter(this, void 0, void 0, function* () {
            return yield this.collection().count(query, options);
        });
    }
    tokenize(searchText) {
        var splitValues = searchText.split(' ').filter((val) => typeof val === 'string');
        if (!splitValues) {
            return /.*/;
        }
        var regexpString = '^(?=.*' + splitValues.join(')(?=.*') + ').*$';
        return new RegExp(regexpString, 'i');
    }
    buildTokenizedQueryObject(filter, searchableProperties) {
        let that = this;
        let query = _.map(searchableProperties, function (property) {
            let obj = {};
            obj[property] = that.tokenize(filter);
            return obj;
        });
        return { $or: query };
    }
    buildQueryParameters(query) {
        if (!query) {
            return undefined;
        }
        let toReturn = {};
        if (query.filter && query.filter.length > 0) {
            toReturn.filter = query.filter;
        }
        if (query.skip) {
            toReturn.skip = parseInt(query.skip);
        }
        if (query.limit) {
            toReturn.limit = parseInt(query.limit);
        }
        if (query.order) {
            toReturn.sortKeyOrList = query.order;
        }
        return toReturn;
    }
    sortKeyToObject(sortKey) {
        if (typeof sortKey !== 'string') {
            return sortKey;
        }
        else {
            let sortObject = {};
            let isDesc = sortKey[0] === '-';
            sortObject[sortKey.substring(isDesc ? 1 : 0)] = isDesc ? -1 : 1;
            return sortObject;
        }
    }
    sortKeyOrListToObject(sortKeyOrList) {
        if (typeof sortKeyOrList === 'string') {
            return [this.sortKeyToObject(sortKeyOrList)];
        }
        else if (!Array.isArray(sortKeyOrList)) {
            return [sortKeyOrList];
        }
        else {
            return _.map(sortKeyOrList, (key) => this.sortKeyToObject(key));
        }
    }
    buildQuery(cursor, parameters) {
        if (parameters) {
            if (parameters.sortKeyOrList) {
                for (let sortObject of this.sortKeyOrListToObject(parameters.sortKeyOrList)) {
                    cursor = cursor.sort(sortObject);
                }
            }
            if (parameters.skip) {
                cursor = cursor.skip(parameters.skip);
            }
            if (parameters.limit) {
                cursor = cursor.limit(parameters.limit);
            }
        }
        return cursor;
    }
}
exports.CollectionFactory = CollectionFactory;
//# sourceMappingURL=collectionFactory.js.map