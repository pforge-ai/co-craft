import { agentTasksIpcHandlers } from './agent-tasks';
import { assetOpsIpcHandlers } from './asset-ops';
import { mediaVaultIpcHandlers } from './media-vault';
import { projectIpcHandlers } from './project';
import { skillsIpcHandlers } from './skills';
import { stageIpcHandlers } from './stage';
import { system1IpcHandlers } from './system1';
import type { IpcContext, IpcHandlerMap } from './types';

export type { IpcContext, IpcHandlerMap, IpcMethodHandler } from './types';
export { listSkillsFromRoots, parseSkillMarkdown } from './skills';

export const IPC_HANDLERS: IpcHandlerMap = {
  ...projectIpcHandlers,
  ...mediaVaultIpcHandlers,
  ...agentTasksIpcHandlers,
  ...skillsIpcHandlers,
  ...stageIpcHandlers,
  ...assetOpsIpcHandlers,
  ...system1IpcHandlers,
};

export const IPC_METHOD_NAMES = Object.keys(IPC_HANDLERS);

export async function dispatchIpcCall(method: string, arg: any, ctx: IpcContext): Promise<unknown> {
  const fn = IPC_HANDLERS[method];
  if (!fn) throw new Error('未知操作：' + method);
  return fn(arg ?? {}, ctx);
}
