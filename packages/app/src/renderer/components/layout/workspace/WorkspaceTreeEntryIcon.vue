<template>
  <component
    :is="isDirectory ? (isExpanded ? FolderOpen : Folder) : FileCode2"
    class="workspace-file-tree-row__icon"
    aria-hidden="true"
  />
</template>
<script setup lang="ts">
import { FileCode2, Folder, FolderOpen } from "lucide-vue-next";
defineProps<{ path: string; isDirectory: boolean; isExpanded?: boolean }>();
</script>
