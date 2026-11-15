import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { AuthView } from './components/AuthView';
import { ExportModal } from './components/ExportModal';
import { LibraryView } from './components/LibraryView';
import { NovelWizardModal } from './components/NovelWizardModal';
import { NovelWorkspace } from './components/NovelWorkspace';
import { SettingsModal } from './components/SettingsModal';
import { api } from './lib/api';
import { useFirebase } from './lib/FirebaseContext';
import { firestoreStore } from './lib/firestoreStore';
import { offlineDb } from './lib/offlineDb';
import { applyThemeMode } from './lib/theme';
import type { Novel, UserProfile } from './types';

export default function App() {
  const {
    firebaseUser,
    authReady,
    firebaseProfile,
    firestoreError,
    reportFirestoreError,
    clearFirestoreError,
  } = useFirebase();

  const [user, setUser] = useState<UserProfile | null>(null);
  const [booting, setBooting] = useState(true);
  const [novels, setNovels] = useState<Novel[]>([]);
  const [activeNovelId, setActiveNovelId] = useState<string | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [exportNovel, setExportNovel] = useState<Novel | null>(null);
  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  const syncedUidRef = useRef<string | null>(null);

  // Sync system/light/dark theme
  useEffect(() => {
    const mode = user?.themePreference || 'system';
    applyThemeMode(mode);
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
    const onChange = () => {
      if (mode === 'system') applyThemeMode('system');
    };
    mq?.addEventListener?.('change', onChange);
    return () => mq?.removeEventListener?.('change', onChange);
  }, [user?.themePreference]);

  // Network connectivity listener
  useEffect(() => {
    const onOnline = () => setIsOffline(false);
    const onOffline = () => setIsOffline(true);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  const refreshNovels = useCallback(async () => {
    try {
      const res = await api.listNovels();
      setNovels(res.novels);
      await offlineDb.cacheNovels(res.novels);
    } catch {
      const cached = await offlineDb.getCachedNovels();
      if (cached.length > 0) setNovels(cached);
    }
  }, []);

  // Boot session once Firebase auth state is ready
  useEffect(() => {
    if (!authReady) return;

    if (firebaseProfile) {
      setUser(firebaseProfile);
      setBooting(false);
      void refreshNovels();
      return;
    }

    api
      .me()
      .then(async (res) => {
        setUser(res.user);
        await refreshNovels();
      })
      .catch(() => {
        setUser(null);
      })
      .finally(() => setBooting(false));
  }, [authReady, firebaseProfile, refreshNovels]);

  // Bidirectional initial SQLite <-> Firestore sync for verified Firebase users
  useEffect(() => {
    if (!authReady || !firebaseUser || !firebaseUser.emailVerified || !user) {
      syncedUidRef.current = null;
      return;
    }
    if (syncedUidRef.current === firebaseUser.uid) return;
    syncedUidRef.current = firebaseUser.uid;

    const uid = firebaseUser.uid;
    void (async () => {
      try {
        const [serverRes, fsNovels] = await Promise.all([
          api.listNovels().catch(() => ({ novels: [] as Novel[] })),
          firestoreStore.fetchUserNovels(uid),
        ]);
        const serverMap = new Map(serverRes.novels.map((n) => [n.id, n]));
        const fsMap = new Map(fsNovels.map((n) => [n.id, n]));

        // Hydrate novels present in Firestore but missing from local SQLite
        for (const fsNovel of fsNovels) {
          if (!serverMap.has(fsNovel.id)) {
            const bundle = await firestoreStore.fetchBundleFromFirestore(uid, fsNovel.id);
            if (bundle) {
              await api.hydrateFromFirestore({ bundle });
            } else {
              await api.hydrateFromFirestore({ novels: [fsNovel] });
            }
          }
        }

        // Push novels present in SQLite but missing from Firestore
        for (const srvNovel of serverRes.novels) {
          if (!fsMap.has(srvNovel.id)) {
            const bundle = await api.getNovelBundle(srvNovel.id);
            await firestoreStore.syncBundleToFirestore(uid, bundle);
            if (srvNovel.status === 'completed') {
              await firestoreStore.applyNovelAction(srvNovel.id, 'complete', 'completed');
            } else if (srvNovel.status === 'trashed') {
              await firestoreStore.applyNovelAction(srvNovel.id, 'trash', 'trashed');
            }
          }
        }

        await refreshNovels();
      } catch (err) {
        reportFirestoreError(err);
      }
    })();
  }, [authReady, firebaseUser, user, refreshNovels, reportFirestoreError]);

  // Real-time Firestore library subscription strictly gated behind authReady && verified firebaseUser
  useEffect(() => {
    if (!authReady || !firebaseUser || !firebaseUser.emailVerified) return;

    const unsub = firestoreStore.subscribeNovels(
      firebaseUser.uid,
      (fsNovels) => {
        if (fsNovels.length > 0) {
          setNovels((prev) => {
            const byId = new Map(prev.map((n) => [n.id, n]));
            const merged = fsNovels.map((fsN) => {
              const existing = byId.get(fsN.id);
              return existing
                ? {
                    ...fsN,
                    chapterCount: fsN.chapterCount ?? existing.chapterCount,
                    totalWordCount: fsN.totalWordCount ?? existing.totalWordCount,
                  }
                : fsN;
            });
            return merged;
          });
          void offlineDb.cacheNovels(fsNovels);
        }
      },
      (err) => {
        reportFirestoreError(err);
      }
    );

    return () => unsub();
  }, [authReady, firebaseUser, reportFirestoreError]);

  if (booting) {
    return (
      <div className="min-h-screen bg-[var(--ink-bg)] text-[var(--ink-text-muted)] flex items-center justify-center text-sm">
        Loading Inkloom...
      </div>
    );
  }

  if (!user) {
    return (
      <AuthView
        onAuthenticated={async (authedUser) => {
          setUser(authedUser);
          await refreshNovels();
        }}
      />
    );
  }

  return (
    <>
      {firestoreError && (
        <div
          role="alert"
          className="px-4 sm:px-6 py-2.5 bg-amber-500/15 border-b border-amber-500/40 text-xs flex items-center justify-between gap-3 text-[var(--ink-text)]"
        >
          <div className="flex items-center gap-2 min-w-0">
            <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
            <span className="truncate sm:whitespace-normal">{firestoreError}</span>
          </div>
          <button
            type="button"
            onClick={clearFirestoreError}
            aria-label="Dismiss Firestore notice"
            className="p-1 text-[var(--ink-text-muted)] hover:text-[var(--ink-text)] shrink-0"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {activeNovelId ? (
        <NovelWorkspace
          user={user}
          novelId={activeNovelId}
          isOffline={isOffline}
          onBackToLibrary={async () => {
            setActiveNovelId(null);
            await refreshNovels();
          }}
          onOpenSettings={() => setSettingsOpen(true)}
          onOpenExport={(novel) => setExportNovel(novel)}
          onNovelMutated={() => void refreshNovels()}
        />
      ) : (
        <LibraryView
          user={user}
          novels={novels}
          isOffline={isOffline}
          onOpenNovel={(id) => setActiveNovelId(id)}
          onOpenWizard={() => setWizardOpen(true)}
          onOpenSettings={() => setSettingsOpen(true)}
          onOpenExport={(novel) => setExportNovel(novel)}
          onUpdateNovelMeta={async (novelId, patch) => {
            await api.updateNovel(novelId, patch);
            await refreshNovels();
          }}
          onNovelAction={async (novelId, action) => {
            await api.updateNovel(novelId, { action });
            await refreshNovels();
          }}
          onDeleteNovelPermanent={async (novelId) => {
            await api.deleteNovelPermanent(novelId);
            await refreshNovels();
          }}
        />
      )}

      {wizardOpen && (
        <NovelWizardModal
          defaultAuthorName={user.name}
          onClose={() => setWizardOpen(false)}
          onCreated={async (novelId) => {
            setWizardOpen(false);
            await refreshNovels();
            setActiveNovelId(novelId);
          }}
        />
      )}

      {exportNovel && (
        <ExportModal novel={exportNovel} onClose={() => setExportNovel(null)} />
      )}

      {settingsOpen && (
        <SettingsModal
          user={user}
          onUserUpdated={(updated) => setUser(updated)}
          onLoggedOut={() => {
            setSettingsOpen(false);
            setActiveNovelId(null);
            setNovels([]);
            syncedUidRef.current = null;
            setUser(null);
          }}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </>
  );
}
