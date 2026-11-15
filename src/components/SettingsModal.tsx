import React, { useEffect, useMemo, useState } from 'react';
import {
  Check,
  KeyRound,
  LogOut,
  RefreshCw,
  ShieldCheck,
  Star,
  Trash2,
  X,
} from 'lucide-react';
import { api } from '../lib/api';
import { auth, signOutFirebase } from '../lib/firebase';
import { firestoreStore } from '../lib/firestoreStore';
import { offlineDb } from '../lib/offlineDb';
import { formatRelativeDate } from '../lib/theme';
import type {
  AiModelInfo,
  AiProviderId,
  AiUsageLog,
  ManuscriptFont,
  ModelFilterTag,
  ProviderCredentialPublic,
  ThemeMode,
  UserProfile,
} from '../types';

interface SettingsModalProps {
  user: UserProfile;
  onUserUpdated: (user: UserProfile) => void;
  onLoggedOut: () => void;
  onClose: () => void;
}

const MODEL_FILTERS: ModelFilterTag[] = [
  'Free',
  'Paid',
  'Reasoning',
  'Creative Writing',
  'Long Context',
  'Vision',
  'Fast',
];

export const SettingsModal: React.FC<SettingsModalProps> = ({
  user,
  onUserUpdated,
  onLoggedOut,
  onClose,
}) => {
  const [tab, setTab] = useState<
    'appearance' | 'providers' | 'models' | 'usage' | 'storage' | 'account'
  >('appearance');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Preferences draft
  const [name, setName] = useState(user.name);
  const [theme, setTheme] = useState<ThemeMode>(user.themePreference);
  const [editorPrefs, setEditorPrefs] = useState(user.editorPrefs);
  const [aiPrefs, setAiPrefs] = useState(user.aiPrefs);

  // Credentials
  const [credentials, setCredentials] = useState<ProviderCredentialPublic[]>([]);
  const [managedGeminiAvailable, setManagedGeminiAvailable] = useState(false);
  const [newProvider, setNewProvider] = useState<AiProviderId>('openai');
  const [newLabel, setNewLabel] = useState('');
  const [newApiKey, setNewApiKey] = useState('');
  const [newEndpointUrl, setNewEndpointUrl] = useState('');
  const [newIsDefault, setNewIsDefault] = useState(true);
  const [testingId, setTestingId] = useState<string | null>(null);

  // Models
  const [models, setModels] = useState<AiModelInfo[]>([]);
  const [modelWarnings, setModelWarnings] = useState<string[]>([]);
  const [selectedTags, setSelectedTags] = useState<ModelFilterTag[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);

  // Usage & Docs
  const [usageLogs, setUsageLogs] = useState<AiUsageLog[]>([]);
  const [pendingSyncCount, setPendingSyncCount] = useState(0);
  const [archDoc, setArchDoc] = useState('');
  const [confirmDeleteAccount, setConfirmDeleteAccount] = useState(false);

  const loadProvidersAndModels = async () => {
    setLoadingModels(true);
    try {
      const [credRes, modRes, usageRes] = await Promise.all([
        api.listCredentials(),
        api.discoverModels(),
        api.listUsageLogs(),
      ]);
      setCredentials(credRes.credentials);
      setManagedGeminiAvailable(credRes.managedGeminiAvailable);
      setModels(modRes.models);
      setModelWarnings(modRes.warnings);
      setUsageLogs(usageRes.logs);
    } catch {
      // ignore offline
    } finally {
      setLoadingModels(false);
    }
  };

  useEffect(() => {
    void loadProvidersAndModels();
    offlineDb.getPendingChapters().then((p) => setPendingSyncCount(p.length));
    api
      .getArchitectureDocs()
      .then((res) => setArchDoc(res.markdown))
      .catch(() => {});
  }, []);

  const filteredModels = useMemo(() => {
    if (selectedTags.length === 0) return models;
    return models.filter((m) => selectedTags.every((t) => m.tags.includes(t)));
  }, [models, selectedTags]);

  const handleSavePreferences = async () => {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const res = await api.updatePreferences({
        name,
        themePreference: theme,
        editorPrefs,
        aiPrefs,
      });
      onUserUpdated(res.user);
      setMessage('Preferences saved.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const handleAddCredential = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newApiKey.trim()) return;
    setError(null);
    setMessage(null);
    try {
      const res = await api.saveCredential({
        provider: newProvider,
        label: newLabel.trim() || `${newProvider} Key`,
        apiKey: newApiKey.trim(),
        endpointUrl: newEndpointUrl.trim() || undefined,
        isDefault: newIsDefault,
      });
      setCredentials(res.credentials);
      setNewLabel('');
      setNewApiKey('');
      setNewEndpointUrl('');
      setMessage('Encrypted provider key stored securely on server.');
      void loadProvidersAndModels();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save credential');
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4 overflow-y-auto">
      <div className="w-full max-w-5xl rounded-xl border border-[var(--ink-border)] bg-[var(--ink-surface)] flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-6 py-4 border-b border-[var(--ink-border)] flex items-center justify-between">
          <h2 className="font-lora text-xl font-semibold">Studio Settings & AI Providers</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close settings"
            className="p-1.5 text-[var(--ink-text-muted)] hover:text-[var(--ink-text)]"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 flex flex-col md:flex-row min-h-0 overflow-hidden">
          {/* Sidebar Tabs */}
          <aside className="md:w-56 shrink-0 border-b md:border-b-0 md:border-r border-[var(--ink-border)] p-3 flex md:flex-col gap-1 overflow-x-auto text-sm">
            {(
              [
                ['appearance', 'Theme & Typography'],
                ['providers', 'Provider Keys'],
                ['models', 'Models & AI Tasks'],
                ['usage', 'Usage & Costs'],
                ['storage', 'Offline Sync & Docs'],
                ['account', 'Account & Security'],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => {
                  setTab(key);
                  setMessage(null);
                  setError(null);
                }}
                className={`text-left px-3 py-2 rounded-lg transition-colors whitespace-nowrap ${
                  tab === key
                    ? 'bg-[var(--ink-surface-elevated)] font-medium text-[var(--ink-text)]'
                    : 'text-[var(--ink-text-muted)] hover:text-[var(--ink-text)]'
                }`}
              >
                {label}
              </button>
            ))}
          </aside>

          {/* Content Pane */}
          <div className="flex-1 p-6 overflow-y-auto space-y-6">
            {error && (
              <div className="p-3 rounded-lg border border-red-500/40 bg-red-500/10 text-sm text-red-600 dark:text-red-300">
                {error}
              </div>
            )}
            {message && (
              <div className="p-3 rounded-lg border border-[var(--ink-accent)]/40 bg-[var(--ink-accent)]/10 text-sm">
                {message}
              </div>
            )}

            {/* 1. APPEARANCE & TYPOGRAPHY */}
            {tab === 'appearance' && (
              <div className="space-y-6 max-w-2xl">
                <div>
                  <h3 className="text-sm font-semibold mb-3">Theme Preference</h3>
                  <div className="grid grid-cols-3 gap-3">
                    {(['system', 'light', 'dark'] as const).map((mode) => (
                      <button
                        key={mode}
                        type="button"
                        onClick={() => setTheme(mode)}
                        className={`py-2.5 px-4 rounded-lg border text-sm capitalize ${
                          theme === mode
                            ? 'border-[var(--ink-accent)] bg-[var(--ink-accent)]/10 font-medium'
                            : 'border-[var(--ink-border)]'
                        }`}
                      >
                        {mode}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs text-[var(--ink-text-muted)] mb-1">
                      Manuscript Font
                    </label>
                    <select
                      value={editorPrefs.manuscriptFont}
                      onChange={(e) =>
                        setEditorPrefs({
                          ...editorPrefs,
                          manuscriptFont: e.target.value as ManuscriptFont,
                        })
                      }
                      className="w-full px-3 py-2 rounded-lg bg-[var(--ink-bg)] border border-[var(--ink-border)] text-sm"
                    >
                      <option value="lora">Lora (Editorial Serif)</option>
                      <option value="merriweather">Merriweather (Classic Book Serif)</option>
                      <option value="source-serif">Source Serif 4</option>
                      <option value="inter">Inter (Clean Sans)</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs text-[var(--ink-text-muted)] mb-1">
                      Default Chapter Length Target (Words)
                    </label>
                    <input
                      type="number"
                      min={500}
                      max={8000}
                      step={100}
                      value={editorPrefs.defaultChapterWordTarget}
                      onChange={(e) =>
                        setEditorPrefs({
                          ...editorPrefs,
                          defaultChapterWordTarget: Number(e.target.value) || 2700,
                        })
                      }
                      className="w-full px-3 py-2 rounded-lg bg-[var(--ink-bg)] border border-[var(--ink-border)] text-sm font-mono-tabular"
                    />
                  </div>

                  <div>
                    <label className="block text-xs text-[var(--ink-text-muted)] mb-1">
                      Font Size ({editorPrefs.fontSizePx}px)
                    </label>
                    <input
                      type="range"
                      min={14}
                      max={24}
                      value={editorPrefs.fontSizePx}
                      onChange={(e) =>
                        setEditorPrefs({ ...editorPrefs, fontSizePx: Number(e.target.value) })
                      }
                      className="w-full"
                    />
                  </div>

                  <div>
                    <label className="block text-xs text-[var(--ink-text-muted)] mb-1">
                      Line Spacing ({editorPrefs.lineSpacing})
                    </label>
                    <input
                      type="range"
                      min={1.4}
                      max={2.2}
                      step={0.05}
                      value={editorPrefs.lineSpacing}
                      onChange={(e) =>
                        setEditorPrefs({ ...editorPrefs, lineSpacing: Number(e.target.value) })
                      }
                      className="w-full"
                    />
                  </div>
                </div>

                <div className="p-4 rounded-lg border border-[var(--ink-border)] bg-[var(--ink-bg)]">
                  <p className="text-xs text-[var(--ink-text-muted)] mb-2">Manuscript Preview</p>
                  <p
                    style={{
                      fontSize: `${editorPrefs.fontSizePx}px`,
                      lineHeight: editorPrefs.lineSpacing,
                    }}
                    className={
                      editorPrefs.manuscriptFont === 'merriweather'
                        ? 'font-merriweather'
                        : editorPrefs.manuscriptFont === 'source-serif'
                          ? 'font-source-serif'
                          : editorPrefs.manuscriptFont === 'inter'
                            ? 'font-ui'
                            : 'font-lora'
                    }
                  >
                    Rain traced slow lines down the casement glass as she set the unsigned ledger between them.
                  </p>
                </div>

                <button
                  type="button"
                  disabled={saving}
                  onClick={handleSavePreferences}
                  className="px-5 py-2 rounded-lg bg-[var(--ink-accent)] text-white text-sm font-medium"
                >
                  {saving ? 'Saving...' : 'Save Preferences'}
                </button>
              </div>
            )}

            {/* 2. PROVIDER KEYS */}
            {tab === 'providers' && (
              <div className="space-y-6">
                <div className="p-4 rounded-xl border border-[var(--ink-border)] bg-[var(--ink-bg)] flex items-start gap-3 text-sm">
                  <ShieldCheck className="w-5 h-5 text-[var(--ink-accent)] shrink-0 mt-0.5" />
                  <div>
                    <p className="font-medium">
                      Credential Priority & Security Policy
                    </p>
                    <p className="text-xs text-[var(--ink-text-muted)] mt-1 leading-relaxed">
                      Managed Universal Gemini Key:{' '}
                      <strong>
                        {managedGeminiAvailable ? 'Available (Server-Side)' : 'Not configured'}
                      </strong>
                      . Author-supplied keys take priority over the managed key for that provider. All author keys are encrypted at rest with AES-256-GCM on the server and never sent back to the browser. If an author key fails, Inkloom asks before falling back.
                    </p>
                  </div>
                </div>

                {/* Configured Author Keys */}
                <div className="space-y-2.5">
                  <h3 className="text-sm font-semibold">Your Encrypted Provider Credentials</h3>
                  {credentials.length === 0 ? (
                    <p className="text-xs text-[var(--ink-text-muted)] py-4">
                      No custom author keys saved yet. Gemini works automatically via the managed server-side key.
                    </p>
                  ) : (
                    credentials.map((cred) => (
                      <div
                        key={cred.id}
                        className="p-4 rounded-xl border border-[var(--ink-border)] bg-[var(--ink-bg)] flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                      >
                        <div>
                          <div className="flex items-center gap-2 text-sm font-medium">
                            <span>{cred.label}</span>
                            <span className="text-xs text-[var(--ink-text-muted)]">
                              ({cred.provider})
                            </span>
                            {cred.isDefault && (
                              <span className="text-xs text-[var(--ink-accent)]">· Default</span>
                            )}
                          </div>
                          <p className="text-xs text-[var(--ink-text-muted)] font-mono-tabular mt-0.5">
                            Key: {cred.keyPreview}
                            {cred.endpointUrl ? ` · Endpoint: ${cred.endpointUrl}` : ''} · Status:{' '}
                            {cred.lastStatus}
                          </p>
                          {cred.lastError && (
                            <p className="text-xs text-red-600 dark:text-red-400 mt-1">
                              {cred.lastError}
                            </p>
                          )}
                        </div>
                        <div className="flex items-center gap-2 shrink-0 text-xs">
                          <button
                            type="button"
                            disabled={testingId === cred.id}
                            onClick={async () => {
                              setTestingId(cred.id);
                              try {
                                const res = await api.testCredential(cred.id);
                                setCredentials(res.credentials);
                                setMessage(res.message);
                              } catch (err) {
                                setError(err instanceof Error ? err.message : 'Test failed');
                              } finally {
                                setTestingId(null);
                              }
                            }}
                            className="px-3 py-1.5 rounded border border-[var(--ink-border)] hover:border-[var(--ink-accent)]"
                          >
                            {testingId === cred.id ? 'Testing...' : 'Test Key'}
                          </button>
                          {!cred.isDefault && (
                            <button
                              type="button"
                              onClick={async () => {
                                const res = await api.updateCredential(cred.id, {
                                  provider: cred.provider,
                                  label: cred.label,
                                  endpointUrl: cred.endpointUrl,
                                  isDefault: true,
                                });
                                setCredentials(res.credentials);
                              }}
                              className="px-3 py-1.5 rounded border border-[var(--ink-border)] hover:border-[var(--ink-accent)]"
                            >
                              Set Default
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={async () => {
                              const res = await api.deleteCredential(cred.id);
                              setCredentials(res.credentials);
                            }}
                            className="p-1.5 text-red-600 dark:text-red-400"
                            aria-label="Remove credential"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>

                {/* Add New Credential Form */}
                <form
                  onSubmit={handleAddCredential}
                  className="p-5 rounded-xl border border-[var(--ink-border)] bg-[var(--ink-bg)] space-y-3"
                >
                  <h3 className="text-sm font-semibold flex items-center gap-1.5">
                    <KeyRound className="w-4 h-4 text-[var(--ink-accent)]" />
                    <span>Add Author Provider API Key</span>
                  </h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <select
                      value={newProvider}
                      onChange={(e) => setNewProvider(e.target.value as AiProviderId)}
                      className="px-3 py-2 rounded-lg bg-[var(--ink-surface)] border border-[var(--ink-border)] text-sm"
                    >
                      <option value="gemini">Google Gemini (Author Override)</option>
                      <option value="openai">OpenAI GPT</option>
                      <option value="anthropic">Anthropic Claude</option>
                      <option value="deepseek">DeepSeek</option>
                      <option value="meta_llama">Meta Llama (Groq / Together / Custom)</option>
                      <option value="mistral">Mistral</option>
                      <option value="openrouter">OpenRouter</option>
                      <option value="custom">Custom OpenAI-Compatible Endpoint</option>
                    </select>
                    <input
                      type="text"
                      value={newLabel}
                      onChange={(e) => setNewLabel(e.target.value)}
                      placeholder="Label (e.g., Personal OpenAI Key)"
                      className="px-3 py-2 rounded-lg bg-[var(--ink-surface)] border border-[var(--ink-border)] text-sm"
                    />
                  </div>
                  <input
                    type="password"
                    required
                    value={newApiKey}
                    onChange={(e) => setNewApiKey(e.target.value)}
                    placeholder="Paste API key (stored encrypted on server)"
                    className="w-full px-3 py-2 rounded-lg bg-[var(--ink-surface)] border border-[var(--ink-border)] text-sm"
                  />
                  {(newProvider === 'custom' || newProvider === 'meta_llama') && (
                    <input
                      type="url"
                      value={newEndpointUrl}
                      onChange={(e) => setNewEndpointUrl(e.target.value)}
                      placeholder="Base URL (e.g., https://api.groq.com/openai/v1)"
                      className="w-full px-3 py-2 rounded-lg bg-[var(--ink-surface)] border border-[var(--ink-border)] text-sm"
                    />
                  )}
                  <div className="flex items-center justify-between pt-1">
                    <label className="flex items-center gap-2 text-xs cursor-pointer">
                      <input
                        type="checkbox"
                        checked={newIsDefault}
                        onChange={(e) => setNewIsDefault(e.target.checked)}
                      />
                      <span>Set as default key for this provider</span>
                    </label>
                    <button
                      type="submit"
                      className="px-4 py-2 rounded-lg bg-[var(--ink-accent)] text-white text-xs font-medium"
                    >
                      Save Encrypted Key
                    </button>
                  </div>
                </form>
              </div>
            )}

            {/* 3. MODELS & AI TASK WORKFLOWS */}
            {tab === 'models' && (
              <div className="space-y-6">
                {/* Task Defaults */}
                <div className="p-4 rounded-xl border border-[var(--ink-border)] bg-[var(--ink-bg)] space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold">Default Workflows & Background Intelligence</h3>
                    <button
                      type="button"
                      onClick={() => void loadProvidersAndModels()}
                      className="text-xs text-[var(--ink-accent)] flex items-center gap-1"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${loadingModels ? 'animate-spin' : ''}`} />
                      <span>Refresh Discovery</span>
                    </button>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                    <div>
                      <label className="block text-[var(--ink-text-muted)] mb-1">
                        Default Provider
                      </label>
                      <select
                        value={aiPrefs.defaultProvider}
                        onChange={(e) =>
                          setAiPrefs({
                            ...aiPrefs,
                            defaultProvider: e.target.value as AiProviderId,
                          })
                        }
                        className="w-full px-3 py-2 rounded bg-[var(--ink-surface)] border border-[var(--ink-border)]"
                      >
                        <option value="gemini">Google Gemini</option>
                        <option value="openai">OpenAI</option>
                        <option value="anthropic">Anthropic</option>
                        <option value="deepseek">DeepSeek</option>
                        <option value="meta_llama">Meta Llama</option>
                        <option value="mistral">Mistral</option>
                        <option value="openrouter">OpenRouter</option>
                        <option value="custom">Custom</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-[var(--ink-text-muted)] mb-1">
                        Gemini Thinking Speed
                      </label>
                      <select
                        value={aiPrefs.thinkingMode}
                        onChange={(e) =>
                          setAiPrefs({
                            ...aiPrefs,
                            thinkingMode: e.target.value as 'fast' | 'balanced' | 'deep',
                          })
                        }
                        className="w-full px-3 py-2 rounded bg-[var(--ink-surface)] border border-[var(--ink-border)]"
                      >
                        <option value="fast">Fast Streaming (LOW thinking)</option>
                        <option value="balanced">Balanced (MEDIUM thinking)</option>
                        <option value="deep">Deep Reasoning (HIGH thinking)</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-[var(--ink-text-muted)] mb-1">
                        Economical Summary Model
                      </label>
                      <input
                        type="text"
                        value={aiPrefs.economicalModelId}
                        onChange={(e) =>
                          setAiPrefs({ ...aiPrefs, economicalModelId: e.target.value })
                        }
                        className="w-full px-3 py-2 rounded bg-[var(--ink-surface)] border border-[var(--ink-border)] font-mono-tabular"
                      />
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <label className="flex items-center gap-2 text-xs cursor-pointer">
                      <input
                        type="checkbox"
                        checked={aiPrefs.backgroundIntelligenceEnabled}
                        onChange={(e) =>
                          setAiPrefs({
                            ...aiPrefs,
                            backgroundIntelligenceEnabled: e.target.checked,
                          })
                        }
                      />
                      <span>
                        Enable non-blocking background chapter summarization & canon proposals
                      </span>
                    </label>
                    <button
                      type="button"
                      onClick={handleSavePreferences}
                      className="px-4 py-1.5 rounded-lg bg-[var(--ink-accent)] text-white text-xs font-medium"
                    >
                      Save AI Defaults
                    </button>
                  </div>
                </div>

                {modelWarnings.map((w, i) => (
                  <div
                    key={i}
                    className="p-3 rounded-lg border border-amber-500/40 bg-amber-500/10 text-xs"
                  >
                    {w}
                  </div>
                ))}

                {/* Filter Buttons */}
                <div className="flex flex-wrap gap-2 text-xs">
                  {MODEL_FILTERS.map((tag) => {
                    const active = selectedTags.includes(tag);
                    return (
                      <button
                        key={tag}
                        type="button"
                        onClick={() =>
                          setSelectedTags((prev) =>
                            active ? prev.filter((t) => t !== tag) : [...prev, tag]
                          )
                        }
                        className={`px-3 py-1.5 rounded-lg border transition-colors ${
                          active
                            ? 'border-[var(--ink-accent)] bg-[var(--ink-accent)]/10 font-medium'
                            : 'border-[var(--ink-border)] text-[var(--ink-text-muted)]'
                        }`}
                      >
                        {tag}
                      </button>
                    );
                  })}
                </div>

                {/* Model Directory */}
                <div className="space-y-2.5">
                  {filteredModels.map((m) => {
                    const isSelectedDefault =
                      aiPrefs.defaultProvider === m.provider && aiPrefs.defaultModelId === m.id;
                    return (
                      <div
                        key={`${m.provider}:${m.id}`}
                        className="p-4 rounded-xl border border-[var(--ink-border)] bg-[var(--ink-bg)] flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                      >
                        <div className="space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-medium text-sm">{m.displayName}</span>
                            <span className="text-xs font-mono-tabular text-[var(--ink-text-muted)]">
                              {m.provider} · {m.id}
                            </span>
                          </div>
                          <p className="text-xs text-[var(--ink-text-muted)] font-mono-tabular">
                            Context: {m.contextWindow.toLocaleString()} tokens · Streaming:{' '}
                            {m.supportsStreaming ? 'Yes' : 'No'} · Vision:{' '}
                            {m.supportsVision ? 'Yes' : 'Text-Only'} ·{' '}
                            {m.pricingTier.replace(/_/g, ' ')}
                          </p>
                          <p className="text-xs text-[var(--ink-text-muted)]">
                            {m.pricingSummary} — {m.availabilityNote}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={async () => {
                            const nextAi = {
                              ...aiPrefs,
                              defaultProvider: m.provider,
                              defaultModelId: m.id,
                            };
                            setAiPrefs(nextAi);
                            const res = await api.updatePreferences({ aiPrefs: nextAi });
                            onUserUpdated(res.user);
                            setMessage(`Default model set to ${m.displayName}.`);
                          }}
                          className={`px-3 py-1.5 rounded-lg text-xs font-medium shrink-0 flex items-center gap-1 ${
                            isSelectedDefault
                              ? 'bg-[var(--ink-accent)] text-white'
                              : 'border border-[var(--ink-border)] hover:border-[var(--ink-accent)]'
                          }`}
                        >
                          {isSelectedDefault ? (
                            <>
                              <Check className="w-3.5 h-3.5" />
                              <span>Default</span>
                            </>
                          ) : (
                            <>
                              <Star className="w-3.5 h-3.5" />
                              <span>Use as Default</span>
                            </>
                          )}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* 4. USAGE & ESTIMATED COSTS */}
            {tab === 'usage' && (
              <div className="space-y-4">
                <p className="text-xs text-[var(--ink-text-muted)]">
                  Recent generation telemetry recorded per user request, including credential source and estimated USD cost.
                </p>
                {usageLogs.length === 0 ? (
                  <p className="text-sm text-[var(--ink-text-muted)] py-8 text-center border border-dashed border-[var(--ink-border)] rounded-xl">
                    No AI generation requests recorded yet.
                  </p>
                ) : (
                  <div className="overflow-x-auto border border-[var(--ink-border)] rounded-xl">
                    <table className="w-full text-xs text-left">
                      <thead className="bg-[var(--ink-bg)] border-b border-[var(--ink-border)] text-[var(--ink-text-muted)]">
                        <tr>
                          <th className="py-2.5 px-3">Model</th>
                          <th className="py-2.5 px-3">Credential</th>
                          <th className="py-2.5 px-3">Tokens (In / Out)</th>
                          <th className="py-2.5 px-3">Est. Cost</th>
                          <th className="py-2.5 px-3">Duration</th>
                          <th className="py-2.5 px-3">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[var(--ink-border)] font-mono-tabular">
                        {usageLogs.map((l) => (
                          <tr key={l.id}>
                            <td className="py-2.5 px-3 font-ui">
                              {l.provider} · {l.modelId}
                            </td>
                            <td className="py-2.5 px-3 capitalize">{l.credentialSource}</td>
                            <td className="py-2.5 px-3">
                              {l.inputTokensEst.toLocaleString()} /{' '}
                              {l.outputTokensEst.toLocaleString()}
                            </td>
                            <td className="py-2.5 px-3">${l.estimatedCostUsd.toFixed(5)}</td>
                            <td className="py-2.5 px-3">{(l.durationMs / 1000).toFixed(1)}s</td>
                            <td className="py-2.5 px-3">
                              {l.status} · {formatRelativeDate(l.createdAt)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {/* 5. OFFLINE STORAGE & PLATFORM DOCS */}
            {tab === 'storage' && (
              <div className="space-y-6">
                <div className="p-4 rounded-xl border border-[var(--ink-border)] bg-[var(--ink-bg)] flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <p className="text-sm font-medium">
                      Local IndexedDB Offline Queue ({pendingSyncCount} pending chapters)
                    </p>
                    <p className="text-xs text-[var(--ink-text-muted)] mt-0.5">
                      Drafts save locally on every edit for crash recovery and conflict-aware cloud sync.
                    </p>
                  </div>
                  <div className="flex gap-2 text-xs">
                    <button
                      type="button"
                      onClick={async () => {
                        const pending = await offlineDb.getPendingChapters();
                        if (pending.length === 0) {
                          setMessage('All local chapters are already synced.');
                          return;
                        }
                        const res = await api.syncChaptersBatch(pending);
                        for (const c of res.synced) await offlineDb.saveChapterLocal(c, 'synced');
                        setPendingSyncCount(res.conflicts.length);
                        setMessage(
                          `Synced ${res.synced.length} chapters. Conflicts: ${res.conflicts.length}.`
                        );
                      }}
                      className="px-3 py-1.5 rounded-lg bg-[var(--ink-accent)] text-white font-medium"
                    >
                      Sync Now
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        await offlineDb.clearAll();
                        setPendingSyncCount(0);
                        setMessage('Local browser cache cleared.');
                      }}
                      className="px-3 py-1.5 rounded-lg border border-[var(--ink-border)]"
                    >
                      Clear Local Cache
                    </button>
                  </div>
                </div>

                <div>
                  <h3 className="text-sm font-semibold mb-2">
                    Platform Architecture, Limitations & Migration Guide
                  </h3>
                  <pre className="p-4 rounded-xl border border-[var(--ink-border)] bg-[var(--ink-bg)] text-xs whitespace-pre-wrap leading-relaxed font-ui max-h-80 overflow-y-auto">
                    {archDoc || 'Loading documentation...'}
                  </pre>
                </div>
              </div>
            )}

            {/* 6. ACCOUNT & SECURITY */}
            {tab === 'account' && (
              <div className="space-y-6 max-w-xl">
                <div className="p-4 rounded-xl border border-[var(--ink-border)] bg-[var(--ink-bg)] space-y-3">
                  <p className="text-xs text-[var(--ink-text-muted)]">Signed in as</p>
                  <p className="text-sm font-medium">{user.email}</p>
                  <div>
                    <label className="block text-xs text-[var(--ink-text-muted)] mb-1">
                      Author Display Name
                    </label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        className="flex-1 px-3 py-2 rounded-lg bg-[var(--ink-surface)] border border-[var(--ink-border)] text-sm"
                      />
                      <button
                        type="button"
                        onClick={handleSavePreferences}
                        className="px-4 py-2 rounded-lg bg-[var(--ink-accent)] text-white text-xs font-medium"
                      >
                        Update
                      </button>
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-4 pt-2">
                  <button
                    type="button"
                    onClick={async () => {
                      await api.logout().catch(() => {});
                      await signOutFirebase().catch(() => {});
                      onLoggedOut();
                    }}
                    className="px-4 py-2 rounded-lg border border-[var(--ink-border)] text-sm flex items-center gap-2"
                  >
                    <LogOut className="w-4 h-4" />
                    <span>Sign Out</span>
                  </button>

                  {!confirmDeleteAccount ? (
                    <button
                      type="button"
                      onClick={() => setConfirmDeleteAccount(true)}
                      className="px-4 py-2 rounded-lg border border-red-500/40 text-red-600 dark:text-red-400 text-sm"
                    >
                      Delete Account
                    </button>
                  ) : (
                    <div className="p-4 rounded-xl border border-red-500/50 bg-red-500/10 space-y-3 w-full">
                      <p className="text-xs">
                        Permanently delete your Inkloom account, all novels, Story Bibles, uploaded images, and encrypted API keys? This cannot be undone.
                      </p>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={async () => {
                            try {
                              if (auth.currentUser) {
                                await firestoreStore.deleteAllUserFirestoreData(auth.currentUser.uid);
                              }
                              await api.deleteAccount();
                              await signOutFirebase().catch(() => {});
                              await offlineDb.clearAll();
                              onLoggedOut();
                            } catch (err) {
                              setError(
                                err instanceof Error ? err.message : 'Account deletion failed'
                              );
                            }
                          }}
                          className="px-4 py-1.5 rounded bg-red-600 text-white text-xs font-medium"
                        >
                          Confirm Account Deletion
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteAccount(false)}
                          className="px-4 py-1.5 rounded border border-[var(--ink-border)] text-xs"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
