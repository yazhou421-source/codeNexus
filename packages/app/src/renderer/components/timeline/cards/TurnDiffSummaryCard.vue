<template>
  <div class="turn-diff-summary-card grid gap-1.5">
    <div class="turn-diff-summary-pills flex flex-wrap gap-1">
      <span
        v-for="pill in summaryPills"
        :key="pill.key"
        class="turn-diff-summary-pill inline-flex items-center rounded-[4px] border px-1.5 py-0 text-[10.5px] leading-4.5"
        :class="pill.className"
      >
        <span class="dim mr-1">{{ pill.label }}</span>
        <span v-if="pill.key === 'lines'" class="turn-diff-line-stats mono">
          <span class="turn-diff-line-add">+{{ pill.add }}</span>
          <span class="turn-diff-line-del">-{{ pill.del }}</span>
        </span>
        <span v-else class="mono">{{ pill.value }}</span>
      </span>
    </div>

    <div class="grid gap-1.5">
      <div
        v-for="file in files"
        :key="file.key"
        class="turn-diff-file-card rounded-[4px] border border-[var(--border)] bg-[var(--button-bg)] px-0 py-0 shadow-[var(--shadow-soft)]"
      >
        <div
          class="turn-diff-file-summary flex min-w-0 w-full items-center gap-1.5 rounded-[4px] px-2 py-1.5 text-left"
        >
          <span
            class="turn-diff-kind-badge inline-flex shrink-0 self-center rounded-[4px] border px-1.5 py-0 text-[9.5px] font-semibold tracking-[0.1px]"
            :class="kindBadgeClass(file.kind)"
          >
            {{ kindLabel(file.kind) }}
          </span>
          <span class="turn-diff-file-content min-w-0 flex flex-1 items-center gap-1.5">
            <span class="turn-diff-file-title block min-w-0 flex-1 truncate mono text-[11.5px] text-[var(--text)]">{{
              file.label
            }}</span>
            <span
              v-if="file.add > 0 || file.del > 0"
              class="turn-diff-file-meta turn-diff-line-stats mono text-[10.5px] text-[var(--text-muted)]"
            >
              <span class="turn-diff-line-add">+{{ file.add }}</span>
              <span class="turn-diff-line-del">-{{ file.del }}</span>
            </span>
          </span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { getParsedDiffCached } from "../../../features/timeline/renderModel/diff";

type DiffFileKind = "add" | "modify" | "delete" | "rename" | "unknown";

type DiffFileSummary = {
  key: string;
  kind: DiffFileKind;
  oldPath: string;
  newPath: string;
  label: string;
  title: string;
  diffText: string;
  add: number;
  del: number;
};

type SummaryPill = {
  key: string;
  label: string;
  className: string;
  value?: string;
  add?: number;
  del?: number;
};

type DiffSummary = {
  files: DiffFileSummary[];
  truncated: boolean;
  totalAdd: number;
  totalDel: number;
  countByKind: Record<DiffFileKind, number>;
};

const props = defineProps<{
  diffText: string;
}>();

const { t } = useI18n();

