export class CardReadingError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
