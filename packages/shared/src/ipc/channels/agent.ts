// 自定义运行时（agent-core）域 IPC channels。
//
// 这一组描述「脱离 codex-app-server」的自定义 provider 运行时与主进程之间的边界。
// agentRun 是请求/响应式的单回合执行（返回最终文本）；流式文本增量另走 IPC_EVENT_CHANNELS.agentEvent 事件通道回吐，由 runId 关联。
export const IPC_AGENT_CHANNELS = {
  // 用激活的自定义 provider 跑一次回合：传入对话历史 + runId，流式回吐增量并返回最终文本。
  agentRun: "agent:run",
  // 回传一次工具/命令审批决策，解开主进程里挂起的 requireApproval/requireConfirmation。
  agentApprove: "agent:approve",
  // 取消正在运行的 agent。
  agentCancel: "agent:cancel",
  // Custom 模式自己的会话历史，不复用 Codex app-server 的 history/session 文件。
  agentSessionList: "agent:session:list",
  agentSessionGet: "agent:session:get",
  agentSessionCreate: "agent:session:create",
  agentSessionUpsert: "agent:session:upsert",
  agentSessionDelete: "agent:session:delete",
} as const;
