<template>
  <aside class="sidebar sidebar-left">
    <div class="sidebar-brand">
      <BrandLogo kind="symbol" /><span>Calmnova Code</span
      ><button
        class="btn-icon workspace-drawer-close"
        type="button"
        :aria-label="t('common.close')"
        @click="appShellStore.setLeftSidebarVisible(false, { save: false })"
      >
        <X />
      </button>
    </div>
    <div class="lsb-shell lsb-shell--threads-only">
      <section class="lsb-pane-frame" data-pane="threads">
        <ThreadHistoryPane />
      </section>
    </div>
    <button class="sidebar-settings-entry" type="button" @click="appShellStore.openSettings('global')">
      <Settings aria-hidden="true" /><span>{{ t("topbar.openSettings") }}</span>
    </button>
  </aside>
</template>

<script setup lang="ts">
import { Settings, X } from "lucide-vue-next";
import { useI18n } from "vue-i18n";
import BrandLogo from "../brand/BrandLogo.vue";
import { useAppShellStore } from "../../stores/appShell.store";
import ThreadHistoryPane from "./left-sidebar/ThreadHistoryPane.vue";
const appShellStore = useAppShellStore();
const { t } = useI18n();
</script>
