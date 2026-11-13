// Password hashing, session tokens and input checks. Uses only WebCrypto, which
// Node also has, so the tests import this file directly.
import { ApiError, b64url, fromB64url } from "./http.ts";

/**
 * Workers' WebCrypto refuses PBKDF2 above 100,000 iterations, so that is the
 * ceiling here. The count is stored per user; raising it later only needs a
 * rehash on the next successful login (see needsRehash).
 */
export const PBKDF2_ITERATIONS = 100_000;
export const SESSION_DAYS = 90;

export interface PasswordHash {
  hash: string;
  salt: string;
  iterations: number;
}

const enc = new TextEncoder();

async function pbkdf2(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256);
  return new Uint8Array(bits);
}

export async function hashPassword(password: string, iterations = PBKDF2_ITERATIONS): Promise<PasswordHash> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(password, salt, iterations);
  return { hash: b64url(hash), salt: b64url(salt), iterations };
}

export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  // Length is not secret here (always 32 bytes), but don't return early on content.
  let diff = a.length ^ b.length;
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

export async function verifyPassword(password: string, stored: PasswordHash): Promise<boolean> {
  const actual = await pbkdf2(password, fromB64url(stored.salt), stored.iterations);
  return timingSafeEqual(actual, fromB64url(stored.hash));
}

export const needsRehash = (stored: PasswordHash) => stored.iterations < PBKDF2_ITERATIONS;

/** 32 random bytes, base64url. Only its SHA-256 is stored. */
export function newToken(): string {
  return b64url(crypto.getRandomValues(new Uint8Array(32)));
}

export async function sha256(text: string): Promise<string> {
  return b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(text))));
}

/** Reads a bearer token, or null. Rejects obviously malformed ones without touching the database. */
export function bearerToken(header: string | null): string | null {
  const m = header?.match(/^Bearer\s+([A-Za-z0-9_-]{20,100})\s*$/);
  return m ? m[1] : null;
}

const invalid = (message: string, code = "invalid_input") => new ApiError(400, code, message);

export function checkUsername(value: unknown): string {
  if (typeof value !== "string") throw invalid("Pick a username.");
  const name = value.trim();
  if (name.length < 3 || name.length > 30) throw invalid("Usernames are 3 to 30 characters.");
  if (!/^[A-Za-z0-9_.-]+$/.test(name)) throw invalid("Usernames can use letters, digits, _, - and . only.");
  return name;
}

export function checkEmail(value: unknown): string {
  if (typeof value !== "string") throw invalid("Enter an email address.");
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw invalid("That email address doesn't look right.");
  return email;
}

export function checkPassword(value: unknown): string {
  if (typeof value !== "string" || value.length < 8) throw invalid("Passwords need at least 8 characters.", "weak_password");
  if (value.length > 200) throw invalid("Passwords can be at most 200 characters.");
  return value;
}
