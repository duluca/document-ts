import {
  AggregationCursor,
  DeleteResult,
  Document as MongoDocument,
  Filter,
  FindOptions,
  CountDocumentsOptions,
  InsertOneOptions,
  ObjectId,
  UpdateFilter,
  UpdateOptions,
  FindCursor,
  Sort,
  SortDirection,
  FindOneAndUpdateOptions,
} from 'mongodb'

import { getDbInstance } from './database'
import {
  DocumentConflictException,
  DocumentException,
  DocumentHydrationException,
  DocumentIdentifierException,
  DocumentValidationException,
} from './documentException'
import {
  Func,
  ICollectionProvider,
  IDbRecord,
  IDocument,
  IFilter,
  IPaginationResult,
  IQueryParameters,
} from './interfaces'
import { ISerializable, SerializationStrategy, Serialize } from './serializer'

const DOCUMENT_VERSION_FIELD = '__documentTsVersion'
const defaultExcludes = [
  '_id',
  DOCUMENT_VERSION_FIELD,
  'collectionName',
  'includes',
  'excludes',
]
const reservedHydrationFields = new Set([
  '_id',
  DOCUMENT_VERSION_FIELD,
  'collectionName',
  '__proto__',
  'prototype',
  'constructor',
])

interface HydrationResult<TDocument> {
  data: Partial<TDocument>
  id: ObjectId | undefined
  version: number
}

const databaseHydrators = new WeakMap<object, (data: unknown) => void>()

function createVersionedUpdate<TDocument>(
  update: UpdateFilter<TDocument>
): UpdateFilter<TDocument> {
  if (!isPlainRecord(update)) {
    throw new DocumentValidationException(
      'findOneAndUpdate() requires an update-operator document.'
    )
  }

  const versionedUpdate: MongoDocument = {}
  for (const [operator, descriptor] of Object.entries(
    Object.getOwnPropertyDescriptors(update)
  )) {
    if (!operator.startsWith('$') || !('value' in descriptor)) {
      throw new DocumentValidationException(
        'findOneAndUpdate() requires an update-operator document.'
      )
    }
    const operatorValue: unknown = descriptor.value
    assertNoVersionMutation(
      operator,
      operatorValue,
      new Set<object>(),
      operator === '$rename'
    )
    defineEnumerableProperty(versionedUpdate, operator, operatorValue)
  }

  const increment = versionedUpdate.$inc as unknown
  if (increment !== undefined && !isPlainRecord(increment)) {
    throw new DocumentValidationException(
      'findOneAndUpdate() received an invalid $inc update.'
    )
  }

  const versionIncrement: MongoDocument = {}
  if (increment) {
    for (const [key, descriptor] of Object.entries(
      Object.getOwnPropertyDescriptors(increment)
    )) {
      if (!('value' in descriptor)) {
        throw new DocumentValidationException(
          'findOneAndUpdate() received an invalid $inc update.'
        )
      }
      defineEnumerableProperty(versionIncrement, key, descriptor.value)
    }
  }
  defineEnumerableProperty(versionIncrement, DOCUMENT_VERSION_FIELD, 1)
  defineEnumerableProperty(versionedUpdate, '$inc', versionIncrement)

  return versionedUpdate as UpdateFilter<TDocument>
}

function assertNoVersionMutation(
  key: string,
  value: unknown,
  visited: Set<object>,
  checkStringTargets: boolean
): void {
  if (
    key === DOCUMENT_VERSION_FIELD ||
    key.startsWith(`${DOCUMENT_VERSION_FIELD}.`) ||
    (checkStringTargets &&
      (value === DOCUMENT_VERSION_FIELD ||
        (typeof value === 'string' && value.startsWith(`${DOCUMENT_VERSION_FIELD}.`))))
  ) {
    throw new DocumentValidationException(
      `${DOCUMENT_VERSION_FIELD} is managed by document-ts.`
    )
  }

  if (!value || typeof value !== 'object') {
    return
  }
  if (visited.has(value)) {
    throw new DocumentValidationException(
      'findOneAndUpdate() does not accept cyclic update documents.'
    )
  }
  if (!Array.isArray(value) && !isPlainRecord(value)) {
    return
  }

  visited.add(value)
  for (const [nestedKey, descriptor] of Object.entries(
    Object.getOwnPropertyDescriptors(value)
  )) {
    if (!('value' in descriptor)) {
      throw new DocumentValidationException(
        'findOneAndUpdate() does not accept accessor properties.'
      )
    }
    assertNoVersionMutation(nestedKey, descriptor.value, visited, checkStringTargets)
  }
  visited.delete(value)
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }
  const prototype = Reflect.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

