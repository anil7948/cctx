export class CctxError extends Error {
  readonly code: string;

  constructor(code: string, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "CctxError";
    this.code = code;
  }
}

export function isCctxError(e: unknown): e is CctxError {
  return e instanceof CctxError;
}
