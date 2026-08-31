/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-return */
import { beforeEach, describe, expect, jest, test } from '@jest/globals'

import { AggregationCursor, Collection, ObjectId } from 'mongodb'

import {
  CollectionFactory,
  DEFAULT_PAGINATION_LIMIT,
  Document,
  DocumentException,
  IDocument,
  MAX_PAGINATION_LIMIT,
  MAX_PAGINATION_TIME_MS,
  MAX_SEARCH_TEXT_LENGTH,
  MAX_SEARCH_TOKENS,
} from '../src'

interface ISecureRecord extends IDocument {
  name: string
  tenantId: string
  password: string
}

class SecureRecord extends Document<ISecureRecord> implements ISecureRecord {
  name: string
  tenantId: string
  password: string

  constructor(record?: Partial<ISecureRecord>) {
    super('secure-records')
    if (record) this.fillData(record)
  }

  protected applyData(data?: Partial<ISecureRecord>): void {
    if (data) {
      Object.assign(this, data)
    }
  }

  protected getCalculatedPropertiesToInclude(): string[] {
    return []
  }

  protected getPropertiesToExclude(): string[] {
    return ['password']
  }
}

function makeFindCursor(documents: ISecureRecord[] = []) {
  const cursor: any = {
    client: { uri: 'mongodb://user:secret@example.test/private' },
    sort: jest.fn(),
    skip: jest.fn(),
    limit: jest.fn(),
    maxTimeMS: jest.fn(),
  }
  cursor.sort.mockReturnValue(cursor)
  cursor.skip.mockReturnValue(cursor)
  cursor.limit.mockReturnValue(cursor)
  cursor.maxTimeMS.mockReturnValue(cursor)
  cursor[Symbol.asyncIterator] = async function* () {
    for (const document of documents) {
      yield document
    }
  }
  return cursor
}

function makeAggregationCursor(
  pipeline: object[] = [],
  data: ISecureRecord[] = [],
  total = data.length
) {
  const cursor: any = {
    pipeline: [...pipeline],
    maxTimeMS: jest.fn(),
    toArray: jest.fn(),
  }
  cursor.maxTimeMS.mockReturnValue(cursor)
  cursor.toArray.mockResolvedValue([
    {
      data,
      total: total > 0 ? [{ count: total }] : [],
    },
  ])
  return cursor as AggregationCursor<ISecureRecord> & {
    maxTimeMS: jest.Mock
    toArray: jest.Mock
  }
}

class SecureCollectionFactory extends CollectionFactory<SecureRecord> {
  findCursor = makeFindCursor()
  findMock = jest.fn(() => this.findCursor)
  countMock = jest.fn(async () => 0)
  aggregateMock = jest.fn()

  constructor() {
    super('secure-records', SecureRecord, ['name'])
  }

  override get collection() {
    return () =>
      ({
        find: this.findMock,
        countDocuments: this.countMock,
        aggregate: this.aggregateMock,
      }) as unknown as Collection<SecureRecord>
  }

  setDocuments(documents: ISecureRecord[]): void {
    this.findCursor = makeFindCursor(documents)
    this.findMock.mockImplementation(() => this.findCursor)
    this.countMock.mockResolvedValue(documents.length)
  }
}

function record(overrides: Partial<ISecureRecord> = {}): ISecureRecord {
  return {
    _id: new ObjectId(),
    name: 'Alice',
    tenantId: 'tenant-a',
    password: 'password-hash',
    ...overrides,
  } as ISecureRecord
}

