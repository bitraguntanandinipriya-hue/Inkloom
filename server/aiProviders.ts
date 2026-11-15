import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import type { AiModelInfo, AiProviderId, ProviderCredentialPublic } from '../src/types';
import { decryptSecret, encryptSecret, maskApiKey } from './crypto';
import { db } from './db';

export const PROVIDER_CATALOG_MODELS: AiModelInfo[] = [
  // Gemini
  {
    id: 'gemini-4-hydrogen',
    provider: 'gemini',
    displayName: 'Gemini 4 Hydrogen',
    contextWindow: 1000000,
    maxOutputTokens: 65536,
    supportsStreaming: true,
    supportsVision: true,
    pricingTier: 'free_quota',
    pricingSummary: 'Free quota tier available; pay-as-you-go for higher throughput',
    availabilityNote: 'Available via Managed Universal Key or Author Gemini Key',
    tags: ['Free', 'Creative Writing', 'Long Context', 'Vision', 'Fast'],
    recommendedFor: 'Default chapter drafting, long-context Story Bible continuity & visual references',
  },
  {
    id: 'gemini-3.1-flash-lite',
    provider: 'gemini',
    displayName: 'Gemini 3.1 Flash Lite',
    contextWindow: 1000000,
    maxOutputTokens: 32768,
    supportsStreaming: true,
    supportsVision: true,
    pricingTier: 'free_quota',
    pricingSummary: 'Low-cost / free quota tier optimized for high-volume background tasks',
    availabilityNote: 'Available via Managed Universal Key or Author Gemini Key',
    tags: ['Free', 'Fast', 'Long Context', 'Vision'],
    recommendedFor: 'Economical background chapter summaries, canon extraction & timeline indexing',
  },
  {
    id: 'gemini-4-argon',
    provider: 'gemini',
    displayName: 'Gemini 4 Argon',
    contextWindow: 1000000,
    maxOutputTokens: 65536,
    supportsStreaming: true,
    supportsVision: true,
    pricingTier: 'paid_api',
    pricingSummary: 'Paid Gemini API key required (~$1.25–$2.50 / 1M input tokens)',
    availabilityNote: 'Requires billing-enabled Gemini API key',
    tags: ['Paid', 'Reasoning', 'Creative Writing', 'Long Context', 'Vision'],
    recommendedFor: 'Complex multi-POV plotting, intricate continuity twists & nuanced prose',
  },
  {
    id: 'gemini-4-carbon',
    provider: 'gemini',
    displayName: 'Gemini 4 Carbon',
    contextWindow: 1000000,
    maxOutputTokens: 65536,
    supportsStreaming: true,
    supportsVision: true,
    pricingTier: 'paid_api',
    pricingSummary: 'Paid Gemini API key required (flagship deep reasoning tier)',
    availabilityNote: 'Requires billing-enabled Gemini API key',
    tags: ['Paid', 'Reasoning', 'Long Context', 'Vision'],
    recommendedFor: 'Deep structural arcs, complex psychological plotting & canon auditing',
  },

  // OpenAI
  {
    id: 'gpt-4.1',
    provider: 'openai',
    displayName: 'GPT-4.1',
    contextWindow: 1000000,
    maxOutputTokens: 32768,
    supportsStreaming: true,
    supportsVision: true,
    pricingTier: 'paid_api',
    pricingSummary: 'Paid OpenAI API (~$2.00 input / $8.00 output per 1M tokens)',
    availabilityNote: 'Requires author OpenAI API key',
    tags: ['Paid', 'Creative Writing', 'Long Context', 'Vision'],
  },
  {
    id: 'gpt-4.1-mini',
    provider: 'openai',
    displayName: 'GPT-4.1 Mini',
    contextWindow: 1000000,
    maxOutputTokens: 32768,
    supportsStreaming: true,
    supportsVision: true,
    pricingTier: 'paid_api',
    pricingSummary: 'Paid OpenAI API (~$0.40 input / $1.60 output per 1M tokens)',
    availabilityNote: 'Requires author OpenAI API key',
    tags: ['Paid', 'Fast', 'Long Context', 'Vision'],
  },
  {
    id: 'o3-mini',
    provider: 'openai',
    displayName: 'OpenAI o3-mini',
    contextWindow: 200000,
    maxOutputTokens: 100000,
    supportsStreaming: true,
    supportsVision: false,
    pricingTier: 'paid_api',
    pricingSummary: 'Paid OpenAI API (~$1.10 input / $4.40 output per 1M tokens)',
    availabilityNote: 'Requires author OpenAI API key (text-only)',
    tags: ['Paid', 'Reasoning', 'Fast'],
  },

  // Anthropic
  {
    id: 'claude-sonnet-4-20250514',
    provider: 'anthropic',
    displayName: 'Claude Sonnet 4',
    contextWindow: 200000,
    maxOutputTokens: 64000,
    supportsStreaming: true,
    supportsVision: true,
    pricingTier: 'paid_api',
    pricingSummary: 'Paid Anthropic API ($3.00 input / $15.00 output per 1M tokens)',
    availabilityNote: 'Requires author Anthropic API key',
    tags: ['Paid', 'Creative Writing', 'Reasoning', 'Long Context', 'Vision'],
  },
  {
    id: 'claude-3-5-haiku-20241022',
    provider: 'anthropic',
    displayName: 'Claude 3.5 Haiku',
    contextWindow: 200000,
    maxOutputTokens: 8192,
    supportsStreaming: true,
    supportsVision: true,
    pricingTier: 'paid_api',
    pricingSummary: 'Paid Anthropic API ($0.80 input / $4.00 output per 1M tokens)',
    availabilityNote: 'Requires author Anthropic API key',
    tags: ['Paid', 'Fast', 'Vision'],
  },

  // DeepSeek
  {
    id: 'deepseek-chat',
    provider: 'deepseek',
    displayName: 'DeepSeek V3 (deepseek-chat)',
    contextWindow: 64000,
    maxOutputTokens: 8192,
    supportsStreaming: true,
    supportsVision: false,
    pricingTier: 'paid_api',
    pricingSummary: 'Paid DeepSeek API (~$0.27 input / $1.10 output per 1M tokens)',
    availabilityNote: 'Requires author DeepSeek API key (text-only)',
    tags: ['Paid', 'Creative Writing', 'Fast'],
  },
  {
    id: 'deepseek-reasoner',
    provider: 'deepseek',
    displayName: 'DeepSeek R1 (deepseek-reasoner)',
    contextWindow: 64000,
    maxOutputTokens: 8192,
    supportsStreaming: true,
    supportsVision: false,
    pricingTier: 'paid_api',
    pricingSummary: 'Paid DeepSeek API (~$0.55 input / $2.19 output per 1M tokens)',
    availabilityNote: 'Requires author DeepSeek API key (text-only)',
    tags: ['Paid', 'Reasoning'],
  },

  // Meta Llama
  {
    id: 'meta-llama/llama-3.3-70b-instruct',
    provider: 'meta_llama',
    displayName: 'Meta Llama 3.3 70B Instruct',
    contextWindow: 131072,
    maxOutputTokens: 16384,
    supportsStreaming: true,
    supportsVision: false,
    pricingTier: 'open_weight_self_host',
    pricingSummary: 'Open-weight model; free/paid via hosted inference (Groq/Together/OpenRouter) or self-hosted endpoint',
    availabilityNote: 'Requires hosted API key or custom self-hosted OpenAI-compatible URL',
    tags: ['Creative Writing', 'Long Context', 'Fast'],
  },

  // Mistral
  {
    id: 'mistral-large-latest',
    provider: 'mistral',
    displayName: 'Mistral Large',
    contextWindow: 128000,
    maxOutputTokens: 16384,
    supportsStreaming: true,
    supportsVision: false,
    pricingTier: 'paid_api',
    pricingSummary: 'Paid Mistral API (promotional trial credits may apply on new accounts)',
    availabilityNote: 'Requires author Mistral API key (text-only)',
    tags: ['Paid', 'Creative Writing', 'Long Context'],
  },

  // OpenRouter
  {
    id: 'meta-llama/llama-3.3-70b-instruct:free',
    provider: 'openrouter',
    displayName: 'Llama 3.3 70B (OpenRouter Free Hosted)',
    contextWindow: 131072,
    maxOutputTokens: 8192,
    supportsStreaming: true,
    supportsVision: false,
    pricingTier: 'free_hosted',
    pricingSummary: 'Free hosted endpoint on OpenRouter (rate-limited; OpenRouter key required)',
    availabilityNote: 'Requires author OpenRouter API key',
    tags: ['Free', 'Creative Writing', 'Long Context'],
  },
];

