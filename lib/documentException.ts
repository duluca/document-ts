export class DocumentException extends Error {
  public name = 'DocumentException'

  constructor(public message: string) {
    super(message)
    Error.captureStackTrace(this, DocumentException)
  }
}