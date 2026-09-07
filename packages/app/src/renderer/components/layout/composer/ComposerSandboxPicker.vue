<template>
  <button
    ref="triggerRef"
    type="button"
    class="composer-sandbox-trigger composer-select--sandbox mono"
    :class="[sandboxToneClass, { 'is-open': open }]"
    :disabled="disabled"
    aria-haspopup="listbox"
    :aria-expanded="open ? 'true' : 'false'"
    :aria-label="`${t('composer.permission')}: ${selectedLabel}`"
    :title="`${t('composer.permission')}: ${permissionCopy(modelValue).description}`"
    @pointerdown="onPreservePointerFocus"
    @click="onTriggerClick"
    @keydown="onTriggerKeydown"
  >
    <span class="composer-sandbox-value">{{ selectedLabel }}</span>
    <ChevronDown class="composer-sandbox-chevron" :class="{ 'is-open': open }" aria-hidden="true" />
  </button>

  <Teleport to="body">
    <Transition name="ui-select-popover">
      <div
        v-if="open"
        ref="popoverRef"
        class="composer-sandbox-popover"
        :style="popoverStyle"
        :data-composer-owner="interactionOwnerId || undefined"
        role="listbox"
        :aria-label="t('composer.permission')"
        @keydown="onListKeydown"
      >
        <button
          v-for="option in pickerOptions"
          :key="option.value"
          type="button"
          class="composer-sandbox-option composer-select--sandbox mono"
          :class="[option.toneClass, { 'is-selected': option.selected }]"
          :data-value="option.value"
          role="option"
          :aria-selected="option.selected ? 'true' : 'false'"
          @click="onOptionClick(option.value)"
        >
          <span class="composer-sandbox-option-copy"
            ><span class="composer-sandbox-option-label">{{ option.label }}</span
            ><span class="composer-sandbox-option-description">{{
              permissionCopy(option.value).description
            }}</span></span
          >
          <Check v-if="option.selected" class="composer-sandbox-check" aria-hidden="true" />
        </button>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { Check, ChevronDown } from "lucide-vue-next";
import { useI18n } from "vue-i18n";
import type { SandboxMode } from "../../../stores/runtime.store";

type SelectOption = {
  value: string;
  label: string;
};

const props = defineProps<{
  modelValue: SandboxMode;
  options: readonly SelectOption[];
  tooltipText: string;
  preservePointerFocus?: boolean;
  interactionOwnerId?: string;
  disabled?: boolean;
}>();

const emit = defineEmits<{
  (event: "update:modelValue", value: SandboxMode): void;
}>();

const { t, locale } = useI18n();
function permissionCopy(value: string) {
  const zh = locale.value.startsWith("zh");
  if (value === "read-only")
    return {
      label: zh ? "只读" : "Read Only",
      description: zh ? "只能查看项目，不修改文件。" : "View the project without modifying files.",
    };
  if (value === "workspace-write")
    return {
      label: zh ? "工作区" : "Workspace",
      description: zh ? "可读取和修改当前工作区。" : "Read and modify files in the workspace.",
    };
  return {
    label: zh ? "完全访问" : "Full Access",
    description: zh
      ? "可访问工作区外文件、运行命令及联网。仅用于可信任务。"
      : "Access files outside the workspace, run commands and use the network. Trusted tasks only.",
  };
}
const open = ref(false);
const triggerRef = ref<HTMLButtonElement | null>(null);
const popoverRef = ref<HTMLDivElement | null>(null);
const popoverStyle = ref<Record<string, string>>({});

const POPOVER_GAP_PX = 6;
const VIEWPORT_PADDING_PX = 8;
const POPOVER_WIDTH_PX = 280;

function onPreservePointerFocus(event: PointerEvent) {
  if (props.preservePointerFocus) event.preventDefault();
}

