import { ipcMain } from "electron";
import { IPC_AGENT_CHANNELS } from "@codenexus/shared/ipc/channels";
import type {
  CustomAgentApproveArgs,
  CustomAgentCancelArgs,
  CustomAgentRunArgs,
  CustomAgentStreamEvent,
  CustomSessionCreateArgs,
  CustomSessionDeleteArgs,
  CustomSessionGetArgs,
  CustomSessionUpsertArgs,
} from "@codenexus/shared/ipc/contracts";
import type { CustomAgentService } from "../../services/CustomAgentService";
import type { CustomSessionService } from "../../services/CustomSessionService";

export function registerAgentHandlers(deps: {
  customAgentService: CustomAgentService;
  customSessionService: CustomSessionService;
  sendEvent: (payload: CustomAgentStreamEvent) => void;
}) {
  const { customAgentService, customSessionService, sendEvent } = deps;

  // 跑一次回合：把流式事件（文本增量 / 工具活动 / 审批请求）经 sendEvent 推给渲染层，
  // 同时返回权威的最终文本。服务内部按 runId 决定是否发流（无 runId 即不发）。
  ipcMain.handle(IPC_AGENT_CHANNELS.agentRun, async (_evt, args: CustomAgentRunArgs) => {
    return await customAgentService.run(args, sendEvent);
  });

  // 回传一次审批决策，解开主进程里挂起的写改 / 命令确认。
  ipcMain.handle(IPC_AGENT_CHANNELS.agentApprove, async (_evt, args: CustomAgentApproveArgs) => {
    return customAgentService.resolveApproval(args);
  });

  // 取消正在运行的 agent。
  ipcMain.handle(IPC_AGENT_CHANNELS.agentCancel, async (_evt, args: CustomAgentCancelArgs) => {
    return customAgentService.cancel(args.runId);
  });

  ipcMain.handle(IPC_AGENT_CHANNELS.agentSessionList, async () => {
    return { items: await customSessionService.list() };
  });

  ipcMain.handle(IPC_AGENT_CHANNELS.agentSessionGet, async (_evt, args: CustomSessionGetArgs) => {
    return { item: await customSessionService.get(args?.id) };
  });

  ipcMain.handle(IPC_AGENT_CHANNELS.agentSessionCreate, async (_evt, args?: CustomSessionCreateArgs) => {
    return customSessionService.create(args);
  });

  ipcMain.handle(IPC_AGENT_CHANNELS.agentSessionUpsert, async (_evt, args: CustomSessionUpsertArgs) => {
    return customSessionService.upsert(args?.session);
  });

  ipcMain.handle(IPC_AGENT_CHANNELS.agentSessionDelete, async (_evt, args: CustomSessionDeleteArgs) => {
    return customSessionService.delete(args?.id);
  });
}
