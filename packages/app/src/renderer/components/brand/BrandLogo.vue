<template>
  <span class="brand-logo" :class="`brand-logo--${kind}`" data-testid="calmnova-brand-logo">
    <img v-if="kind === 'symbol'" class="brand-logo__image" :src="symbolUrl" alt="" aria-hidden="true" />
    <template v-else>
      <img
        class="brand-logo__image brand-logo__image--light"
        :src="logoLightUrl"
        alt=""
        aria-hidden="true"
        data-brand-theme="light"
      />
      <img
        class="brand-logo__image brand-logo__image--dark"
        :src="logoDarkUrl"
        alt=""
        aria-hidden="true"
        data-brand-theme="dark"
      />
    </template>
    <span class="brand-logo__accessible-name">{{ alt }}</span>
  </span>
</template>

<script setup lang="ts">
import logoDarkUrl from "../../assets/branding/logo-dark.png";
import logoLightUrl from "../../assets/branding/logo-light.png";
import symbolUrl from "../../assets/branding/symbol.png";

withDefaults(
  defineProps<{
    kind?: "wordmark" | "symbol";
    alt?: string;
  }>(),
  {
    kind: "wordmark",
    alt: "Calmnova Code",
  }
);
</script>

<style scoped>
.brand-logo {
  display: inline-block;
  line-height: 0;
}

.brand-logo__image {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.brand-logo__image--dark {
  display: none;
}

:global(html[data-tone="dark"]) .brand-logo__image--light {
  display: none;
}

:global(html[data-tone="dark"]) .brand-logo__image--dark {
  display: block;
}

.brand-logo__accessible-name {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
</style>
