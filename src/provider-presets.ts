import type { CompatibleProvider, Config } from './config.js';

/** Documented capabilities of a provider's models; presets never guess, they quote vendor documentation. */
export interface ProviderPreset {
  id: string;
  label: string;
  baseUrl: string;
  keyEnv: string;
  models: CompatibleProvider['models'];
}

const ZAI_ANTHROPIC_BASE = 'https://api.z.ai/api/anthropic';

export const PROVIDER_PRESETS: readonly ProviderPreset[] = [
  {
    id: 'zai',
    label: 'Z.ai GLM models through the Anthropic-compatible endpoint',
    baseUrl: ZAI_ANTHROPIC_BASE,
    keyEnv: 'ZAI_API_KEY',
    models: [
      // GLM-5.3: text-only input, 1M context, 128K output (docs.z.ai/guides/llm/glm-5.3).
      { id: 'glm-5.3', context: 1_000_000, tools: true, vision: false },
      // GLM-5.3-Flash: native multimodal input, 1M context (docs.z.ai/guides/vlm/glm-5.3-flash).
      { id: 'glm-5.3-flash', context: 1_000_000, tools: true, vision: true },
    ],
  },
];

export function presetFor(id: string): ProviderPreset | undefined {
  return PROVIDER_PRESETS.find(preset => preset.id === id);
}

/** Adds the preset with the selected models; throws before mutating when the provider already exists. */
export function mergePreset(config: Config, preset: ProviderPreset, modelIds: readonly string[]): Config {
  if (config.providers.some(provider => provider.id === preset.id))
    throw new Error('Provider "' + preset.id + '" is already configured; edit config.json to change it.');
  const models = preset.models.filter(model => modelIds.includes(model.id));
  if (!models.length) throw new Error('Select at least one documented model: ' + preset.models.map(model => model.id).join(', ') + '.');
  return { ...config, providers: [...config.providers, { id: preset.id, baseUrl: preset.baseUrl, keyEnv: preset.keyEnv, models }] };
}
