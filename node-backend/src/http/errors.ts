export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export function isPgError(error: unknown): error is { code?: string; detail?: string; constraint?: string } {
  return Boolean(error && typeof error === "object" && "code" in error);
}
