import type { BrowserWindow } from 'electron';
import type { AgentHost } from '../agents';
import type { GenerationService } from '../generation';
import type { JobService } from '../jobs';
import type { McpBridgeServer } from '../mcp-bridge';
import type { McpClientManager } from '../mcp-client';
import type { MediaServer } from '../server';
import type { SettingsStore } from '../settings';
import type { Library, ProjectStore } from '../store';
import type { System1Service } from '../system1';
import type { GlobalVault } from '../vault';
import type { Asset, ProjectEnvelope, SkillInfo, StockVideo } from '../../src/core/types';

export interface IpcContext {
  getWin: () => BrowserWindow;
  getStore: () => ProjectStore;
  setStore: (next: ProjectStore) => void;
  library: Library;
  settings: SettingsStore;
  media: MediaServer;
  jobs: JobService;
  generation: GenerationService;
  agents: AgentHost;
  globalVault: GlobalVault;
  mcpBridge: McpBridgeServer;
  mcpClient: McpClientManager;
  system1: System1Service;
  resources: string;
  getStudioMedia: () => Asset[];
  knownStock: Map<number, StockVideo>;
  emit: (channel: string, data: unknown) => void;
  changed: (target: ProjectStore, envelope: ProjectEnvelope) => Promise<void>;
  importFiles: (paths: string[], append?: boolean, sequenceId?: string) => Promise<ProjectEnvelope>;
  listSkills: () => Promise<SkillInfo[]>;
  sanitizeFileName: (raw: string, fallback?: string) => string;
}

export type IpcMethodHandler = (arg: any, ctx: IpcContext) => Promise<unknown> | unknown;
export type IpcHandlerMap = Record<string, IpcMethodHandler>;
