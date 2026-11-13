<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { LogOut, Settings, X } from "lucide-vue-next";
import logoMark from "@/assets/logo-mark.svg?raw";
import { api, backendConfig, errorCode, friendlyError, HOSTED_BASE_URL } from "@/api";
import Artwork from "@/components/Artwork.vue";
import { EMAIL_RULE, MIN_PASSWORD, USERNAME_RULE, useAccount } from "@/stores/account";
import { useLibrary } from "@/stores/library";
import { useUi } from "@/stores/ui";

const route = useRoute();
const router = useRouter();
const library = useLibrary();
const account = useAccount();
const ui = useUi();

// Only same-app paths, so a crafted link can't send people elsewhere.
const next = computed(() => {
  const n = route.query.next;
  return typeof n === "string" && n.startsWith("/") && !n.startsWith("//") && !n.startsWith("/account") ? n : null;
});

const mode = ref<"signin" | "signup">(route.query.mode === "signup" ? "signup" : "signin");
const form = reactive({ login: "", username: "", email: "", password: "" });
const errors = reactive<Record<"login" | "username" | "email" | "password" | "form", string | null>>({
  login: null, username: null, email: null, password: null, form: null,
});
const busy = ref(false);
const tried = ref(false);

const serverLabel = computed(() => {
  const c = backendConfig.value;
  if (c.kind === "hosted") return new URL(HOSTED_BASE_URL).host;
  if (c.kind === "http") return c.baseUrl;
  return null;
});

function validate() {
  errors.login = errors.username = errors.email = errors.password = null;
  if (mode.value === "signin") {
    if (!form.login.trim()) errors.login = "Enter your username or email.";
    if (!form.password) errors.password = "Enter your password.";
  } else {
    const name = form.username.trim();
    if (name.length < 3 || name.length > 30) errors.username = "Use 3 to 30 characters.";
    else if (!USERNAME_RULE.test(name)) errors.username = "Use only letters, digits, _, - and .";
    if (!EMAIL_RULE.test(form.email.trim())) errors.email = "Enter an email address like you@example.com.";
    if (form.password.length < MIN_PASSWORD) errors.password = `Use at least ${MIN_PASSWORD} characters.`;
  }
  return !errors.login && !errors.username && !errors.email && !errors.password;
}

// After the first submit, re-check as they type so errors clear when fixed.
watch(form, () => tried.value && validate());
watch(mode, () => {
  tried.value = false;
  errors.login = errors.username = errors.email = errors.password = errors.form = null;
});

async function submit() {
  tried.value = true;
  errors.form = null;
  if (!validate()) return;
  busy.value = true;
  try {
    if (mode.value === "signin") await account.signIn(form.login, form.password);
    else await account.signUp(form.username, form.email, form.password);
    ui.notify(library.me ? `Signed in as ${library.me.username}` : "Signed in");
    form.password = "";
    void router.replace(next.value ?? "/");
  } catch (err) {
    const code = errorCode(err);
    const message = friendlyError(err);
    if (code === "username_taken") errors.username = message;
    else if (code === "email_taken") errors.email = message;
    else if (code === "weak_password") errors.password = message;
    else errors.form = message;
  } finally {
    busy.value = false;
  }
}

function close() {
  if (next.value) void router.replace(next.value);
  else if (window.history.length > 1) router.back();
  else void router.replace("/");
}
</script>

