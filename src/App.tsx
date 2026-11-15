import { useCallback, useEffect, useState } from 'react';
import { AuthView } from './components/AuthView';
import { ExportModal } from './components/ExportModal';
import { LibraryView } from './components/LibraryView';
import { NovelWizardModal } from './components/NovelWizardModal';
import { NovelWorkspace } from './components/NovelWorkspace';
import { SettingsModal } from './components/SettingsModal';
import { api } from './lib/api';
import { offlineDb } from './lib/offlineDb';
import { applyThemeMode } from './lib/theme';
import type { Novel, UserProfile } from './types';

export default function App() {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [booting, setBooting] = useState(true);
  const [novels, setNovels] = useState<Novel[]>([]);
  const [activeNovelId, setActiveNovelId] = useState<string | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [exportNovel, setExportNovel] = useState<Novel | null>(null);
  const [isOffline, setIsOffline] = useState(!navigator.onLine);

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

  // Boot session
  useEffect(() => {
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
  }, [refreshNovels]);

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
            setUser(null);
          }}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </>
  );
}
