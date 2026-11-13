import { defineStore } from "pinia";
import { computed, ref } from "vue";
import { api, setSessionToken, type AuthSession } from "@/api";
import { useLibrary } from "./library";
import { useUi } from "./ui";

// The hosted `/me` doesn't include the email, so remember the one used to sign
// up or in, next to the username it belongs to, and show it in Settings.
const EMAIL_KEY = "stratus.accountEmail";

export const USERNAME_RULE = /^[A-Za-z0-9_.-]{3,30}$/;
export const EMAIL_RULE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const MIN_PASSWORD = 8;

function loadRemembered(): { username: string; email: string } | null {
  try {
    return JSON.parse(localStorage.getItem(EMAIL_KEY) ?? "null");
  } catch {
    return null;
  }
}

/** Signing up, in and out of the current backend's account. */
export const useAccount = defineStore("account", () => {
  const library = useLibrary();
  const ui = useUi();
  const remembered = ref(loadRemembered());

  /** The signed-in account's email, if the backend or the sign-in form told us. */
  const email = computed(() => {
    const me = library.me;
    if (!me) return null;
    if (me.email) return me.email;
    const r = remembered.value;
    return r && r.username.toLowerCase() === me.username.toLowerCase() ? r.email : null;
  });

  function remember(username: string, address: string | null) {
    remembered.value = address ? { username, email: address } : null;
    try {
      if (remembered.value) localStorage.setItem(EMAIL_KEY, JSON.stringify(remembered.value));
      else localStorage.removeItem(EMAIL_KEY);
    } catch {
      // Only cosmetic.
    }
  }

  async function begin(session: AuthSession, knownEmail: string | null) {
    remember(session.user.username, session.user.email ?? knownEmail);
    setSessionToken(session.token);
    await library.refresh();
  }

  async function signUp(username: string, address: string, password: string) {
    const signup = api.value.signup;
    if (!signup) throw new Error("This backend doesn't have accounts.");
    await begin(await signup.call(api.value, username.trim(), address.trim(), password), address.trim());
  }

  async function signIn(login: string, password: string) {
    const fn = api.value.login;
    if (!fn) throw new Error("This backend doesn't have accounts.");
    const value = login.trim();
    await begin(await fn.call(api.value, value, password), value.includes("@") ? value : null);
  }

  async function end() {
    remember("", null);
    setSessionToken("");
    await library.refresh();
  }

  async function signOut() {
    // Revoke the token on the server if we can, but sign out locally either way.
    await api.value.logout?.().catch(() => {});
    await end();
    ui.notify("Signed out");
  }

  /** Throws (with the server's error) if the password is wrong, leaving the session alone. */
  async function deleteAccount(password: string) {
    const fn = api.value.deleteAccount;
    if (!fn) throw new Error("This backend can't delete accounts.");
    await fn.call(api.value, password);
    await end();
    ui.notify("Your account was deleted");
  }

  return { email, signUp, signIn, signOut, deleteAccount };
});
