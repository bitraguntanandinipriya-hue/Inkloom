import React, { useCallback, useEffect, useState } from 'react';
import {
  ArrowLeft,
  CheckCircle2,
  Download,
  Lock,
  RotateCcw,
  Settings,
  WifiOff,
} from 'lucide-react';
import { api, type NovelBundleResponse } from '../lib/api';
import { offlineDb } from '../lib/offlineDb';
import type { BackgroundJob, Chapter, Novel, UserProfile } from '../types';
import { ChapterStudio } from './ChapterStudio';
import { ReferenceGalleryView } from './ReferenceGalleryView';
import { StoryBibleView } from './StoryBibleView';

interface NovelWorkspaceProps {
  user: UserProfile;
  novelId: string;
  isOffline: boolean;
  onBackToLibrary: () => void;
  onOpenSettings: () => void;
  onOpenExport: (novel: Novel) => void;
  onNovelMutated: () => void;
}

export const NovelWorkspace: React.FC<NovelWorkspaceProps> = ({
  user,
  novelId,
  isOffline,
  onBackToLibrary,
  onOpenSettings,
  onOpenExport,
  onNovelMutated,
}) => {
  const [tab, setTab] = useState<'studio' | 'bible' | 'references'>('studio');
  const [bundle, setBundle] = useState<NovelBundleResponse | null>(null);
  const [jobs, setJobs] = useState<BackgroundJob[]>([]);
  const [activeChapterId, setActiveChapterId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingPromptInsert, setPendingPromptInsert] = useState<string | null>(null);
  const [syncingOffline, setSyncingOffline] = useState(false);

  const loadBundle = useCallback(async () => {
    try {
      const data = await api.getNovelBundle(novelId);
      // Merge any pending offline chapters that are newer than cloud
      const localChapters = await offlineDb.getChaptersForNovel(novelId);
      const mergedActive = data.chapters.map((serverCh) => {
        const local = localChapters.find((l) => l.id === serverCh.id);
        if (
          local &&
          local.syncState === 'pending' &&
          new Date(local.clientUpdatedAt).getTime() > new Date(serverCh.clientUpdatedAt).getTime()
        ) {
          return { ...local, syncState: 'pending' as const };
        }
        void offlineDb.saveChapterLocal(serverCh, 'synced');
        return serverCh;
      });

      setBundle({ ...data, chapters: mergedActive });
      setActiveChapterId((prev) =>
        prev && mergedActive.some((c) => c.id === prev)
          ? prev
          : mergedActive[0]?.id || null
      );
      setError(null);

      api
        .listJobs(novelId)
        .then((res) => setJobs(res.jobs))
        .catch(() => {});
    } catch (err) {
      // Fallback to cached local data if offline
      const cachedNovels = await offlineDb.getCachedNovels();
      const cachedNovel = cachedNovels.find((n) => n.id === novelId);
      const cachedChapters = await offlineDb.getChaptersForNovel(novelId);
      if (cachedNovel && cachedChapters.length > 0) {
        setBundle({
          novel: cachedNovel,
          characters: [],
          chapters: cachedChapters.filter((c) => !c.trashedAt),
          trashedChapters: cachedChapters.filter((c) => Boolean(c.trashedAt)),
          images: [],
          canonFacts: [],
          summaries: [],
          stateProposals: [],
          scratchpadNotes: [],
        });
        setActiveChapterId((prev) => prev || cachedChapters[0]?.id || null);
      } else {
        setError(err instanceof Error ? err.message : 'Failed to load novel');
      }
    } finally {
      setLoading(false);
    }
  }, [novelId]);

  useEffect(() => {
    setLoading(true);
    void loadBundle();
  }, [loadBundle]);

  // Auto-sync pending offline chapters when connectivity returns
  useEffect(() => {
    if (isOffline) return;
    offlineDb.getPendingChapters().then(async (pending) => {
      const forThisNovel = pending.filter((p) => p.novelId === novelId);
      if (forThisNovel.length === 0) return;
      setSyncingOffline(true);
      try {
        const res = await api.syncChaptersBatch(forThisNovel);
        for (const ch of res.synced) {
          await offlineDb.saveChapterLocal(ch, 'synced');
        }
        await loadBundle();
      } catch {
        // will retry later
      } finally {
        setSyncingOffline(false);
      }
    });
  }, [isOffline, novelId, loadBundle]);

  const handleChapterSavedLocal = (updated: Chapter) => {
    setBundle((prev) =>
      prev
        ? {
            ...prev,
            chapters: prev.chapters.map((c) => (c.id === updated.id ? updated : c)),
          }
        : prev
    );
  };

  if (loading && !bundle) {
    return (
      <div className="min-h-screen bg-[var(--ink-bg)] flex items-center justify-center text-sm text-[var(--ink-text-muted)]">
        Opening manuscript workspace...
      </div>
    );
  }

  if (error || !bundle) {
    return (
      <div className="min-h-screen bg-[var(--ink-bg)] flex flex-col items-center justify-center p-6 text-center gap-4">
        <p className="text-sm text-red-600 dark:text-red-400">{error || 'Novel unavailable.'}</p>
        <button
          type="button"
          onClick={onBackToLibrary}
          className="px-4 py-2 rounded-lg border border-[var(--ink-border)] text-sm"
        >
          Back to Library
        </button>
      </div>
    );
  }

  const isReadOnly = bundle.novel.status === 'completed';

  return (
    <div className="min-h-screen bg-[var(--ink-bg)] text-[var(--ink-text)] flex flex-col">
      {/* Clean 3-Zone Workspace Top Bar */}
      <header className="sticky top-0 z-20 h-16 bg-[var(--ink-surface)] border-b border-[var(--ink-border)] px-4 sm:px-6 flex items-center justify-between gap-8">
        <div className="flex items-center gap-3 min-w-0">
          <button
            type="button"
            onClick={onBackToLibrary}
            aria-label="Back to Library"
            className="p-1.5 rounded-lg border border-[var(--ink-border)] text-[var(--ink-text-muted)] hover:text-[var(--ink-text)] shrink-0"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <span className="font-lora font-semibold text-base truncate">
            {bundle.novel.title}
          </span>
        </div>

        <nav className="flex items-center gap-6 text-sm overflow-x-auto">
          <button
            type="button"
            onClick={() => setTab('studio')}
            className={`py-1 border-b-2 transition-colors whitespace-nowrap shrink-0 ${
              tab === 'studio'
                ? 'border-[var(--ink-accent)] text-[var(--ink-text)] font-medium'
                : 'border-transparent text-[var(--ink-text-muted)] hover:text-[var(--ink-text)]'
            }`}
          >
            Chapter Studio
          </button>
          <button
            type="button"
            onClick={() => setTab('bible')}
            className={`py-1 border-b-2 transition-colors whitespace-nowrap shrink-0 ${
              tab === 'bible'
                ? 'border-[var(--ink-accent)] text-[var(--ink-text)] font-medium'
                : 'border-transparent text-[var(--ink-text-muted)] hover:text-[var(--ink-text)]'
            }`}
          >
            Story Bible
          </button>
          <button
            type="button"
            onClick={() => setTab('references')}
            className={`py-1 border-b-2 transition-colors whitespace-nowrap shrink-0 ${
              tab === 'references'
                ? 'border-[var(--ink-accent)] text-[var(--ink-text)] font-medium'
                : 'border-transparent text-[var(--ink-text-muted)] hover:text-[var(--ink-text)]'
            }`}
          >
            References
          </button>
          <button
            type="button"
            onClick={() => onOpenExport(bundle.novel)}
            className="py-1 border-b-2 border-transparent text-[var(--ink-text-muted)] hover:text-[var(--ink-text)] flex items-center gap-1 whitespace-nowrap shrink-0"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export</span>
          </button>
        </nav>

        <div className="flex items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={onOpenSettings}
            aria-label="Settings"
            className="p-2 rounded-lg border border-[var(--ink-border)] text-[var(--ink-text-muted)] hover:text-[var(--ink-text)]"
          >
            <Settings className="w-4 h-4" />
          </button>
          <button
            type="button"
            disabled={isOffline}
            onClick={async () => {
              await api.updateNovel(bundle.novel.id, {
                action: isReadOnly ? 'reopen' : 'complete',
              });
              await loadBundle();
              onNovelMutated();
            }}
            className={`px-3.5 py-2 rounded-lg text-xs font-medium flex items-center gap-1.5 whitespace-nowrap shrink-0 disabled:opacity-50 ${
              isReadOnly
                ? 'bg-[var(--ink-accent)] text-white'
                : 'border border-[var(--ink-border)] hover:border-[var(--ink-accent)]'
            }`}
          >
            {isReadOnly ? (
              <>
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Reopen Novel</span>
              </>
            ) : (
              <>
                <CheckCircle2 className="w-3.5 h-3.5 text-[var(--ink-accent)]" />
                <span>Complete Novel</span>
              </>
            )}
          </button>
        </div>
      </header>

      {/* Status Banners */}
      {isOffline && (
        <div className="px-6 py-2.5 bg-[var(--ink-surface-elevated)] border-b border-[var(--ink-border)] text-xs flex items-center gap-2">
          <WifiOff className="w-3.5 h-3.5 text-[var(--ink-accent)]" />
          <span>
            Offline mode active. Edits autosave locally and sync automatically when online. Live AI generation requires connectivity.
          </span>
        </div>
      )}

      {syncingOffline && (
        <div className="px-6 py-2 bg-[var(--ink-surface-elevated)] border-b border-[var(--ink-border)] text-xs">
          Syncing offline edits with cloud...
        </div>
      )}

      {isReadOnly && (
        <div className="px-6 py-2.5 bg-[var(--ink-surface-elevated)] border-b border-[var(--ink-border)] text-xs flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Lock className="w-3.5 h-3.5 text-[var(--ink-accent)]" />
            <span>
              Completed Novel Mode — Manuscript, Story Bible, and profiles are protected in read-only reading mode.
            </span>
          </div>
          <button
            type="button"
            disabled={isOffline}
            onClick={async () => {
              await api.updateNovel(bundle.novel.id, { action: 'reopen' });
              await loadBundle();
              onNovelMutated();
            }}
            className="text-[var(--ink-accent)] font-medium hover:underline"
          >
            Reopen Novel for Editing
          </button>
        </div>
      )}

      {/* Active Workspace Tab */}
      {tab === 'studio' && (
        <ChapterStudio
          user={user}
          novel={bundle.novel}
          chapters={bundle.chapters}
          trashedChapters={bundle.trashedChapters}
          images={bundle.images}
          canonFacts={bundle.canonFacts}
          scratchpadNotes={bundle.scratchpadNotes}
          activeChapterId={activeChapterId}
          isOffline={isOffline}
          isReadOnly={isReadOnly}
          pendingPromptInsert={pendingPromptInsert}
          onClearPendingPromptInsert={() => setPendingPromptInsert(null)}
          onSelectChapter={setActiveChapterId}
          onChaptersChanged={loadBundle}
          onChapterSavedLocal={handleChapterSavedLocal}
        />
      )}

      {tab === 'bible' && (
        <StoryBibleView
          novel={bundle.novel}
          characters={bundle.characters}
          chapters={bundle.chapters}
          canonFacts={bundle.canonFacts}
          summaries={bundle.summaries}
          stateProposals={bundle.stateProposals}
          scratchpadNotes={bundle.scratchpadNotes}
          jobs={jobs}
          isReadOnly={isReadOnly}
          onRefresh={loadBundle}
          onInsertScratchpadToPrompt={(text) => {
            setPendingPromptInsert(text);
            setTab('studio');
          }}
        />
      )}

      {tab === 'references' && (
        <ReferenceGalleryView
          novel={bundle.novel}
          images={bundle.images}
          characters={bundle.characters}
          isReadOnly={isReadOnly}
          onRefresh={loadBundle}
        />
      )}
    </div>
  );
};