export function getProviderDefaultBaseUrl(provider: AiProviderId): string | null {
  switch (provider) {
    case 'openai':
      return 'https://api.openai.com/v1';
    case 'deepseek':
      return 'https://api.deepseek.com/v1';
    case 'mistral':
      return 'https://api.mistral.ai/v1';
    case 'openrouter':
      return 'https://openrouter.ai/api/v1';
    case 'meta_llama':
      return 'https://api.groq.com/openai/v1';
    default:
      return null;
  }
}

export interface ResolvedCredential {
  provider: AiProviderId;
  source: 'managed' | 'author';
  credentialId: string | null;
  label: string;
  apiKey: string;
  endpointUrl: string | null;
}

export function listAuthorCredentialsPublic(userId: string): ProviderCredentialPublic[] {
  const rows = db
    .prepare(
      `SELECT * FROM provider_credentials WHERE user_id = ? ORDER BY is_default DESC, updated_at DESC`
    )
    .all(userId) as Array<{
    id: string;
    provider: AiProviderId;
    label: string;
    endpoint_url: string | null;
    encrypted_api_key: string;
    iv: string;
    auth_tag: string;
    is_default: number;
    last_status: ProviderCredentialPublic['lastStatus'];
    last_error: string | null;
    last_tested_at: string | null;
    created_at: string;
    updated_at: string;
  }>;

  return rows.map((r) => {
    let preview = '••••••••';
    try {
      preview = maskApiKey(decryptSecret(r.encrypted_api_key, r.iv, r.auth_tag));
    } catch {
      preview = '••••••••';
    }
    return {
      id: r.id,
      provider: r.provider,
      label: r.label,
      endpointUrl: r.endpoint_url,
      hasApiKey: true,
      keyPreview: preview,
      isDefault: r.is_default === 1,
      lastStatus: r.last_status,
      lastError: r.last_error,
      lastTestedAt: r.last_tested_at,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  });
}

export function resolveCredentialForProvider(
  userId: string,
  provider: AiProviderId,
  options?: { forceSource?: 'managed' | 'author'; credentialId?: string }
): ResolvedCredential {
  const managedKey = process.env.GEMINI_API_KEY?.trim() || '';

  if (options?.forceSource === 'managed') {
    if (provider !== 'gemini') {
      throw new Error(`Managed fallback is only available for Google Gemini, not ${provider}.`);
    }
    if (!managedKey) {
      throw new Error('Managed Gemini key is not configured on this server.');
    }
    return {
      provider: 'gemini',
      source: 'managed',
      credentialId: null,
      label: 'Managed Universal Key (Server-Side)',
      apiKey: managedKey,
      endpointUrl: null,
    };
  }

  // Author key takes priority when present for the selected provider
  const row = options?.credentialId
    ? (db
        .prepare('SELECT * FROM provider_credentials WHERE id = ? AND user_id = ?')
        .get(options.credentialId, userId) as
        | {
            id: string;
            provider: AiProviderId;
            label: string;
            endpoint_url: string | null;
            encrypted_api_key: string;
            iv: string;
            auth_tag: string;
          }
        | undefined)
    : (db
        .prepare(
          `SELECT * FROM provider_credentials WHERE user_id = ? AND provider = ?
           ORDER BY is_default DESC, updated_at DESC LIMIT 1`
        )
        .get(userId, provider) as
        | {
            id: string;
            provider: AiProviderId;
            label: string;
            endpoint_url: string | null;
            encrypted_api_key: string;
            iv: string;
            auth_tag: string;
          }
        | undefined);

  if (row) {
    const apiKey = decryptSecret(row.encrypted_api_key, row.iv, row.auth_tag);
    return {
      provider: row.provider,
      source: 'author',
      credentialId: row.id,
      label: `Author Key (${row.label})`,
      apiKey,
      endpointUrl: row.endpoint_url || getProviderDefaultBaseUrl(row.provider),
    };
  }

  if (provider === 'gemini' && managedKey) {
    return {
      provider: 'gemini',
      source: 'managed',
      credentialId: null,
      label: 'Managed Universal Key (Server-Side)',
      apiKey: managedKey,
      endpointUrl: null,
    };
  }

  throw new Error(
    `No API key configured for ${provider}. Add your own ${provider} API key in Settings > AI Providers.`
  );
}

export function saveAuthorCredential(params: {
  userId: string;
  id?: string;
  provider: AiProviderId;
  label: string;
  apiKey?: string;
  endpointUrl?: string | null;
  isDefault?: boolean;
}) {
  const now = new Date().toISOString();

  if (params.isDefault) {
    db.prepare('UPDATE provider_credentials SET is_default = 0 WHERE user_id = ? AND provider = ?').run(
      params.userId,
      params.provider
    );
  }

  if (params.id) {
    const existing = db
      .prepare('SELECT * FROM provider_credentials WHERE id = ? AND user_id = ?')
      .get(params.id, params.userId) as
      | {
          id: string;
          encrypted_api_key: string;
          iv: string;
          auth_tag: string;
        }
      | undefined;
    if (!existing) throw new Error('Credential not found.');

    let enc = {
      encrypted: existing.encrypted_api_key,
      iv: existing.iv,
      authTag: existing.auth_tag,
    };
    if (params.apiKey && params.apiKey.trim()) {
      enc = encryptSecret(params.apiKey.trim());
    }

    db.prepare(
      `UPDATE provider_credentials
       SET label = ?, endpoint_url = ?, encrypted_api_key = ?, iv = ?, auth_tag = ?, is_default = ?, updated_at = ?
       WHERE id = ? AND user_id = ?`
    ).run(
      params.label.trim() || params.provider,
      params.endpointUrl?.trim() || null,
      enc.encrypted,
      enc.iv,
      enc.authTag,
      params.isDefault ? 1 : 0,
      now,
      params.id,
      params.userId
    );
    return params.id;
  }

  if (!params.apiKey || !params.apiKey.trim()) {
    throw new Error('API key is required.');
  }
  const enc = encryptSecret(params.apiKey.trim());
  const id = uuidv4();
  db.prepare(
    `INSERT INTO provider_credentials
     (id, user_id, provider, label, endpoint_url, encrypted_api_key, iv, auth_tag, is_default, last_status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'untested', ?, ?)`
  ).run(
    id,
    params.userId,
    params.provider,
    params.label.trim() || `${params.provider} key`,
    params.endpointUrl?.trim() || null,
    enc.encrypted,
    enc.iv,
    enc.authTag,
    params.isDefault ? 1 : 0,
    now,
    now
  );
  return id;
}

export async function testProviderCredential(
  userId: string,
  credentialId: string
): Promise<{ ok: boolean; status: 'valid' | 'invalid' | 'rate_limited'; message: string }> {
  const cred = resolveCredentialForProvider(userId, 'gemini', { credentialId });
  const now = new Date().toISOString();

  const updateRow = (status: 'valid' | 'invalid' | 'rate_limited', error: string | null) => {
    db.prepare(
      `UPDATE provider_credentials SET last_status = ?, last_error = ?, last_tested_at = ?, updated_at = ? WHERE id = ?`
    ).run(status, error, now, now, credentialId);
  };

  try {
    if (cred.provider === 'gemini') {
      const ai = new GoogleGenAI({
        apiKey: cred.apiKey,
        httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
      });
      await ai.models.generateContent({
        model: 'gemini-3.1-flash-lite',
        contents: 'Reply with OK.',
        config: { thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL } },
      });
      updateRow('valid', null);
      return { ok: true, status: 'valid', message: 'Gemini API key verified successfully.' };
    }

    if (cred.provider === 'anthropic') {
      const resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': cred.apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: 'claude-3-5-haiku-20241022',
          max_tokens: 10,
          messages: [{ role: 'user', content: 'Say OK.' }],
        }),
      });
      if (!resp.ok) {
        const text = await resp.text();
        const status = resp.status === 429 ? 'rate_limited' : 'invalid';
        updateRow(status, `HTTP ${resp.status}: ${text.slice(0, 180)}`);
        return { ok: false, status, message: `Anthropic returned HTTP ${resp.status}.` };
      }
      updateRow('valid', null);
      return { ok: true, status: 'valid', message: 'Anthropic key verified successfully.' };
    }

    const baseUrl = (cred.endpointUrl || getProviderDefaultBaseUrl(cred.provider) || '').replace(/\/+$/, '');
    if (!baseUrl) {
      updateRow('invalid', 'Missing endpoint URL.');
      return { ok: false, status: 'invalid', message: 'Custom endpoint URL is required.' };
    }

    const resp = await fetch(`${baseUrl}/models`, {
      headers: { Authorization: `Bearer ${cred.apiKey}` },
    });
    if (!resp.ok) {
      const text = await resp.text();
      const status = resp.status === 429 ? 'rate_limited' : 'invalid';
      updateRow(status, `HTTP ${resp.status}: ${text.slice(0, 180)}`);
      return { ok: false, status, message: `Endpoint returned HTTP ${resp.status}.` };
    }
    updateRow('valid', null);
    return { ok: true, status: 'valid', message: 'Provider endpoint and API key verified.' };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    updateRow('invalid', msg);
    return { ok: false, status: 'invalid', message: msg };
  }
}

