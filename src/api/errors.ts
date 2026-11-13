// Errors from a backend. No imports, so `node --test` can load this file directly.

/**
 * A failed request. `code` is the server's short error code (`username_taken`,
 * `unauthorized`, ...) when the body had the hosted API's `{ error, code }` shape.
 */
export class ApiError extends Error {
  // Plain fields rather than parameter properties: Node's type stripping
  // (used by the tests) rejects the latter.
  status: number;
  code: string | null;
  url: string;

  constructor(status: number, code: string | null, message: string, url = "") {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.url = url;
  }
}

/** Builds an ApiError from a non-2xx response body, which may or may not be JSON. */
export function parseApiError(status: number, body: string, url = ""): ApiError {
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(body);
  } catch {
    // Not JSON. Fall through to the raw text.
  }
  if (parsed && typeof parsed === "object") {
    const { error, code } = parsed as { error?: unknown; code?: unknown };
    const message = typeof error === "string" && error.trim() ? error.trim() : null;
    const short = typeof code === "string" && code ? code : null;
    if (message || short) return new ApiError(status, short, message ?? `${status} ${short}`, url);
  }
  const text = body.trim();
  return new ApiError(status, null, `${status} from ${url}${text ? `: ${text.slice(0, 200)}` : ""}`, url);
}

export function errorCode(err: unknown): string | null {
  return err instanceof ApiError ? err.code : null;
}

export function isUnauthorized(err: unknown): boolean {
  return err instanceof ApiError && (err.code === "unauthorized" || (err.code === null && err.status === 401));
}

export function isNotSupported(err: unknown): boolean {
  return err instanceof ApiError && (err.code === "not_supported" || err.status === 501);
}

const FRIENDLY: Record<string, string> = {
  invalid_credentials: "That username or email and password don't match.",
  username_taken: "That username is taken.",
  email_taken: "There's already an account with that email.",
  weak_password: "Use a password with at least 8 characters.",
  rate_limited: "Too many tries. Wait a minute and try again.",
  unauthorized: "Your session ended. Sign in again.",
};

/** A sentence for the UI. Known codes get fixed wording, anything else keeps the server's message. */
export function friendlyError(err: unknown): string {
  if (err instanceof ApiError && err.code && FRIENDLY[err.code]) return FRIENDLY[err.code];
  if (err instanceof TypeError) return "Couldn't reach the server. Check your connection.";
  return err instanceof Error ? err.message : String(err);
}
