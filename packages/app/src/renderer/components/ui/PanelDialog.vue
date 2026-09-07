<template>
  <Teleport to="body">
    <dialog
      v-if="open"
      ref="dialog"
      class="panel-dialog"
      :aria-label="title"
      @cancel.prevent="emit('close')"
      @click="onBackdropClick"
    >
      <section class="review-panel">
        <header class="review-panel-header">
          <h2>{{ title }}</h2>
          <button type="button" class="btn-icon" :aria-label="t('common.close')" @click="emit('close')">
            <X aria-hidden="true" />
          </button>
        </header>
        <div class="review-panel-body app-scrollbar"><slot /></div>
      </section>
    </dialog>
  </Teleport>
</template>
<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from "vue";
import { X } from "lucide-vue-next";
import { useI18n } from "vue-i18n";
const props = defineProps<{ open: boolean; title: string }>();
const emit = defineEmits<{ close: [] }>();
const { t } = useI18n();
const dialog = ref<HTMLDialogElement | null>(null);
let previousFocus: HTMLElement | null = null;
watch(
  () => props.open,
  async (open) => {
    if (open) {
      previousFocus = document.activeElement as HTMLElement | null;
      await nextTick();
      if (props.open && dialog.value && !dialog.value.open) dialog.value.showModal();
    } else {
      dialog.value?.close();
      previousFocus?.focus();
    }
  },
  { immediate: true }
);
function onBackdropClick(event: MouseEvent) {
  if (event.target === dialog.value) emit("close");
}
onBeforeUnmount(() => {
  dialog.value?.close();
  previousFocus?.focus();
});
</script>
