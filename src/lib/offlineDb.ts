import type { Chapter, Novel } from '../types';

const DB_NAME = 'inkloom_offline_db';
const DB_VERSION = 1;

interface OfflineChapterRecord extends Chapter {
  syncState: 'synced' | 'pending' | 'conflict';
  localSavedAt: string;
}

interface DraftRecoveryRecord {
  chapterId: string;
  novelId: string;
  title: string;
  content: string;
  prompt: string;
  timelineAnchor: string;
  locationAnchor: string;
  savedAt: string;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('novels')) {
        db.createObjectStore('novels', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('chapters')) {
        const store = db.createObjectStore('chapters', { keyPath: 'id' });
        store.createIndex('novelId', 'novelId', { unique: false });
        store.createIndex('syncState', 'syncState', { unique: false });
      }
      if (!db.objectStoreNames.contains('draftRecovery')) {
        db.createObjectStore('draftRecovery', { keyPath: 'chapterId' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export const offlineDb = {
  async cacheNovels(novels: Novel[]) {
    try {
      const db = await openDb();
      const tx = db.transaction('novels', 'readwrite');
      const store = tx.objectStore('novels');
      for (const n of novels) store.put(n);
    } catch {
      // IndexedDB unavailable in private mode
    }
  },

  async getCachedNovels(): Promise<Novel[]> {
    try {
      const db = await openDb();
      return await new Promise((resolve) => {
        const tx = db.transaction('novels', 'readonly');
        const req = tx.objectStore('novels').getAll();
        req.onsuccess = () => resolve((req.result as Novel[]) || []);
        req.onerror = () => resolve([]);
      });
    } catch {
      return [];
    }
  },

  async saveChapterLocal(chapter: Chapter, syncState: 'synced' | 'pending' | 'conflict') {
    try {
      const db = await openDb();
      const tx = db.transaction('chapters', 'readwrite');
      const store = tx.objectStore('chapters');
      const existing = await new Promise<OfflineChapterRecord | undefined>((resolve) => {
        const getReq = store.get(chapter.id);
        getReq.onsuccess = () => resolve(getReq.result as OfflineChapterRecord | undefined);
        getReq.onerror = () => resolve(undefined);
      });

      // Never overwrite newer unsynced local edits with older server data
      if (
        syncState === 'synced' &&
        existing &&
        existing.syncState === 'pending' &&
        new Date(existing.clientUpdatedAt).getTime() > new Date(chapter.clientUpdatedAt).getTime()
      ) {
        return;
      }

      const record: OfflineChapterRecord = {
        ...chapter,
        syncState,
        localSavedAt: new Date().toISOString(),
      };
      store.put(record);
    } catch {
      // ignore
    }
  },

  async getChaptersForNovel(novelId: string): Promise<OfflineChapterRecord[]> {
    try {
      const db = await openDb();
      return await new Promise((resolve) => {
        const tx = db.transaction('chapters', 'readonly');
        const idx = tx.objectStore('chapters').index('novelId');
        const req = idx.getAll(novelId);
        req.onsuccess = () => resolve((req.result as OfflineChapterRecord[]) || []);
        req.onerror = () => resolve([]);
      });
    } catch {
      return [];
    }
  },

  async getPendingChapters(): Promise<OfflineChapterRecord[]> {
    try {
      const db = await openDb();
      return await new Promise((resolve) => {
        const tx = db.transaction('chapters', 'readonly');
        const idx = tx.objectStore('chapters').index('syncState');
        const req = idx.getAll('pending');
        req.onsuccess = () => resolve((req.result as OfflineChapterRecord[]) || []);
        req.onerror = () => resolve([]);
      });
    } catch {
      return [];
    }
  },

  async saveDraftRecovery(rec: DraftRecoveryRecord) {
    try {
      const db = await openDb();
      const tx = db.transaction('draftRecovery', 'readwrite');
      tx.objectStore('draftRecovery').put(rec);
    } catch {
      // ignore
    }
  },

  async getDraftRecovery(chapterId: string): Promise<DraftRecoveryRecord | null> {
    try {
      const db = await openDb();
      return await new Promise((resolve) => {
        const tx = db.transaction('draftRecovery', 'readonly');
        const req = tx.objectStore('draftRecovery').get(chapterId);
        req.onsuccess = () => resolve((req.result as DraftRecoveryRecord) || null);
        req.onerror = () => resolve(null);
      });
    } catch {
      return null;
    }
  },

  async clearDraftRecovery(chapterId: string) {
    try {
      const db = await openDb();
      const tx = db.transaction('draftRecovery', 'readwrite');
      tx.objectStore('draftRecovery').delete(chapterId);
    } catch {
      // ignore
    }
  },

  async clearAll() {
    try {
      const db = await openDb();
      const tx = db.transaction(['novels', 'chapters', 'draftRecovery'], 'readwrite');
      tx.objectStore('novels').clear();
      tx.objectStore('chapters').clear();
      tx.objectStore('draftRecovery').clear();
    } catch {
      // ignore
    }
  },
};
