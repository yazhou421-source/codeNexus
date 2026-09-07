// 工作区域 IPC channels。
//
// 工作区能力都必须绑定 cwd，避免 renderer 直接操作任意路径。破坏性写入前应优先走 dry run。
export const IPC_WORKSPACE_CHANNELS = {
  workspaceActivate: "workspace:activate",
  workspaceGitDiffRead: "workspace:gitDiff:read",
  // 只计算反向 patch 的影响范围，不修改磁盘。
  workspaceReverseDiffDryRun: "workspace:reverseDiff:dryRun",

  // 真正应用反向 patch；调用方应先用 dry run 确认结果。
  workspaceReverseDiffApply: "workspace:reverseDiff:apply",

  // 读取工作区 git 状态，供 UI 标记脏变更和线程上下文。
  workspaceGitStatusRead: "workspace:gitStatus:read",
} as const;
