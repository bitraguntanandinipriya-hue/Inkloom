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
import { auth, getFirebaseIdToken } from './firebase';
import { firestoreStore } from './firestoreStore';

export class ApiError extends Error {
  status: number;
  data?: unknown;
  constructor(message: string, status: number, data?: unknown) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

async function mirrorFirestore(fn: (uid: string) => Promise<void>): Promise<void> {
  const fbUser = auth.currentUser;
  if (!fbUser || !fbUser.emailVerified) return;
  try {
    await fn(fbUser.uid);
  } catch (err) {
    window.dispatchEvent(new CustomEvent('inkloom:firestore-error', { detail: err }));
  }
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const isFormData = init?.body instanceof FormData;
  const headers: Record<string, string> = isFormData
    ? {}
    : { 'Content-Type': 'application/json' };

  const fbToken = await getFirebaseIdToken();
  if (fbToken) {
    headers['Authorization'] = `Bearer ${fbToken}`;
  }

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
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const fbToken = await getFirebaseIdToken();
  if (fbToken) {
    headers['Authorization'] = `Bearer ${fbToken}`;
  }

  const resp = await fetch('/api/ai/generate/stream', {
    method: 'POST',
    credentials: 'include',
    headers,
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
      else if (evtName === 'done') {
        if (parsed.chapter) {
          void mirrorFirestore(async () => {
            await firestoreStore.saveChapter(parsed.chapter as Chapter);
          });
        }
        callbacks.onDone(parsed);
      } else if (evtName === 'error') callbacks.onError(parsed);
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
  firebaseSession: (idToken: string) =>
    apiFetch<{ user: UserProfile }>('/api/auth/firebase-session', {
      method: 'POST',
      body: JSON.stringify({ idToken }),
    }),
  hydrateFromFirestore: (payload: { novels?: Novel[]; bundle?: NovelBundleResponse }) =>
    apiFetch<{ ok: boolean }>('/api/sync/hydrate', {
      method: 'POST',
      body: JSON.stringify(payload),
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
  updatePreferences: async (payload: Partial<UserProfile>) => {
    const res = await apiFetch<{ user: UserProfile }>('/api/auth/preferences', {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
    await mirrorFirestore(async () => {
      await firestoreStore.syncUserProfile(res.user);
    });
    return res;
  },
  deleteAccount: () => apiFetch<{ ok: boolean }>('/api/auth/account', { method: 'DELETE' }),

  listNovels: () => apiFetch<{ novels: Novel[] }>('/api/novels'),
  createNovel: async (payload: Record<string, unknown>) => {
    const res = await apiFetch<{ novel: Novel; firstChapterId: string }>('/api/novels', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    await mirrorFirestore(async (uid) => {
      const bundle = await apiFetch<NovelBundleResponse>(`/api/novels/${res.novel.id}`);
      await firestoreStore.syncBundleToFirestore(uid, bundle);
    });
    return res;
  },
  getNovelBundle: (novelId: string) => apiFetch<NovelBundleResponse>(`/api/novels/${novelId}`),
  updateNovel: async (novelId: string, payload: Record<string, unknown>) => {
    const res = await apiFetch<{ novel: Novel }>(`/api/novels/${novelId}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
    const action = payload.action as 'complete' | 'reopen' | 'trash' | 'restore' | undefined;
    await mirrorFirestore(async () => {
      if (action) {
        await firestoreStore.applyNovelAction(novelId, action, res.novel.status);
      } else {
        await firestoreStore.saveNovel(res.novel);
      }
    });
    return res;
  },
  deleteNovelPermanent: async (novelId: string) => {
    const res = await apiFetch<{ ok: boolean }>(`/api/novels/${novelId}`, { method: 'DELETE' });
    await mirrorFirestore(async (uid) => {
      await firestoreStore.deleteNovelCascade(uid, novelId);
    });
    return res;
  },

  createCharacter: async (novelId: string, payload: Partial<CharacterProfile>) => {
    const res = await apiFetch<{ character: CharacterProfile }>(`/api/novels/${novelId}/characters`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    await mirrorFirestore(async () => {
      await firestoreStore.saveCharacter(res.character);
    });
    return res;
  },
  updateCharacter: async (
    novelId: string,
    characterId: string,
    payload: Partial<CharacterProfile>
  ) => {
    const res = await apiFetch<{ character: CharacterProfile }>(
      `/api/novels/${novelId}/characters/${characterId}`,
      {
        method: 'PATCH',
        body: JSON.stringify(payload),
      }
    );
    await mirrorFirestore(async () => {
      await firestoreStore.saveCharacter(res.character);
    });
    return res;
  },
  deleteCharacter: async (novelId: string, characterId: string) => {
    const res = await apiFetch<{ ok: boolean }>(
      `/api/novels/${novelId}/characters/${characterId}`,
      {
        method: 'DELETE',
      }
    );
    await mirrorFirestore(async () => {
      await firestoreStore.deleteCharacter(novelId, characterId);
    });
    return res;
  },

  uploadImage: async (novelId: string, formData: FormData) => {
    const res = await apiFetch<{ image: UploadedImage }>(`/api/novels/${novelId}/images`, {
      method: 'POST',
      body: formData,
    });
    await mirrorFirestore(async () => {
      await firestoreStore.saveImageMetadata(res.image);
      if (res.image.entityType === 'cover') {
        await firestoreStore.setNovelCoverImage(novelId, res.image.id);
      } else if (res.image.entityType === 'character' && res.image.entityId) {
        await firestoreStore.setCharacterImage(novelId, res.image.entityId, res.image.id);
      }
    });
    return res;
  },
  updateImage: async (imageId: string, payload: Record<string, unknown>) => {
    const res = await apiFetch<{ ok: boolean; image?: UploadedImage }>(`/api/images/${imageId}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
    if (res.image) {
      await mirrorFirestore(async () => {
        await firestoreStore.saveImageMetadata(res.image!);
      });
    }
    return res;
  },
  deleteImage: async (imageId: string) => {
    const res = await apiFetch<{
      ok: boolean;
      novelId?: string;
      entityType?: string;
      entityId?: string | null;
    }>(`/api/images/${imageId}`, { method: 'DELETE' });
    if (res.novelId) {
      await mirrorFirestore(async () => {
        await firestoreStore.deleteImageMetadata(res.novelId!, imageId);
        if (res.entityType === 'cover') {
          await firestoreStore.setNovelCoverImage(res.novelId!, null);
        } else if (res.entityType === 'character' && res.entityId) {
          await firestoreStore.setCharacterImage(res.novelId!, res.entityId, null);
        }
      });
    }
    return res;
  },

  createChapter: async (novelId: string, payload: Record<string, unknown>) => {
    const res = await apiFetch<{ chapter: Chapter }>(`/api/novels/${novelId}/chapters`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    await mirrorFirestore(async () => {
      await firestoreStore.saveChapter(res.chapter);
    });
    return res;
  },
  updateChapter: async (chapterId: string, payload: Record<string, unknown>) => {
    const res = await apiFetch<{ chapter: Chapter }>(`/api/chapters/${chapterId}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
    await mirrorFirestore(async () => {
      await firestoreStore.saveChapter(res.chapter);
    });
    return res;
  },
  duplicateChapter: async (chapterId: string) => {
    const res = await apiFetch<{ chapter: Chapter }>(`/api/chapters/${chapterId}/duplicate`, {
      method: 'POST',
    });
    await mirrorFirestore(async () => {
      await firestoreStore.saveChapter(res.chapter);
    });
    return res;
  },
  trashChapter: async (chapterId: string) => {
    const res = await apiFetch<{ ok: boolean; novelId?: string }>(
      `/api/chapters/${chapterId}/trash`,
      { method: 'POST' }
    );
    if (res.novelId) {
      await mirrorFirestore(async () => {
        await firestoreStore.trashChapter(res.novelId!, chapterId);
      });
    }
    return res;
  },
  restoreChapter: async (chapterId: string) => {
    const res = await apiFetch<{ chapter: Chapter }>(`/api/chapters/${chapterId}/restore`, {
      method: 'POST',
    });
    await mirrorFirestore(async () => {
      await firestoreStore.restoreChapter(res.chapter.novelId, chapterId);
    });
    return res;
  },
  deleteChapterPermanent: async (chapterId: string) => {
    const res = await apiFetch<{ ok: boolean; novelId?: string }>(`/api/chapters/${chapterId}`, {
      method: 'DELETE',
    });
    if (res.novelId) {
      await mirrorFirestore(async (uid) => {
        await firestoreStore.deleteChapterPermanent(uid, res.novelId!, chapterId);
      });
    }
    return res;
  },
  listChapterVersions: (chapterId: string) =>
    apiFetch<{ versions: ChapterVersion[] }>(`/api/chapters/${chapterId}/versions`),
  createChapterVersion: async (chapterId: string, reason: string) => {
    const res = await apiFetch<{
      ok: boolean;
      id: string;
      novelId?: string;
      version?: ChapterVersion;
    }>(`/api/chapters/${chapterId}/versions`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
    if (res.novelId && res.version) {
      await mirrorFirestore(async (uid) => {
        await firestoreStore.saveChapterVersion(uid, res.novelId!, res.version!);
      });
    }
    return res;
  },
  restoreChapterVersion: async (chapterId: string, versionId: string) => {
    const res = await apiFetch<{ chapter: Chapter; novelId?: string }>(
      `/api/chapters/${chapterId}/versions/${versionId}/restore`,
      {
        method: 'POST',
      }
    );
    await mirrorFirestore(async () => {
      await firestoreStore.saveChapter(res.chapter);
    });
    return res;
  },
  syncChaptersBatch: async (chapters: Chapter[]) => {
    const res = await apiFetch<{
      synced: Chapter[];
      conflicts: Array<{ localId: string; serverChapter: Chapter }>;
    }>('/api/chapters/sync', { method: 'POST', body: JSON.stringify({ chapters }) });
    if (res.synced.length > 0) {
      await mirrorFirestore(async () => {
        for (const ch of res.synced) {
          await firestoreStore.saveChapter(ch);
        }
      });
    }
    return res;
  },

  addCanonFact: async (
    novelId: string,
    payload: { factText: string; category: string; isPinned?: boolean }
  ) => {
    const res = await apiFetch<{ canonFact: CanonFact }>(`/api/novels/${novelId}/canon`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    await mirrorFirestore(async (uid) => {
      await firestoreStore.saveCanonFact(uid, res.canonFact);
    });
    return res;
  },
  updateCanonFact: async (canonId: string, payload: Record<string, unknown>) => {
    const res = await apiFetch<{ ok: boolean; canonFact?: CanonFact }>(`/api/canon/${canonId}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
    if (res.canonFact) {
      await mirrorFirestore(async (uid) => {
        await firestoreStore.saveCanonFact(uid, res.canonFact!);
      });
    }
    return res;
  },
  deleteCanonFact: async (canonId: string) => {
    const res = await apiFetch<{ ok: boolean; novelId?: string | null }>(`/api/canon/${canonId}`, {
      method: 'DELETE',
    });
    if (res.novelId) {
      await mirrorFirestore(async () => {
        await firestoreStore.deleteCanonFact(res.novelId!, canonId);
      });
    }
    return res;
  },

  summarizeChapter: async (chapterId: string) => {
    const res = await apiFetch<{
      ok: boolean;
      novelId?: string;
      summaryText: string;
      proposedCanonCount: number;
      proposedStateCount: number;
    }>(`/api/chapters/${chapterId}/summarize`, { method: 'POST' });
    if (res.novelId) {
      await mirrorFirestore(async (uid) => {
        const bundle = await apiFetch<NovelBundleResponse>(`/api/novels/${res.novelId}`);
        await firestoreStore.syncBundleToFirestore(uid, bundle);
      });
    }
    return res;
  },
  updateSummary: async (
    summaryId: string,
    payload: { summaryText?: string; timelineNote?: string }
  ) => {
    const res = await apiFetch<{ ok: boolean; summary?: ChapterSummary | null }>(
      `/api/summaries/${summaryId}`,
      {
        method: 'PATCH',
        body: JSON.stringify(payload),
      }
    );
    if (res.summary) {
      await mirrorFirestore(async (uid) => {
        await firestoreStore.saveChapterSummary(uid, res.summary!);
      });
    }
    return res;
  },
  resolveStateProposal: async (proposalId: string, action: 'approve' | 'reject') => {
    const res = await apiFetch<{
      ok: boolean;
      novelId?: string;
      approvalStatus?: 'approved' | 'rejected';
      character?: CharacterProfile | null;
    }>(`/api/state-proposals/${proposalId}`, {
      method: 'PATCH',
      body: JSON.stringify({ action }),
    });
    if (res.novelId && res.approvalStatus) {
      await mirrorFirestore(async () => {
        await firestoreStore.resolveStateProposal(res.novelId!, proposalId, res.approvalStatus!);
        if (res.character) {
          await firestoreStore.saveCharacter(res.character);
        }
      });
    }
    return res;
  },

  addScratchpadNote: async (
    novelId: string,
    payload: { title: string; content: string; category: string }
  ) => {
    const res = await apiFetch<{ note: ScratchpadNote }>(`/api/novels/${novelId}/scratchpad`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    await mirrorFirestore(async (uid) => {
      await firestoreStore.saveScratchpadNote(uid, res.note);
    });
    return res;
  },
  updateScratchpadNote: async (noteId: string, payload: Record<string, unknown>) => {
    const res = await apiFetch<{ ok: boolean; note?: ScratchpadNote | null }>(
      `/api/scratchpad/${noteId}`,
      {
        method: 'PATCH',
        body: JSON.stringify(payload),
      }
    );
    if (res.note) {
      await mirrorFirestore(async (uid) => {
        await firestoreStore.saveScratchpadNote(uid, res.note!);
      });
    }
    return res;
  },
  deleteScratchpadNote: async (noteId: string) => {
    const res = await apiFetch<{ ok: boolean; novelId?: string | null }>(
      `/api/scratchpad/${noteId}`,
      { method: 'DELETE' }
    );
    if (res.novelId) {
      await mirrorFirestore(async () => {
        await firestoreStore.deleteScratchpadNote(res.novelId!, noteId);
      });
    }
    return res;
  },

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