<template>
  <div class="account-page">
    <div class="card">
      <button class="icon-btn close" title="Close" @click="close"><X :size="18" /></button>
      <div class="mark" aria-hidden="true" v-html="logoMark" />

      <!-- Signed in -->
      <template v-if="library.me">
        <div class="who">
          <Artwork :src="library.me.avatarUrl" :size="64" round />
          <h1>{{ library.me.username }}</h1>
          <p v-if="account.email" class="muted">{{ account.email }}</p>
          <p class="faint small">Signed in to {{ api.name }}<template v-if="serverLabel"> ({{ serverLabel }})</template></p>
        </div>
        <div class="stack">
          <button v-if="next" class="btn primary wide" @click="router.replace(next)">Continue</button>
          <RouterLink to="/settings" class="btn wide"><Settings :size="15" /> Account settings</RouterLink>
          <button class="btn wide" @click="account.signOut()"><LogOut :size="15" /> Sign out</button>
        </div>
      </template>

      <!-- No accounts on this backend -->
      <template v-else-if="!library.accounts">
        <h1>No accounts here</h1>
        <p class="muted center">The backend in use doesn't have accounts. Switch to a Stratus account in Settings.</p>
        <RouterLink to="/settings" class="btn primary wide">Open Settings</RouterLink>
      </template>

      <!-- Sign in / create account -->
      <template v-else>
        <h1>{{ mode === "signin" ? "Sign in to Stratus" : "Create your Stratus account" }}</h1>
        <p class="muted center intro">
          Likes, playlists, follows and history stay in your account, on the desktop app and in the browser.
        </p>
        <div class="seg" role="tablist">
          <button role="tab" :aria-selected="mode === 'signin'" :class="{ active: mode === 'signin' }" @click="mode = 'signin'">Sign in</button>
          <button role="tab" :aria-selected="mode === 'signup'" :class="{ active: mode === 'signup' }" @click="mode = 'signup'">Create account</button>
        </div>

        <form novalidate @submit.prevent="submit">
          <template v-if="mode === 'signin'">
            <label class="field">
              <span>Username or email</span>
              <input v-model="form.login" autocomplete="username" autocapitalize="off" spellcheck="false" :aria-invalid="!!errors.login" />
              <small v-if="errors.login" class="err">{{ errors.login }}</small>
            </label>
          </template>
          <template v-else>
            <label class="field">
              <span>Username</span>
              <input v-model="form.username" autocomplete="username" autocapitalize="off" spellcheck="false" maxlength="30" :aria-invalid="!!errors.username" />
              <small v-if="errors.username" class="err">{{ errors.username }}</small>
              <small v-else class="faint">3 to 30 letters, digits, _, - or .</small>
            </label>
            <label class="field">
              <span>Email</span>
              <input v-model="form.email" type="email" inputmode="email" autocomplete="email" autocapitalize="off" spellcheck="false" :aria-invalid="!!errors.email" />
              <small v-if="errors.email" class="err">{{ errors.email }}</small>
            </label>
          </template>
          <label class="field">
            <span>Password</span>
            <input
              v-model="form.password"
              type="password"
              :autocomplete="mode === 'signin' ? 'current-password' : 'new-password'"
              :aria-invalid="!!errors.password"
            />
            <small v-if="errors.password" class="err">{{ errors.password }}</small>
            <small v-else-if="mode === 'signup'" class="faint">At least {{ MIN_PASSWORD }} characters.</small>
          </label>

          <p v-if="errors.form" class="err form-err" role="alert">{{ errors.form }}</p>

          <button class="btn primary wide submit" type="submit" :disabled="busy">
            {{ busy ? (mode === "signin" ? "Signing in…" : "Creating account…") : mode === "signin" ? "Sign in" : "Create account" }}
          </button>
        </form>

        <p class="faint small center foot">
          <template v-if="backendConfig.kind === 'mock'">Demo data: sign in as "you" with any password of 8 or more characters.</template>
          <template v-else>
            Stratus accounts are separate from SoundCloud, and nothing is posted to SoundCloud.
            <template v-if="serverLabel">Server: {{ serverLabel }}.</template>
          </template>
          <RouterLink to="/settings" class="link">Change server</RouterLink>
        </p>
      </template>
    </div>
  </div>
</template>

<style scoped>
.account-page { display: grid; place-items: start center; min-height: 100%; padding: 48px 16px; }
.card {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 14px;
  width: min(400px, 100%);
  padding: 28px 28px 22px;
  border-radius: var(--radius-lg);
  background: var(--raised);
  box-shadow: var(--shadow), inset 0 0 0 1px var(--border);
}
.close { position: absolute; top: 10px; right: 10px; }
.mark { display: flex; justify-content: center; height: 24px; color: var(--accent); }
.mark :deep(svg) { height: 100%; width: auto; }
h1 { margin: 0; font-size: 21px; font-weight: 750; letter-spacing: -0.01em; text-align: center; }
.center { text-align: center; }
.intro { margin: -6px 0 2px; }
.small { font-size: 12px; }
.seg { display: flex; padding: 3px; gap: 2px; border-radius: 9px; background: var(--hover); }
.seg button { flex: 1; height: 28px; border-radius: 7px; color: var(--text-2); font-weight: 600; }
.seg button.active { background: var(--panel); color: var(--text); box-shadow: 0 1px 3px rgba(0, 0, 0, 0.25); }
form { display: flex; flex-direction: column; gap: 12px; }
.field { display: flex; flex-direction: column; gap: 5px; }
.field > span { font-weight: 600; color: var(--text-2); font-size: 12.5px; }
.field input { height: 36px; }
.field input[aria-invalid="true"] { border-color: #ff6b6b; }
.field small { font-size: 11.5px; }
.err { color: #ff6b6b; user-select: text; }
.form-err { margin: 0; padding: 8px 10px; border-radius: 8px; background: color-mix(in srgb, #ff6b6b 12%, transparent); }
.wide { width: 100%; justify-content: center; height: 36px; }
.submit { margin-top: 4px; }
.stack { display: flex; flex-direction: column; gap: 8px; }
.stack a:hover { text-decoration: none; }
.who { display: flex; flex-direction: column; align-items: center; gap: 6px; text-align: center; }
.who p { margin: 0; }
.foot { margin: 2px 0 0; line-height: 1.5; }
.link { color: var(--accent); margin-left: 4px; white-space: nowrap; }
@media (max-width: 560px) {
  .account-page { padding: 20px 12px; }
  .card { padding: 24px 18px 18px; }
  /* 16px stops iOS from zooming into the field on focus. */
  .field input { font-size: 16px; height: 42px; }
}
</style>
