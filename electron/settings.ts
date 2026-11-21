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
import type { Settings, ModelUse, ModelDefinition, ProviderConnection } from '../src/core/types';

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
  allowShell: false,
  allowNetwork: false,
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
      for (const key of ['theme', 'glass', 'allowShell', 'allowNetwork'] as const)
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
