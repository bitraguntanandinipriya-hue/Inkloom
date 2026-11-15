import React, { useMemo, useState } from 'react';
import {
  BookOpen,
  CheckCircle2,
  Download,
  Edit3,
  MoreHorizontal,
  Plus,
  RotateCcw,
  Search,
  Settings,
  Trash2,
  WifiOff,
} from 'lucide-react';
import { formatRelativeDate } from '../lib/theme';
import type { Novel, UserProfile } from '../types';

interface LibraryViewProps {
  user: UserProfile;
  novels: Novel[];
  isOffline: boolean;
  onOpenNovel: (novelId: string) => void;
  onOpenWizard: () => void;
  onOpenSettings: () => void;
  onOpenExport: (novel: Novel) => void;
  onUpdateNovelMeta: (novelId: string, patch: { title: string; authorName: string; genre: string; synopsis: string }) => Promise<void>;
  onNovelAction: (novelId: string, action: 'complete' | 'reopen' | 'trash' | 'restore') => Promise<void>;
  onDeleteNovelPermanent: (novelId: string) => Promise<void>;
}

export const LibraryView: React.FC<LibraryViewProps> = ({
  user,
  novels,
  isOffline,
  onOpenNovel,
  onOpenWizard,
  onOpenSettings,
  onOpenExport,
  onUpdateNovelMeta,
  onNovelAction,
  onDeleteNovelPermanent,
}) => {
  const [tab, setTab] = useState<'active' | 'completed' | 'trash'>('active');
  const [search, setSearch] = useState('');
  const [genreFilter, setGenreFilter] = useState('All');
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [editingNovel, setEditingNovel] = useState<Novel | null>(null);
  const [confirmTrashNovel, setConfirmTrashNovel] = useState<Novel | null>(null);
  const [confirmPermanentNovel, setConfirmPermanentNovel] = useState<Novel | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Edit metadata form
  const [metaTitle, setMetaTitle] = useState('');
  const [metaAuthor, setMetaAuthor] = useState('');
  const [metaGenre, setMetaGenre] = useState('');
  const [metaSynopsis, setMetaSynopsis] = useState('');

  const genres = useMemo(() => {
    const set = new Set<string>(['All']);
    for (const n of novels) {
      if (n.genre) set.add(n.genre);
    }
    return Array.from(set);
  }, [novels]);

  const filteredNovels = useMemo(() => {
    const q = search.trim().toLowerCase();
    return novels.filter((n) => {
      if (tab === 'active' && n.status !== 'active') return false;
      if (tab === 'completed' && n.status !== 'completed') return false;
      if (tab === 'trash' && n.status !== 'trashed') return false;
      if (genreFilter !== 'All' && n.genre !== genreFilter) return false;
      if (
        q &&
        !n.title.toLowerCase().includes(q) &&
        !n.genre.toLowerCase().includes(q) &&
        !n.synopsis.toLowerCase().includes(q)
      ) {
        return false;
      }
      return true;
    });
  }, [novels, tab, genreFilter, search]);

  const openEditModal = (novel: Novel) => {
    setMenuOpenId(null);
    setEditingNovel(novel);
    setMetaTitle(novel.title);
    setMetaAuthor(novel.authorName);
    setMetaGenre(novel.genre);
    setMetaSynopsis(novel.synopsis);
  };

  const handleSaveMeta = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingNovel) return;
    setBusyId(editingNovel.id);
    try {
      await onUpdateNovelMeta(editingNovel.id, {
        title: metaTitle,
        authorName: metaAuthor,
        genre: metaGenre,
        synopsis: metaSynopsis,
      });
      setEditingNovel(null);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="min-h-screen bg-[var(--ink-bg)] text-[var(--ink-text)]">
      {/* Strict 3-Zone Editorial Top Bar */}
      <header className="sticky top-0 z-20 bg-[var(--ink-bg)]/95 backdrop-blur border-b border-[var(--ink-border)]">
        <div className="max-w-7xl mx-auto px-4 sm:px-8 h-16 flex items-center justify-between gap-8">
          <div className="flex items-center gap-2.5 whitespace-nowrap shrink-0">
            <BookOpen className="w-5 h-5 text-[var(--ink-accent)]" />
            <span className="text-lg font-semibold tracking-tight">Inkloom</span>
          </div>

          <nav className="flex items-center gap-6 text-sm overflow-x-auto">
            <button
              type="button"
              onClick={() => setTab('active')}
              className={`py-1 border-b-2 transition-colors whitespace-nowrap shrink-0 ${
                tab === 'active'
                  ? 'border-[var(--ink-accent)] text-[var(--ink-text)] font-medium'
                  : 'border-transparent text-[var(--ink-text-muted)] hover:text-[var(--ink-text)]'
              }`}
            >
              Active Novels
            </button>
            <button
              type="button"
              onClick={() => setTab('completed')}
              className={`py-1 border-b-2 transition-colors whitespace-nowrap shrink-0 ${
                tab === 'completed'
                  ? 'border-[var(--ink-accent)] text-[var(--ink-text)] font-medium'
                  : 'border-transparent text-[var(--ink-text-muted)] hover:text-[var(--ink-text)]'
              }`}
            >
              Completed Archive
            </button>
            <button
              type="button"
              onClick={() => setTab('trash')}
              className={`py-1 border-b-2 transition-colors whitespace-nowrap shrink-0 ${
                tab === 'trash'
                  ? 'border-[var(--ink-accent)] text-[var(--ink-text)] font-medium'
                  : 'border-transparent text-[var(--ink-text-muted)] hover:text-[var(--ink-text)]'
              }`}
            >
              Trash
            </button>
            <button
              type="button"
              onClick={onOpenSettings}
              className="py-1 border-b-2 border-transparent text-[var(--ink-text-muted)] hover:text-[var(--ink-text)] transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0"
            >
              <Settings className="w-4 h-4" />
              <span>Settings</span>
            </button>
          </nav>

          <div className="flex items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={onOpenWizard}
              disabled={isOffline}
              className="py-2 px-4 rounded-lg bg-[var(--ink-accent)] hover:bg-[var(--ink-accent-hover)] text-white text-sm font-medium transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 disabled:opacity-50"
            >
              <Plus className="w-4 h-4" />
              <span>New Novel</span>
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-8 py-10">
        {isOffline && (
          <div className="mb-6 p-3.5 rounded-lg border border-[var(--ink-border)] bg-[var(--ink-surface)] flex items-center gap-3 text-sm">
            <WifiOff className="w-4 h-4 text-[var(--ink-accent)] shrink-0" />
            <span>
              You are offline. Cached novels and chapters can still be opened and edited locally; live AI generation requires connectivity.
            </span>
          </div>
        )}

        {/* Section Header + Search / Genre Filters */}
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 mb-8">
          <div>
            <p className="text-xs text-[var(--ink-text-muted)] mb-1">
              {user.name} · Manuscript Library
            </p>
            <h1 className="font-lora text-2xl sm:text-3xl font-semibold tracking-tight">
              {tab === 'active'
                ? 'Active Novels'
                : tab === 'completed'
                  ? 'Completed Archive'
                  : 'Trash'}
            </h1>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="relative">
              <Search className="w-4 h-4 text-[var(--ink-text-muted)] absolute left-3 top-2.5" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search title or synopsis..."
                className="pl-9 pr-3.5 py-2 w-60 rounded-lg bg-[var(--ink-surface)] border border-[var(--ink-border)] text-sm focus:outline-none focus:border-[var(--ink-accent)]"
              />
            </div>

            <select
              value={genreFilter}
              onChange={(e) => setGenreFilter(e.target.value)}
              className="px-3 py-2 rounded-lg bg-[var(--ink-surface)] border border-[var(--ink-border)] text-sm focus:outline-none focus:border-[var(--ink-accent)]"
            >
              {genres.map((g) => (
                <option key={g} value={g}>
                  {g === 'All' ? 'All Genres' : g}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Empty State */}
        {filteredNovels.length === 0 ? (
          <div className="py-16 px-6 rounded-xl border border-dashed border-[var(--ink-border)] bg-[var(--ink-surface)] text-center max-w-xl mx-auto">
            <BookOpen className="w-8 h-8 text-[var(--ink-accent)] mx-auto mb-3" />
            <h2 className="font-lora text-xl font-semibold mb-2">
              {tab === 'active'
                ? 'No active novels yet'
                : tab === 'completed'
                  ? 'No completed novels in archive'
                  : 'Trash is empty'}
            </h2>
            <p className="text-sm text-[var(--ink-text-muted)] mb-6 leading-relaxed">
              {tab === 'active'
                ? 'Create your first novel with the guided Story DNA, lead character, and supporting cast wizard.'
                : tab === 'completed'
                  ? 'When you finish a manuscript and mark it Complete, it moves here in protected read-only reading mode.'
                  : 'Deleted novels stay recoverable here until you restore or permanently remove them.'}
            </p>
            {tab === 'active' && (
              <button
                type="button"
                onClick={onOpenWizard}
                disabled={isOffline}
                className="py-2.5 px-5 rounded-lg bg-[var(--ink-accent)] hover:bg-[var(--ink-accent-hover)] text-white text-sm font-medium inline-flex items-center gap-2"
              >
                <Plus className="w-4 h-4" />
                <span>Create New Novel</span>
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredNovels.map((novel) => (
              <article
                key={novel.id}
                className="rounded-xl border border-[var(--ink-border)] bg-[var(--ink-surface)] flex flex-col overflow-hidden transition-colors hover:border-[var(--ink-accent)]/60"
              >
                {/* Cover Area (Author-uploaded image or clean editorial typographic spine) */}
                <button
                  type="button"
                  onClick={() => tab !== 'trash' && onOpenNovel(novel.id)}
                  disabled={tab === 'trash'}
                  className="text-left group relative h-44 w-full bg-[var(--ink-surface-elevated)] border-b border-[var(--ink-border)] overflow-hidden"
                >
                  {novel.coverImageId ? (
                    <img
                      src={`/api/images/${novel.coverImageId}/file`}
                      alt={`Cover for ${novel.title}`}
                      referrerPolicy="no-referrer"
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full p-6 flex flex-col justify-between">
                      <span className="text-xs text-[var(--ink-text-muted)]">{novel.genre}</span>
                      <div>
                        <p className="font-lora text-xl font-semibold line-clamp-2 leading-snug">
                          {novel.title}
                        </p>
                        {novel.authorName && (
                          <p className="text-xs text-[var(--ink-text-muted)] mt-1">
                            by {novel.authorName}
                          </p>
                        )}
                      </div>
                    </div>
                  )}
                </button>

                {/* Card Body */}
                <div className="p-5 flex-1 flex flex-col justify-between gap-4">
                  <div>
                    <div className="flex items-start justify-between gap-3">
                      <button
                        type="button"
                        onClick={() => tab !== 'trash' && onOpenNovel(novel.id)}
                        disabled={tab === 'trash'}
                        className="text-left font-lora text-lg font-semibold leading-snug hover:text-[var(--ink-accent)] transition-colors line-clamp-1"
                      >
                        {novel.title}
                      </button>

                      <div className="relative shrink-0">
                        <button
                          type="button"
                          onClick={() => setMenuOpenId(menuOpenId === novel.id ? null : novel.id)}
                          aria-label={`Actions for ${novel.title}`}
                          className="p-1.5 rounded-md text-[var(--ink-text-muted)] hover:text-[var(--ink-text)] hover:bg-[var(--ink-surface-elevated)]"
                        >
                          <MoreHorizontal className="w-4 h-4" />
                        </button>

                        {menuOpenId === novel.id && (
                          <div className="absolute right-0 mt-1 w-48 rounded-lg border border-[var(--ink-border)] bg-[var(--ink-surface)] shadow-lg py-1.5 z-30 text-sm">
                            {tab !== 'trash' ? (
                              <>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setMenuOpenId(null);
                                    onOpenNovel(novel.id);
                                  }}
                                  className="w-full text-left px-3.5 py-2 hover:bg-[var(--ink-surface-elevated)] flex items-center gap-2"
                                >
                                  <BookOpen className="w-4 h-4 text-[var(--ink-text-muted)]" />
                                  <span>Open Studio</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => openEditModal(novel)}
                                  className="w-full text-left px-3.5 py-2 hover:bg-[var(--ink-surface-elevated)] flex items-center gap-2"
                                >
                                  <Edit3 className="w-4 h-4 text-[var(--ink-text-muted)]" />
                                  <span>Edit Metadata</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setMenuOpenId(null);
                                    onOpenExport(novel);
                                  }}
                                  className="w-full text-left px-3.5 py-2 hover:bg-[var(--ink-surface-elevated)] flex items-center gap-2"
                                >
                                  <Download className="w-4 h-4 text-[var(--ink-text-muted)]" />
                                  <span>Export Manuscript</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={async () => {
                                    setMenuOpenId(null);
                                    await onNovelAction(
                                      novel.id,
                                      novel.status === 'completed' ? 'reopen' : 'complete'
                                    );
                                  }}
                                  className="w-full text-left px-3.5 py-2 hover:bg-[var(--ink-surface-elevated)] flex items-center gap-2"
                                >
                                  {novel.status === 'completed' ? (
                                    <RotateCcw className="w-4 h-4 text-[var(--ink-text-muted)]" />
                                  ) : (
                                    <CheckCircle2 className="w-4 h-4 text-[var(--ink-text-muted)]" />
                                  )}
                                  <span>
                                    {novel.status === 'completed'
                                      ? 'Reopen Novel'
                                      : 'Mark Complete'}
                                  </span>
                                </button>
                                <div className="my-1 border-t border-[var(--ink-border)]" />
                                <button
                                  type="button"
                                  onClick={() => {
                                    setMenuOpenId(null);
                                    setConfirmTrashNovel(novel);
                                  }}
                                  className="w-full text-left px-3.5 py-2 hover:bg-red-500/10 text-red-600 dark:text-red-400 flex items-center gap-2"
                                >
                                  <Trash2 className="w-4 h-4" />
                                  <span>Move to Trash</span>
                                </button>
                              </>
                            ) : (
                              <>
                                <button
                                  type="button"
                                  onClick={async () => {
                                    setMenuOpenId(null);
                                    await onNovelAction(novel.id, 'restore');
                                  }}
                                  className="w-full text-left px-3.5 py-2 hover:bg-[var(--ink-surface-elevated)] flex items-center gap-2"
                                >
                                  <RotateCcw className="w-4 h-4" />
                                  <span>Restore Novel</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setMenuOpenId(null);
                                    setConfirmPermanentNovel(novel);
                                  }}
                                  className="w-full text-left px-3.5 py-2 hover:bg-red-500/10 text-red-600 dark:text-red-400 flex items-center gap-2"
                                >
                                  <Trash2 className="w-4 h-4" />
                                  <span>Delete Permanently</span>
                                </button>
                              </>
                            )}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Clean Unboxed Metadata */}
                    <p className="text-xs text-[var(--ink-text-muted)] mt-1.5 font-mono-tabular">
                      {novel.genre} · {novel.chapterCount ?? 0} chapters ·{' '}
                      {(novel.totalWordCount ?? 0).toLocaleString()} words · Edited{' '}
                      {formatRelativeDate(novel.updatedAt)}
                    </p>

                    {novel.synopsis && (
                      <p className="text-sm text-[var(--ink-text-muted)] mt-3 line-clamp-2 leading-relaxed">
                        {novel.synopsis}
                      </p>
                    )}
                  </div>

                  <div className="pt-3 border-t border-[var(--ink-border)] flex items-center justify-between gap-3">
                    {tab === 'trash' ? (
                      <>
                        <button
                          type="button"
                          onClick={() => onNovelAction(novel.id, 'restore')}
                          className="text-xs font-medium text-[var(--ink-accent)] hover:underline whitespace-nowrap"
                        >
                          Restore Novel
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmPermanentNovel(novel)}
                          className="text-xs font-medium text-red-600 dark:text-red-400 hover:underline whitespace-nowrap"
                        >
                          Delete Permanently
                        </button>
                      </>
                    ) : (
                      <>
                        <span className="text-xs text-[var(--ink-text-muted)]">
                          {novel.status === 'completed' ? 'Completed · Read-Only' : 'In Progress'}
                        </span>
                        <button
                          type="button"
                          onClick={() => onOpenNovel(novel.id)}
                          className="text-xs font-medium text-[var(--ink-accent)] hover:underline whitespace-nowrap"
                        >
                          {novel.status === 'completed' ? 'Read Manuscript' : 'Open Studio'}
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </main>

      {/* Edit Metadata Modal */}
      {editingNovel && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="w-full max-w-lg rounded-xl border border-[var(--ink-border)] bg-[var(--ink-surface)] p-6">
            <h2 className="text-lg font-semibold mb-4">Edit Novel Metadata</h2>
            <form onSubmit={handleSaveMeta} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-[var(--ink-text-muted)] mb-1">
                  Title
                </label>
                <input
                  type="text"
                  required
                  value={metaTitle}
                  onChange={(e) => setMetaTitle(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-[var(--ink-bg)] border border-[var(--ink-border)] text-sm"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-[var(--ink-text-muted)] mb-1">
                    Author Name
                  </label>
                  <input
                    type="text"
                    value={metaAuthor}
                    onChange={(e) => setMetaAuthor(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-[var(--ink-bg)] border border-[var(--ink-border)] text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[var(--ink-text-muted)] mb-1">
                    Genre
                  </label>
                  <input
                    type="text"
                    value={metaGenre}
                    onChange={(e) => setMetaGenre(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-[var(--ink-bg)] border border-[var(--ink-border)] text-sm"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-[var(--ink-text-muted)] mb-1">
                  Synopsis
                </label>
                <textarea
                  rows={4}
                  value={metaSynopsis}
                  onChange={(e) => setMetaSynopsis(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-[var(--ink-bg)] border border-[var(--ink-border)] text-sm"
                />
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setEditingNovel(null)}
                  className="px-4 py-2 rounded-lg border border-[var(--ink-border)] text-sm"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={busyId === editingNovel.id}
                  className="px-4 py-2 rounded-lg bg-[var(--ink-accent)] text-white text-sm font-medium"
                >
                  Save Changes
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Confirm Move to Trash */}
      {confirmTrashNovel && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-xl border border-[var(--ink-border)] bg-[var(--ink-surface)] p-6">
            <h2 className="text-lg font-semibold mb-2">Move novel to Trash?</h2>
            <p className="text-sm text-[var(--ink-text-muted)] mb-5">
              "{confirmTrashNovel.title}" will be moved to Trash. You can restore it anytime from the Trash tab. Unrelated novels will not be affected.
            </p>
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setConfirmTrashNovel(null)}
                className="px-4 py-2 rounded-lg border border-[var(--ink-border)] text-sm"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={async () => {
                  const target = confirmTrashNovel;
                  setConfirmTrashNovel(null);
                  await onNovelAction(target.id, 'trash');
                }}
                className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white text-sm font-medium"
              >
                Move to Trash
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirm Permanent Delete */}
      {confirmPermanentNovel && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-xl border border-[var(--ink-border)] bg-[var(--ink-surface)] p-6">
            <h2 className="text-lg font-semibold mb-2">Permanently delete novel?</h2>
            <p className="text-sm text-[var(--ink-text-muted)] mb-5">
              This will permanently erase "{confirmPermanentNovel.title}", its chapters, Story Bible, and uploaded images. This cannot be undone.
            </p>
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setConfirmPermanentNovel(null)}
                className="px-4 py-2 rounded-lg border border-[var(--ink-border)] text-sm"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={async () => {
                  const target = confirmPermanentNovel;
                  setConfirmPermanentNovel(null);
                  await onDeleteNovelPermanent(target.id);
                }}
                className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white text-sm font-medium"
              >
                Delete Permanently
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
