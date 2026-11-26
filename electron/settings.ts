import { safeStorage } from 'electron';
import { join } from 'node:path';
import { copyFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { atomicJSON, readJSON } from './store';
import {
  localProvider,
  localSpeech,
  providerPresets,
  selectedModel,
  adapters,
  modelUses,
  normalizeProviderUrl,
  compatibleAdapters,
} from '../src/core/models';
import type { Settings, ModelUse, ModelDefinition, ProviderConnection, McpServerConfig } from '../src/core/types';

export const defaults: Settings = {
  schemaVersion: 2,
  providers: [localProvider],
  models: [localSpeech],
  defaults: { speech: localSpeech.id },
  provider: 'custom',
  model: '',
  baseUrl: '',
  hasApiKey: false,
  hasPexelsKey: false,
  hasTranscriptionKey: false,
  theme: 'dark',
  glass: true,
  glow: 'subtle',
  glowColor: 'emerald',
  motionEffects: true,
  allowShell: false,
  allowNetwork: false,
  mcpBridgeEnabled: false,
  mcpServers: [],
  system1: {
    mode: 'off',
    jevBaseUrl: 'https://api.typesafe.ai/v1',
    jevModelId: 'jev-latest',
    hasJevApiKey: false,
    features: {
      autoReframeBox: false,
      batchQualityGate: false,
      omnibarRouter: false,
      autoTagAssets: false,
    },
    monthlyCallCap: 500,
  },
};
export class SettingsStore {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private root: string) {}
  private initialized?: Promise<unknown>;
  private raw() {
    // The first reader performs migration once, including when boot and job recovery run together.
    if (!this.initialized)
      this.initialized = this.readAndMigrate().catch((error) => {
        this.initialized = undefined;
        throw error;
      });
    return this.initialized.then(() => readJSON<any>(join(this.root, 'settings.json')));
  }
  private async readAndMigrate() {
    const file = join(this.root, 'settings.json');
    let raw = await readJSON<any>(file, {});
    if (Number(raw.schemaVersion) > 2) throw new Error('此设置来自更新版本的 CoCraft，请用对应版本打开');
    if (raw.schemaVersion !== 2) {
      const legacy =
        raw.model || raw.apiKeyEncrypted
          ? {
              id: 'legacy',
              name: raw.provider === 'custom' ? '已保存的连接' : raw.provider || '已保存的连接',
              protocol:
                raw.provider === 'anthropic' ? 'anthropic' : raw.provider === 'google' ? 'google' : 'openai',
              baseUrl:
                raw.baseUrl ||
                providerPresets.find((p) => p.name.toLowerCase() === raw.provider)?.baseUrl ||
                'https://api.openai.com/v1',
              requiresKey: true,
              apiKeyEncrypted: raw.apiKeyEncrypted,
            }
          : undefined;
      if (Object.keys(raw).length)
        await copyFile(file, join(this.root, 'settings-v1.backup.json'), constants.COPYFILE_EXCL).catch(
          (error) => {
            if (error.code !== 'EEXIST') throw error;
          },
        );
      raw = {
        ...defaults,
        ...raw,
        schemaVersion: 2,
        providers: [localProvider, ...(legacy ? [legacy] : [])],
        models: [
          localSpeech,
          ...(legacy
            ? [
                {
                  id: 'legacy-model',
                  providerId: 'legacy',
                  name: raw.model || 'gpt-5.4',
                  modelId: raw.model || 'gpt-5.4',
                  adapter: 'chat',
                  capabilities: ['agent'],
                  parameters: {},
                },
              ]
            : []),
        ],
        defaults: { speech: localSpeech.id, ...(legacy ? { agent: 'legacy-model' } : {}) },
      };
      delete raw.apiKey;
      delete raw.apiKeyEncrypted;
      await atomicJSON(file, raw);
    }
    return raw;
  }
  private projectSettings(raw: any): Settings {
    const value: Settings = {
      ...defaults,
      ...raw,
      providers: raw.providers.map((p: any) => {
        const { apiKeyEncrypted, apiKey, ...rest } = p;
        return {
          ...rest,
          hasApiKey: !!apiKeyEncrypted,
        };
      }),
    };
    for (const key of ['pexelsKey', 'transcriptionKey'] as const) {
      const encrypted = raw[key + 'Encrypted'];
      delete (value as any)[key + 'Encrypted'];
      delete value[key];
      value[key === 'pexelsKey' ? 'hasPexelsKey' : 'hasTranscriptionKey'] = !!encrypted;
    }
    const rawS1 = raw.system1 || {};
    value.system1 = {
      mode: rawS1.mode === 'fast-model' || rawS1.mode === 'typesafe-jev' ? rawS1.mode : 'off',
      fastModelId: typeof rawS1.fastModelId === 'string' ? rawS1.fastModelId : undefined,
      jevBaseUrl: typeof rawS1.jevBaseUrl === 'string' && rawS1.jevBaseUrl.trim() ? rawS1.jevBaseUrl.trim() : 'https://api.typesafe.ai/v1',
      jevModelId: typeof rawS1.jevModelId === 'string' && rawS1.jevModelId.trim() ? rawS1.jevModelId.trim() : 'jev-latest',
      hasJevApiKey: Boolean(rawS1.jevApiKeyEncrypted),
      features: {
        autoReframeBox: Boolean(rawS1.features?.autoReframeBox),
        batchQualityGate: Boolean(rawS1.features?.batchQualityGate),
        omnibarRouter: Boolean(rawS1.features?.omnibarRouter),
        autoTagAssets: Boolean(rawS1.features?.autoTagAssets),
      },
      monthlyCallCap:
        typeof rawS1.monthlyCallCap === 'number' && Number.isFinite(rawS1.monthlyCallCap) && rawS1.monthlyCallCap >= 0
          ? Math.round(rawS1.monthlyCallCap)
          : 500,
    };
    value.mcpServers = Array.isArray(raw.mcpServers)
      ? raw.mcpServers.map((s: any): McpServerConfig => ({
          id: String(s.id || ''),
          name: String(s.name || 'MCP 服务'),
          enabled: Boolean(s.enabled),
          transport: s.transport === 'http' ? 'http' : 'stdio',
          command: typeof s.command === 'string' ? s.command : undefined,
          args: Array.isArray(s.args) ? s.args.map(String) : undefined,
          cwd: typeof s.cwd === 'string' ? s.cwd : undefined,
          envKeys: Array.isArray(s.envKeys) ? s.envKeys.map(String) : [],
          url: typeof s.url === 'string' ? s.url : undefined,
          headerKeys: Array.isArray(s.headerKeys) ? s.headerKeys.map(String) : [],
          disabledTools: Array.isArray(s.disabledTools) ? s.disabledTools.map(String) : [],
          preset: typeof s.preset === 'string' ? s.preset : undefined,
        }))
      : [];
    const model = selectedModel(value, 'agent');
    const provider = value.providers.find((p) => p.id === model?.providerId);
    value.provider =
      provider?.protocol === 'anthropic'
        ? 'anthropic'
        : provider?.protocol === 'google'
          ? 'google'
          : 'custom';
    value.model = model?.modelId || '';
    value.baseUrl = provider?.baseUrl || '';
    value.hasApiKey = !!provider && (provider.hasApiKey || !provider.requiresKey);
    return value;
  }
  async get() {
    return this.projectSettings(await this.raw());
  }
  private async decrypt(value: string) {
    return (await safeStorage.decryptStringAsync(Buffer.from(value, 'base64'))).result;
  }
  async stockKey() {
    const raw = await this.raw();
    return raw.pexelsKeyEncrypted ? this.decrypt(raw.pexelsKeyEncrypted) : undefined;
  }
  async system1Secret(): Promise<string | undefined> {
    const raw = await this.raw();
    return raw.system1?.jevApiKeyEncrypted ? this.decrypt(raw.system1.jevApiKeyEncrypted) : undefined;
  }
  async mcpServersWithSecrets(): Promise<McpServerConfig[]> {
    const raw = await this.raw();
    const list = Array.isArray(raw.mcpServers) ? raw.mcpServers : [];
    const resolved: McpServerConfig[] = [];
    for (const s of list) {
      let env: Record<string, string> | undefined;
      let headers: Record<string, string> | undefined;
      if (typeof s.envEncrypted === 'string' && s.envEncrypted) {
        try {
          const parsed = JSON.parse(await this.decrypt(s.envEncrypted));
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) env = parsed;
        } catch {}
      }
      if (typeof s.headersEncrypted === 'string' && s.headersEncrypted) {
        try {
          const parsed = JSON.parse(await this.decrypt(s.headersEncrypted));
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) headers = parsed;
        } catch {}
      }
      resolved.push({
        id: String(s.id || ''),
        name: String(s.name || 'MCP 服务'),
        enabled: Boolean(s.enabled),
        transport: s.transport === 'http' ? 'http' : 'stdio',
        command: typeof s.command === 'string' ? s.command : undefined,
        args: Array.isArray(s.args) ? s.args.map(String) : undefined,
        cwd: typeof s.cwd === 'string' ? s.cwd : undefined,
        env,
        envKeys: env ? Object.keys(env) : [],
        url: typeof s.url === 'string' ? s.url : undefined,
        headers,
        headerKeys: headers ? Object.keys(headers) : [],
        disabledTools: Array.isArray(s.disabledTools) ? s.disabledTools.map(String) : [],
        preset: typeof s.preset === 'string' ? s.preset : undefined,
      });
    }
    return resolved;
  }
  private async providerFrom(raw: any, id: string): Promise<ProviderConnection | undefined> {
    const stored = raw.providers.find((p: ProviderConnection) => p.id === id);
    if (!stored) return undefined;
    const { apiKeyEncrypted, apiKey: ignored, ...provider } = stored;
    return {
      ...provider,
      hasApiKey: !!apiKeyEncrypted,
      ...(apiKeyEncrypted ? { apiKey: await this.decrypt(apiKeyEncrypted) } : {}),
    };
  }
  async connection(id: string) {
    return this.providerFrom(await this.raw(), id);
  }
  async resolve(use: ModelUse, override?: string, projectDefaults?: Settings['defaults']) {
    const raw = await this.raw();
    const settings = this.projectSettings(raw);
    const model = override
      ? settings.models.find((m) => m.id === override && m.capabilities.includes(use))
      : selectedModel(settings, use, projectDefaults);
    if (!model)
      throw new Error(
        `请在「设置 → 用途默认值」中选择「${modelUses.find((u) => u.id === use)?.name || use}」的模型`,
      );
    const provider = await this.providerFrom(raw, model.providerId);
    if (!provider) throw new Error('模型的提供商连接不存在');
    if (provider.requiresKey && !provider.apiKey) throw new Error(`请为「${provider.name}」保存 API Key`);
    return { model, provider, settings };
  }
  async agent(override?: string, projectDefaults?: Settings['defaults']) {
    const { settings, model, provider } = await this.resolve('agent', override, projectDefaults);
    // Only the chosen model credential crosses into its worker.
    const { pexelsKey, transcriptionKey, ...scoped } = settings;
    return {
      ...scoped,
      providers: [],
      models: [],
      mcpServers: [],
      apiKey: provider.apiKey || 'local-no-key',
      provider:
        provider.protocol === 'anthropic'
          ? 'anthropic'
          : provider.protocol === 'google'
            ? 'google'
            : 'custom',
      protocol: provider.protocol,
      model: model.modelId,
      baseUrl: provider.baseUrl,
      modelParameters: model.parameters,
      modelInput: model.capabilities.includes('vision') ? ['text', 'image'] : ['text'],
    };
  }
  save(input: Partial<Settings>) {
    const work = this.queue.then(async () => {
      const raw = await this.raw();
      for (const key of [
        'theme',
        'glass',
        'glow',
        'glowColor',
        'motionEffects',
        'allowShell',
        'allowNetwork',
        'mcpBridgeEnabled',
      ] as const)
        if (input[key] !== undefined) raw[key] = input[key];
      const encrypt = async (s: string) => {
        if (!(await safeStorage.isAsyncEncryptionAvailable()))
          throw new Error('系统安全存储暂不可用，密钥未保存');
        return (await safeStorage.encryptStringAsync(s)).toString('base64');
      };
      if (input.providers)
        raw.providers = await Promise.all(
          input.providers.map(async (p) => {
            const existing = raw.providers.find((v: any) => v.id === p.id);
            if (p.protocol !== 'system' && !p.name.trim()) throw new Error('请输入提供商名称');
            const baseUrl = p.protocol === 'system' ? '' : normalizeProviderUrl(p.baseUrl.trim());
            const sameEndpoint =
              existing?.protocol === p.protocol &&
              (p.protocol === 'system' || normalizeProviderUrl(existing.baseUrl) === baseUrl);
            return {
              id: p.id,
              name: p.name.trim(),
              protocol: p.protocol,
              baseUrl,
              requiresKey: p.requiresKey,
              apiKeyEncrypted:
                p.apiKey === undefined
                  ? sameEndpoint
                    ? existing?.apiKeyEncrypted
                    : undefined
                  : p.apiKey
                    ? await encrypt(p.apiKey)
                    : undefined,
            };
          }),
        );
      if (input.models) raw.models = input.models;
      if (input.defaults) raw.defaults = input.defaults;
      // Retain compatibility for old project tools, while persisting only the new catalog.
      if (input.model !== undefined && !input.models) {
        const current = raw.models.find((m: ModelDefinition) => m.id === raw.defaults.agent);
        const id = current?.providerId || 'legacy';
        let p = raw.providers.find((p: ProviderConnection) => p.id === id);
        if (!p) {
          p = { id, name: '模型连接', protocol: 'openai', requiresKey: true };
          raw.providers.push(p);
        }
        const previousProtocol = p.protocol,
          previousUrl = p.baseUrl;
        p.protocol =
          input.provider === 'anthropic' ? 'anthropic' : input.provider === 'google' ? 'google' : 'openai';
        p.baseUrl = normalizeProviderUrl(input.baseUrl || p.baseUrl || 'https://api.openai.com/v1');
        if (
          previousProtocol !== p.protocol ||
          !previousUrl ||
          normalizeProviderUrl(previousUrl) !== p.baseUrl
        )
          delete p.apiKeyEncrypted;
        if (input.apiKey !== undefined)
          p.apiKeyEncrypted = input.apiKey ? await encrypt(input.apiKey) : undefined;
        const m = {
          id: current?.id || 'legacy-model',
          providerId: id,
          name: input.model,
          modelId: input.model,
          adapter: 'chat',
          capabilities: ['agent'],
          parameters: {},
        };
        raw.models = [...raw.models.filter((v: ModelDefinition) => v.id !== m.id), m];
        raw.defaults.agent = m.id;
      }
      for (const key of ['pexelsKey', 'transcriptionKey'] as const)
        if (input[key] !== undefined)
          raw[key + 'Encrypted'] = input[key] ? await encrypt(input[key]!) : undefined;
      if (input.system1 !== undefined) {
        const prevS1 = raw.system1 || {};
        const nextS1 = input.system1;
        const cleanUrl = nextS1.jevBaseUrl?.trim()
          ? normalizeProviderUrl(nextS1.jevBaseUrl.trim())
          : prevS1.jevBaseUrl || 'https://api.typesafe.ai/v1';
        const sameJevEndpoint =
          prevS1.jevBaseUrl && normalizeProviderUrl(prevS1.jevBaseUrl) === cleanUrl;
        raw.system1 = {
          mode: nextS1.mode === 'fast-model' || nextS1.mode === 'typesafe-jev' ? nextS1.mode : 'off',
          fastModelId: nextS1.fastModelId || undefined,
          jevBaseUrl: cleanUrl,
          jevModelId: nextS1.jevModelId?.trim() || 'jev-latest',
          jevApiKeyEncrypted:
            nextS1.jevApiKey === undefined
              ? sameJevEndpoint
                ? prevS1.jevApiKeyEncrypted
                : undefined
              : nextS1.jevApiKey
                ? await encrypt(nextS1.jevApiKey)
                : undefined,
          features: {
            autoReframeBox: Boolean(nextS1.features?.autoReframeBox),
            batchQualityGate: Boolean(nextS1.features?.batchQualityGate),
            omnibarRouter: Boolean(nextS1.features?.omnibarRouter),
            autoTagAssets: Boolean(nextS1.features?.autoTagAssets),
          },
          monthlyCallCap:
            typeof nextS1.monthlyCallCap === 'number' && Number.isFinite(nextS1.monthlyCallCap)
              ? Math.max(0, Math.round(nextS1.monthlyCallCap))
              : 500,
        };
      }
      if (input.mcpServers !== undefined) {
        const prevList = Array.isArray(raw.mcpServers) ? raw.mcpServers : [];
        const seenMcpIds = new Set<string>();
        raw.mcpServers = await Promise.all(
          input.mcpServers.map(async (s) => {
            const id = String(s.id || '').trim();
            if (!id || seenMcpIds.has(id)) throw new Error('外部 MCP 服务必须具有唯一标识');
            seenMcpIds.add(id);
            const name = String(s.name || '').trim();
            if (!name) throw new Error('请填写外部 MCP 服务名称');
            const transport = s.transport === 'http' ? 'http' : 'stdio';
            const existing = prevList.find((v: any) => v.id === id);
            let command: string | undefined;
            let args: string[] | undefined;
            let cwd: string | undefined;
            let url: string | undefined;
            if (transport === 'stdio') {
              command = String(s.command || '').trim();
              if (!command) throw new Error(`MCP 服务「${name}」需要填写启动命令（如 uvx 或 npx）`);
              args = Array.isArray(s.args) ? s.args.map((a) => String(a)).filter((a) => a.length > 0) : [];
              cwd = typeof s.cwd === 'string' && s.cwd.trim() ? s.cwd.trim() : undefined;
            } else {
              url = normalizeProviderUrl(String(s.url || '').trim());
            }
            const sameTarget =
              existing &&
              existing.transport === transport &&
              (transport === 'stdio'
                ? existing.command === command
                : existing.url && normalizeProviderUrl(existing.url) === url);

            let envEncrypted: string | undefined;
            let envKeys: string[] = [];
            if (s.env !== undefined) {
              const cleaned = Object.fromEntries(
                Object.entries(s.env)
                  .map(([k, v]) => [k.trim(), String(v)] as const)
                  .filter(([k]) => k.length > 0),
              );
              envKeys = Object.keys(cleaned);
              envEncrypted = envKeys.length ? await encrypt(JSON.stringify(cleaned)) : undefined;
            } else if (sameTarget && existing.envEncrypted) {
              envEncrypted = existing.envEncrypted;
              envKeys = Array.isArray(existing.envKeys) ? existing.envKeys.map(String) : [];
            }

            let headersEncrypted: string | undefined;
            let headerKeys: string[] = [];
            if (s.headers !== undefined) {
              const cleaned = Object.fromEntries(
                Object.entries(s.headers)
                  .map(([k, v]) => [k.trim(), String(v)] as const)
                  .filter(([k]) => k.length > 0),
              );
              headerKeys = Object.keys(cleaned);
              headersEncrypted = headerKeys.length ? await encrypt(JSON.stringify(cleaned)) : undefined;
            } else if (sameTarget && existing.headersEncrypted) {
              headersEncrypted = existing.headersEncrypted;
              headerKeys = Array.isArray(existing.headerKeys) ? existing.headerKeys.map(String) : [];
            }

            return {
              id,
              name,
              enabled: Boolean(s.enabled),
              transport,
              ...(command ? { command, args } : {}),
              ...(cwd ? { cwd } : {}),
              ...(url ? { url } : {}),
              ...(envEncrypted ? { envEncrypted, envKeys } : { envKeys: [] }),
              ...(headersEncrypted ? { headersEncrypted, headerKeys } : { headerKeys: [] }),
              disabledTools: Array.isArray(s.disabledTools)
                ? Array.from(new Set(s.disabledTools.map(String).filter(Boolean)))
                : [],
              ...(s.preset ? { preset: String(s.preset) } : {}),
            };
          }),
        );
      }
      for (const list of [raw.providers, raw.models]) {
        const ids = list.map((entry: { id: string }) => entry.id);
        if (ids.some((id: string) => !id) || ids.length !== new Set(ids).size)
          throw new Error('连接和模型必须具有唯一标识');
      }
      for (const m of raw.models as ModelDefinition[]) {
        const adapter = adapters.find((a) => a.id === m.adapter);
        if (
          !adapter ||
          !m.modelId.trim() ||
          !m.name.trim() ||
          !m.capabilities.length ||
          m.capabilities.some((use) => !adapter.uses.includes(use))
        )
          throw new Error('请检查模型名称、接口与用途');
        const provider = raw.providers.find((p: ProviderConnection) => p.id === m.providerId);
        if (provider && !compatibleAdapters(provider).some((a) => a.id === m.adapter))
          throw new Error('「' + m.name + '」的接口与提供商协议不匹配');
      }
      for (const m of raw.models)
        if (!raw.providers.some((p: ProviderConnection) => p.id === m.providerId))
          throw new Error(`「${m.name}」缺少提供商连接`);
      for (const [use, id] of Object.entries(raw.defaults))
        if (
          id &&
          !raw.models.some((m: ModelDefinition) => m.id === id && m.capabilities.includes(use as ModelUse))
        )
          delete raw.defaults[use];
      await atomicJSON(join(this.root, 'settings.json'), raw);
      return this.get();
    });
    this.queue = work.catch(() => {});
    return work;
  }
}
