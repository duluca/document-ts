import {
  AggregationCursor,
  Cursor,
  FindOneAndReplaceOption,
  FindOneOptions,
  MongoCountPreferences,
  ObjectID,
} from 'mongodb'

import { getDbInstance } from './database'
import {
  Func,
  ICollectionProvider,
  IDbRecord,
  IDocument,
  IFilter,
  IPaginationResult,
  IQueryParameters,
} from './interfaces'

export abstract class CollectionFactory<TDocument extends IDocument> {
  constructor(
    public collectionName: string,
    private documentType: any,
    public searchableProperties: string[] = []
  ) {}

  sanitizeId(filter: IFilter) {
    var hasId = filter.hasOwnProperty('_id')
    if (hasId && typeof filter['_id'] !== 'object') {
      filter['_id'] = new ObjectID(filter['_id'])
    }
  }

  get collection(): ICollectionProvider<TDocument> {
    return () => getDbInstance().collection<TDocument>(this.collectionName)
  }

  aggregate(pipeline: Object[]): AggregationCursor<TDocument> {
    return this.collection().aggregate(pipeline)
  }

  protected get undefinedObject(): TDocument {
    return <TDocument>new this.documentType()
  }

  async findOne(filter: IFilter, options?: FindOneOptions): Promise<TDocument> {
    this.sanitizeId(filter)
    let document = await this.collection().findOne(filter, options)
    return this.hydrateObject(document) || this.undefinedObject
  }

  async findOneAndUpdate(
    filter: IFilter,
    update: Object,
    options?: FindOneAndReplaceOption
  ): Promise<TDocument> {
    this.sanitizeId(filter)
    let document = await this.collection().findOneAndUpdate(filter, update, options)
    return this.hydrateObject(document.value) || this.undefinedObject
  }

  async findWithPagination<TReturnType extends IDbRecord>(
    queryParams: Partial<IQueryParameters> & Object,
    aggregationCursorFunc?: Func<AggregationCursor<TReturnType>>,
    query?: string | Object,
    searchableProperties?: string[],
    hydrate = false
  ): Promise<IPaginationResult<TReturnType>> {
    let collection = this

    let cursor = this.buildCursor<TReturnType>(
      aggregationCursorFunc ? aggregationCursorFunc() : undefined,
      queryParams,
      query,
      searchableProperties
    )

    let executionCursor = await this.buildQuery(cursor, queryParams)
    let loadStrategy: Promise<any>

    if (executionCursor instanceof Cursor) {
      loadStrategy = collection.cursorStrategy(executionCursor, hydrate, collection)
    } else {
      loadStrategy = collection.aggregationCursorStrategy<TReturnType>(executionCursor)
    }

    let returnData = await Promise.all([
      loadStrategy,
      this.getTotal(aggregationCursorFunc ? aggregationCursorFunc() : undefined, query),
    ])
    return {
      data: returnData[0],
      total: returnData[1],
    }
  }

  private buildCursor<TReturnType>(
    aggregationCursor: AggregationCursor<TReturnType> | undefined,
    queryParams: Partial<IQueryParameters> & Object,
    query: string | Object | undefined,
    searchableProperties: string[] | undefined
  ): AggregationCursor<TReturnType> | Cursor<TDocument> {
    if (aggregationCursor) {
      if (queryParams && queryParams.filter) {
        aggregationCursor = aggregationCursor.match(
          this.buildTokenizedQueryObject(queryParams.filter, this.searchableProperties)
        )
      }
      return aggregationCursor
    } else {
      if (!query) {
        query = {}
      }
      return this.getCursor(query, searchableProperties || this.searchableProperties)
    }
  }

  private async cursorStrategy(
    cursor: Cursor<TDocument>,
    hydrate: boolean,
    collection: CollectionFactory<TDocument>
  ): Promise<(TDocument | undefined)[]> {
    let data: (TDocument | undefined)[] = []
    await cursor.forEach(document =>
      data.push(hydrate ? collection.hydrateObject(document) : document)
    )
    return data
  }