export abstract class Document<TDocument extends IDocument>
  implements IDocument, ISerializable
{
  [index: string]: unknown

  readonly #collectionName: string
  #documentVersion = 0
  #id: ObjectId | undefined = undefined

  constructor(collectionName: string) {
    if (!collectionName || typeof collectionName !== 'string') {
      throw new DocumentValidationException('Document collection name is required.')
    }
    this.#collectionName = collectionName
    databaseHydrators.set(this, (data: unknown) => {
      const hydrated = this.validateHydrationData(data, true)
      this.applyData(hydrated.data)
      this.#id = hydrated.id
      this.#documentVersion = hydrated.version
    })
  }

  public get _id(): ObjectId {
    return this.#id as ObjectId
  }

  public get collectionName(): string {
    return this.#collectionName
  }

  protected abstract getCalculatedPropertiesToInclude(): string[]

  protected abstract getPropertiesToExclude(): string[]

  protected abstract applyData(data?: Partial<TDocument>): void

  public fillData(data?: Partial<TDocument>): void {
    if (data === undefined) {
      this.applyData(data)
      return
    }

    const hydrated = this.validateHydrationData(data, false)
    this.applyData(hydrated.data)
  }

  protected hydrateInterface<TInterface extends TObject, TObject extends object>(
    objectType: new () => TObject,
    hydrator: (data: Partial<TInterface>) => TObject,
    element: Partial<TInterface>
  ) {
    return element instanceof objectType ? element : hydrator(element)
  }

  protected hydrateInterfaceArray<TInterface extends TObject, TObject extends object>(
    objectType: new () => TObject,
    hydrator: (data: Partial<TInterface>) => TObject,
    objectArray: Partial<TInterface>[]
  ): TObject[] | undefined {
    if (!objectArray || objectArray.length === 0) {
      return undefined
    }
    return objectArray.map((e) => this.hydrateInterface(objectType, hydrator, e))
  }

  async save(options?: InsertOneOptions | UpdateOptions): Promise<boolean> {
    try {
      const id = this.getValidatedId()
      const collection = getDbInstance().collection(this.#collectionName)

      if (!id) {
        const document = this.getPersistenceDocument()
        defineEnumerableProperty(document, DOCUMENT_VERSION_FIELD, this.#documentVersion)
        const result = await collection.insertOne(document, options)

        if (!result.acknowledged || !(result.insertedId instanceof ObjectId)) {
          throw new Error('Unacknowledged document insert')
        }

        this.#id = result.insertedId
        return true
      }

      if ((options as UpdateOptions | undefined)?.upsert) {
        throw new DocumentValidationException(
          'Document.save() does not allow upsert for an existing document.'
        )
      }

      const expectedVersion = this.#documentVersion
      const nextVersion = expectedVersion + 1
      const persistedFields = this.getPersistenceDocument()
      const replacementFields: MongoDocument = {
        ...persistedFields,
        [DOCUMENT_VERSION_FIELD]: nextVersion,
      }
      const update: MongoDocument[] = [
        {
          $replaceWith: {
            $cond: [
              {
                $eq: [{ $ifNull: [`$${DOCUMENT_VERSION_FIELD}`, 0] }, expectedVersion],
              },
              { $mergeObjects: ['$$ROOT', { $literal: replacementFields }] },
              '$$ROOT',
            ],
          },
        },
      ]
      const result = await collection.updateOne({ _id: id }, update, options)

      if (!result.acknowledged) {
        throw new Error('Unacknowledged document update')
      }
      if (result.modifiedCount !== 1) {
        throw new DocumentConflictException()
      }

      this.#documentVersion = nextVersion
      return true
    } catch (error: unknown) {
      throw DocumentException.from(error)
    }
  }

  async delete(): Promise<DeleteResult> {
    try {
      const id = this.getValidatedId()
      if (!id) {
        throw new DocumentIdentifierException()
      }

      return await getDbInstance().collection(this.#collectionName).deleteOne({ _id: id })
    } catch (error: unknown) {
      throw DocumentException.from(error)
    }
  }

  private getValidatedId(): ObjectId | undefined {
    if (Object.prototype.hasOwnProperty.call(this, '_id')) {
      throw new DocumentIdentifierException()
    }
    if (this.#id === undefined) {
      return undefined
    }
    if (!(this.#id instanceof ObjectId) || !ObjectId.isValid(this.#id)) {
      throw new DocumentIdentifierException()
    }
    return this.#id
  }

  private getPersistenceDocument(): MongoDocument {
    const serialized = this.toBSON()
    if (!serialized || typeof serialized !== 'object' || Array.isArray(serialized)) {
      throw new DocumentValidationException('Document BSON output must be an object.')
    }

    const document: MongoDocument = {}
    for (const [key, value] of Object.entries(serialized)) {
      if (defaultExcludes.includes(key) || typeof value === 'function') {
        continue
      }
      defineEnumerableProperty(document, key, value)
    }
    return document
  }

  private validateHydrationData(
    data: unknown,
    trustedDatabaseResult: boolean
  ): HydrationResult<TDocument> {
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw new DocumentHydrationException()
    }

    const prototype = Reflect.getPrototypeOf(data)
    if (prototype !== Object.prototype && prototype !== null) {
      throw new DocumentHydrationException()
    }
    if (Object.getOwnPropertySymbols(data).length > 0) {
      throw new DocumentHydrationException()
    }

    const descriptors = Object.getOwnPropertyDescriptors(data)
    const sanitized: Record<string, unknown> = {}
    let id: ObjectId | undefined
    let version = 0

    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (!('value' in descriptor)) {
        throw new DocumentHydrationException()
      }
      const value: unknown = descriptor.value

      if (key === '_id' && trustedDatabaseResult) {
        if (!(value instanceof ObjectId) || !ObjectId.isValid(value)) {
          throw new DocumentHydrationException()
        }
        id = value
        continue
      }
      if (key === DOCUMENT_VERSION_FIELD && trustedDatabaseResult) {
        if (!Number.isSafeInteger(value) || (value as number) < 0) {
          throw new DocumentHydrationException()
        }
        version = value as number
        continue
      }

      if (
        reservedHydrationFields.has(key) ||
        this.isProtectedMember(key) ||
        typeof value === 'function'
      ) {
        throw new DocumentHydrationException()
      }
      defineEnumerableProperty(sanitized, key, value)
    }

    if (trustedDatabaseResult && id === undefined) {
      throw new DocumentHydrationException()
    }

    return {
      data: sanitized as Partial<TDocument>,
      id,
      version,
    }
  }

  private isProtectedMember(key: string): boolean {
    const ownDescriptor = Object.getOwnPropertyDescriptor(this, key)
    if (
      ownDescriptor &&
      (typeof ownDescriptor.value === 'function' ||
        typeof ownDescriptor.get === 'function' ||
        typeof ownDescriptor.set === 'function')
    ) {
      return true
    }

    let prototype: object | null = Reflect.getPrototypeOf(this)
    while (prototype) {
      const descriptor = Object.getOwnPropertyDescriptor(prototype, key)
      if (descriptor) {
        return true
      }
      prototype = Reflect.getPrototypeOf(prototype)
    }
    return false
  }

  private fieldsToSerialize(excludes: string[] = [], includes: string[] = []) {
    const allExcludes = defaultExcludes.concat(excludes)
    const keys = Object.keys(this).filter(
      (item) => !allExcludes.includes(item) && typeof this[item] !== 'function'
    )
    if (this.#id) {
      keys.push('_id')
    }
    return keys.concat(includes)
  }

  toJSON(): object {
    const fields = this.fieldsToSerialize(
      this.getPropertiesToExclude(),
      this.getCalculatedPropertiesToInclude()
    )
    return Serialize(SerializationStrategy.JSON, this, fields)
  }

  toBSON(): object {
    const fields = this.fieldsToSerialize(this.getCalculatedPropertiesToInclude())
    return Serialize(SerializationStrategy.BSON, this, fields)
  }
}

function defineEnumerableProperty(
  target: Record<string, unknown>,
  key: string,
  value: unknown
): void {
  Object.defineProperty(target, key, {
    configurable: true,
    enumerable: true,
    value,
    writable: true,
  })
}

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
    return document ? this.#hydrateObject(document) : null
  }

  async findOneAndUpdate(
    filter: Filter<TDocument>,
    update: UpdateFilter<TDocument>,
    options?: FindOneAndUpdateOptions
  ): Promise<TDocument | null> {
    this.sanitizeId(filter)
    const versionedUpdate = createVersionedUpdate(update)
    const document = options
      ? await this.collection().findOneAndUpdate(filter, versionedUpdate, options)
      : await this.collection().findOneAndUpdate(filter, versionedUpdate)
    return document ? this.#hydrateObject(document) : null
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
      throw new DocumentValidationException(
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
        document = collection.#hydrateObject(document).toJSON() as TReturnType
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

  #hydrateObject(document: unknown): TDocument & ISerializable {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    const newDocument = new this.documentType() as TDocument
    if (!(newDocument instanceof Document)) {
      throw new DocumentHydrationException()
    }
    const hydrate = databaseHydrators.get(newDocument)
    if (!hydrate) {
      throw new DocumentHydrationException()
    }
    hydrate(document)
    return newDocument
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
