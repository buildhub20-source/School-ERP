/** An error whose message is safe to show to the user. */
export class AppError extends Error {
  constructor(message: string, public code: string = "APP_ERROR", public fields?: Record<string, string>) {
    super(message);
    this.name = "AppError";
  }
}

export function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new AppError(message);
}