function normalizeToneKey(value: unknown): string {
  return (
    String(value ?? "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "default"
  );
}

const sandboxToneClass = computed(() => `is-${normalizeToneKey(props.modelValue)}`);
const disabled = computed(() => Boolean(props.disabled));

const selectedLabel = computed(() => {
  const hit = props.options.find((option) => option.value === props.modelValue);
  return hit ? permissionCopy(hit.value).label : props.modelValue;
});

const pickerOptions = computed(() =>
  props.options.map((option) => ({
    ...option,
    label: permissionCopy(option.value).label,
    toneClass: `is-${normalizeToneKey(option.value)}`,
    selected: option.value === props.modelValue,
  }))
);

function updatePopoverPosition() {
  const trigger = triggerRef.value;
  if (!trigger) return;
  const rect = trigger.getBoundingClientRect();
  const width = Math.min(POPOVER_WIDTH_PX, window.innerWidth - VIEWPORT_PADDING_PX * 2);
  const left = Math.max(
    VIEWPORT_PADDING_PX,
    Math.min(Math.round(rect.left), window.innerWidth - width - VIEWPORT_PADDING_PX)
  );
  const spaceBelow = Math.max(0, window.innerHeight - VIEWPORT_PADDING_PX - rect.bottom - POPOVER_GAP_PX);
  const spaceAbove = Math.max(0, rect.top - POPOVER_GAP_PX - VIEWPORT_PADDING_PX);
  const openBelow = spaceBelow >= 120 || spaceBelow >= spaceAbove;
  const estimatedHeight = Math.min(window.innerHeight - 16, popoverRef.value?.scrollHeight || 220);
  const top = openBelow
    ? rect.bottom + POPOVER_GAP_PX
    : Math.max(VIEWPORT_PADDING_PX, rect.top - POPOVER_GAP_PX - estimatedHeight);

  popoverStyle.value = {
    position: "fixed",
    left: `${Math.round(left)}px`,
    top: `${Math.round(top)}px`,
    width: `${width}px`,
    maxHeight: `${Math.max(80, openBelow ? spaceBelow : spaceAbove)}px`,
    overflowY: "auto",
  };
}

async function openPicker() {
  if (disabled.value) return;
  open.value = true;
  await nextTick();
  updatePopoverPosition();
  popoverRef.value?.querySelector<HTMLButtonElement>('[aria-selected="true"]')?.focus();
  window.requestAnimationFrame(() => updatePopoverPosition());
}

function closePicker(restoreFocus = true) {
  open.value = false;
  if (restoreFocus) triggerRef.value?.focus();
}

async function onTriggerClick() {
  if (disabled.value) return;
  if (open.value) {
    closePicker();
    return;
  }
  await openPicker();
}

function onOptionClick(value: string) {
  emit("update:modelValue", value as SandboxMode);
  closePicker();
}

async function onTriggerKeydown(event: KeyboardEvent) {
  if (disabled.value) return;
  if (event.key === "Escape") {
    closePicker();
    return;
  }
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    await onTriggerClick();
    popoverRef.value?.querySelector<HTMLButtonElement>('[aria-selected="true"]')?.focus();
  }
}

function onListKeydown(event: KeyboardEvent) {
  if (event.key === "Escape") {
    event.stopPropagation();
    closePicker();
    triggerRef.value?.focus();
    return;
  }
  if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
  const buttons = Array.from(popoverRef.value?.querySelectorAll<HTMLButtonElement>("button") || []);
  const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
  const next =
    event.key === "Home"
      ? 0
      : event.key === "End"
        ? buttons.length - 1
        : (index + (event.key === "ArrowUp" ? -1 : 1) + buttons.length) % buttons.length;
  event.preventDefault();
  buttons[next]?.focus();
}
function onWindowPointerDownCapture(event: PointerEvent) {
  if (!open.value) return;
  const target = event.target as Node | null;
  if (!target) return;
  if (triggerRef.value?.contains(target)) return;
  if (popoverRef.value?.contains(target)) return;
  closePicker(false);
}

function onWindowResizeOrScroll() {
  if (open.value) updatePopoverPosition();
}

watch(open, (next) => {
  if (next) {
    window.addEventListener("pointerdown", onWindowPointerDownCapture, true);
    window.addEventListener("resize", onWindowResizeOrScroll, true);
    window.addEventListener("scroll", onWindowResizeOrScroll, true);
    return;
  }
  window.removeEventListener("pointerdown", onWindowPointerDownCapture, true);
  window.removeEventListener("resize", onWindowResizeOrScroll, true);
  window.removeEventListener("scroll", onWindowResizeOrScroll, true);
});

watch(disabled, (next) => {
  if (next) closePicker();
});

onBeforeUnmount(() => {
  window.removeEventListener("pointerdown", onWindowPointerDownCapture, true);
  window.removeEventListener("resize", onWindowResizeOrScroll, true);
  window.removeEventListener("scroll", onWindowResizeOrScroll, true);
});
</script>
