export type DocumentExceptionCode =
  | 'DOCUMENT_CONFLICT'
  | 'DOCUMENT_DUPLICATE_KEY'
  | 'DOCUMENT_INVALID_HYDRATION'
  | 'DOCUMENT_INVALID_ID'
  | 'DOCUMENT_OPERATION_FAILED'
  | 'DOCUMENT_VALIDATION_FAILED'

const DUPLICATE_KEY_CODE = 11000

function isDuplicateKeyError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false
  }

  const code: unknown = (error as { code?: unknown }).code
  return code === DUPLICATE_KEY_CODE || code === `${DUPLICATE_KEY_CODE}`
}

export class DocumentException extends Error {
  public override get name(): string {
    return 'DocumentException'
  }

  protected constructor(
    public readonly code: DocumentExceptionCode,
    message: string,
    public override readonly cause?: unknown
  ) {
    super(message)
    Object.defineProperty(this, 'cause', {
      configurable: true,
      enumerable: false,
      value: cause,
      writable: false,
    })
    Error.captureStackTrace(this, new.target)
  }

  static from(error: unknown): DocumentException {
    if (error instanceof DocumentException) {
      return error
    }

    if (isDuplicateKeyError(error)) {
      return new DocumentException(
        'DOCUMENT_DUPLICATE_KEY',
        'Document conflicts with an existing unique value.',
        error
      )
    }

    return new DocumentException(
      'DOCUMENT_OPERATION_FAILED',
      'Document operation failed.',
      error
    )
  }
}

export class DocumentConflictException extends DocumentException {
  public override get name(): string {
    return 'DocumentConflictException'
  }

  constructor() {
    super(
      'DOCUMENT_CONFLICT',
      'Document changed after it was loaded; no changes were saved.'
    )
  }
}

export class DocumentHydrationException extends DocumentException {
  public override get name(): string {
    return 'DocumentHydrationException'
  }

  constructor() {
    super('DOCUMENT_INVALID_HYDRATION', 'Document data contains a reserved field.')
  }
}

export class DocumentIdentifierException extends DocumentException {
  public override get name(): string {
    return 'DocumentIdentifierException'
  }

  constructor() {
    super('DOCUMENT_INVALID_ID', 'Document identifier is missing or invalid.')
  }
}

export class DocumentValidationException extends DocumentException {
  public override get name(): string {
    return 'DocumentValidationException'
  }

  constructor(message = 'Document validation failed.') {
    super('DOCUMENT_VALIDATION_FAILED', message)
  }
}
