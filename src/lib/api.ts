import type {
  AiModelInfo,
  AiProviderId,
  AiUsageLog,
  BackgroundJob,
  CanonFact,
  Chapter,
  ChapterSummary,
  ChapterVersion,
  CharacterProfile,
  CharacterStateProposal,
  Novel,
  PreflightContextSummary,
  ProviderCredentialPublic,
  ScratchpadNote,
  UploadedImage,
  UserProfile,
} from '../types';

export class ApiError extends Error {
  status: number;
  data?: unknown;
  constructor(message: string, status: number, data?: unknown) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const isFormData = init?.body instanceof FormData;
  const headers: Record<string, string> = isFormData
    ? {}
    : { 'Content-Type': 'application/json' };

  const resp = await fetch(path, {
    ...init,
    credentials: 'include',
    headers: {
      ...headers,
      ...(init?.headers as Record<string, string> | undefined),
    },
  });

  const contentType = resp.headers.get('content-type') || '';
  const data = contentType.includes('application/json')
    ? await resp.json().catch(() => ({}))
    : await resp.text().catch(() => '');

  if (!resp.ok) {
    const msg =
      typeof data === 'object' && data && 'error' in data
        ? String((data as { error: unknown }).error)
        : `Request failed with status ${resp.status}`;
    throw new ApiError(msg, resp.status, data);
  }
  return data as T;
}

export interface NovelBundleResponse {
  novel: Novel;
  characters: CharacterProfile[];
  chapters: Chapter[];
  trashedChapters: Chapter[];
  images: UploadedImage[];
  canonFacts: CanonFact[];
  summaries: ChapterSummary[];
  stateProposals: CharacterStateProposal[];
  scratchpadNotes: ScratchpadNote[];
}

export interface StreamGenerationCallbacks {
  onLifecycle: (payload: {
    state: string;
    requestId: string;
    credentialSource?: 'managed' | 'author';
    credentialLabel?: string;
  }) => void;
  onDelta: (text: string) => void;
  onDone: (payload: {
    state: string;
    requestId: string;
    chapter: Chapter | null;
    finishReason: string;
    truncatedByOutputLimit: boolean;
    backgroundJobId: string | null;
    usage: {
      inputTokensEst: number;
      outputTokensEst: number;
      estimatedCostUsd: number;
      durationMs: number;
    };
  }) => void;
  onError: (payload: {
    state: string;
    requestId: string;
    error: string;
    code: string;
    partialText: string;
    credentialSource?: 'managed' | 'author';
    canFallbackToManaged?: boolean;
  }) => void;
}

export async function streamGeneration(
  body: Record<string, unknown>,
  signal: AbortSignal,
  callbacks: StreamGenerationCallbacks
): Promise<void> {
  const resp = await fetch('/api/ai/generate/stream', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });

  if (!resp.ok || !resp.body) {
    const errData = await resp.json().catch(() => ({ error: `HTTP ${resp.status}` }));
    throw new ApiError(errData.error || 'Failed to start generation stream', resp.status, errData);
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let currentEvent = 'message';

  const dispatch = (evtName: string, rawData: string) => {
    try {
      const parsed = JSON.parse(rawData);
      if (evtName === 'lifecycle') callbacks.onLifecycle(parsed);
      else if (evtName === 'delta') callbacks.onDelta(parsed.text || '');
      else if (evtName === 'done') callbacks.onDone(parsed);
      else if (evtName === 'error') callbacks.onError(parsed);
    } catch {
      // ignore non-JSON keepalives
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const rawLine of lines) {
      const line = rawLine.trimEnd();
      if (!line) {
        currentEvent = 'message';
        continue;
      }
      if (line.startsWith(':')) continue; // SSE keepalive comment
      if (line.startsWith('event:')) {
        currentEvent = line.slice(6).trim();
      } else if (line.startsWith('data:')) {
        const dataStr = line.slice(5).trim();
        if (dataStr) dispatch(currentEvent, dataStr);
      }
    }
  }
}

