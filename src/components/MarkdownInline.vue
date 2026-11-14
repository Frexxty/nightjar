<script setup lang="ts">
import type { Inline } from "@/lib/markdown";

defineProps<{ parts: Inline[] }>();

function open(href: string) {
  window.nightjar?.window("open-external", href);
}
</script>

<template>
  <template v-for="(part, i) in parts" :key="i">
    <a v-if="part.kind === 'link'" :href="part.href" @click.prevent="open(part.href)">{{ part.text }}</a>
    <code v-else-if="part.kind === 'code'">{{ part.text }}</code>
    <strong v-else-if="part.kind === 'strong'">{{ part.text }}</strong>
    <em v-else-if="part.kind === 'em'">{{ part.text }}</em>
    <template v-else>{{ part.text }}</template>
  </template>
</template>
