// Spotify sign-in: Authorization Code with PKCE, using the Client ID of the
// user's own Spotify developer app (docs/spotify.md explains why). Desktop
// gets the code through a loopback server in the main process; the web player
// redirects the page and finishes in `completeWebCallback` at boot.
import { defineStore } from "pinia";
import { computed, ref } from "vue";
import {
  authorizeUrl, callbackErrorMessage, challengeFor, DESKTOP_REDIRECT_URI, isClientId, needsRefresh, randomState, randomVerifier,
  readTokenReply, TOKEN_URL, tokenErrorMessage, WEB_CALLBACK_PATH, type CallbackResult, type TokenSet,
} from "./pkce";

const CLIENT_ID_KEY = "stratus.spotify.clientId";
const TOKENS_KEY = "stratus.spotify.tokens";
const PROFILE_KEY = "stratus.spotify.profile";
/** Web only: the verifier and state for a sign-in that left the page. */
const PENDING_KEY = "stratus.spotify.pending";

export type SpotifyStatus = "disconnected" | "connecting" | "connected" | "error";

export interface SpotifyProfile {
  id: string;
  displayName: string;
  /** "premium", "free", "open"... Development-mode apps may not get it any more (February 2026), then null. */
  product: string | null;
  country: string | null;
  avatarUrl: string | null;
}

/** Thrown by `accessToken()` when there's no usable session. */
export class SpotifyAuthError extends Error {
  /** The token endpoint's `error`, such as "invalid_grant". */
  code: string | null;
  constructor(message: string, code: string | null = null) {
    super(message);
    this.name = "SpotifyAuthError";
    this.code = code;
  }
}

interface PendingWebSignIn {
  verifier: string;
  state: string;
  redirectUri: string;
  clientId: string;
  /** The hash route to come back to. */
  returnTo: string;
  startedAt: number;
}

const desktop = () => window.stratus?.spotifyAuth;

function readJson<T>(key: string): T | null {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "null");
  } catch {
    return null;
  }
}
function writeJson(key: string, value: unknown) {
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private mode or a full quota: the session lasts until reload.
  }
}

/** Where Spotify sends the browser back to. Spotify only accepts loopback IPs, not "localhost", for http. */
export function webRedirectUri(): string {
  return `${location.origin}${WEB_CALLBACK_PATH}`;
}