// Convenience typed endpoints
export const api = {
  getAuthConfig: () =>
    apiFetch<{ googleClientId: string | null; managedGeminiConfigured: boolean }>('/api/auth/config'),
  me: () =>
    apiFetch<{
      user: UserProfile;
      googleClientIdConfigured: boolean;
      managedGeminiConfigured: boolean;
    }>('/api/auth/me'),
  login: (email: string, password: string) =>
    apiFetch<{ user: UserProfile }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),
  register: (email: string, password: string, name: string) =>
    apiFetch<{ user: UserProfile }>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password, name }),
    }),
  googleSignIn: (idToken: string) =>
    apiFetch<{ user: UserProfile }>('/api/auth/google', {
      method: 'POST',
      body: JSON.stringify({ idToken }),
    }),
  logout: () => apiFetch<{ ok: boolean }>('/api/auth/logout', { method: 'POST' }),
  requestPasswordReset: (email: string) =>
    apiFetch<{ ok: boolean; message: string; localResetToken: string | null; expiresAt: string | null }>(
      '/api/auth/password-reset/request',
      { method: 'POST', body: JSON.stringify({ email }) }
    ),
  completePasswordReset: (token: string, newPassword: string) =>
    apiFetch<{ ok: boolean; message: string }>('/api/auth/password-reset/complete', {
      method: 'POST',
      body: JSON.stringify({ token, newPassword }),
    }),
  updatePreferences: (payload: Partial<UserProfile>) =>
    apiFetch<{ user: UserProfile }>('/api/auth/preferences', {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
  deleteAccount: () => apiFetch<{ ok: boolean }>('/api/auth/account', { method: 'DELETE' }),

  listNovels: () => apiFetch<{ novels: Novel[] }>('/api/novels'),
  createNovel: (payload: Record<string, unknown>) =>
    apiFetch<{ novel: Novel; firstChapterId: string }>('/api/novels', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  getNovelBundle: (novelId: string) => apiFetch<NovelBundleResponse>(`/api/novels/${novelId}`),
  updateNovel: (novelId: string, payload: Record<string, unknown>) =>
    apiFetch<{ novel: Novel }>(`/api/novels/${novelId}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
  deleteNovelPermanent: (novelId: string) =>
    apiFetch<{ ok: boolean }>(`/api/novels/${novelId}`, { method: 'DELETE' }),

  createCharacter: (novelId: string, payload: Partial<CharacterProfile>) =>
    apiFetch<{ character: CharacterProfile }>(`/api/novels/${novelId}/characters`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateCharacter: (novelId: string, characterId: string, payload: Partial<CharacterProfile>) =>
    apiFetch<{ character: CharacterProfile }>(`/api/novels/${novelId}/characters/${characterId}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
  deleteCharacter: (novelId: string, characterId: string) =>
    apiFetch<{ ok: boolean }>(`/api/novels/${novelId}/characters/${characterId}`, {
      method: 'DELETE',
    }),

  uploadImage: (novelId: string, formData: FormData) =>
    apiFetch<{ image: UploadedImage }>(`/api/novels/${novelId}/images`, {
      method: 'POST',
      body: formData,
    }),
  updateImage: (imageId: string, payload: Record<string, unknown>) =>
    apiFetch<{ ok: boolean }>(`/api/images/${imageId}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
  deleteImage: (imageId: string) =>
    apiFetch<{ ok: boolean }>(`/api/images/${imageId}`, { method: 'DELETE' }),

  createChapter: (novelId: string, payload: Record<string, unknown>) =>
    apiFetch<{ chapter: Chapter }>(`/api/novels/${novelId}/chapters`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateChapter: (chapterId: string, payload: Record<string, unknown>) =>
    apiFetch<{ chapter: Chapter }>(`/api/chapters/${chapterId}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
  duplicateChapter: (chapterId: string) =>
    apiFetch<{ chapter: Chapter }>(`/api/chapters/${chapterId}/duplicate`, { method: 'POST' }),
  trashChapter: (chapterId: string) =>
    apiFetch<{ ok: boolean }>(`/api/chapters/${chapterId}/trash`, { method: 'POST' }),
  restoreChapter: (chapterId: string) =>
    apiFetch<{ chapter: Chapter }>(`/api/chapters/${chapterId}/restore`, { method: 'POST' }),
  deleteChapterPermanent: (chapterId: string) =>
    apiFetch<{ ok: boolean }>(`/api/chapters/${chapterId}`, { method: 'DELETE' }),
  listChapterVersions: (chapterId: string) =>
    apiFetch<{ versions: ChapterVersion[] }>(`/api/chapters/${chapterId}/versions`),
  createChapterVersion: (chapterId: string, reason: string) =>
    apiFetch<{ ok: boolean; id: string }>(`/api/chapters/${chapterId}/versions`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }),
  restoreChapterVersion: (chapterId: string, versionId: string) =>
    apiFetch<{ chapter: Chapter }>(`/api/chapters/${chapterId}/versions/${versionId}/restore`, {
      method: 'POST',
    }),
  syncChaptersBatch: (chapters: Chapter[]) =>
    apiFetch<{ synced: Chapter[]; conflicts: Array<{ localId: string; serverChapter: Chapter }> }>(
      '/api/chapters/sync',
      { method: 'POST', body: JSON.stringify({ chapters }) }
    ),

  addCanonFact: (novelId: string, payload: { factText: string; category: string; isPinned?: boolean }) =>
    apiFetch<{ canonFact: CanonFact }>(`/api/novels/${novelId}/canon`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateCanonFact: (canonId: string, payload: Record<string, unknown>) =>
    apiFetch<{ ok: boolean }>(`/api/canon/${canonId}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
  deleteCanonFact: (canonId: string) =>
    apiFetch<{ ok: boolean }>(`/api/canon/${canonId}`, { method: 'DELETE' }),

  summarizeChapter: (chapterId: string) =>
    apiFetch<{ ok: boolean; summaryText: string; proposedCanonCount: number; proposedStateCount: number }>(
      `/api/chapters/${chapterId}/summarize`,
      { method: 'POST' }
    ),
  updateSummary: (summaryId: string, payload: { summaryText?: string; timelineNote?: string }) =>
    apiFetch<{ ok: boolean }>(`/api/summaries/${summaryId}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
  resolveStateProposal: (proposalId: string, action: 'approve' | 'reject') =>
    apiFetch<{ ok: boolean }>(`/api/state-proposals/${proposalId}`, {
      method: 'PATCH',
      body: JSON.stringify({ action }),
    }),

  addScratchpadNote: (novelId: string, payload: { title: string; content: string; category: string }) =>
    apiFetch<{ note: ScratchpadNote }>(`/api/novels/${novelId}/scratchpad`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateScratchpadNote: (noteId: string, payload: Record<string, unknown>) =>
    apiFetch<{ ok: boolean }>(`/api/scratchpad/${noteId}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
  deleteScratchpadNote: (noteId: string) =>
    apiFetch<{ ok: boolean }>(`/api/scratchpad/${noteId}`, { method: 'DELETE' }),

  listCredentials: () =>
    apiFetch<{ credentials: ProviderCredentialPublic[]; managedGeminiAvailable: boolean }>(
      '/api/ai/credentials'
    ),
  saveCredential: (payload: {
    provider: AiProviderId;
    label: string;
    apiKey: string;
    endpointUrl?: string;
    isDefault?: boolean;
  }) =>
    apiFetch<{ id: string; credentials: ProviderCredentialPublic[] }>('/api/ai/credentials', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateCredential: (id: string, payload: Record<string, unknown>) =>
    apiFetch<{ credentials: ProviderCredentialPublic[] }>(`/api/ai/credentials/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),
  testCredential: (id: string) =>
    apiFetch<{
      ok: boolean;
      status: string;
      message: string;
      credentials: ProviderCredentialPublic[];
    }>(`/api/ai/credentials/${id}/test`, { method: 'POST' }),
  deleteCredential: (id: string) =>
    apiFetch<{ credentials: ProviderCredentialPublic[] }>(`/api/ai/credentials/${id}`, {
      method: 'DELETE',
    }),

  discoverModels: (provider?: AiProviderId) =>
    apiFetch<{ models: AiModelInfo[]; hasManagedGemini: boolean; warnings: string[] }>(
      `/api/ai/models${provider ? `?provider=${encodeURIComponent(provider)}` : ''}`
    ),
  preflight: (payload: Record<string, unknown>) =>
    apiFetch<{ preflight: PreflightContextSummary }>('/api/ai/preflight', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  cancelGeneration: (requestId: string) =>
    apiFetch<{ ok: boolean }>(`/api/ai/generate/${requestId}/cancel`, { method: 'POST' }),
  editSelection: (payload: Record<string, unknown>) =>
    apiFetch<{ replacementText: string }>('/api/ai/edit-selection', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  brainstorm: (payload: Record<string, unknown>) =>
    apiFetch<{ ideas: string }>('/api/ai/brainstorm', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  listUsageLogs: () => apiFetch<{ logs: AiUsageLog[] }>('/api/ai/usage'),
  listJobs: (novelId: string) => apiFetch<{ jobs: BackgroundJob[] }>(`/api/novels/${novelId}/jobs`),
  retryJob: (jobId: string) => apiFetch<{ ok: boolean }>(`/api/jobs/${jobId}/retry`, { method: 'POST' }),
  getArchitectureDocs: () => apiFetch<{ markdown: string }>('/api/docs/architecture'),
};