  private async aggregationCursorStrategy<TReturnType>(
    cursor: AggregationCursor<TReturnType>
  ): Promise<(TReturnType | undefined)[]> {
    return new Promise<(TReturnType | undefined)[]>((resolve, reject) => {
      const data: (TReturnType | undefined)[] = []
      cursor.each((err, document) => {
        if (err) {
          reject(err.message)
        } else if (document == null) {
          resolve(data)
        } else {
          data.push((document as unknown) as TReturnType)
        }
      })
    })
  }

  async getTotal(aggregationCursor?: AggregationCursor, query = {}): Promise<number> {
    if (aggregationCursor) {
      let result = await aggregationCursor
        .group({ _id: null, count: { $sum: 1 } })
        .toArray()
      return result.length > 0 ? (result[0] as any).count : 0
    } else {
      return this.count(query)
    }
  }

  getCursor(query: string | Object, searchableProperties: string[]): Cursor<TDocument> {
    let builtQuery = {}
    if (typeof query === 'string') {
      builtQuery = this.buildTokenizedQueryObject(query, searchableProperties)
    } else {
      builtQuery = query
    }
    return this.collection().find(builtQuery)
  }

  fieldsArrayToObject(fields: string[]): Object {
    let fieldsObject: IFilter = {}

    fields.forEach(field => {
      fieldsObject[field] = 1
    })

    return fieldsObject
  }

  async find(
    query: Object,
    fields?: Object,
    skip?: number,
    limit?: number
  ): Promise<TDocument[]> {
    return await this.collection()
      .find(query, fields)
      .skip(skip ? skip : 0)
      .limit(limit ? limit : Number.MAX_SAFE_INTEGER)
      .map(document => this.hydrateObject(document) || this.undefinedObject)
      .toArray()
  }

  hydrateObject(document: any): TDocument | undefined {
    if (document && document instanceof this.documentType) {
      return document
    } else if (document) {
      const newDocument = <TDocument>new this.documentType()
      Object.assign(newDocument, document)
      return newDocument
    }
    return undefined
  }

  async count(query: Object, options?: MongoCountPreferences): Promise<number> {
    return await this.collection().countDocuments(query, options)
  }

  private tokenize(searchText: string): RegExp {
    const splitValues = searchText.split(' ').filter(val => typeof val === 'string')

    if (splitValues.length === 0) {
      return /.*/
    }

    var regexpString = '^(?=.*' + splitValues.join(')(?=.*') + ').*$'
    return new RegExp(regexpString, 'i')
  }

  buildTokenizedQueryObject(filter: string, searchableProperties: string[]): Object {
    let that = this
    let query = searchableProperties.map((property: string) => {
      let obj: any = {}
      obj[property] = that.tokenize(filter)
      return obj
    })

    return { $or: query }
  }

  sortKeyToObject(sortKey: string | Object): Object {
    if (typeof sortKey !== 'string') {
      return sortKey
    } else {
      let sortObject: { [index: string]: number } = {}
      let isDesc = sortKey[0] === '-'
      sortObject[sortKey.substring(isDesc ? 1 : 0)] = isDesc ? -1 : 1
      return sortObject
    }
  }

  sortKeyOrListToObject(sortKeyOrList: string | Object[] | Object): Object[] {
    if (typeof sortKeyOrList === 'string') {
      return [this.sortKeyToObject(sortKeyOrList)]
    } else if (!Array.isArray(sortKeyOrList)) {
      return [sortKeyOrList]
    } else {
      return sortKeyOrList.map(key => this.sortKeyToObject(key))
    }
  }

  buildQuery<TReturnType>(
    cursor: Cursor<TDocument> | AggregationCursor<TReturnType>,
    parameters?: IQueryParameters
  ): Cursor<TDocument> | AggregationCursor<TReturnType> {
    if (parameters) {
      if (parameters.sortKeyOrList) {
        for (let sortObject of this.sortKeyOrListToObject(parameters.sortKeyOrList)) {
          cursor = (cursor as AggregationCursor<TReturnType>).sort(sortObject)
        }
      }

      if (parameters.skip) {
        cursor = cursor.skip(parameters.skip)
      }

      if (parameters.limit) {
        cursor = cursor.limit(parameters.limit)
      }
    }

    return cursor
  }
}
