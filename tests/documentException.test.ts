import { describe, expect, test } from '@jest/globals'

import {
  DocumentConflictException,
  DocumentException,
  DocumentHydrationException,
  DocumentIdentifierException,
  DocumentValidationException,
} from '../src/index'

describe('DocumentException', () => {
  test('maps primitive and string-coded failures without leaking their values', () => {
    const operationFailure = DocumentException.from('private failure value')
    expect(operationFailure.name).toBe('DocumentException')
    expect(operationFailure.code).toBe('DOCUMENT_OPERATION_FAILED')
    expect(operationFailure.message).toBe('Document operation failed.')
    expect(JSON.stringify(operationFailure)).not.toContain('private failure value')

    const duplicateCause = {
      code: '11000',
      message: 'duplicate private value',
    }
    const duplicateFailure = DocumentException.from(duplicateCause)
    const typedCause: unknown = duplicateFailure.cause
    expect(duplicateFailure.code).toBe('DOCUMENT_DUPLICATE_KEY')
    expect(typedCause).toBe(duplicateCause)
    expect(Object.getOwnPropertyDescriptor(duplicateFailure, 'cause')).toMatchObject({
      enumerable: false,
      writable: false,
    })
  })

  test('preserves typed errors and exposes stable subclass names', () => {
    const conflict = new DocumentConflictException()
    const hydration = new DocumentHydrationException()
    const identifier = new DocumentIdentifierException()
    const validation = new DocumentValidationException()

    expect(DocumentException.from(conflict)).toBe(conflict)
    expect(conflict.name).toBe('DocumentConflictException')
    expect(hydration.name).toBe('DocumentHydrationException')
    expect(identifier.name).toBe('DocumentIdentifierException')
    expect(validation.name).toBe('DocumentValidationException')
    expect(validation.message).toBe('Document validation failed.')
  })
})
