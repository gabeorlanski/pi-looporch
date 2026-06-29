/** Converts an unknown thrown value into stable user-facing and persisted error text. */
export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (typeof error === "number" || typeof error === "boolean" || typeof error === "bigint") return String(error);
  if (typeof error === "symbol") return error.description ?? "symbol";
  return JSON.stringify(error);
}