const normalizePath = (value: string) => {
  const trimmed = String(value ?? "")
    .trim()
    .replace(/^['"]|['"]$/g, "");
  if (!trimmed || trimmed === "/dev/null") return "";
  if (/^[ab]\//.test(trimmed)) return trimmed.slice(2);
  return trimmed;
};

const parseDiffGitHeader = (line: string) => {
  const source = String(line ?? "").trim();
  const match = /^diff --git\s+"?a\/(.+?)"?\s+"?b\/(.+?)"?$/.exec(source);
  if (!match) return { oldPath: "", newPath: "" };
  return {
    oldPath: normalizePath(`a/${match[1] ?? ""}`),
    newPath: normalizePath(`b/${match[2] ?? ""}`),
  };
};

const countAddedDeletedLines = (diffText: string) => {
  const parsed = getParsedDiffCached(diffText);
  return { ...parsed.stats, truncated: parsed.truncated };
};

const splitDiffSections = (diffText: string) => {
  const normalized = String(diffText ?? "").replace(/\r\n/g, "\n");
  if (!normalized.trim()) return [] as string[];

  const lines = normalized.split("\n");
  const starts: number[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].startsWith("diff --git ")) starts.push(i);
  }

  if (starts.length === 0) return [normalized];

  const sections: string[] = [];
  for (let i = 0; i < starts.length; i += 1) {
    const start = starts[i];
    const end = i + 1 < starts.length ? starts[i + 1] : lines.length;
    sections.push(lines.slice(start, end).join("\n"));
  }
  return sections.filter((section) => section.trim().length > 0);
};

const summarizeSection = (sectionText: string, index: number): DiffFileSummary => {
  const lines = String(sectionText ?? "")
    .replace(/\r\n/g, "\n")
    .split("\n");
  const first = lines[0] ?? "";
  const headerPaths = parseDiffGitHeader(first);
  let oldPath = headerPaths.oldPath;
  let newPath = headerPaths.newPath;
  let renameFrom = "";
  let renameTo = "";
  let isAdd = false;
  let isDelete = false;

  for (const rawLine of lines) {
    const line = String(rawLine ?? "");
    if (line.startsWith("@@")) break;
    if (line.startsWith("rename from ")) renameFrom = normalizePath(line.slice("rename from ".length));
    else if (line.startsWith("rename to ")) renameTo = normalizePath(line.slice("rename to ".length));
    else if (line.startsWith("new file mode ")) isAdd = true;
    else if (line.startsWith("deleted file mode ")) isDelete = true;
    else if (line.startsWith("--- ")) {
      const next = normalizePath(line.slice(4));
      if (!next) isAdd = true;
      else oldPath = next;
    } else if (line.startsWith("+++ ")) {
      const next = normalizePath(line.slice(4));
      if (!next) isDelete = true;
      else newPath = next;
    }
  }

  const effectiveOldPath = renameFrom || oldPath;
  const effectiveNewPath = renameTo || newPath;
  const kind: DiffFileKind =
    renameFrom || renameTo
      ? "rename"
      : isAdd
        ? "add"
        : isDelete
          ? "delete"
          : effectiveNewPath || effectiveOldPath
            ? "modify"
            : "unknown";

  const stats = countAddedDeletedLines(sectionText);
  const fallbackName = t("turnDiff.changeFallback", { index: index + 1 });
  const label =
    kind === "rename"
      ? `${effectiveOldPath || fallbackName} -> ${effectiveNewPath || fallbackName}`
      : effectiveNewPath || effectiveOldPath || fallbackName;
  const title =
    kind === "rename"
      ? `${effectiveOldPath || fallbackName} -> ${effectiveNewPath || fallbackName}`
      : effectiveNewPath || effectiveOldPath || fallbackName;
  return {
    key: `${effectiveOldPath || "unknown"}->${effectiveNewPath || "unknown"}:${index}`,
    kind,
    oldPath: effectiveOldPath,
    newPath: effectiveNewPath,
    label,
    title,
    diffText: sectionText,
    add: stats.add,
    del: stats.del,
  };
};

const summary = computed<DiffSummary>(() => {
  const sections = splitDiffSections(props.diffText);
  const files = sections.length > 0 ? sections.map((section, index) => summarizeSection(section, index)) : [];

  const countByKind: Record<DiffFileKind, number> = {
    add: 0,
    modify: 0,
    delete: 0,
    rename: 0,
    unknown: 0,
  };

  let totalAdd = 0;
  let totalDel = 0;
  for (const file of files) {
    countByKind[file.kind] += 1;
    totalAdd += file.add;
    totalDel += file.del;
  }

  const parsed = getParsedDiffCached(props.diffText);
  return {
    files,
    truncated: parsed.truncated,
    totalAdd,
    totalDel,
    countByKind,
  };
});

const files = computed(() => summary.value.files);

const summaryPills = computed(() => {
  const pills: SummaryPill[] = [];
  const counts = summary.value.countByKind;

  pills.push({
    key: "files",
    label: t("turnDiff.files"),
    value: String(summary.value.files.length),
    className: "border-[var(--border)] bg-[var(--button-bg)] text-[var(--text)]",
  });
  if (counts.add > 0)
    pills.push({ key: "add", label: t("turnDiff.added"), value: String(counts.add), className: kindBadgeClass("add") });
  if (counts.modify > 0)
    pills.push({
      key: "modify",
      label: t("turnDiff.modified"),
      value: String(counts.modify),
      className: kindBadgeClass("modify"),
    });
  if (counts.delete > 0)
    pills.push({
      key: "delete",
      label: t("turnDiff.deleted"),
      value: String(counts.delete),
      className: kindBadgeClass("delete"),
    });
  if (counts.rename > 0)
    pills.push({
      key: "rename",
      label: t("turnDiff.renamed"),
      value: String(counts.rename),
      className: kindBadgeClass("rename"),
    });
  if (summary.value.totalAdd > 0 || summary.value.totalDel > 0) {
    pills.push({
      key: "lines",
      label: t("turnDiff.lines"),
      add: summary.value.totalAdd,
      del: summary.value.totalDel,
      className: "border-[var(--border)] bg-[var(--surface-1)] text-[var(--text)]",
    });
  }
  return pills;
});

const kindLabel = (kind: DiffFileKind) => {
  if (kind === "add") return t("turnDiff.added");
  if (kind === "modify") return t("turnDiff.modified");
  if (kind === "delete") return t("turnDiff.deleted");
  if (kind === "rename") return t("turnDiff.renamed");
  return t("turnDiff.diff");
};

function kindBadgeClass(kind: DiffFileKind) {
  if (kind === "add") {
    return "border-[var(--border-success)] bg-[var(--bg-success-soft)] text-[var(--fg-success)]";
  }
  if (kind === "modify") {
    return "border-[var(--border-accent)] bg-[var(--bg-accent-soft)] text-[var(--fg-accent)]";
  }
  if (kind === "delete") {
    return "border-[var(--border-danger)] bg-[var(--bg-danger-soft)] text-[var(--fg-danger)]";
  }
  if (kind === "rename") {
    return "border-[var(--border-warning)] bg-[var(--bg-warning-soft)] text-[var(--fg-warning)]";
  }
  return "border-[var(--ui-well-border)] bg-[var(--ui-well-bg)] text-[var(--text-muted)]";
}
</script>

<style scoped>
.turn-diff-summary-card {
  position: relative;
}

.turn-diff-summary-pills {
  gap: 6px;
}

.turn-diff-summary-pill {
  box-shadow: inset 0 1px 0 color-mix(in srgb, var(--text) 8%, transparent);
}

.turn-diff-file-card {
  position: relative;
  overflow: hidden;
  border-color: color-mix(in srgb, var(--border-accent, var(--border)) 34%, var(--border) 66%);
  background: linear-gradient(
    180deg,
    color-mix(in srgb, var(--button-bg, var(--surface-1)) 86%, var(--bg-accent-soft, var(--accent-soft)) 14%),
    color-mix(in srgb, var(--button-bg, var(--surface-1)) 96%, transparent)
  );
  box-shadow:
    inset 0 1px 0 color-mix(in srgb, var(--text) 10%, transparent),
    var(--shadow-soft),
    0 0 0 1px color-mix(in srgb, var(--border-accent, var(--border)) 12%, transparent);
  transition:
    transform 180ms ease,
    border-color 180ms ease,
    box-shadow 180ms ease;
}

.turn-diff-file-card::before {
  content: "";
  position: absolute;
  inset: 0;
  background:
    radial-gradient(
      circle at top left,
      color-mix(in srgb, var(--bg-accent-soft, var(--accent-soft)) 72%, transparent),
      transparent 34%
    ),
    linear-gradient(
      120deg,
      transparent 0%,
      color-mix(in srgb, var(--bg-accent-soft, var(--accent-soft)) 28%, transparent) 48%,
      transparent 100%
    );
  opacity: 0.9;
  pointer-events: none;
}

.turn-diff-file-card:hover {
  transform: translateY(-1px);
  border-color: var(--border-accent-hover, var(--border-accent, var(--border)));
  box-shadow:
    inset 0 1px 0 color-mix(in srgb, var(--text) 12%, transparent),
    0 14px 28px color-mix(in srgb, var(--accent) 12%, transparent),
    var(--shadow-soft),
    0 0 0 1px color-mix(in srgb, var(--border-accent-hover, var(--border-accent, var(--border))) 28%, transparent);
}

.turn-diff-file-summary {
  position: relative;
  z-index: 1;
  background: linear-gradient(
    180deg,
    color-mix(
      in srgb,
      var(--button-bg-hover, var(--button-bg, var(--surface-1))) 88%,
      var(--bg-accent-soft, var(--accent-soft)) 12%
    ),
    color-mix(in srgb, var(--button-bg, var(--surface-1)) 94%, transparent)
  );
}

.turn-diff-file-trigger {
  position: relative;
  z-index: 1;
}

.turn-diff-file-content {
  min-width: 0;
}

.turn-diff-kind-badge {
  box-shadow:
    inset 0 1px 0 color-mix(in srgb, var(--text) 10%, transparent),
    0 0 0 1px color-mix(in srgb, var(--border) 14%, transparent);
}

.turn-diff-file-title {
  transition:
    color 150ms ease,
    text-shadow 150ms ease;
}

.turn-diff-file-trigger:hover .turn-diff-file-title,
.turn-diff-file-card:hover .turn-diff-file-title {
  color: var(--text);
  text-shadow: 0 0 12px color-mix(in srgb, var(--accent) 10%, transparent);
}

.turn-diff-file-meta {
  flex-shrink: 0;
  white-space: nowrap;
  color: var(--text-muted);
}

.turn-diff-line-stats {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.turn-diff-line-add {
  color: var(--fg-success);
}

.turn-diff-line-del {
  color: var(--fg-danger);
}
</style>
