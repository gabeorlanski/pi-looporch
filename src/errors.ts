/** Converts an unknown thrown value into stable user-facing and persisted error text. */
export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (typeof error === "number" || typeof error === "boolean" || typeof error === "bigint") return String(error);
  if (typeof error === "symbol") return error.description ?? "symbol";
  if (typeof error === "object" && error !== null && "message" in error && typeof error.message === "string") return error.message;
  return JSON.stringify(error);
}

/** Returns whether an unknown filesystem failure reports a missing path. */
export function isMissingFileError(error: unknown): boolean {
  return error instanceof Error && (error as NodeJS.ErrnoException).code === "ENOENT";
}
