export class DocumentException extends Error {
  public name = 'DocumentException'

  constructor(public error: string | Error) {
    super(error instanceof Error ? error.message : error)
    Error.captureStackTrace(this, DocumentException)
  }
}
