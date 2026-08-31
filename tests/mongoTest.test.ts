import { describe, expect, test } from '@jest/globals'

import { testMongoUri } from './mongoTest'

describe('MongoDB test namespace', () => {
  test('separates concurrent runs and retry attempts', () => {
    const first = new URL(
      testMongoUri('document', {
        MONGO_URI: 'mongodb://mongodb:27017',
        GITHUB_RUN_ID: '1234',
        GITHUB_RUN_ATTEMPT: '1',
        JEST_WORKER_ID: '2',
      })
    )
    const retry = new URL(
      testMongoUri('document', {
        MONGO_URI: 'mongodb://mongodb:27017',
        GITHUB_RUN_ID: '1234',
        GITHUB_RUN_ATTEMPT: '2',
        JEST_WORKER_ID: '2',
      })
    )
    const separateRun = new URL(
      testMongoUri('document', {
        MONGO_URI: 'mongodb://mongodb:27017',
        DOCUMENT_TS_TEST_RUN_ID: 'local-run-b',
        JEST_WORKER_ID: '2',
      })
    )

    expect(first.pathname).not.toBe(retry.pathname)
    expect(first.pathname).not.toBe(separateRun.pathname)
    expect(retry.pathname).not.toBe(separateRun.pathname)
  })

  test('sanitizes and bounds database names while preserving the base URI', () => {
    const uri = new URL(
      testMongoUri('suite/with spaces', {
        MONGO_URI: 'mongodb://example.test:27018/original?directConnection=true',
        DOCUMENT_TS_TEST_RUN_ID: '../'.repeat(30),
        JEST_WORKER_ID: 'worker:1',
      })
    )
    const database = uri.pathname.slice(1)

    expect(uri.host).toBe('example.test:27018')
    expect(uri.searchParams.get('directConnection')).toBe('true')
    expect(database).toMatch(/^[a-zA-Z0-9_]+$/)
    expect(database.length).toBeLessThanOrEqual(63)
  })
})
