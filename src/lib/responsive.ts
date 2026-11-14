import { readonly, ref } from "vue";

/** Same breakpoint as the `@media (max-width: 760px)` rules in the components. */
export const PHONE_QUERY = "(max-width: 760px)";

function media(query: string) {
  const list = window.matchMedia(query);
  const matches = ref(list.matches);
  list.addEventListener("change", (e) => (matches.value = e.matches));
  return readonly(matches);
}

/** Compact layout for phones and narrow desktop windows: tab bar, mini player, now-playing sheet. */
export const isPhone = media(PHONE_QUERY);
/** A finger is the main input: no hover, so no hover-only controls. */
export const isTouch = media("(hover: none) and (pointer: coarse)");
