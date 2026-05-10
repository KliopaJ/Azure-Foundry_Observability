// ── Model Pricing — Official Azure Prices, Global Standard, per 1 M tokens ──
// Sources:
//   OpenAI models  → https://azure.microsoft.com/en-us/pricing/details/cognitive-services/openai-service/
//   DeepSeek       → https://azure.microsoft.com/en-us/pricing/details/ai-foundry-models/deepseek/
//   Kimi           → https://azure.microsoft.com/en-us/pricing/details/ai-foundry-models/kimi/
//   Llama          → https://azure.microsoft.com/en-us/pricing/details/ai-foundry-models/llama/
//   Microsoft      → https://azure.microsoft.com/en-us/pricing/details/ai-foundry-models/microsoft/

export interface ModelPricing {
  input: number
  cachedInput: number
  output: number
}

export const PRICING_SOURCES = {
  openai:    'https://azure.microsoft.com/en-us/pricing/details/cognitive-services/openai-service/',
  deepseek:  'https://azure.microsoft.com/en-us/pricing/details/ai-foundry-models/deepseek/',
  kimi:      'https://azure.microsoft.com/en-us/pricing/details/ai-foundry-models/kimi/',
  llama:     'https://azure.microsoft.com/en-us/pricing/details/ai-foundry-models/llama/',
  microsoft: 'https://azure.microsoft.com/en-us/pricing/details/ai-foundry-models/microsoft/',
}

export const MODEL_PRICING: Record<string, ModelPricing> = {
  // ── GPT-5.4 series ──────────────────────────────────────────────────────
  'gpt-5.4':       { input: 2.50,  cachedInput: 0.25,  output: 15.00 },
  'gpt-5.4-mini':  { input: 0.75,  cachedInput: 0.08,  output: 4.50  },
  'gpt-5.4-nano':  { input: 0.20,  cachedInput: 0.02,  output: 1.25  },
  // ── GPT-5.3 ─────────────────────────────────────────────────────────────
  'gpt-5.3':       { input: 1.75,  cachedInput: 0.18,  output: 14.00 },
  // ── GPT-5.2 ─────────────────────────────────────────────────────────────
  'gpt-5.2':       { input: 1.75,  cachedInput: 0.18,  output: 14.00 },
  // ── GPT-5.1 ─────────────────────────────────────────────────────────────
  'gpt-5.1':       { input: 1.25,  cachedInput: 0.13,  output: 10.00 },
  'gpt-5.1-codex-mini': { input: 0.25, cachedInput: 0.03, output: 2.00 },
  // ── GPT-5 ───────────────────────────────────────────────────────────────
  'gpt-5':         { input: 1.25,  cachedInput: 0.13,  output: 10.00 },
  'gpt-5-mini':    { input: 0.25,  cachedInput: 0.03,  output: 2.00  },
  'gpt-5-nano':    { input: 0.05,  cachedInput: 0.01,  output: 0.40  },
  // ── GPT-4.1 ─────────────────────────────────────────────────────────────
  'gpt-4.1':       { input: 2.00,  cachedInput: 0.50,  output: 8.00  },
  'gpt-4.1-mini':  { input: 0.40,  cachedInput: 0.10,  output: 1.60  },
  'gpt-4.1-nano':  { input: 0.10,  cachedInput: 0.03,  output: 0.40  },
  // ── GPT-4o ──────────────────────────────────────────────────────────────
  'gpt-4o':        { input: 2.50,  cachedInput: 1.25,  output: 10.00 },
  'gpt-4o-mini':   { input: 0.15,  cachedInput: 0.075, output: 0.60  },
  // ── o-series ────────────────────────────────────────────────────────────
  'o4-mini':       { input: 1.10,  cachedInput: 0.28,  output: 4.40  },
  'o3':            { input: 2.00,  cachedInput: 0.50,  output: 8.00  },
  'o3-mini':       { input: 1.10,  cachedInput: 0.55,  output: 4.40  },
  'o1':            { input: 15.00, cachedInput: 7.50,  output: 60.00 },
  'o1-mini':       { input: 1.10,  cachedInput: 0.55,  output: 4.40  },
  // ── DeepSeek (Foundry Models — Global) ──────────────────────────────────
  'deepseek-v3.2': { input: 0.58,  cachedInput: 0,     output: 1.68  },
  'deepseek-v3':   { input: 1.14,  cachedInput: 0,     output: 4.56  },
  'deepseek-r1':   { input: 1.35,  cachedInput: 0,     output: 5.40  },
  // ── Kimi (Foundry Models — Global) ──────────────────────────────────────
  'kimi-k2.5':     { input: 0.60,  cachedInput: 0,     output: 3.00  },
  'kimi-k2':       { input: 0.60,  cachedInput: 0,     output: 2.50  },
  // ── Llama (Foundry Models — Global) ─────────────────────────────────────
  'llama-4-maverick': { input: 0.25, cachedInput: 0,   output: 1.00  },
  'llama-3.3-70b': { input: 0.71,  cachedInput: 0,     output: 0.71  },
  // ── Microsoft / Phi (Foundry Models — Global) ───────────────────────────
  'phi-4':         { input: 0.125, cachedInput: 0,     output: 0.50  },
  'phi-4-mini':    { input: 0.075, cachedInput: 0,     output: 0.30  },
  'mai-ds-r1':     { input: 1.35,  cachedInput: 0,     output: 5.40  },
}

export const MODEL_PRICING_DEFAULT: ModelPricing = { input: 2.00, cachedInput: 0.50, output: 8.00 }

/** Look up pricing for a deployment name (fuzzy match on lowercase). */
export function getModelPricing(deployment: string): ModelPricing {
  const d = deployment.toLowerCase()
  const key = Object.keys(MODEL_PRICING).find(k => d.includes(k))
  return key ? MODEL_PRICING[key] : MODEL_PRICING_DEFAULT
}

/** Same as getModelPricing but also returns the matched key. */
export function detectModelPricing(deployment: string): { key: string; pricing: ModelPricing } {
  const d = deployment.toLowerCase()
  const key = Object.keys(MODEL_PRICING).find(k => d.includes(k))
  return key ? { key, pricing: MODEL_PRICING[key] } : { key: 'default', pricing: MODEL_PRICING_DEFAULT }
}

/** Dollar cost for known input + output token counts. */
export function getCost(deployment: string, inputTokens: number, outputTokens: number): number {
  const p = getModelPricing(deployment)
  return (inputTokens / 1_000_000) * p.input + (outputTokens / 1_000_000) * p.output
}

/** Blended cost for estimated total tokens (75 % input / 25 % output). */
export function getCostBlended(deployment: string, totalTokens: number): number {
  const p = getModelPricing(deployment)
  const blended = p.input * 0.75 + p.output * 0.25
  return (totalTokens / 1_000_000) * blended
}

/** Blended $/1 K rate (75 % input, 25 % output) — handy for budget ↔ TPM. */
export function blendedPer1K(p: ModelPricing): number {
  return (p.input * 0.75 + p.output * 0.25) / 1_000
}