export async function discoverModelsForUser(
  userId: string,
  providerFilter?: AiProviderId
): Promise<{
  models: AiModelInfo[];
  hasManagedGemini: boolean;
  warnings: string[];
}> {
  const hasManagedGemini = Boolean(process.env.GEMINI_API_KEY?.trim());
  const baseModels = PROVIDER_CATALOG_MODELS.filter(
    (m) => !providerFilter || m.provider === providerFilter
  );
  const discovered: AiModelInfo[] = [...baseModels];
  const seen = new Set(discovered.map((m) => `${m.provider}:${m.id}`));
  const warnings: string[] = [];

  const authorCreds = db
    .prepare('SELECT * FROM provider_credentials WHERE user_id = ?')
    .all(userId) as Array<{
    provider: AiProviderId;
    endpoint_url: string | null;
    encrypted_api_key: string;
    iv: string;
    auth_tag: string;
  }>;

  const targetCreds = providerFilter
    ? authorCreds.filter((c) => c.provider === providerFilter)
    : authorCreds;

  for (const credRow of targetCreds) {
    try {
      const apiKey = decryptSecret(credRow.encrypted_api_key, credRow.iv, credRow.auth_tag);
      const baseUrl = (
        credRow.endpoint_url ||
        getProviderDefaultBaseUrl(credRow.provider) ||
        ''
      ).replace(/\/+$/, '');

      if (credRow.provider === 'gemini') {
        const resp = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`,
          { signal: AbortSignal.timeout(5000) }
        );
        if (resp.ok) {
          const data = (await resp.json()) as {
            models?: Array<{
              name?: string;
              displayName?: string;
              inputTokenLimit?: number;
              outputTokenLimit?: number;
              supportedGenerationMethods?: string[];
            }>;
          };
          for (const gm of data.models || []) {
            const id = (gm.name || '').replace(/^models\//, '');
            if (!id || seen.has(`gemini:${id}`)) continue;
            if (!gm.supportedGenerationMethods?.includes('generateContent')) continue;
            seen.add(`gemini:${id}`);
            discovered.push({
              id,
              provider: 'gemini',
              displayName: gm.displayName || id,
              contextWindow: gm.inputTokenLimit || 128000,
              maxOutputTokens: gm.outputTokenLimit || 8192,
              supportsStreaming: true,
              supportsVision: id.includes('gemini'),
              pricingTier: 'free_quota',
              pricingSummary: 'Discovered from your Gemini key',
              availabilityNote: 'Available via Author Gemini Key',
              tags: ['Long Context', 'Vision'],
            });
          }
        }
      } else if (baseUrl) {
        const resp = await fetch(`${baseUrl}/models`, {
          headers: { Authorization: `Bearer ${apiKey}` },
          signal: AbortSignal.timeout(5000),
        });
        if (resp.ok) {
          const data = (await resp.json()) as {
            data?: Array<{
              id: string;
              name?: string;
              context_length?: number;
              pricing?: { prompt?: string; completion?: string };
            }>;
          };
          for (const om of (data.data || []).slice(0, 40)) {
            if (!om.id || seen.has(`${credRow.provider}:${om.id}`)) continue;
            seen.add(`${credRow.provider}:${om.id}`);
            const isFree =
              om.id.endsWith(':free') ||
              (om.pricing && Number(om.pricing.prompt) === 0 && Number(om.pricing.completion) === 0);
            discovered.push({
              id: om.id,
              provider: credRow.provider,
              displayName: om.name || om.id,
              contextWindow: om.context_length || 128000,
              maxOutputTokens: 16384,
              supportsStreaming: true,
              supportsVision: om.id.toLowerCase().includes('vision') || om.id.includes('gpt-4'),
              pricingTier: isFree ? 'free_hosted' : 'paid_api',
              pricingSummary: isFree
                ? 'Free hosted tier on endpoint'
                : 'Paid API via your configured endpoint',
              availabilityNote: `Discovered dynamically from ${credRow.provider}`,
              tags: [isFree ? 'Free' : 'Paid', 'Creative Writing'],
            });
          }
        }
      }
    } catch (err) {
      warnings.push(
        `Could not refresh live model list for ${credRow.provider}: ${
          err instanceof Error ? err.message : 'Request failed'
        }`
      );
    }
  }

  return { models: discovered, hasManagedGemini, warnings };
}

export function classifyProviderError(err: unknown, provider: AiProviderId): {
  message: string;
  permanent: boolean;
  code: string;
} {
  const raw = err instanceof Error ? err.message : String(err);
  const lower = raw.toLowerCase();

  if (lower.includes('abort') || lower.includes('cancel')) {
    return { message: 'Generation was cancelled by the author.', permanent: true, code: 'CANCELLED' };
  }
  if (lower.includes('api_key_invalid') || lower.includes('invalid api key') || lower.includes('401') || lower.includes('unauthorized')) {
    return {
      message: `Authentication failed for ${provider}: the API key appears invalid or revoked.`,
      permanent: true,
      code: 'AUTH_FAILED',
    };
  }
  if (lower.includes('permission_denied') || lower.includes('403')) {
    return {
      message: `Permission denied by ${provider}. Check key permissions or billing tier.`,
      permanent: true,
      code: 'PERMISSION_DENIED',
    };
  }
  if (lower.includes('insufficient') || lower.includes('quota') || lower.includes('credit') || lower.includes('billing')) {
    return {
      message: `Insufficient credits or quota exceeded on ${provider}.`,
      permanent: true,
      code: 'QUOTA_EXCEEDED',
    };
  }
  if (lower.includes('not_found') || lower.includes('404')) {
    return {
      message: `Model or endpoint not found on ${provider}. Please verify the selected model ID.`,
      permanent: true,
      code: 'NOT_FOUND',
    };
  }
  if (lower.includes('context') && (lower.includes('length') || lower.includes('too long') || lower.includes('token'))) {
    return {
      message: `Context size exceeded the model's window. Reduce prompt length or deselect older summaries.`,
      permanent: true,
      code: 'CONTEXT_OVERFLOW',
    };
  }
  if (lower.includes('429') || lower.includes('rate limit') || lower.includes('resource_exhausted')) {
    return {
      message: `${provider} is currently rate-limiting requests. Try again shortly or switch models.`,
      permanent: false,
      code: 'RATE_LIMITED',
    };
  }
  if (lower.includes('timeout') || lower.includes('timed out')) {
    return {
      message: `Timed out waiting for ${provider} to respond.`,
      permanent: false,
      code: 'TIMEOUT',
    };
  }
  return {
    message: raw || `Unexpected error from ${provider}.`,
    permanent: false,
    code: 'PROVIDER_ERROR',
  };
}

export function estimateCostUsd(
  modelId: string,
  inputTokens: number,
  outputTokens: number
): number {
  const m = modelId.toLowerCase();
  if (m.includes('hydrogen') || m.includes('flash-lite') || m.endsWith(':free')) {
    return Number(((inputTokens * 0.1 + outputTokens * 0.4) / 1_000_000).toFixed(5));
  }
  if (m.includes('argon') || m.includes('carbon') || m.includes('gpt-4.1')) {
    return Number(((inputTokens * 2.0 + outputTokens * 8.0) / 1_000_000).toFixed(5));
  }
  if (m.includes('sonnet')) {
    return Number(((inputTokens * 3.0 + outputTokens * 15.0) / 1_000_000).toFixed(5));
  }
  return Number(((inputTokens * 0.5 + outputTokens * 1.5) / 1_000_000).toFixed(5));
}

export interface StreamCompletionOptions {
  credential: ResolvedCredential;
  modelId: string;
  systemInstruction: string;
  userPrompt: string;
  attachedImages: Array<{ id: string; filePath: string; mimeType: string; title: string }>;
  thinkingMode?: 'fast' | 'balanced' | 'deep';
  signal: AbortSignal;
  onPhase: (phase: 'Connecting' | 'Generating' | 'Streaming') => void;
  onDelta: (chunk: string) => void;
}

export async function streamAiCompletion(opts: StreamCompletionOptions): Promise<{
  fullText: string;
  finishReason: string;
}> {
  const { credential, modelId, systemInstruction, userPrompt, attachedImages, signal } = opts;

  const firstByteTimeoutMs = 55_000;
  const interChunkTimeoutMs = 35_000;

  let attempt = 0;
  const maxAttempts = 2;

  while (true) {
    attempt += 1;
    let receivedAnyChunk = false;
    let fullText = '';
    let finishReason = 'stop';

    const localController = new AbortController();
    const onExternalAbort = () => localController.abort();
    signal.addEventListener('abort', onExternalAbort, { once: true });

    let stallTimer: NodeJS.Timeout | null = null;
    const resetStallTimer = (ms: number) => {
      if (stallTimer) clearTimeout(stallTimer);
      stallTimer = setTimeout(() => {
        localController.abort(new Error('Provider stream timed out waiting for response.'));
      }, ms);
    };

    try {
      opts.onPhase('Connecting');
      resetStallTimer(firstByteTimeoutMs);

      if (credential.provider === 'gemini') {
        const ai = new GoogleGenAI({
          apiKey: credential.apiKey,
          httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
        });

        const parts: Array<
          | { text: string }
          | { inlineData: { mimeType: string; data: string } }
        > = [];

        for (const img of attachedImages) {
          if (fs.existsSync(img.filePath)) {
            const data = fs.readFileSync(img.filePath).toString('base64');
            parts.push({ inlineData: { mimeType: img.mimeType, data } });
          }
        }
        parts.push({ text: userPrompt });

        const isGemini4 = modelId.startsWith('gemini-4-');
        const thinkingLevel =
          opts.thinkingMode === 'deep'
            ? ThinkingLevel.HIGH
            : opts.thinkingMode === 'balanced'
              ? ThinkingLevel.MEDIUM
              : ThinkingLevel.LOW;

        const stream = await ai.models.generateContentStream({
          model: modelId,
          contents: parts.length === 1 ? userPrompt : { parts },
          config: {
            systemInstruction,
            ...(isGemini4 ? { thinkingConfig: { thinkingLevel } } : {}),
            abortSignal: localController.signal,
          },
        });

        opts.onPhase('Generating');

        for await (const chunk of stream) {
          if (localController.signal.aborted) {
            throw new Error('Aborted');
          }
          resetStallTimer(interChunkTimeoutMs);
          const candidateFinish = chunk.candidates?.[0]?.finishReason;
          if (candidateFinish) {
            finishReason = String(candidateFinish);
          }
          const delta = chunk.text || '';
          if (delta) {
            if (!receivedAnyChunk) {
              receivedAnyChunk = true;
              opts.onPhase('Streaming');
            }
            fullText += delta;
            opts.onDelta(delta);
          }
        }
      } else if (credential.provider === 'anthropic') {
        const resp = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          signal: localController.signal,
          headers: {
            'x-api-key': credential.apiKey,
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            model: modelId,
            max_tokens: 8192,
            stream: true,
            system: systemInstruction,
            messages: [{ role: 'user', content: userPrompt }],
          }),
        });

        if (!resp.ok || !resp.body) {
          const errText = await resp.text();
          throw new Error(`HTTP ${resp.status}: ${errText}`);
        }

        opts.onPhase('Generating');
        const reader = resp.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          resetStallTimer(interChunkTimeoutMs);
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';
          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const payload = line.slice(6).trim();
            if (!payload || payload === '[DONE]') continue;
            try {
              const evt = JSON.parse(payload);
              if (evt.type === 'content_block_delta' && evt.delta?.text) {
                if (!receivedAnyChunk) {
                  receivedAnyChunk = true;
                  opts.onPhase('Streaming');
                }
                fullText += evt.delta.text;
                opts.onDelta(evt.delta.text);
              }
              if (evt.type === 'message_delta' && evt.delta?.stop_reason) {
                finishReason = evt.delta.stop_reason;
              }
            } catch {
              // ignore partial JSON line
            }
          }
        }
      } else {
        // OpenAI-compatible SSE streaming (OpenAI, DeepSeek, Mistral, OpenRouter, Meta Llama, Custom)
        const baseUrl = (
          credential.endpointUrl ||
          getProviderDefaultBaseUrl(credential.provider) ||
          ''
        ).replace(/\/+$/, '');
        if (!baseUrl) {
          throw new Error(`Missing endpoint URL for ${credential.provider}.`);
        }

        const resp = await fetch(`${baseUrl}/chat/completions`, {
          method: 'POST',
          signal: localController.signal,
          headers: {
            Authorization: `Bearer ${credential.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: modelId,
            stream: true,
            messages: [
              { role: 'system', content: systemInstruction },
              { role: 'user', content: userPrompt },
            ],
          }),
        });

        if (!resp.ok || !resp.body) {
          const errText = await resp.text();
          throw new Error(`HTTP ${resp.status}: ${errText}`);
        }

        opts.onPhase('Generating');
        const reader = resp.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          resetStallTimer(interChunkTimeoutMs);
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';
          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const payload = line.slice(6).trim();
            if (!payload || payload === '[DONE]') continue;
            try {
              const evt = JSON.parse(payload);
              const delta = evt.choices?.[0]?.delta?.content || '';
              if (evt.choices?.[0]?.finish_reason) {
                finishReason = evt.choices[0].finish_reason;
              }
              if (delta) {
                if (!receivedAnyChunk) {
                  receivedAnyChunk = true;
                  opts.onPhase('Streaming');
                }
                fullText += delta;
                opts.onDelta(delta);
              }
            } catch {
              // ignore non-JSON keepalive
            }
          }
        }
      }

      if (stallTimer) clearTimeout(stallTimer);
      signal.removeEventListener('abort', onExternalAbort);

      if (!fullText.trim()) {
        throw new Error('The provider returned an empty response.');
      }

      return { fullText, finishReason };
    } catch (err) {
      if (stallTimer) clearTimeout(stallTimer);
      signal.removeEventListener('abort', onExternalAbort);

      if (signal.aborted) {
        const abortErr = new Error('Cancelled by author');
        (abortErr as Error & { partialText?: string }).partialText = fullText;
        throw abortErr;
      }

      const classified = classifyProviderError(err, credential.provider);
      // Do NOT retry if permanent error OR if we already received partial streamed output OR exhausted retries
      if (classified.permanent || receivedAnyChunk || attempt >= maxAttempts) {
        const enriched = new Error(classified.message) as Error & {
          partialText?: string;
          code?: string;
          permanent?: boolean;
        };
        enriched.partialText = fullText;
        enriched.code = classified.code;
        enriched.permanent = classified.permanent;
        throw enriched;
      }

      // Bounded exponential backoff before retrying transient pre-stream error
      await new Promise((resolve) => setTimeout(resolve, 900 * attempt));
    }
  }
}

export async function runSingleAiTextCompletion(params: {
  credential: ResolvedCredential;
  modelId: string;
  systemInstruction: string;
  userPrompt: string;
  jsonMode?: boolean;
}): Promise<string> {
  const { credential, modelId, systemInstruction, userPrompt, jsonMode } = params;

  if (credential.provider === 'gemini') {
    const ai = new GoogleGenAI({
      apiKey: credential.apiKey,
      httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
    });
    const isGemini4 = modelId.startsWith('gemini-4-');
    const resp = await ai.models.generateContent({
      model: modelId,
      contents: userPrompt,
      config: {
        systemInstruction,
        ...(jsonMode ? { responseMimeType: 'application/json' } : {}),
        ...(isGemini4 ? { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } } : {}),
      },
    });
    return (resp.text || '').trim();
  }

  if (credential.provider === 'anthropic') {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': credential.apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: modelId,
        max_tokens: 4096,
        system: systemInstruction,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${await resp.text()}`);
    const data = (await resp.json()) as { content?: Array<{ text?: string }> };
    return (data.content?.[0]?.text || '').trim();
  }

  const baseUrl = (
    credential.endpointUrl ||
    getProviderDefaultBaseUrl(credential.provider) ||
    ''
  ).replace(/\/+$/, '');
  if (!baseUrl) throw new Error(`Missing endpoint URL for ${credential.provider}.`);

  const resp = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${credential.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: modelId,
      ...(jsonMode ? { response_format: { type: 'json_object' } } : {}),
      messages: [
        { role: 'system', content: systemInstruction },
        { role: 'user', content: userPrompt },
      ],
    }),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${await resp.text()}`);
  const data = (await resp.json()) as { choices?: Array<{ message?: { content?: string } }> };
  return (data.choices?.[0]?.message?.content || '').trim();
}
