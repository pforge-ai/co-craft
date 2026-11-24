import type { ModelAdapter } from '../../src/core/types';
import { arkDriver } from './ark';
import { dashscopeDriver } from './dashscope';
import { minimaxDriver } from './minimax';
import { openaiDriver } from './openai';
import type { MediaProviderDriver } from './types';

const DRIVERS: MediaProviderDriver[] = [dashscopeDriver, arkDriver, minimaxDriver, openaiDriver];

const DRIVER_MAP = new Map<ModelAdapter, MediaProviderDriver>();
for (const driver of DRIVERS) {
  for (const adapter of driver.adapters) {
    DRIVER_MAP.set(adapter, driver);
  }
}

export function getProviderDriver(adapter: ModelAdapter): MediaProviderDriver {
  const driver = DRIVER_MAP.get(adapter);
  if (!driver) throw new Error(`未找到适配器「${adapter}」对应的云端驱动`);
  return driver;
}

export * from './types';
export { dashscopeDriver, isDashscopeMediaArrayVideo, isDashscopeMultimodalImage } from './dashscope';
export { arkDriver } from './ark';
export { minimaxDriver, isMiniMaxH3Image, isMiniMaxV2Video } from './minimax';
export { openaiDriver } from './openai';
