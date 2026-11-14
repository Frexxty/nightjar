// Desktop Spotify sign-in (docs/spotify.md). The renderer builds the PKCE
// authorize URL; this opens it in the system browser and waits once on
// http://127.0.0.1:43821/callback for Spotify's redirect. Tokens are kept
// encrypted with safeStorage in the user data folder.
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const PORT = 43821;
const REDIRECT_URI = `http://127.0.0.1:${PORT}/callback`;
const TIMEOUT_MS = 5 * 60 * 1000;

class AuthError extends Error {}

const page = (title, text) => `<!doctype html><meta charset="utf-8"><title>${title}</title>
<style>body{font:15px system-ui,sans-serif;background:#141416;color:#eee;display:grid;place-items:center;height:100vh;margin:0}main{text-align:center}</style>
<main><h1>${title}</h1><p>${text}</p></main>`;

/** Accepts only Spotify's authorize endpoint with our loopback redirect. */
function checkAuthorizeUrl(raw) {
  let url;
  try {
    url = new URL(String(raw));
  } catch {
    throw new AuthError("That isn't a Spotify sign-in link.");
  }
  if (url.origin !== "https://accounts.spotify.com" || url.pathname !== "/authorize") throw new AuthError("That isn't a Spotify sign-in link.");
  if (url.searchParams.get("redirect_uri") !== REDIRECT_URI) throw new AuthError(`The redirect URI must be ${REDIRECT_URI}.`);
  if (!url.searchParams.get("state")) throw new AuthError("The sign-in link has no state.");
  return url;
}

let pending = null;

/**
 * Opens `authorizeUrl` in the browser and resolves with `{ code, state }` or
 * `{ error, state }` from the first request to /callback. One at a time: a new
 * call cancels the previous one.
 */
function authorize(authorizeUrl, { openExternal, timeoutMs = TIMEOUT_MS } = {}) {
  const url = checkAuthorizeUrl(authorizeUrl);
  const expectedState = url.searchParams.get("state");
  pending?.cancel();

  return new Promise((resolve, reject) => {
    let settled = false;
    const server = http.createServer((req, res) => {
      const reqUrl = new URL(req.url ?? "/", REDIRECT_URI);
      if (reqUrl.pathname !== "/callback") {
        res.writeHead(404, { Connection: "close" }).end();
        return;
      }
      const state = reqUrl.searchParams.get("state");
      const code = reqUrl.searchParams.get("code");
      const error = reqUrl.searchParams.get("error");
      // A stray request (or a stale tab) with the wrong state doesn't end the wait.
      if (state !== expectedState) {
        res.writeHead(400, { "Content-Type": "text/html; charset=utf-8", Connection: "close" }).end(page("Nightjar", "This sign-in link is out of date. Go back to Nightjar and connect again."));
        return;
      }
      const ok = !!code && !error;
      res.writeHead(ok ? 200 : 400, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", Connection: "close" });
      // Close the server only once the page has reached the browser.
      res.end(ok
        ? page("Connected to Spotify", "You can close this tab and go back to Nightjar.")
        : page("Spotify sign-in didn't finish", "Go back to Nightjar to try again."),
      () => finish(() => resolve(ok ? { code, state } : { error: error ?? "missing_code", state })));
    });

    const timer = setTimeout(() => finish(() => reject(new AuthError("timeout"))), timeoutMs);
    function finish(done) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      server.close();
      // Browsers keep the connection alive; drop it so the port frees at once.
      server.closeAllConnections?.();
      if (pending?.server === server) pending = null;
      done();
    }

    pending = { server, cancel: () => finish(() => reject(new AuthError("cancelled"))) };
    server.on("error", (err) => {
      finish(() => reject(new AuthError(err.code === "EADDRINUSE"
        ? `Port ${PORT} is in use, so Nightjar can't receive Spotify's reply. Close whatever is using it and try again.`
        : `Couldn't wait for Spotify's reply: ${err.message}`)));
    });
    server.listen(PORT, "127.0.0.1", () => {
      Promise.resolve(openExternal(url.toString())).catch((err) => finish(() => reject(new AuthError(`Couldn't open the browser: ${err.message}`))));
    });
  });
}

function tokenFile(app) {
  return path.join(app.getPath("userData"), "spotify-tokens.bin");
}

function readTokens(app, safeStorage) {
  let raw;
  try {
    raw = fs.readFileSync(tokenFile(app));
  } catch {
    return null;
  }
  try {
    // First byte: 1 = safeStorage-encrypted, 0 = plain (no keychain available).
    const body = raw.subarray(1);
    const text = raw[0] === 1 ? safeStorage.decryptString(body) : body.toString("utf8");
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function writeTokens(app, safeStorage, tokens) {
  const text = JSON.stringify(tokens);
  const encrypted = safeStorage.isEncryptionAvailable();
  const body = encrypted ? safeStorage.encryptString(text) : Buffer.from(text, "utf8");
  fs.writeFileSync(tokenFile(app), Buffer.concat([Buffer.from([encrypted ? 1 : 0]), body]), { mode: 0o600 });
}

function clearTokens(app) {
  fs.rmSync(tokenFile(app), { force: true });
}

/** Wires the IPC handlers. Replies are `{ ok, result }` or `{ ok: false, error }` so messages arrive clean. */
function registerSpotifyAuthIpc(ipcMain, { app, shell, safeStorage }) {
  const wrap = (fn) => async (_event, ...args) => {
    try {
      return { ok: true, result: await fn(...args) };
    } catch (err) {
      return { ok: false, error: err instanceof AuthError ? err.message : `Spotify sign-in failed: ${err.message}` };
    }
  };
  ipcMain.handle("spotify-auth:authorize", wrap((url) => authorize(url, { openExternal: (u) => shell.openExternal(u) })));
  ipcMain.handle("spotify-auth:cancel", wrap(() => pending?.cancel()));
  ipcMain.handle("spotify-auth:get-tokens", wrap(() => readTokens(app, safeStorage)));
  ipcMain.handle("spotify-auth:set-tokens", wrap((tokens) => writeTokens(app, safeStorage, tokens)));
  ipcMain.handle("spotify-auth:clear-tokens", wrap(() => clearTokens(app)));
}

module.exports = { registerSpotifyAuthIpc, authorize, checkAuthorizeUrl, REDIRECT_URI, PORT };
