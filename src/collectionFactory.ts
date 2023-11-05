import {
  AggregationCursor,
  Filter,
  FindOptions,
  CountDocumentsOptions,
  ObjectId,
  UpdateFilter,
  FindCursor,
  Sort,
  SortDirection,
  FindOneAndUpdateOptions,
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
import { ISerializable } from './serializer'

export abstract class CollectionFactory<TDocument extends IDocument & ISerializable> {
  constructor(
    public collectionName: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private documentType: any,
    public searchableProperties: string[] = []
  ) {}

  sanitizeId(filter: IFilter) {
    const hasId = Object.prototype.hasOwnProperty.call(filter, '_id')
    if (
      hasId &&
      (typeof filter._id === 'string' ||
        typeof filter._id === 'number' ||
        filter._id instanceof ObjectId)
    ) {
      filter._id = new ObjectId(filter._id)
    }
  }

  get collection(): ICollectionProvider<TDocument> {
    return () => getDbInstance().collection<TDocument>(this.collectionName)
  }

  aggregate(pipeline: object[]): AggregationCursor<TDocument> {
    return this.collection().aggregate(pipeline)
  }

  async findOne(
    filter: Filter<TDocument>,
    options?: FindOptions
  ): Promise<TDocument | null> {
    this.sanitizeId(filter)
    const document = await this.collection().findOne(filter, options)
    return document ? this.hydrateObject(document) : null
  }

  async findOneAndUpdate(
    filter: Filter<TDocument>,
    update: TDocument | UpdateFilter<TDocument>,
    options?: FindOneAndUpdateOptions
  ): Promise<TDocument | null> {
    this.sanitizeId(filter)
    const document = options
      ? await this.collection().findOneAndUpdate(filter, update, options)
      : await this.collection().findOneAndUpdate(filter, update)
    return document ? this.hydrateObject(document) : null
  }

  async findWithPagination<TReturnType extends IDbRecord>(
    queryParams: Partial<IQueryParameters> & object,
    aggregationCursorFunc?: Func<AggregationCursor<TReturnType>>,
    query?: string | object,
    searchableProperties?: string[],
    hydrate = true,
    debugQuery = false
  ): Promise<IPaginationResult<TReturnType>> {
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
    let loadStrategy: Promise<TReturnType[]>

    if (debugQuery) {
      console.log(executionCursor)
    }

    if (executionCursor instanceof AggregationCursor) {
      loadStrategy = this.aggregationCursorStrategy<TReturnType>(executionCursor)
    } else {
      loadStrategy = this.findCursorStrategy<TReturnType>(executionCursor, hydrate, this)
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
    aggregationCursor?: AggregationCursor<TReturnType>,
    queryParams?: Partial<IQueryParameters> & object,
    builtQuery?: object
  ): AggregationCursor<TReturnType> | FindCursor<TReturnType> {
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

      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
      return this.getCursor(builtQuery, Object.assign({}, ...projection))
    }
  }

  private async findCursorStrategy<TReturnType>(
    cursor: FindCursor<TReturnType>,
    hydrate: boolean,
    collection: CollectionFactory<TDocument>
  ): Promise<TReturnType[]> {
    const data: TReturnType[] = []
    for await (let document of cursor) {
      if (hydrate) {
        document = collection.hydrateObject(document).toJSON() as TReturnType
      }
      data.push(document)
    }
    return data
  }

  private async aggregationCursorStrategy<TReturnType>(
    cursor: AggregationCursor<TReturnType>
  ): Promise<TReturnType[]> {
    const data: TReturnType[] = []
    for await (const document of cursor) {
      data.push(document as unknown as TReturnType)
    }

    return Promise.resolve(data)
  }

  async getTotal(
    aggregationCursor?: AggregationCursor,
    builtQuery = {}
  ): Promise<number> {
    if (aggregationCursor) {
      const result = await aggregationCursor
        .group({ _id: null, count: { $sum: 1 } })
        .toArray()

      // eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-member-access
      return result.length > 0 ? result[0].count : 0
    } else {
      return this.count(builtQuery)
    }
  }

  getQuery(query: string | object | undefined, searchableProperties: string[]): object {
    if (typeof query === 'string') {
      return this.buildTokenizedQueryObject(query, searchableProperties)
    } else if (typeof query === 'undefined') {
      return {}
    }
    return query
  }

  getCursor<TReturnType>(
    builtQuery: object,
    projection: object
  ): FindCursor<TReturnType> {
    return this.collection().find(builtQuery, {
      projection,
    }) as FindCursor<TReturnType>
  }

  fieldsArrayToObject(fields: string[]): object {
    const fieldsObject: IFilter = {}

    fields.forEach((field) => {
      fieldsObject[field] = 1
    })

    return fieldsObject
  }

  async find<TReturnType extends IDbRecord>(
    query: Filter<TDocument>,
    options?: FindOptions,
    skip?: number,
    limit?: number,
    hydrate = true,
    debugQuery = false
  ): Promise<IPaginationResult<TReturnType>> {
    return this.findWithPagination(
      {
        limit,
        skip,
        mongoSortOverride: options?.sort,
        projectionKeyOrList: options?.projection || [],
      },
      undefined,
      query,
      undefined,
      hydrate,
      debugQuery
    )
  }

  hydrateObject(document: unknown): TDocument & ISerializable {
    if (document instanceof this.documentType) {
      return document as TDocument
    } else {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call
      const newDocument = new this.documentType() as TDocument
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call
      newDocument.fillData(document)
      return newDocument
    }
  }

  async count(
    query: Filter<TDocument>,
    options?: CountDocumentsOptions
  ): Promise<number> {
    return await this.collection().countDocuments(query, options)
  }

  private tokenize(searchText: string): RegExp {
    const splitValues = searchText.split(' ').filter((val) => typeof val === 'string')

    if (splitValues.length === 0) {
      return /.*/
    }

    const regexpString = '^(?=.*' + splitValues.join(')(?=.*') + ').*$'
    return new RegExp(regexpString, 'i')
  }

  buildTokenizedQueryObject(filter: string, searchableProperties: string[]): object {
    const query = searchableProperties.map((property: string) => {
      const obj: { [key: string]: RegExp } = {}
      obj[property] = this.tokenize(filter)
      return obj
    })

    return { $or: query }
  }

  sortKeyToSortTuple(key: string): [string, SortDirection] {
    const isDesc = key[0] === '-'
    return [key.substring(isDesc ? 1 : 0), isDesc ? -1 : 1]
  }

  sortKeyOrListToSort(sortKeyOrList: string | string[]): Sort {
    if (typeof sortKeyOrList === 'string') {
      return [this.sortKeyToSortTuple(sortKeyOrList)]
    } else {
      return sortKeyOrList.map((key) => this.sortKeyToSortTuple(key))
    }
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
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
      return sortKeyOrList.map((key) => this.keyToObject(key, negativeValue))
    }
  }

  buildQuery<TReturnType>(
    cursor: FindCursor<TReturnType> | AggregationCursor<TReturnType>,
    parameters?: IQueryParameters
  ): FindCursor<TReturnType> | AggregationCursor<TReturnType> {
    if (!parameters) {
      return cursor
    }

    if (parameters?.mongoSortOverride) {
      cursor = cursor.sort(parameters.mongoSortOverride)
    } else if (parameters?.sortKeyOrList) {
      cursor = cursor.sort(this.sortKeyOrListToSort(parameters.sortKeyOrList))
    }

    if (parameters?.skip && typeof parameters.skip === 'number') {
      cursor = cursor.skip(parameters.skip)
    }

    if (parameters?.limit && typeof parameters.limit === 'number') {
      cursor = cursor.limit(parameters.limit)
    }

    return cursor
  }
}
