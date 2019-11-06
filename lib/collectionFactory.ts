import {
  AggregationCursor,
  Cursor,
  FilterQuery,
  FindOneAndReplaceOption,
  FindOneOptions,
  MongoCountPreferences,
  ObjectID,
  UpdateQuery,
} from 'mongodb'

import { getDbInstance } from './database'
import { DocumentException } from './documentException'
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
    const hasId = filter.hasOwnProperty('_id')
    if (hasId && typeof filter._id !== 'object') {
      filter._id = new ObjectID(filter._id)
    }
  }

  get collection(): ICollectionProvider<TDocument> {
    return () => getDbInstance().collection<TDocument>(this.collectionName)
  }

  aggregate(pipeline: object[]): AggregationCursor<TDocument> {
    return this.collection().aggregate(pipeline)
  }

  async findOne(
    filter: FilterQuery<TDocument>,
    options?: FindOneOptions
  ): Promise<TDocument | null> {
    this.sanitizeId(filter)
    const document = await this.collection().findOne(filter, options)
    return this.hydrateObject(document)
  }

  async findOneAndUpdate(
    filter: FilterQuery<TDocument>,
    update: TDocument | UpdateQuery<TDocument>,
    options?: FindOneAndReplaceOption
  ): Promise<TDocument | null> {
    this.sanitizeId(filter)
    const document = await this.collection().findOneAndUpdate(filter, update, options)
    return this.hydrateObject(document.value)
  }

  async findWithPagination<TReturnType extends IDbRecord>(
    queryParams: Partial<IQueryParameters> & object,
    aggregationCursorFunc?: Func<AggregationCursor<TReturnType>>,
    query?: string | object,
    searchableProperties?: string[],
    hydrate = false,
    debugQuery = false
  ): Promise<IPaginationResult<TReturnType>> {
    const collection = this

    if (queryParams.filter && !query) {
      query = queryParams.filter
    } else if (queryParams.filter && query && queryParams.filter !== query) {
      throw new DocumentException(
        'Illegal assignment: queryParams.filter and query cannot be set as different values'
      )
    }

    const builtQuery = this.getQuery(
      query,
      searchableProperties || this.searchableProperties
    )

    const cursor = this.buildCursor<TReturnType>(
      aggregationCursorFunc ? aggregationCursorFunc() : undefined,
      queryParams,
      builtQuery
    )

    const executionCursor = this.buildQuery(cursor, queryParams)
    let loadStrategy: Promise<any>

    if (debugQuery && executionCursor) {
      console.log((executionCursor as any).cmd)
    }

    if (executionCursor instanceof AggregationCursor) {
      loadStrategy = collection.aggregationCursorStrategy<TReturnType>(executionCursor)
    } else {
      loadStrategy = collection.cursorStrategy(executionCursor, hydrate, collection)
    }

    const returnData = await Promise.all([
      loadStrategy,
      this.getTotal(
        aggregationCursorFunc ? aggregationCursorFunc() : undefined,
        builtQuery
      ),
    ])
    return {
      data: returnData[0],
      total: returnData[1],
    }
  }

  private buildCursor<TReturnType>(
    aggregationCursor: AggregationCursor<TReturnType> | undefined,
    queryParams: Partial<IQueryParameters> & object,
    builtQuery: {} | undefined
  ): AggregationCursor<TReturnType> | Cursor<TDocument> {
    if (aggregationCursor) {
      if (queryParams && queryParams.filter) {
        aggregationCursor = aggregationCursor.match(
          this.buildTokenizedQueryObject(queryParams.filter, this.searchableProperties)
        )
      }
      return aggregationCursor
    } else {
      if (!builtQuery) {
        builtQuery = {}
      }

      let projection: object[] = []

      if (queryParams && queryParams.projectionKeyOrList) {
        projection = this.keyOrListToObject(queryParams.projectionKeyOrList, 0)
      }

      return this.getCursor(builtQuery, Object.assign({}, ...projection))
    }
  }

  private async cursorStrategy(
    cursor: Cursor<TDocument>,
    hydrate: boolean,
    collection: CollectionFactory<TDocument>
  ): Promise<(TDocument | null)[]> {
    const data: (TDocument | null)[] = []
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

  async getTotal(
    aggregationCursor?: AggregationCursor,
    builtQuery = {}
  ): Promise<number> {
    if (aggregationCursor) {
      const result = await aggregationCursor
        .group({ _id: null, count: { $sum: 1 } })
        .toArray()
      return result.length > 0 ? (result[0] as any).count : 0
    } else {
      return this.count(builtQuery)
    }
  }

  getQuery(query: string | object | undefined, searchableProperties: string[]): {} {
    if (typeof query === 'string') {
      return this.buildTokenizedQueryObject(query, searchableProperties)
    } else if (typeof query === 'undefined') {
      return {}
    }
    return query
  }

  getCursor(builtQuery: {}, projection: {}): Cursor<TDocument> {
    return this.collection().find(builtQuery, {
      projection,
    })
  }

  fieldsArrayToObject(fields: string[]): object {
    const fieldsObject: IFilter = {}

    fields.forEach(field => {
      fieldsObject[field] = 1
    })

    return fieldsObject
  }

  async find<TReturnType extends IDbRecord>(
    query: FilterQuery<TDocument>,
    options?: FindOneOptions,
    skip?: number,
    limit?: number,
    hydrate = true,
    debugQuery = false
  ): Promise<IPaginationResult<TReturnType>> {
    return this.findWithPagination(
      {
        limit,
        skip,
        sortKeyOrList: options ? options.sort : [],
        projectionKeyOrList: options ? options.projection : [],
      },
      undefined,
      query,
      undefined,
      hydrate,
      debugQuery
    )
  }

  hydrateObject(document: unknown): TDocument | null {
    if (document && document instanceof this.documentType) {
      return document as TDocument
    } else if (document) {
      const newDocument = new this.documentType() as TDocument
      Object.assign(newDocument, document)
      return newDocument
    }
    return null
  }

  async count(
    query: FilterQuery<TDocument>,
    options?: MongoCountPreferences
  ): Promise<number> {
    return await this.collection().countDocuments(query, options)
  }

  private tokenize(searchText: string): RegExp {
    const splitValues = searchText.split(' ').filter(val => typeof val === 'string')

    if (splitValues.length === 0) {
      return /.*/
    }

    const regexpString = '^(?=.*' + splitValues.join(')(?=.*') + ').*$'
    return new RegExp(regexpString, 'i')
  }

  buildTokenizedQueryObject(filter: string, searchableProperties: string[]): object {
    const that = this
    const query = searchableProperties.map((property: string) => {
      const obj: any = {}
      obj[property] = that.tokenize(filter)
      return obj
    })

    return { $or: query }
  }

  keyToObject(sortKey: string | object, negativeValue: number): object {
    if (typeof sortKey !== 'string') {
      return sortKey
    } else {
      const sortObject: { [index: string]: number } = {}
      const isDesc = sortKey[0] === '-'
      sortObject[sortKey.substring(isDesc ? 1 : 0)] = isDesc ? negativeValue : 1
      return sortObject
    }
  }

  keyOrListToObject(
    sortKeyOrList: string | object[] | object,
    negativeValue: number
  ): object[] {
    if (typeof sortKeyOrList === 'string') {
      return [this.keyToObject(sortKeyOrList, negativeValue)]
    } else if (!Array.isArray(sortKeyOrList)) {
      return [sortKeyOrList]
    } else {
      return sortKeyOrList.map(key => this.keyToObject(key, negativeValue))
    }
  }

  buildQuery<TReturnType>(
    cursor: Cursor<TDocument> | AggregationCursor<TReturnType>,
    parameters?: IQueryParameters
  ): Cursor<TDocument> | AggregationCursor<TReturnType> {
    if (parameters) {
      if (parameters.sortKeyOrList) {
        for (const sortObject of this.keyOrListToObject(parameters.sortKeyOrList, -1)) {
          cursor = (cursor as AggregationCursor<TReturnType>).sort(sortObject)
        }
      }

      if (parameters.skip) {
        cursor = cursor.skip(parseInt(parameters.skip as any, 0))
      }

      if (parameters.limit) {
        cursor = cursor.limit(parseInt(parameters.limit as any, 0))
      }
    }

    return cursor
  }
}