describe('query security controls', () => {
  let collection: SecureCollectionFactory

  beforeEach(() => {
    collection = new SecureCollectionFactory()
  })

  describe('literal and bounded search', () => {
    test('exports the documented search limits', () => {
      expect(MAX_SEARCH_TEXT_LENGTH).toBe(256)
      expect(MAX_SEARCH_TOKENS).toBe(16)
    })

    test.each(['\\', '^', '$', '.', '*', '+', '?', '(', ')', '[', ']', '{', '}', '|'])(
      'treats %s as a literal character',
      (metacharacter) => {
        const query = collection.buildTokenizedQueryObject(metacharacter, ['name']) as any
        const expression = query.$or[0].name as RegExp
        const escaped = metacharacter.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

        expect(expression.source).toBe(new RegExp(`^(?=.*${escaped}).*$`, 'i').source)
        expect(expression.test(metacharacter)).toBe(true)
      }
    )

    test.each(['[', '{', '(', '\\'])('does not throw for unmatched %s input', (value) => {
      expect(() => collection.buildTokenizedQueryObject(value, ['name'])).not.toThrow()
    })

    test.each(['', ' ', '\t\n'])(
      'produces no search predicate for blank input',
      (value) => {
        expect(collection.buildTokenizedQueryObject(value, ['name'])).toEqual({})
      }
    )

    test('validates searchable field paths even when text is blank', () => {
      expect(() =>
        collection.buildTokenizedQueryObject('', ['profile.__proto__'])
      ).toThrow(DocumentException)
    })

    test('rejects non-string search text and missing searchable fields', () => {
      expect(() => collection.buildTokenizedQueryObject(1 as any, ['name'])).toThrow(
        DocumentException
      )
      expect(() => collection.buildTokenizedQueryObject('Alice', [])).toThrow(
        DocumentException
      )
      expect(() => collection.buildTokenizedQueryObject('Alice', null as any)).toThrow(
        DocumentException
      )
    })

    test('accepts exactly the text and token limits', () => {
      expect(() =>
        collection.buildTokenizedQueryObject('a'.repeat(MAX_SEARCH_TEXT_LENGTH), ['name'])
      ).not.toThrow()
      expect(() =>
        collection.buildTokenizedQueryObject(
          Array.from({ length: MAX_SEARCH_TOKENS }, () => 'a').join(' '),
          ['name']
        )
      ).not.toThrow()
    })

    test('rejects one over the text and token limits with typed errors', () => {
      expect(() =>
        collection.buildTokenizedQueryObject('a'.repeat(MAX_SEARCH_TEXT_LENGTH + 1), [
          'name',
        ])
      ).toThrow(DocumentException)
      expect(() =>
        collection.buildTokenizedQueryObject(' '.repeat(MAX_SEARCH_TEXT_LENGTH + 1), [
          'name',
        ])
      ).toThrow(DocumentException)
      expect(() =>
        collection.buildTokenizedQueryObject(
          Array.from({ length: MAX_SEARCH_TOKENS + 1 }, () => 'a').join(' '),
          ['name']
        )
      ).toThrow(DocumentException)
    })

    test.each([
      'a'.repeat(MAX_SEARCH_TEXT_LENGTH + 1),
      Array.from({ length: MAX_SEARCH_TOKENS + 1 }, () => 'a').join(' '),
    ])('rejects over-limit search text before database access', async (filter) => {
      const aggregationFactory = jest.fn()

      await expect(
        collection.findWithPagination({ filter }, aggregationFactory as any)
      ).rejects.toThrow(DocumentException)
      expect(aggregationFactory).not.toHaveBeenCalled()
      expect(collection.findMock).not.toHaveBeenCalled()
      expect(collection.countMock).not.toHaveBeenCalled()
    })

    test('handles a maximum-length repeated-metacharacter input literally', () => {
      const searchText = '*'.repeat(MAX_SEARCH_TEXT_LENGTH)
      const query = collection.buildTokenizedQueryObject(searchText, ['name']) as any
      const expression = query.$or[0].name as RegExp

      expect(expression.test(searchText)).toBe(true)
      expect(expression.source).toContain('\\*\\*\\*')
    })
  })

  describe('runtime filter separation', () => {
    const sparseTenantArray = new Array<unknown>(2)
    sparseTenantArray[1] = 'tenant-a'
    const rejectedFilters: Array<[string, unknown]> = [
      ['null', null],
      ['array', []],
      ['plain object', {}],
      ['boxed string', new String('search')],
      ['number', 1],
      ['NaN', Number.NaN],
      ['boolean', true],
      ['bigint', BigInt(1)],
      ['symbol', Symbol('search')],
      ['function', () => 'search'],
      ['$where operator', { $where: 'return true' }],
      ['$ne operator', { $ne: null }],
    ]

    test.each(rejectedFilters)(
      'rejects a %s before database access',
      async (_, value) => {
        const aggregationFactory = jest.fn()

        await expect(
          collection.findWithPagination(
            { filter: value } as any,
            aggregationFactory as any
          )
        ).rejects.toThrow(DocumentException)
        expect(aggregationFactory).not.toHaveBeenCalled()
        expect(collection.findMock).not.toHaveBeenCalled()
        expect(collection.countMock).not.toHaveBeenCalled()
      }
    )

    test.each([{}, { filter: undefined }, { filter: 'Alice' }])(
      'accepts an omitted, undefined, or primitive string filter',
      async (parameters) => {
        await expect(collection.findWithPagination(parameters)).resolves.toBeDefined()
        expect(collection.findMock).toHaveBeenCalledTimes(1)
      }
    )

    test('accepts a trusted object only through the named query argument', async () => {
      await collection.findWithPagination({}, undefined, { tenantId: 'tenant-a' })

      expect(collection.findMock).toHaveBeenCalledWith(
        { tenantId: 'tenant-a' },
        expect.any(Object)
      )
    })

    test.each([
      'untrusted',
      null,
      [],
      new String('untrusted'),
      new Date(),
      /tenant-a/,
      new ObjectId(),
      Buffer.from('tenant-a'),
      new Uint8Array([1, 2, 3]),
    ])('rejects invalid trusted query value %p before database access', async (query) => {
      const aggregationFactory = jest.fn()
      await expect(
        collection.findWithPagination({}, aggregationFactory as any, query as any)
      ).rejects.toThrow(DocumentException)
      expect(aggregationFactory).not.toHaveBeenCalled()
      expect(collection.findMock).not.toHaveBeenCalled()
    })

    test.each([
      { tenantId: undefined },
      { tenantId: () => 'tenant-a' },
      { tenantId: Symbol('tenant-a') },
      { tenantId: sparseTenantArray },
    ])(
      'rejects BSON-omitted or unsafe trusted query value %p before database access',
      async (query) => {
        const aggregationFactory = jest.fn()

        await expect(
          collection.findWithPagination({}, aggregationFactory as any, query as any)
        ).rejects.toThrow(DocumentException)
        expect(aggregationFactory).not.toHaveBeenCalled()
        expect(collection.findMock).not.toHaveBeenCalled()
      }
    )

    test('rejects symbol, non-enumerable, and accessor trusted query keys', async () => {
      const symbolQuery = { [Symbol('tenantId')]: 'tenant-a' }
      const nonEnumerableQuery = {}
      Object.defineProperty(nonEnumerableQuery, 'tenantId', { value: 'tenant-a' })
      const accessor = jest.fn(() => 'tenant-a')
      const accessorQuery = {}
      Object.defineProperty(accessorQuery, 'tenantId', {
        enumerable: true,
        get: accessor,
      })

      for (const query of [symbolQuery, nonEnumerableQuery, accessorQuery]) {
        await expect(
          collection.findWithPagination({}, undefined, query as any)
        ).rejects.toThrow(DocumentException)
      }

      expect(accessor).not.toHaveBeenCalled()
      expect(collection.findMock).not.toHaveBeenCalled()
    })
  })

  describe('bounded pagination', () => {
    const invalidParameters: Array<[string, object]> = [
      ['string skip', { skip: '10' }],
      ['negative skip', { skip: -1 }],
      ['fractional skip', { skip: 0.5 }],
      ['NaN skip', { skip: Number.NaN }],
      ['infinite skip', { skip: Number.POSITIVE_INFINITY }],
      ['unsafe skip', { skip: Number.MAX_SAFE_INTEGER + 1 }],
      ['string limit', { limit: '10' }],
      ['zero limit', { limit: 0 }],
      ['negative limit', { limit: -1 }],
      ['fractional limit', { limit: 1.5 }],
      ['NaN limit', { limit: Number.NaN }],
      ['infinite limit', { limit: Number.POSITIVE_INFINITY }],
      ['oversized limit', { limit: MAX_PAGINATION_LIMIT + 1 }],
      ['zero maxTimeMS', { maxTimeMS: 0 }],
      ['string maxTimeMS', { maxTimeMS: '100' }],
      ['oversized maxTimeMS', { maxTimeMS: MAX_PAGINATION_TIME_MS + 1 }],
      ['non-boolean rawOutput', { rawOutput: 1 }],
      ['non-boolean debugQuery', { debugQuery: 'true' }],
    ]

    test.each(invalidParameters)(
      'rejects %s before database access',
      async (_, value) => {
        const aggregationFactory = jest.fn()

        await expect(
          collection.findWithPagination(value as any, aggregationFactory as any)
        ).rejects.toThrow(DocumentException)
        expect(aggregationFactory).not.toHaveBeenCalled()
        expect(collection.findMock).not.toHaveBeenCalled()
        expect(collection.countMock).not.toHaveBeenCalled()
      }
    )

    test('applies explicit finite defaults and a timeout', async () => {
      await collection.findWithPagination({})

      expect(collection.findCursor.skip).toHaveBeenCalledWith(0)
      expect(collection.findCursor.limit).toHaveBeenCalledWith(DEFAULT_PAGINATION_LIMIT)
      expect(collection.findCursor.maxTimeMS).toHaveBeenCalledWith(MAX_PAGINATION_TIME_MS)
      expect(collection.countMock).toHaveBeenCalledWith(
        {},
        {
          maxTimeMS: MAX_PAGINATION_TIME_MS,
        }
      )
    })

    test('accepts boundary pagination values and a lower timeout', async () => {
      await collection.findWithPagination({
        skip: Number.MAX_SAFE_INTEGER,
        limit: MAX_PAGINATION_LIMIT,
        maxTimeMS: 1,
      })

      expect(collection.findCursor.skip).toHaveBeenCalledWith(Number.MAX_SAFE_INTEGER)
      expect(collection.findCursor.limit).toHaveBeenCalledWith(MAX_PAGINATION_LIMIT)
      expect(collection.findCursor.maxTimeMS).toHaveBeenCalledWith(1)
    })

    test('rejects inherited query parameters before database access', async () => {
      const inherited = Object.create({
        rawOutput: true,
        debugQuery: true,
        filter: 'private-filter',
        sortKeyOrList: '-password',
        projectionKeyOrList: { exposed: '$password' },
        skip: 5,
        limit: 1,
        maxTimeMS: 1,
      })

      await expect(collection.findWithPagination(inherited)).rejects.toThrow(
        DocumentException
      )
      expect(collection.findMock).not.toHaveBeenCalled()
      expect(collection.countMock).not.toHaveBeenCalled()
    })

    test('ignores polluted Object.prototype query options and preserves safe defaults', async () => {
      const optionNames = [
        'rawOutput',
        'debugQuery',
        'filter',
        'sortKeyOrList',
        'projectionKeyOrList',
        'skip',
        'limit',
        'maxTimeMS',
      ]
      const before = Object.getOwnPropertyNames(Object.prototype)
      const log = jest.spyOn(console, 'log').mockImplementation(() => undefined)
      collection.setDocuments([record()])

      Object.defineProperties(Object.prototype, {
        rawOutput: { configurable: true, value: true },
        debugQuery: { configurable: true, value: true },
        filter: { configurable: true, value: 'private-filter' },
        sortKeyOrList: { configurable: true, value: '-password' },
        projectionKeyOrList: {
          configurable: true,
          value: { exposed: '$password' },
        },
        skip: { configurable: true, value: 5 },
        limit: { configurable: true, value: 1 },
        maxTimeMS: { configurable: true, value: 1 },
      })

      try {
        const result = await collection.findWithPagination<ISecureRecord>({})

        expect((result.data[0] as any).password).toBeUndefined()
        expect(log).not.toHaveBeenCalled()
        expect(collection.findCursor.skip).toHaveBeenCalledWith(0)
        expect(collection.findCursor.limit).toHaveBeenCalledWith(DEFAULT_PAGINATION_LIMIT)
        expect(collection.findCursor.maxTimeMS).toHaveBeenCalledWith(
          MAX_PAGINATION_TIME_MS
        )
      } finally {
        optionNames.forEach((name) => Reflect.deleteProperty(Object.prototype, name))
      }

      expect(Object.getOwnPropertyNames(Object.prototype)).toEqual(before)
    })

    test('rejects accessor query parameters without invoking them', async () => {
      const accessor = jest.fn(() => true)
      const parameters = {}
      Object.defineProperty(parameters, 'rawOutput', {
        enumerable: true,
        get: accessor,
      })

      await expect(collection.findWithPagination(parameters)).rejects.toThrow(
        DocumentException
      )
      expect(accessor).not.toHaveBeenCalled()
      expect(collection.findMock).not.toHaveBeenCalled()
    })
  })

  describe('safe output and diagnostics', () => {
    test('redacts model exclusions by default for find results', async () => {
      collection.setDocuments([record()])

      const result = await collection.findWithPagination<ISecureRecord>({})

      expect((result.data[0] as any).password).toBeUndefined()
      expect(result.data[0].name).toBe('Alice')
    })

    test('rejects inherited find options before database access', async () => {
      const inherited = Object.create({ rawOutput: true })

      await expect(collection.find({}, inherited)).rejects.toThrow(DocumentException)
      expect(collection.findMock).not.toHaveBeenCalled()
    })

    test('ignores Object.prototype pollution when normalizing find options', async () => {
      collection.setDocuments([record()])
      Object.defineProperty(Object.prototype, 'rawOutput', {
        configurable: true,
        value: true,
      })

      try {
        const result = await collection.find<ISecureRecord>({}, {})
        expect((result.data[0] as any).password).toBeUndefined()
      } finally {
        Reflect.deleteProperty(Object.prototype, 'rawOutput')
      }
    })

    test('rejects accessor find options without invoking them', async () => {
      const accessor = jest.fn(() => true)
      const options = {}
      Object.defineProperty(options, 'rawOutput', {
        enumerable: true,
        get: accessor,
      })

      await expect(collection.find({}, options)).rejects.toThrow(DocumentException)
      expect(accessor).not.toHaveBeenCalled()
      expect(collection.findMock).not.toHaveBeenCalled()
    })

    test('allows raw find output only through rawOutput true', async () => {
      collection.setDocuments([record()])

      const result = await collection.findWithPagination<ISecureRecord>({
        rawOutput: true,
        projectionKeyOrList: ['name', 'password'],
      })

      expect(result.data[0].password).toBe('password-hash')
    })

    test('does not let a projection implicitly enable raw output', async () => {
      collection.setDocuments([record()])

      const result = await collection.findWithPagination<ISecureRecord>({
        projectionKeyOrList: ['name', 'password'],
      })

      expect((result.data[0] as any).password).toBeUndefined()
    })

    test.each([
      { exposed: '$password' },
      { exposed: { $literal: 'private-value' } },
      { exposed: true },
    ])(
      'rejects computed projection %p before find or aggregation execution',
      async (projectionKeyOrList) => {
        const aggregationFactory = jest.fn()

        await expect(
          collection.findWithPagination(
            { projectionKeyOrList: projectionKeyOrList as any },
            aggregationFactory as any
          )
        ).rejects.toThrow(DocumentException)
        expect(aggregationFactory).not.toHaveBeenCalled()
        expect(collection.findMock).not.toHaveBeenCalled()
      }
    )

    test('redacts aggregation results by default and exposes raw output explicitly', async () => {
      const safeCursor = makeAggregationCursor([], [record()])
      const rawCursor = makeAggregationCursor([], [record()])

      const safe = await collection.findWithPagination<ISecureRecord>(
        {},
        () => safeCursor
      )
      const raw = await collection.findWithPagination<ISecureRecord>(
        { rawOutput: true },
        () => rawCursor
      )

      expect((safe.data[0] as any).password).toBeUndefined()
      expect(raw.data[0].password).toBe('password-hash')
    })

    test('logs one allowlisted summary without cursor, URI, or query values', async () => {
      collection.setDocuments([record()])
      const log = jest.spyOn(console, 'log').mockImplementation(() => undefined)

      await collection.findWithPagination(
        {
          filter: 'needle',
          sortKeyOrList: '-name',
          projectionKeyOrList: ['name'],
          debugQuery: true,
        },
        undefined,
        {
          $where: 'private-script',
          tenantId: 'tenant-secret',
          name: { $ne: 'private-name' },
        }
      )

      expect(log).toHaveBeenCalledTimes(1)
      expect(log.mock.calls[0]).toHaveLength(1)
      expect(Object.keys(log.mock.calls[0][0] as object)).toEqual([
        'operation',
        'collection',
        'skip',
        'limit',
        'filterFields',
        'sortFields',
        'projectionFields',
      ])
      const logged = JSON.stringify(log.mock.calls[0][0])
      expect(logged).not.toContain('mongodb://')
      expect(logged).not.toContain('user')
      expect(logged).not.toContain('secret')
      expect(logged).not.toContain('needle')
      expect(logged).not.toContain('private-name')
      expect(logged).not.toContain('private-script')
    })

    test('never derives logged field names from expression or literal values', async () => {
      const log = jest.spyOn(console, 'log').mockImplementation(() => undefined)

      await collection.findWithPagination({ debugQuery: true }, undefined, {
        $and: [{ tenantId: 'tenant-secret' }],
        $expr: {
          $eq: [
            { $literal: { 'api-key-12345': 'private-value' } },
            { $literal: { 'api-key-12345': 'other-private-value' } },
          ],
        },
      } as any)

      expect(log).toHaveBeenCalledTimes(1)
      expect((log.mock.calls[0][0] as any).filterFields).toEqual(['tenantId'])
      expect(JSON.stringify(log.mock.calls[0][0])).not.toContain('api-key-12345')
      expect(JSON.stringify(log.mock.calls[0][0])).not.toContain('private-value')
    })

    test('does not emit diagnostics when debugging is disabled', async () => {
      const log = jest.spyOn(console, 'log').mockImplementation(() => undefined)

      await collection.findWithPagination({}, undefined, { name: 'private-name' })

      expect(log).not.toHaveBeenCalled()
    })
  })

  describe('aggregation scope and consistency', () => {
    test('delegates aggregate pipelines to the configured collection', () => {
      const pipeline = [{ $match: { tenantId: 'tenant-a' } }]

      collection.aggregate(pipeline)

      expect(collection.aggregateMock).toHaveBeenCalledWith(pipeline)
    })

    test('rejects an invalid aggregation factory result before execution', async () => {
      await expect(collection.findWithPagination({}, () => null as any)).rejects.toThrow(
        DocumentException
      )
    })

    test('uses one scoped pipeline and one facet for rows and total', async () => {
      const cursor = makeAggregationCursor(
        [{ $project: { tenantId: 1, name: 1, password: 1 } }],
        [record()],
        3
      )
      const cursorFactory = jest.fn(() => cursor)

      const result = await collection.findWithPagination<ISecureRecord>(
        {
          skip: 1,
          limit: 2,
          sortKeyOrList: 'name',
          projectionKeyOrList: ['name'],
        },
        cursorFactory,
        { tenantId: 'tenant-a' }
      )

      expect(cursorFactory).toHaveBeenCalledTimes(1)
      // Jest assertions intentionally inspect the unbound mock method.
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(cursor.toArray).toHaveBeenCalledTimes(1)
      // Jest assertions intentionally inspect the unbound mock method.
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(cursor.maxTimeMS).toHaveBeenCalledWith(MAX_PAGINATION_TIME_MS)
      expect(cursor.pipeline[0]).toEqual({ $match: { tenantId: 'tenant-a' } })
      expect(cursor.pipeline[1]).toEqual({
        $project: { tenantId: 1, name: 1, password: 1 },
      })
      expect(cursor.pipeline[2]).toEqual({
        $facet: {
          data: [
            { $sort: { name: 1 } },
            { $skip: 1 },
            { $limit: 2 },
            { $project: { name: 1 } },
          ],
          total: [{ $count: 'count' }],
        },
      })
      expect(result.total).toBe(3)
      expect((result.data[0] as any).password).toBeUndefined()
    })

    test('honors searchableProperties overrides in the shared aggregation match', async () => {
      const cursor = makeAggregationCursor()

      await collection.findWithPagination<ISecureRecord>(
        { filter: 'tenant-a' },
        () => cursor,
        undefined,
        ['tenantId']
      )

      const match = (cursor.pipeline[0] as any).$match
      expect(match.$or[0].tenantId).toBeInstanceOf(RegExp)
      expect(match.$or[0].name).toBeUndefined()
    })

    test('returns an empty page and zero total when the facet is empty', async () => {
      const cursor = makeAggregationCursor([], [], 0)

      const result = await collection.findWithPagination<ISecureRecord>({}, () => cursor)

      expect(result).toEqual({ data: [], total: 0 })
    })

    test('supports direct count and aggregation total helpers', async () => {
      collection.countMock.mockResolvedValue(4)
      await expect(collection.getTotal()).resolves.toBe(4)

      const cursor: any = {
        pipeline: [],
        maxTimeMS: jest.fn().mockReturnThis(),
        toArray: jest.fn(async (): Promise<any[]> => [{ count: 2 }]),
      }
      await expect(collection.getTotal(cursor, { tenantId: 'tenant-a' })).resolves.toBe(2)
      expect(cursor.pipeline).toEqual([
        { $match: { tenantId: 'tenant-a' } },
        { $count: 'count' },
      ])
      expect(cursor.maxTimeMS).toHaveBeenCalledWith(MAX_PAGINATION_TIME_MS)

      cursor.pipeline = []
      cursor.toArray.mockResolvedValue([])
      await expect(collection.getTotal(cursor)).resolves.toBe(0)
    })

    test('applies mandatory-query validation and foreign-stage policy to getTotal', async () => {
      await expect(
        collection.getTotal(undefined, { tenantId: undefined } as any)
      ).rejects.toThrow(DocumentException)
      expect(collection.countMock).not.toHaveBeenCalled()

      const undefinedScope = makeAggregationCursor()
      await expect(
        collection.getTotal(undefinedScope, { tenantId: undefined } as any)
      ).rejects.toThrow(DocumentException)
      // Jest assertions intentionally inspect the unbound mock method.
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(undefinedScope.toArray).not.toHaveBeenCalled()

      const foreignSource = makeAggregationCursor([
        { $unionWith: { coll: 'secure-records' } },
      ])
      await expect(
        collection.getTotal(foreignSource, { tenantId: 'tenant-a' })
      ).rejects.toThrow(DocumentException)
      // Jest assertions intentionally inspect the unbound mock method.
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(foreignSource.toArray).not.toHaveBeenCalled()
    })

    test.each(['$out', '$merge'])(
      'rejects %s before aggregation execution',
      async (stage) => {
        const cursor = makeAggregationCursor([{ [stage]: 'target' }])
        const cursorFactory = jest.fn(() => cursor)

        await expect(collection.findWithPagination({}, cursorFactory)).rejects.toThrow(
          DocumentException
        )
        expect(cursorFactory).toHaveBeenCalledTimes(1)
        // Jest assertions intentionally inspect the unbound mock method.
        // eslint-disable-next-line @typescript-eslint/unbound-method
        expect(cursor.toArray).not.toHaveBeenCalled()
      }
    )

    test.each([
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
    ])(
      'rejects required-first stage %s when mandatory scope cannot precede it',
      async (operator) => {
        const cursor = makeAggregationCursor([{ [operator]: {} }])

        await expect(
          collection.findWithPagination({}, () => cursor, { tenantId: 'tenant-a' })
        ).rejects.toThrow(DocumentException)
        // Jest assertions intentionally inspect the unbound mock method.
        // eslint-disable-next-line @typescript-eslint/unbound-method
        expect(cursor.toArray).not.toHaveBeenCalled()
      }
    )

    test.each([
      { $match: { $text: { $search: 'Alice' } } },
      { $match: { $and: [{ $text: { $search: 'Alice' } }] } },
    ])('rejects a first-stage $text match before execution', async (stage) => {
      const cursor = makeAggregationCursor([stage])

      await expect(
        collection.findWithPagination({}, () => cursor, { tenantId: 'tenant-a' })
      ).rejects.toThrow(DocumentException)
      // Jest assertions intentionally inspect the unbound mock method.
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(cursor.toArray).not.toHaveBeenCalled()
    })

    test.each([
      { $unionWith: { coll: 'secure-records' } },
      {
        $lookup: {
          from: 'secure-records',
          localField: '_id',
          foreignField: '_id',
          as: 'foreignRecords',
        },
      },
      {
        $graphLookup: {
          from: 'secure-records',
          startWith: '$_id',
          connectFromField: '_id',
          connectToField: '_id',
          as: 'foreignRecords',
        },
      },
      { $facet: { leaked: [{ $unionWith: 'secure-records' }] } },
    ])('rejects foreign-document stage %p under mandatory scope', async (stage) => {
      const cursor = makeAggregationCursor([stage])

      await expect(
        collection.findWithPagination({}, () => cursor, { tenantId: 'tenant-a' })
      ).rejects.toThrow(DocumentException)
      // Jest assertions intentionally inspect the unbound mock method.
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(cursor.toArray).not.toHaveBeenCalled()
    })

    test.each(['$out', '$merge'])(
      'rejects nested write stage %s before aggregation execution',
      async (operator) => {
        const cursor = makeAggregationCursor([
          { $facet: { unsafe: [{ [operator]: 'target' }] } },
        ])

        await expect(collection.findWithPagination({}, () => cursor)).rejects.toThrow(
          DocumentException
        )
        // Jest assertions intentionally inspect the unbound mock method.
        // eslint-disable-next-line @typescript-eslint/unbound-method
        expect(cursor.toArray).not.toHaveBeenCalled()
      }
    )

    test('allows a foreign-document stage when no mandatory scope is supplied', async () => {
      const cursor = makeAggregationCursor([{ $unionWith: 'secure-records' }])

      await expect(
        collection.findWithPagination({ rawOutput: true }, () => cursor)
      ).resolves.toEqual({ data: [], total: 0 })
      expect(cursor.pipeline[0]).toEqual({ $unionWith: 'secure-records' })
      // Jest assertions intentionally inspect the unbound mock method.
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(cursor.toArray).toHaveBeenCalledTimes(1)
    })

    test('allows scope-preserving root and shape transforms after mandatory scope', async () => {
      const cursor = makeAggregationCursor([
        { $project: { nested: '$$ROOT' } },
        { $replaceRoot: { newRoot: '$nested' } },
      ])

      await expect(
        collection.findWithPagination({ rawOutput: true }, () => cursor, {
          tenantId: 'tenant-a',
        })
      ).resolves.toEqual({ data: [], total: 0 })
      expect(cursor.pipeline[0]).toEqual({ $match: { tenantId: 'tenant-a' } })
    })

    test.each([
      { $project: { leaked: '$password', _id: 1 } },
      { $set: { leaked: '$password' } },
      { $replaceWith: { leaked: '$password' } },
      { $lookup: { from: 'secure-records', pipeline: [], as: 'leaked' } },
    ])(
      'rejects disclosure-capable stage %p under default serialized output',
      async (stage) => {
        const cursor = makeAggregationCursor([stage])

        await expect(collection.findWithPagination({}, () => cursor)).rejects.toThrow(
          DocumentException
        )
        // Jest assertions intentionally inspect the unbound mock method.
        // eslint-disable-next-line @typescript-eslint/unbound-method
        expect(cursor.toArray).not.toHaveBeenCalled()
      }
    )

    test('rejects an aggregation pipeline with an overridden array iterator', async () => {
      const pipeline: any = [{ $unionWith: 'secure-records' }]
      pipeline.forEach = () => undefined
      const cursor = makeAggregationCursor(pipeline)

      await expect(
        collection.findWithPagination({}, () => cursor, { tenantId: 'tenant-a' })
      ).rejects.toThrow(DocumentException)
      // Jest assertions intentionally inspect the unbound mock method.
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(cursor.toArray).not.toHaveBeenCalled()
    })

    test.each(['overridden', 'sparse'])(
      'rejects %s nested operator arrays before aggregation execution',
      async (kind) => {
        const operands: any[] = new Array(2)
        operands[1] = { $text: { $search: 'Alice' } }
        if (kind === 'overridden') {
          operands[0] = { tenantId: 'tenant-a' }
          Object.defineProperty(operands, 'some', {
            enumerable: true,
            value: () => false,
          })
        }
        const cursor = makeAggregationCursor([{ $match: { $and: operands } }])

        await expect(
          collection.findWithPagination({}, () => cursor, { tenantId: 'tenant-a' })
        ).rejects.toThrow(DocumentException)
        // Jest assertions intentionally inspect the unbound mock method.
        // eslint-disable-next-line @typescript-eslint/unbound-method
        expect(cursor.toArray).not.toHaveBeenCalled()
      }
    )

    test('accepts BSON scalar leaves while checking first-stage operators', async () => {
      const cursor = makeAggregationCursor([{ $match: { name: /Alice/i } }])

      await expect(
        collection.findWithPagination({}, () => cursor, { tenantId: 'tenant-a' })
      ).resolves.toEqual({ data: [], total: 0 })
      expect(cursor.pipeline[0]).toEqual({ $match: { tenantId: 'tenant-a' } })
    })
  })

  describe('prototype-safe dynamic fields', () => {
    const invalidPaths = [
      '__proto__',
      'prototype',
      'constructor',
      'profile.__proto__',
      'profile.prototype.value',
      'profile.constructor',
      'profile..name',
      'profile.\0name',
      'profile-name',
      '1profile',
    ]

    test.each(invalidPaths)(
      'rejects invalid projection path %p before database access',
      async (path) => {
        const projection = { [path]: 1 }

        await expect(
          collection.findWithPagination({
            projectionKeyOrList: projection as Record<string, 1>,
          })
        ).rejects.toThrow(DocumentException)
        expect(collection.findMock).not.toHaveBeenCalled()
      }
    )

    test.each([
      { projectionKeyOrList: new Map([['name', 1]]) },
      { projectionKeyOrList: [null] },
      { projectionKeyOrList: [[]] },
      { sortKeyOrList: '' },
      { mongoSortOverride: { '': 1 } },
    ])(
      'rejects non-field shorthand input %p before database access',
      async (parameters) => {
        await expect(collection.findWithPagination(parameters as any)).rejects.toThrow(
          DocumentException
        )
        expect(collection.findMock).not.toHaveBeenCalled()
      }
    )

    test('rejects symbol, non-enumerable, and accessor projection keys', async () => {
      const symbolProjection = { [Symbol('private')]: 1 }
      const nonEnumerableProjection = {}
      Object.defineProperty(nonEnumerableProjection, 'name', { value: 1 })
      const accessor = jest.fn(() => 1)
      const accessorProjection = {}
      Object.defineProperty(accessorProjection, 'name', {
        enumerable: true,
        get: accessor,
      })

      for (const projectionKeyOrList of [
        symbolProjection,
        nonEnumerableProjection,
        accessorProjection,
      ]) {
        await expect(
          collection.findWithPagination({ projectionKeyOrList } as any)
        ).rejects.toThrow(DocumentException)
      }

      expect(accessor).not.toHaveBeenCalled()
      expect(collection.findMock).not.toHaveBeenCalled()
    })

    test('rejects symbol, non-enumerable, and accessor sort keys', async () => {
      const symbolSort = { [Symbol('private')]: 1 }
      const nonEnumerableSort = {}
      Object.defineProperty(nonEnumerableSort, 'name', { value: 1 })
      const accessor = jest.fn(() => 1)
      const accessorSort = {}
      Object.defineProperty(accessorSort, 'name', {
        enumerable: true,
        get: accessor,
      })

      for (const mongoSortOverride of [symbolSort, nonEnumerableSort, accessorSort]) {
        await expect(
          collection.findWithPagination({ mongoSortOverride } as any)
        ).rejects.toThrow(DocumentException)
      }

      expect(accessor).not.toHaveBeenCalled()
      expect(collection.findMock).not.toHaveBeenCalled()
    })

    test('rejects sparse or augmented projection, sort, and searchable arrays', async () => {
      const sparseProjection = new Array<unknown>(1)
      const sparseSort = new Array<unknown>(1)
      const sparseSearchableProperties = new Array<unknown>(1)
      const augmentedProjection = ['name']
      Object.defineProperty(augmentedProjection, 'extra', {
        enumerable: true,
        value: 'ignored',
      })

      await expect(
        collection.findWithPagination({
          projectionKeyOrList: sparseProjection as any,
        })
      ).rejects.toThrow(DocumentException)
      await expect(
        collection.findWithPagination({ mongoSortOverride: sparseSort as any })
      ).rejects.toThrow(DocumentException)
      await expect(
        collection.findWithPagination(
          { filter: 'Alice' },
          undefined,
          undefined,
          sparseSearchableProperties as any
        )
      ).rejects.toThrow(DocumentException)
      await expect(
        collection.findWithPagination({
          projectionKeyOrList: augmentedProjection as any,
        })
      ).rejects.toThrow(DocumentException)

      expect(collection.findMock).not.toHaveBeenCalled()
    })

    test('rejects explicit null searchable properties before database access', async () => {
      await expect(
        collection.findWithPagination(
          { filter: 'Alice' },
          undefined,
          undefined,
          null as any
        )
      ).rejects.toThrow(DocumentException)
      expect(collection.findMock).not.toHaveBeenCalled()
    })

    test('rejects nested sort-direction accessors without invoking them', async () => {
      const accessor = jest.fn(() => 'textScore')
      const direction = {}
      Object.defineProperty(direction, '$meta', {
        enumerable: true,
        get: accessor,
      })

      await expect(
        collection.findWithPagination({
          mongoSortOverride: { name: direction } as any,
        })
      ).rejects.toThrow(DocumentException)
      expect(accessor).not.toHaveBeenCalled()
      expect(collection.findMock).not.toHaveBeenCalled()
    })

    test.each(invalidPaths)(
      'rejects invalid sort path %p before database access',
      async (path) => {
        await expect(
          collection.findWithPagination({ mongoSortOverride: { [path]: 1 } })
        ).rejects.toThrow(DocumentException)
        expect(collection.findMock).not.toHaveBeenCalled()
      }
    )

    test.each(invalidPaths)(
      'rejects invalid searchable path %p before database access',
      async (path) => {
        await expect(
          collection.findWithPagination({ filter: 'Alice' }, undefined, undefined, [path])
        ).rejects.toThrow(DocumentException)
        expect(collection.findMock).not.toHaveBeenCalled()
      }
    )

    test('uses null-prototype dictionaries without mutating Object.prototype', async () => {
      const before = Object.getOwnPropertyNames(Object.prototype)
      const fields = collection.fieldsArrayToObject(['profile.name'])
      const projection = collection.keyToObject('profile.name', 0)
      const query = collection.buildTokenizedQueryObject('Alice', ['profile.name']) as any

      await collection.findWithPagination({ projectionKeyOrList: ['profile.name'] })
      const driverProjection = (collection.findMock.mock.calls as any)[0][1].projection

      expect(Object.getPrototypeOf(fields)).toBeNull()
      expect(Object.getPrototypeOf(projection)).toBeNull()
      expect(Object.getPrototypeOf(query.$or[0])).toBeNull()
      expect(Object.getPrototypeOf(driverProjection)).toBeNull()
      expect(Object.getOwnPropertyNames(Object.prototype)).toEqual(before)
    })

    test('normalizes valid object and list projection helpers into safe dictionaries', async () => {
      const objectProjection = collection.keyToObject({ name: 1 }, 0)
      const stringList = collection.keyOrListToObject(['name', '-password'], 0)
      const objectList = collection.keyOrListToObject([{ name: 1 }, { tenantId: 1 }], 0)

      expect(objectProjection).toEqual({ name: 1 })
      expect(stringList).toEqual([{ name: 1 }, { password: 0 }])
      expect(objectList).toEqual([{ name: 1 }, { tenantId: 1 }])

      await collection.findWithPagination({
        projectionKeyOrList: { name: 1, tenantId: 1 },
      })
      expect((collection.findMock.mock.calls as any)[0][1].projection).toEqual({
        name: 1,
        tenantId: 1,
      })
    })

    test('normalizes every supported MongoDB sort shape and rejects malformed shapes', async () => {
      const validSorts = [
        'name',
        new Map([['name', 1]]),
        [],
        ['name', 'desc'],
        ['name', 'tenantId', 'password'],
        [
          ['name', 1],
          ['tenantId', -1],
        ],
        { name: { $meta: 'textScore' } },
      ]

      for (const mongoSortOverride of validSorts) {
        await expect(
          collection.findWithPagination({ mongoSortOverride } as any)
        ).resolves.toBeDefined()
      }

      for (const mongoSortOverride of [[1, 2], { name: 0 }, 1]) {
        await expect(
          collection.findWithPagination({ mongoSortOverride } as any)
        ).rejects.toThrow(DocumentException)
      }
    })

    test('validates direct sort and cursor-builder helper inputs', () => {
      expect(collection.sortKeyOrListToSort('name')).toEqual([['name', 1]])
      expect(() => collection.sortKeyToSortTuple(1 as any)).toThrow(DocumentException)
      expect(() => collection.sortKeyOrListToSort({} as any)).toThrow(DocumentException)

      const findCursor = makeFindCursor()
      expect(
        collection.buildQuery(findCursor, { sortKeyOrList: '-name', limit: 1 })
      ).toBe(findCursor)
      expect(findCursor.sort).toHaveBeenCalledWith([['name', -1]])
      expect(findCursor.limit).toHaveBeenCalledWith(1)

      const aggregationCursor: any = {
        sort: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        maxTimeMS: jest.fn().mockReturnThis(),
      }
      Object.setPrototypeOf(aggregationCursor, AggregationCursor.prototype)
      expect(
        collection.buildQuery(aggregationCursor, {
          mongoSortOverride: { name: 1 },
          skip: 1,
          limit: 2,
          maxTimeMS: 3,
        })
      ).toBe(aggregationCursor)
      expect(aggregationCursor.sort).toHaveBeenCalledWith([['name', 1]])
      expect(aggregationCursor.skip).toHaveBeenCalledWith(1)
      expect(aggregationCursor.limit).toHaveBeenCalledWith(2)
      expect(aggregationCursor.maxTimeMS).toHaveBeenCalledWith(3)
    })
  })
})