export const useSpotify = defineStore("spotify", () => {
  const clientId = ref(localStorage.getItem(CLIENT_ID_KEY) ?? "");
  const status = ref<SpotifyStatus>("disconnected");
  const error = ref<string | null>(null);
  const profile = ref<SpotifyProfile | null>(readJson<SpotifyProfile>(PROFILE_KEY));
  /** Set when the Web Playback SDK says the account can't stream (Free, Lite or Mini). */
  const sdkRejected = ref<string | null>(null);
  let tokens: TokenSet | null = null;
  let refreshing: Promise<TokenSet> | null = null;
  let ready: Promise<void> | null = null;

  const connected = computed(() => status.value === "connected");
  /**
   * False once Spotify has told us the account can't play: `/me` says it isn't
   * Premium, or the SDK raised `account_error`. Lite and Mini report "premium"
   * on `/me`, so only the SDK catches those. True while unknown.
   */
  const isPremium = computed(() => {
    if (sdkRejected.value) return false;
    const product = profile.value?.product;
    return product == null || product === "premium";
  });
  const premiumMessage = computed(() => {
    if (sdkRejected.value) return sdkRejected.value;
    if (!isPremium.value) return "Playing Spotify in Stratus needs Spotify Premium. Free accounts can still browse.";
    return null;
  });
  const redirectUri = computed(() => (desktop() ? DESKTOP_REDIRECT_URI : webRedirectUri()));

  function setClientId(value: string) {
    clientId.value = value.trim();
    try {
      localStorage.setItem(CLIENT_ID_KEY, clientId.value);
    } catch {
      // Kept for this session.
    }
  }

  async function saveTokens(next: TokenSet | null) {
    tokens = next;
    const bridge = desktop();
    if (bridge) {
      if (next) await bridge.setTokens(next);
      else await bridge.clearTokens();
    } else writeJson(TOKENS_KEY, next);
  }

  async function loadTokens(): Promise<TokenSet | null> {
    const bridge = desktop();
    if (bridge) return bridge.getTokens().catch(() => null);
    return readJson<TokenSet>(TOKENS_KEY);
  }

  /** Loads a saved session. Safe to call many times; runs once. */
  function init() {
    ready ??= (async () => {
      tokens = await loadTokens();
      if (!tokens) return;
      status.value = "connected";
      // Refresh the profile in the background; a stale one is fine meanwhile.
      void loadProfile().catch(() => {});
    })();
    return ready;
  }

  async function postToken(params: Record<string, string>): Promise<Record<string, unknown>> {
    let res: Response;
    try {
      res = await fetch(TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(params),
      });
    } catch {
      throw new SpotifyAuthError("Couldn't reach Spotify. Check your connection.");
    }
    const body = await res.json().catch(() => null);
    if (!res.ok) throw new SpotifyAuthError(tokenErrorMessage(res.status, body), typeof body?.error === "string" ? body.error : null);
    return body ?? {};
  }

  async function exchange(code: string, verifier: string, redirect: string, id: string) {
    const body = await postToken({ grant_type: "authorization_code", code, redirect_uri: redirect, client_id: id, code_verifier: verifier });
    await saveTokens(readTokenReply(body, Date.now()));
    status.value = "connected";
    error.value = null;
    sdkRejected.value = null;
    await loadProfile().catch(() => {});
  }

  function fail(message: string) {
    status.value = "error";
    error.value = message;
  }

  /** Starts sign-in. On desktop it resolves when done; on the web the page navigates away. */
  async function connect() {
    if (!isClientId(clientId.value)) {
      fail("Paste the Client ID from your Spotify app first. It's 32 letters and numbers.");
      return;
    }
    if (!desktop() && location.hostname === "localhost") {
      fail("Spotify doesn't accept \"localhost\" redirects. Open Stratus at 127.0.0.1 instead and connect from there.");
      return;
    }
    status.value = "connecting";
    error.value = null;
    const verifier = randomVerifier();
    const state = randomState();
    const url = authorizeUrl({ clientId: clientId.value, redirectUri: redirectUri.value, challenge: await challengeFor(verifier), state });

    const bridge = desktop();
    if (!bridge) {
      const pending: PendingWebSignIn = {
        verifier, state, redirectUri: redirectUri.value, clientId: clientId.value, returnTo: location.hash || "#/", startedAt: Date.now(),
      };
      writeJson(PENDING_KEY, pending);
      location.assign(url);
      return;
    }

    let reply: CallbackResult;
    try {
      reply = await bridge.authorize(url);
    } catch (err) {
      const message = (err as Error).message;
      if (message === "cancelled") status.value = tokens ? "connected" : "disconnected";
      else fail(callbackErrorMessage(message === "timeout" ? "timeout" : message));
      return;
    }
    await finish(reply, { verifier, state, redirectUri: redirectUri.value, clientId: clientId.value });
  }

  async function finish(reply: CallbackResult, pending: Pick<PendingWebSignIn, "verifier" | "state" | "redirectUri" | "clientId">) {
    if (reply.state !== pending.state) return fail(callbackErrorMessage("state_mismatch"));
    if ("error" in reply) {
      if (reply.error === "access_denied") {
        status.value = tokens ? "connected" : "disconnected";
        error.value = callbackErrorMessage(reply.error);
        return;
      }
      return fail(callbackErrorMessage(reply.error));
    }
    try {
      await exchange(reply.code, pending.verifier, pending.redirectUri, pending.clientId);
    } catch (err) {
      fail((err as Error).message);
    }
  }

  /**
   * Web: finishes a sign-in after Spotify redirected to /spotify-callback.
   * main.ts has already read the query and put the URL back to the app.
   */
  async function completeWebCallback(reply: CallbackResult) {
    await init();
    const pending = readJson<PendingWebSignIn>(PENDING_KEY);
    writeJson(PENDING_KEY, null);
    if (!pending) return fail("This Spotify sign-in wasn't started here, or it was already used. Connect again.");
    status.value = "connecting";
    await finish(reply, pending);
  }

  async function refresh(): Promise<TokenSet> {
    const current = tokens;
    if (!current?.refreshToken) throw new SpotifyAuthError("Your Spotify session ended. Reconnect Spotify in Settings.");
    refreshing ??= (async () => {
      try {
        const body = await postToken({ grant_type: "refresh_token", refresh_token: current.refreshToken!, client_id: clientId.value });
        const next = readTokenReply(body, Date.now(), current.refreshToken);
        await saveTokens(next);
        return next;
      } catch (err) {
        // A revoked or expired refresh token: the user has to sign in again.
        const code = err instanceof SpotifyAuthError ? err.code : null;
        if (code === "invalid_grant" || code === "invalid_client") {
          await saveTokens(null).catch(() => {});
          fail("Your Spotify session expired. Reconnect Spotify in Settings.");
          throw new SpotifyAuthError("Your Spotify session expired. Reconnect Spotify in Settings.");
        }
        throw err;
      } finally {
        refreshing = null;
      }
    })();
    return refreshing;
  }

  /** A valid access token, refreshed when it's within a minute of expiring. `force` refreshes regardless (after a 401). */
  async function accessToken(force = false): Promise<string> {
    await init();
    if (!tokens) throw new SpotifyAuthError("Connect Spotify in Settings to use Spotify.");
    if (force || needsRefresh(tokens, Date.now())) return (await refresh()).accessToken;
    return tokens.accessToken;
  }

  async function loadProfile() {
    const token = await accessToken();
    const res = await fetch("https://api.spotify.com/v1/me", { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`GET /me ${res.status}`);
    const me = await res.json();
    profile.value = {
      id: me.id,
      displayName: me.display_name || me.id,
      product: typeof me.product === "string" ? me.product : null,
      country: typeof me.country === "string" ? me.country : null,
      avatarUrl: me.images?.[0]?.url ?? null,
    };
    writeJson(PROFILE_KEY, profile.value);
  }

  /** The SDK's `account_error`: the account can't stream (Free, or Premium Lite/Mini, which `/me` calls "premium"). */
  function markNotPremium(message?: string) {
    sdkRejected.value = message
      ?? "Spotify says this account can't play music in other apps. That needs full Spotify Premium; Premium Lite and Mini don't include it.";
  }

  async function disconnect() {
    desktop()?.cancel().catch(() => {});
    await saveTokens(null).catch(() => {});
    profile.value = null;
    writeJson(PROFILE_KEY, null);
    sdkRejected.value = null;
    status.value = "disconnected";
    error.value = null;
  }

  return {
    clientId, status, error, profile, connected, isPremium, premiumMessage, sdkRejected, redirectUri,
    setClientId, init, connect, disconnect, accessToken, completeWebCallback, markNotPremium, loadProfile,
  };
});
