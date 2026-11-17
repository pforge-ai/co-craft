import { safeStorage } from 'electron';
import { join } from 'node:path';
import { atomicJSON, readJSON } from './store';
import type { Settings } from '../src/core/types';
export const defaults: Settings = {
  provider: 'openai',
  model: 'gpt-5.4',
  baseUrl: '',
  hasApiKey: false,
  hasPexelsKey: false,
  hasTranscriptionKey: false,
  theme: 'dark',
  allowShell: false,
  allowNetwork: false,
};
export class SettingsStore {
  constructor(private root: string) {}
  async get(secrets = false): Promise<Settings> {
    const raw = await readJSON<any>(join(this.root, 'settings.json'), {});
    const settings = { ...defaults, ...raw };
    for (const k of ['apiKey', 'pexelsKey', 'transcriptionKey']) {
      const encrypted = raw[k + 'Encrypted'];
      delete settings[k + 'Encrypted'];
      settings[k === 'apiKey' ? 'hasApiKey' : k === 'pexelsKey' ? 'hasPexelsKey' : 'hasTranscriptionKey'] =
        !!encrypted;
      if (secrets && encrypted) settings[k] = safeStorage.decryptString(Buffer.from(encrypted, 'base64'));
      else delete settings[k];
    }
    return settings;
  }
  async save(input: Partial<Settings>) {
    const raw = await readJSON<any>(join(this.root, 'settings.json'), {});
    for (const k of ['provider', 'model', 'baseUrl', 'theme', 'allowShell', 'allowNetwork'] as const)
      if (input[k] !== undefined) raw[k] = input[k];
    for (const k of ['apiKey', 'pexelsKey', 'transcriptionKey'] as const)
      if (input[k] !== undefined) {
        if (input[k] && !safeStorage.isEncryptionAvailable())
          throw new Error('系统安全存储暂不可用，密钥未保存');
        raw[k + 'Encrypted'] = input[k] ? safeStorage.encryptString(input[k]!).toString('base64') : undefined;
      }
    await atomicJSON(join(this.root, 'settings.json'), raw);
    return this.get();
  }
}
