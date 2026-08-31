import {
  AggregationCursor,
  BSON,
  CountDocumentsOptions,
  DeleteResult,
  Document as MongoDocument,
  Filter,
  FindCursor,
  FindOptions,
  FindOneAndUpdateOptions,
  InsertOneOptions,
  ObjectId,
  Sort,
  SortDirection,
  UpdateFilter,
  UpdateOptions,
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
  IFindOptions,
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

export const MAX_SEARCH_TEXT_LENGTH = 256
export const MAX_SEARCH_TOKENS = 16
export const DEFAULT_PAGINATION_LIMIT = 100
export const MAX_PAGINATION_LIMIT = 1000
export const MAX_PAGINATION_TIME_MS = 10_000

const fieldPathPattern = /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*$/
const reservedFieldSegments = new Set(['__proto__', 'prototype', 'constructor'])
const firstStageOnlyOperators = new Set([
  '$changeStream',
  '$collStats',
  '$currentOp',
  '$documents',
  '$geoNear',
  '$indexStats',
  '$listCachedAndActiveUsers',
  '$listCatalog',
  '$listLocalSessions',
  '$listSampledQueries',
  '$listSearchIndexes',
  '$listSessions',
  '$operationMetrics',
  '$planCacheStats',
  '$querySettings',
  '$queryStats',
  '$search',
  '$searchMeta',
  '$shardedDataDistribution',
  '$vectorSearch',
])
const foreignDocumentStageOperators = new Set(['$graphLookup', '$lookup', '$unionWith'])
const nestedPipelineStageOperators = new Set(['$facet', '$lookup', '$unionWith'])
const serializedOutputSafeStageOperators = new Set([
  '$limit',
  '$match',
  '$project',
  '$redact',
  '$sample',
  '$skip',
  '$sort',
  '$unset',
  '$unwind',
])

type FieldDictionary = Record<string, unknown>
type SortTuple = [string, SortDirection]

interface NormalizedQueryParameters {
  filter?: string
  skip: number
  limit: number
  maxTimeMS: number
  sort: SortTuple[]
  projection: FieldDictionary
  rawOutput: boolean
  debugQuery: boolean
}

interface AggregationFacetResult<TReturnType> {
  data?: TReturnType[]
  total?: Array<{ count?: number }>
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
    queryParams: Partial<IQueryParameters>,
    aggregationCursorFunc?: Func<AggregationCursor<TReturnType>>,
    query?: Filter<TDocument>,
    searchableProperties?: string[]
  ): Promise<IPaginationResult<TReturnType>> {
    const parameters = this.normalizeQueryParameters(queryParams)
    this.validateTrustedQuery(query)

    const effectiveSearchableProperties = this.validateSearchableProperties(
      typeof searchableProperties === 'undefined'
        ? this.searchableProperties
        : searchableProperties
    )
    const builtQuery = this.getQuery(
      query,
      effectiveSearchableProperties,
      parameters.filter
    )

    if (aggregationCursorFunc) {
      const aggregationCursor = aggregationCursorFunc()
      return this.executeAggregationPagination(aggregationCursor, parameters, builtQuery)
    }

    const cursor = this.getCursor<TReturnType>(builtQuery, parameters.projection)
    const executionCursor = this.applyFindPagination(cursor, parameters)

    this.logQuerySummary('find', parameters, builtQuery)

    const [data, total] = await Promise.all([
      this.findCursorStrategy(executionCursor, parameters.rawOutput),
      this.count(builtQuery, { maxTimeMS: parameters.maxTimeMS }),
    ])

    return { data, total }
  }

  private async executeAggregationPagination<TReturnType extends IDbRecord>(
    cursor: AggregationCursor<TReturnType>,
    parameters: NormalizedQueryParameters,
    builtQuery: Filter<TDocument>
  ): Promise<IPaginationResult<TReturnType>> {
    if (!cursor || !Array.isArray(cursor.pipeline)) {
      throw new DocumentValidationException(
        'Invalid aggregation cursor: the aggregation factory must return an AggregationCursor'
      )
    }

    const pipeline = cursor.pipeline
    this.assertReadOnlyAggregationPipeline(pipeline)
    if (!parameters.rawOutput) {
      this.assertSafeSerializedAggregationPipeline(pipeline)
    }
    this.validateAndApplyAggregationScope(pipeline, builtQuery)

    const dataPipeline: object[] = []
    if (parameters.sort.length > 0) {
      dataPipeline.push({ $sort: this.sortTuplesToObject(parameters.sort) })
    }
    dataPipeline.push({ $skip: parameters.skip }, { $limit: parameters.limit })
    if (Object.keys(parameters.projection).length > 0) {
      dataPipeline.push({ $project: parameters.projection })
    }

    pipeline.push({
      $facet: {
        data: dataPipeline,
        total: [{ $count: 'count' }],
      },
    })
    cursor.maxTimeMS(parameters.maxTimeMS)

    this.logQuerySummary('aggregate', parameters, builtQuery)

    const result = (await cursor.toArray()) as unknown as Array<
      AggregationFacetResult<TReturnType>
    >
    const facet = result[0]
    const rawData = facet?.data ?? []
    const data = parameters.rawOutput
      ? rawData
      : rawData.map((document) => this.serializeDocument<TReturnType>(document))
    const total = facet?.total?.[0]?.count ?? 0

    return { data, total }
  }

  private async findCursorStrategy<TReturnType extends IDbRecord>(
    cursor: FindCursor<TReturnType>,
    rawOutput: boolean
  ): Promise<TReturnType[]> {
    const data: TReturnType[] = []
    for await (const document of cursor) {
      data.push(rawOutput ? document : this.serializeDocument(document))
    }
    return data
  }

  private serializeDocument<TReturnType extends IDbRecord>(
    document: TReturnType
  ): TReturnType {
    return this.#hydrateObject(document).toJSON() as TReturnType
  }

  async getTotal(
    aggregationCursor?: AggregationCursor,
    builtQuery: Filter<TDocument> = {}
  ): Promise<number> {
    this.validateTrustedQuery(builtQuery)
    if (!aggregationCursor) {
      return this.count(builtQuery, { maxTimeMS: MAX_PAGINATION_TIME_MS })
    }

    this.validateAndApplyAggregationScope(aggregationCursor.pipeline, builtQuery)
    aggregationCursor.pipeline.push({ $count: 'count' })
    aggregationCursor.maxTimeMS(MAX_PAGINATION_TIME_MS)
    const result = (await aggregationCursor.toArray()) as Array<{ count?: number }>
    return result[0]?.count ?? 0
  }

  getQuery(
    query: Filter<TDocument> | undefined,
    searchableProperties: string[],
    filter?: string
  ): Filter<TDocument> {
    const queryClauses: Filter<TDocument>[] = []
    if (query && this.hasQuery(query)) {
      queryClauses.push(query)
    }

    if (typeof filter === 'string') {
      const textQuery = this.buildTokenizedQueryObject(
        filter,
        searchableProperties
      ) as Filter<TDocument>
      if (this.hasQuery(textQuery)) {
        queryClauses.push(textQuery)
      }
    }

    if (queryClauses.length === 0) {
      return {}
    }
    if (queryClauses.length === 1) {
      return queryClauses[0] as Filter<TDocument>
    }
    return { $and: queryClauses } as Filter<TDocument>
  }

  getCursor<TReturnType extends IDbRecord>(
    builtQuery: Filter<TDocument>,
    projection: object
  ): FindCursor<TReturnType> {
    return this.collection().find(builtQuery, {
      projection,
    }) as unknown as FindCursor<TReturnType>
  }

  fieldsArrayToObject(fields: string[]): object {
    const fieldsObject = this.createFieldDictionary()
    this.copyDenseArrayValues(fields, 'Field list').forEach((field) => {
      const validatedField = this.validateFieldPath(field)
      fieldsObject[validatedField] = 1
    })
    return fieldsObject
  }

  async find<TReturnType extends IDbRecord>(
    query: Filter<TDocument>,
    options?: IFindOptions | null,
    skip?: number,
    limit?: number
  ): Promise<IPaginationResult<TReturnType>> {
    const safeOptions = options
      ? this.copyOwnDataProperties(options, 'Find options')
      : this.createFieldDictionary()
    return this.findWithPagination(
      {
        limit,
        skip,
        mongoSortOverride: safeOptions.sort as Sort | undefined,
        projectionKeyOrList: safeOptions.projection as IFindOptions['projection'],
        rawOutput: safeOptions.rawOutput as boolean | undefined,
        debugQuery: safeOptions.debugQuery as boolean | undefined,
        maxTimeMS: safeOptions.maxTimeMS as number | undefined,
      },
      undefined,
      query
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

  buildTokenizedQueryObject(filter: string, searchableProperties: string[]): object {
    const validatedProperties = this.validateSearchableProperties(searchableProperties)
    const tokens = this.tokenize(filter)
    if (tokens.length === 0) {
      return {}
    }

    if (validatedProperties.length === 0) {
      throw new DocumentValidationException(
        'Cannot apply a non-empty text filter without searchable properties'
      )
    }

    const regexpString =
      '^(?=.*' + tokens.map((token) => this.escapeRegExp(token)).join(')(?=.*') + ').*$'
    const expression = new RegExp(regexpString, 'i')
    const query = validatedProperties.map((property) => {
      const fieldQuery = this.createFieldDictionary()
      fieldQuery[property] = expression
      return fieldQuery
    })

    return { $or: query }
  }

  private tokenize(searchText: string): string[] {
    if (typeof searchText !== 'string') {
      throw new DocumentValidationException('Search filter must be a primitive string')
    }
    if (searchText.length > MAX_SEARCH_TEXT_LENGTH) {
      throw new DocumentValidationException(
        `Search filter cannot exceed ${MAX_SEARCH_TEXT_LENGTH} UTF-16 code units`
      )
    }

    const trimmed = searchText.trim()
    if (trimmed.length === 0) {
      return []
    }

    const tokens = trimmed.split(/\s+/u)
    if (tokens.length > MAX_SEARCH_TOKENS) {
      throw new DocumentValidationException(
        `Search filter cannot exceed ${MAX_SEARCH_TOKENS} non-empty tokens`
      )
    }
    return tokens
  }

  private escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }

  sortKeyToSortTuple(key: string): SortTuple {
    if (typeof key !== 'string') {
      throw new DocumentValidationException('Sort keys must be primitive strings')
    }
    const isDesc = key.startsWith('-')
    const field = this.validateFieldPath(key.substring(isDesc ? 1 : 0))
    return [field, isDesc ? -1 : 1]
  }

  sortKeyOrListToSort(sortKeyOrList: unknown): Sort {
    if (typeof sortKeyOrList === 'string') {
      return [this.sortKeyToSortTuple(sortKeyOrList)]
    }
    if (!Array.isArray(sortKeyOrList)) {
      throw new DocumentValidationException(
        'Sort input must be a string or an array of strings'
      )
    }
    return this.copyDenseArrayValues(sortKeyOrList, 'Sort input').map((key) => {
      if (typeof key !== 'string') {
        throw new DocumentValidationException(
          'Sort input must be a string or an array of strings'
        )
      }
      return this.sortKeyToSortTuple(key)
    })
  }

  keyToObject(sortKey: unknown, negativeValue: number): object {
    if (typeof sortKey === 'string') {
      const sortObject = this.createFieldDictionary()
      const isDesc = sortKey.startsWith('-')
      const field = this.validateFieldPath(sortKey.substring(isDesc ? 1 : 0))
      sortObject[field] = isDesc ? negativeValue : 1
      return sortObject
    }
    return this.copyValidatedFieldObject(sortKey)
  }

  keyOrListToObject(
    sortKeyOrList: string | Array<string | object> | object,
    negativeValue: number
  ): object[] {
    if (typeof sortKeyOrList === 'string') {
      return [this.keyToObject(sortKeyOrList, negativeValue)]
    }
    if (!Array.isArray(sortKeyOrList)) {
      return [this.keyToObject(sortKeyOrList, negativeValue)]
    }
    return this.copyDenseArrayValues(sortKeyOrList, 'Projection input').map((key) =>
      this.keyToObject(key, negativeValue)
    )
  }

  buildQuery<TReturnType extends IDbRecord>(
    cursor: FindCursor<TReturnType> | AggregationCursor<TReturnType>,
    parameters: Partial<IQueryParameters> = {}
  ): FindCursor<TReturnType> | AggregationCursor<TReturnType> {
    const normalized = this.normalizeQueryParameters(parameters)
    if (cursor instanceof AggregationCursor) {
      if (normalized.sort.length > 0) {
        cursor.sort(normalized.sort)
      }
      cursor.skip(normalized.skip).limit(normalized.limit).maxTimeMS(normalized.maxTimeMS)
      return cursor
    }
    return this.applyFindPagination(cursor, normalized)
  }

  private applyFindPagination<TReturnType extends IDbRecord>(
    cursor: FindCursor<TReturnType>,
    parameters: NormalizedQueryParameters
  ): FindCursor<TReturnType> {
    if (parameters.sort.length > 0) {
      cursor.sort(parameters.sort)
    }
    cursor.skip(parameters.skip)
    cursor.limit(parameters.limit)
    cursor.maxTimeMS(parameters.maxTimeMS)
    return cursor
  }

  private normalizeQueryParameters(queryParams: unknown): NormalizedQueryParameters {
    if (
      queryParams === null ||
      typeof queryParams !== 'object' ||
      Array.isArray(queryParams)
    ) {
      throw new DocumentValidationException(
        'Pagination query parameters must be an object'
      )
    }

    const parameters = this.copyOwnDataProperties(
      queryParams,
      'Pagination query parameters'
    )
    this.validateRuntimeFilter(parameters.filter)
    const skip = this.normalizeInteger(
      'skip',
      parameters.skip,
      0,
      Number.MAX_SAFE_INTEGER,
      0
    )
    const limit = this.normalizeInteger(
      'limit',
      parameters.limit,
      1,
      MAX_PAGINATION_LIMIT,
      DEFAULT_PAGINATION_LIMIT
    )
    const maxTimeMS = this.normalizeInteger(
      'maxTimeMS',
      parameters.maxTimeMS,
      1,
      MAX_PAGINATION_TIME_MS,
      MAX_PAGINATION_TIME_MS
    )
    const rawOutput = this.normalizeBoolean('rawOutput', parameters.rawOutput, false)
    const debugQuery = this.normalizeBoolean('debugQuery', parameters.debugQuery, false)
    const sort =
      typeof parameters.mongoSortOverride !== 'undefined'
        ? this.normalizeMongoSort(parameters.mongoSortOverride)
        : typeof parameters.sortKeyOrList !== 'undefined'
          ? (this.sortKeyOrListToSort(parameters.sortKeyOrList) as SortTuple[])
          : []
    const projection = this.normalizeProjection(parameters.projectionKeyOrList)

    return {
      ...(typeof parameters.filter === 'string' ? { filter: parameters.filter } : {}),
      skip,
      limit,
      maxTimeMS,
      sort,
      projection,
      rawOutput,
      debugQuery,
    }
  }

  private validateRuntimeFilter(filter: unknown): asserts filter is string | undefined {
    if (typeof filter !== 'undefined' && typeof filter !== 'string') {
      throw new DocumentValidationException(
        'queryParams.filter must be a primitive string'
      )
    }
  }

  private validateTrustedQuery(
    query: Filter<TDocument> | undefined
  ): asserts query is Filter<TDocument> | undefined {
    if (typeof query === 'undefined') {
      return
    }
    if (query === null || typeof query !== 'object' || Array.isArray(query)) {
      throw new DocumentValidationException(
        'The trusted query argument must be a MongoDB Filter object'
      )
    }
    const prototype = Object.getPrototypeOf(query) as unknown
    if (prototype !== Object.prototype && prototype !== null) {
      throw new DocumentValidationException(
        'The trusted query argument must be a plain MongoDB Filter object'
      )
    }
    this.validateTrustedQueryValue(query, new WeakSet<object>())
  }

  private validateTrustedQueryValue(value: unknown, seen: WeakSet<object>): void {
    if (
      typeof value === 'undefined' ||
      typeof value === 'function' ||
      typeof value === 'symbol'
    ) {
      throw new DocumentValidationException(
        'The trusted query contains a value that BSON can omit or cannot serialize safely'
      )
    }
    if (value === null || typeof value !== 'object') {
      return
    }
    if (
      value instanceof Date ||
      value instanceof RegExp ||
      value instanceof BSON.BSONValue ||
      ArrayBuffer.isView(value)
    ) {
      return
    }
    if (seen.has(value)) {
      throw new DocumentValidationException('The trusted query cannot contain cycles')
    }
    seen.add(value)

    if (Array.isArray(value)) {
      const prototype = Object.getPrototypeOf(value) as unknown
      if (prototype !== Array.prototype) {
        throw new DocumentValidationException(
          'The trusted query can contain only plain arrays'
        )
      }
      this.copyDenseArrayValues(value, 'The trusted query').forEach((entry) =>
        this.validateTrustedQueryValue(entry, seen)
      )
      seen.delete(value)
      return
    }

    const properties = this.copyOwnDataProperties(value, 'The trusted query')
    Object.values(properties).forEach((child) =>
      this.validateTrustedQueryValue(child, seen)
    )
    seen.delete(value)
  }

  private normalizeInteger(
    name: string,
    value: unknown,
    minimum: number,
    maximum: number,
    defaultValue: number
  ): number {
    if (typeof value === 'undefined') {
      return defaultValue
    }
    if (
      typeof value !== 'number' ||
      !Number.isSafeInteger(value) ||
      value < minimum ||
      value > maximum
    ) {
      throw new DocumentValidationException(
        `${name} must be an integer from ${minimum} through ${maximum}`
      )
    }
    return value
  }

  private normalizeBoolean(name: string, value: unknown, defaultValue: boolean): boolean {
    if (typeof value === 'undefined') {
      return defaultValue
    }
    if (typeof value !== 'boolean') {
      throw new DocumentValidationException(`${name} must be a boolean`)
    }
    return value
  }

  private validateSearchableProperties(searchableProperties: unknown): string[] {
    if (!Array.isArray(searchableProperties)) {
      throw new DocumentValidationException(
        'searchableProperties must be an array of field paths'
      )
    }
    return this.copyDenseArrayValues(searchableProperties, 'searchableProperties').map(
      (property) => this.validateFieldPath(property)
    )
  }

  private validateFieldPath(field: unknown): string {
    if (typeof field !== 'string' || !fieldPathPattern.test(field)) {
      throw new DocumentValidationException(
        'Field paths must contain dot-separated alphanumeric or underscore segments'
      )
    }
    if (field.split('.').some((segment) => reservedFieldSegments.has(segment))) {
      throw new DocumentValidationException(
        'Field paths cannot contain reserved prototype segments'
      )
    }
    return field
  }

  private createFieldDictionary(): FieldDictionary {
    return Object.create(null) as FieldDictionary
  }

  private copyOwnDataProperties(value: object, label: string): FieldDictionary {
    const prototype = Object.getPrototypeOf(value) as unknown
    if (prototype !== Object.prototype && prototype !== null) {
      throw new DocumentValidationException(`${label} must be a plain object`)
    }

    const result = this.createFieldDictionary()
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== 'string') {
        throw new DocumentValidationException(`${label} cannot contain symbol keys`)
      }
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      if (!descriptor || !('value' in descriptor)) {
        throw new DocumentValidationException(`${label} cannot contain accessors`)
      }
      if (!descriptor.enumerable) {
        throw new DocumentValidationException(
          `${label} cannot contain non-enumerable properties`
        )
      }
      result[key] = descriptor.value
    }
    return result
  }

  private copyDenseArrayValues(value: unknown[], label: string): unknown[] {
    if (Object.getPrototypeOf(value) !== Array.prototype) {
      throw new DocumentValidationException(`${label} must be a plain array`)
    }
    const keys = Reflect.ownKeys(value).filter((key) => key !== 'length')
    if (keys.length !== value.length) {
      throw new DocumentValidationException(
        `${label} cannot contain sparse entries or extra properties`
      )
    }

    const result = new Array<unknown>(value.length)
    keys.forEach((key) => {
      if (
        typeof key !== 'string' ||
        !/^(0|[1-9][0-9]*)$/.test(key) ||
        Number(key) >= value.length
      ) {
        throw new DocumentValidationException(
          `${label} cannot contain sparse entries or extra properties`
        )
      }
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) {
        throw new DocumentValidationException(
          `${label} must contain enumerable data properties`
        )
      }
      result[Number(key)] = descriptor.value
    })
    return result
  }

  private copyValidatedFieldObject(value: unknown): FieldDictionary {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      throw new DocumentValidationException(
        'Projection entries must be strings or objects'
      )
    }
    const properties = this.copyOwnDataProperties(value, 'Projection entries')
    const result = this.createFieldDictionary()
    Object.entries(properties).forEach(([field, fieldValue]) => {
      if (fieldValue !== 0 && fieldValue !== 1) {
        throw new DocumentValidationException(
          'Projection values must be the numeric literals 0 or 1'
        )
      }
      result[this.validateFieldPath(field)] = fieldValue
    })
    return result
  }

  private normalizeProjection(value: unknown): FieldDictionary {
    const result = this.createFieldDictionary()
    if (typeof value === 'undefined') {
      return result
    }

    const entries = Array.isArray(value)
      ? this.copyDenseArrayValues(value, 'Projection input')
      : [value]
    entries.forEach((entry) => {
      if (typeof entry === 'string') {
        const projection = this.keyToObject(entry, 0)
        Object.entries(projection).forEach(([field, fieldValue]) => {
          result[field] = fieldValue
        })
        return
      }
      const projection = this.copyValidatedFieldObject(entry)
      Object.entries(projection).forEach(([field, fieldValue]) => {
        result[field] = fieldValue
      })
    })
    return result
  }

  private normalizeMongoSort(sort: unknown): SortTuple[] {
    if (typeof sort === 'string') {
      return [[this.validateFieldPath(sort), 1]]
    }
    if (sort instanceof Map) {
      if (Object.getPrototypeOf(sort) !== Map.prototype) {
        throw new DocumentValidationException('MongoDB sort maps must be plain maps')
      }
      return Array.from(Map.prototype.entries.call(sort)).map(([field, direction]) => {
        if (!this.isSortDirection(direction)) {
          throw new DocumentValidationException('Invalid MongoDB sort direction')
        }
        return [this.validateFieldPath(field), direction]
      })
    }
    if (Array.isArray(sort)) {
      const entries = this.copyDenseArrayValues(sort, 'MongoDB sort')
      if (entries.length === 0) {
        return []
      }
      if (
        entries.length === 2 &&
        typeof entries[0] === 'string' &&
        this.isSortDirection(entries[1])
      ) {
        return [[this.validateFieldPath(entries[0]), entries[1]]]
      }
      if (entries.every((entry) => typeof entry === 'string')) {
        return entries.map((field) => [this.validateFieldPath(field), 1])
      }
      if (entries.every((entry) => Array.isArray(entry))) {
        return entries.map((entry) => {
          const tuple = this.copyDenseArrayValues(
            entry as unknown[],
            'MongoDB sort tuple'
          )
          if (
            tuple.length !== 2 ||
            typeof tuple[0] !== 'string' ||
            !this.isSortDirection(tuple[1])
          ) {
            throw new DocumentValidationException('Invalid MongoDB sort input')
          }
          return [this.validateFieldPath(tuple[0]), tuple[1]]
        })
      }
      throw new DocumentValidationException('Invalid MongoDB sort input')
    }
    if (sort && typeof sort === 'object') {
      const properties = this.copyOwnDataProperties(sort, 'MongoDB sort')
      return Object.entries(properties).map(([field, direction]) => {
        if (!this.isSortDirection(direction)) {
          throw new DocumentValidationException('Invalid MongoDB sort direction')
        }
        return [this.validateFieldPath(field), direction]
      })
    }
    throw new DocumentValidationException('Invalid MongoDB sort input')
  }

  private isSortDirection(value: unknown): value is SortDirection {
    if (
      value === 1 ||
      value === -1 ||
      value === 'asc' ||
      value === 'desc' ||
      value === 'ascending' ||
      value === 'descending'
    ) {
      return true
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return false
    }
    const properties = this.copyOwnDataProperties(value, 'MongoDB sort direction')
    return Object.keys(properties).length === 1 && typeof properties.$meta === 'string'
  }

  private sortTuplesToObject(sort: SortTuple[]): FieldDictionary {
    const result = this.createFieldDictionary()
    sort.forEach(([field, direction]) => {
      result[this.validateFieldPath(field)] = direction
    })
    return result
  }

  private assertReadOnlyAggregationPipeline(pipeline: object[]): void {
    this.walkAggregationPipeline(pipeline, (operator) => {
      if (operator === '$out' || operator === '$merge') {
        throw new DocumentValidationException(
          'Pagination aggregation pipelines cannot contain $out or $merge stages'
        )
      }
    })
  }

  private assertSafeSerializedAggregationPipeline(pipeline: object[]): void {
    this.walkAggregationPipeline(pipeline, (operator, specification) => {
      if (!serializedOutputSafeStageOperators.has(operator)) {
        throw new DocumentValidationException(
          `Aggregation stage ${operator} requires explicit rawOutput: true because it can rename, synthesize, or import fields`
        )
      }
      if (operator === '$project') {
        this.copyValidatedFieldObject(specification)
      }
    })
  }

  private validateAndApplyAggregationScope(
    pipeline: object[],
    builtQuery: Filter<TDocument>
  ): void {
    this.assertReadOnlyAggregationPipeline(pipeline)
    this.validateTrustedQuery(builtQuery)
    if (this.hasQuery(builtQuery)) {
      this.assertScopeCanPrecedePipeline(pipeline)
      pipeline.unshift({ $match: builtQuery })
    }
  }

  private assertScopeCanPrecedePipeline(pipeline: object[]): void {
    const firstStage = pipeline[0]
    if (!firstStage || typeof firstStage !== 'object') {
      return
    }
    const firstStageProperties = this.copyOwnDataProperties(
      firstStage,
      'Aggregation pipeline stages'
    )
    const firstStageKeys = Object.keys(firstStageProperties)
    const hasFirstOnlyOperator = firstStageKeys.some((key) =>
      firstStageOnlyOperators.has(key)
    )
    const match = firstStageProperties.$match
    const hasTextMatch = this.containsOperator(match, '$text')
    if (hasFirstOnlyOperator || hasTextMatch) {
      throw new DocumentValidationException(
        'The mandatory query scope cannot safely precede this first-stage aggregation operator'
      )
    }

    this.walkAggregationPipeline(pipeline, (operator) => {
      if (foreignDocumentStageOperators.has(operator)) {
        throw new DocumentValidationException(
          'Mandatory query scope cannot be combined with aggregation stages that import foreign documents'
        )
      }
    })
  }

  private walkAggregationPipeline(
    pipeline: object[],
    visit: (operator: string, specification: unknown) => void
  ): void {
    if (!Array.isArray(pipeline)) {
      throw new DocumentValidationException('Aggregation pipeline must be an array')
    }

    this.copyDenseArrayValues(pipeline, 'Aggregation pipeline').forEach((stage) => {
      if (!stage || typeof stage !== 'object' || Array.isArray(stage)) {
        throw new DocumentValidationException(
          'Aggregation pipeline stages must be plain objects'
        )
      }
      const stageProperties = this.copyOwnDataProperties(
        stage,
        'Aggregation pipeline stages'
      )
      const operators = Object.keys(stageProperties)
      const operator = operators[0]
      if (
        operators.length !== 1 ||
        typeof operator !== 'string' ||
        !operator.startsWith('$')
      ) {
        throw new DocumentValidationException(
          'Aggregation pipeline stages must contain exactly one operator'
        )
      }
      const specification = stageProperties[operator]
      visit(operator, specification)
      if (!nestedPipelineStageOperators.has(operator)) {
        return
      }

      if (operator === '$facet') {
        if (
          !specification ||
          typeof specification !== 'object' ||
          Array.isArray(specification)
        ) {
          throw new DocumentValidationException('$facet must contain pipeline arrays')
        }
        const facets = this.copyOwnDataProperties(specification, '$facet')
        Object.values(facets).forEach((nestedPipeline) => {
          if (!Array.isArray(nestedPipeline)) {
            throw new DocumentValidationException('$facet must contain pipeline arrays')
          }
          this.walkAggregationPipeline(nestedPipeline as object[], visit)
        })
        return
      }

      if (
        specification &&
        typeof specification === 'object' &&
        !Array.isArray(specification)
      ) {
        const source = this.copyOwnDataProperties(specification, operator)
        if (typeof source.pipeline !== 'undefined') {
          if (!Array.isArray(source.pipeline)) {
            throw new DocumentValidationException(`${operator}.pipeline must be an array`)
          }
          this.walkAggregationPipeline(source.pipeline as object[], visit)
        }
      }
    })
  }

  private containsOperator(
    value: unknown,
    operator: string,
    seen = new WeakSet<object>()
  ): boolean {
    if (Array.isArray(value)) {
      if (seen.has(value)) {
        throw new DocumentValidationException(
          'Aggregation operator expressions cannot contain cycles'
        )
      }
      seen.add(value)
      const entries = this.copyDenseArrayValues(value, 'Aggregation operator expressions')
      for (let index = 0; index < entries.length; index += 1) {
        if (this.containsOperator(entries[index], operator, seen)) {
          seen.delete(value)
          return true
        }
      }
      seen.delete(value)
      return false
    }
    if (!value || typeof value !== 'object') {
      return false
    }
    if (
      value instanceof Date ||
      value instanceof RegExp ||
      value instanceof BSON.BSONValue ||
      ArrayBuffer.isView(value)
    ) {
      return false
    }
    if (seen.has(value)) {
      throw new DocumentValidationException(
        'Aggregation operator expressions cannot contain cycles'
      )
    }
    seen.add(value)
    const properties = this.copyOwnDataProperties(
      value,
      'Aggregation operator expressions'
    )
    const keys = Object.keys(properties)
    for (const key of keys) {
      if (key === operator || this.containsOperator(properties[key], operator, seen)) {
        seen.delete(value)
        return true
      }
    }
    seen.delete(value)
    return false
  }

  private hasQuery(query?: object): query is object {
    return !!query && Object.keys(query).length > 0
  }

  private logQuerySummary(
    operation: 'find' | 'aggregate',
    parameters: NormalizedQueryParameters,
    builtQuery: Filter<TDocument>
  ): void {
    if (!parameters.debugQuery) {
      return
    }
    console.log({
      operation,
      collection: this.collectionName,
      skip: parameters.skip,
      limit: parameters.limit,
      filterFields: this.collectFilterFields(builtQuery),
      sortFields: parameters.sort.map(([field]) => field),
      projectionFields: Object.keys(parameters.projection),
    })
  }

  private collectFilterFields(value: unknown, fields = new Set<string>()): string[] {
    if (!value || typeof value !== 'object') {
      return Array.from(fields)
    }
    Object.entries(value).forEach(([key, child]) => {
      if (!key.startsWith('$')) {
        fields.add(key)
        return
      }
      if (key === '$and' || key === '$or' || key === '$nor') {
        if (Array.isArray(child)) {
          child.forEach((entry) => this.collectFilterFields(entry, fields))
        }
      }
    })
    return Array.from(fields)
  }
}
