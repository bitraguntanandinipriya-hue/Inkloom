import React, { useState } from 'react';
import { Image as ImageIcon, Trash2, Upload } from 'lucide-react';
import { api } from '../lib/api';
import type { CharacterProfile, Novel, ReferenceImageCategory, UploadedImage } from '../types';

interface ReferenceGalleryViewProps {
  novel: Novel;
  images: UploadedImage[];
  characters: CharacterProfile[];
  isReadOnly: boolean;
  onRefresh: () => Promise<void>;
}

const CATEGORIES: Array<{ value: ReferenceImageCategory; label: string }> = [
  { value: 'location', label: 'Location' },
  { value: 'architecture', label: 'Architecture' },
  { value: 'clothing', label: 'Clothing & Wardrobe' },
  { value: 'prop', label: 'Props & Objects' },
  { value: 'other', label: 'Other Reference' },
];

export const ReferenceGalleryView: React.FC<ReferenceGalleryViewProps> = ({
  novel,
  images,
  characters,
  isReadOnly,
  onRefresh,
}) => {
  const [category, setCategory] = useState<ReferenceImageCategory>('location');
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [entityId, setEntityId] = useState('');
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filterCat, setFilterCat] = useState<string>('all');

  const coverImg = images.find((i) => i.entityType === 'cover');
  const refImages = images.filter((i) => i.entityType !== 'cover');
  const visibleRefs =
    filterCat === 'all' ? refImages : refImages.filter((i) => i.category === filterCat);

  const handleCoverUpload = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('entityType', 'cover');
      fd.append('category', 'cover');
      fd.append('title', `${novel.title} Cover`);
      await api.uploadImage(novel.id, fd);
      await onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Cover upload failed');
    } finally {
      setUploading(false);
    }
  };

  const handleReferenceUpload = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('entityType', 'reference');
      fd.append('category', category);
      fd.append('title', title.trim() || file.name);
      fd.append('notes', notes.trim());
      if (entityId) fd.append('entityId', entityId);
      await api.uploadImage(novel.id, fd);
      setTitle('');
      setNotes('');
      setEntityId('');
      await onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-8 py-8 space-y-8">
      <div>
        <h2 className="font-lora text-2xl font-semibold">Author Visual References & Cover</h2>
        <p className="text-sm text-[var(--ink-text-muted)] mt-1">
          Only author-uploaded JPEG, PNG, and WebP images are stored. Inkloom never generates or alters artwork. Reference images are never sent to AI models unless you explicitly opt in for a vision-capable model.
        </p>
      </div>

      {error && (
        <div className="p-3.5 rounded-lg border border-red-500/40 bg-red-500/10 text-sm text-red-600 dark:text-red-300">
          {error}
        </div>
      )}

      {/* Novel Cover Card */}
      <section className="p-5 rounded-xl border border-[var(--ink-border)] bg-[var(--ink-surface)] flex flex-col sm:flex-row gap-6 items-start">
        <div className="w-36 h-48 rounded-lg border border-[var(--ink-border)] bg-[var(--ink-bg)] overflow-hidden shrink-0 flex items-center justify-center">
          {coverImg ? (
            <img
              src={coverImg.url}
              alt={`${novel.title} cover`}
              referrerPolicy="no-referrer"
              className="w-full h-full object-cover"
            />
          ) : (
            <ImageIcon className="w-6 h-6 text-[var(--ink-text-muted)]" />
          )}
        </div>
        <div className="space-y-3">
          <div>
            <h3 className="font-lora text-lg font-semibold">Novel Cover Image</h3>
            <p className="text-xs text-[var(--ink-text-muted)] mt-1">
              Displayed on your library card and manuscript header.
            </p>
          </div>
          {!isReadOnly && (
            <div className="flex flex-wrap items-center gap-3">
              <label className="px-4 py-2 rounded-lg bg-[var(--ink-accent)] text-white text-xs font-medium cursor-pointer inline-flex items-center gap-1.5">
                <Upload className="w-3.5 h-3.5" />
                <span>{coverImg ? 'Replace Cover' : 'Upload Cover'}</span>
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="hidden"
                  disabled={uploading}
                  onChange={(e) => handleCoverUpload(e.target.files?.[0])}
                />
              </label>
              {coverImg && (
                <button
                  type="button"
                  onClick={async () => {
                    await api.deleteImage(coverImg.id);
                    await onRefresh();
                  }}
                  className="px-3 py-2 rounded-lg border border-[var(--ink-border)] text-xs text-red-600 dark:text-red-400"
                >
                  Delete Cover
                </button>
              )}
            </div>
          )}
        </div>
      </section>

      {/* Upload Reference Form */}
      {!isReadOnly && (
        <section className="p-5 rounded-xl border border-[var(--ink-border)] bg-[var(--ink-surface)] space-y-4">
          <h3 className="text-sm font-semibold">Add Reference Image</h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as ReferenceImageCategory)}
              className="px-3 py-2 rounded-lg bg-[var(--ink-bg)] border border-[var(--ink-border)] text-sm"
            >
              {CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Title (e.g., Ravenswood Courtyard)"
              className="px-3 py-2 rounded-lg bg-[var(--ink-bg)] border border-[var(--ink-border)] text-sm"
            />
            <select
              value={entityId}
              onChange={(e) => setEntityId(e.target.value)}
              className="px-3 py-2 rounded-lg bg-[var(--ink-bg)] border border-[var(--ink-border)] text-sm"
            >
              <option value="">Associate with character (optional)</option>
              {characters.map((ch) => (
                <option key={ch.id} value={ch.id}>
                  {ch.name}
                </option>
              ))}
            </select>
          </div>
          <textarea
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Written visual description & notes (used automatically for text-only AI models)..."
            className="w-full px-3 py-2 rounded-lg bg-[var(--ink-bg)] border border-[var(--ink-border)] text-sm"
          />
          <div>
            <label className="px-4 py-2 rounded-lg border border-[var(--ink-border)] hover:border-[var(--ink-accent)] text-sm font-medium cursor-pointer inline-flex items-center gap-2">
              <Upload className="w-4 h-4 text-[var(--ink-accent)]" />
              <span>{uploading ? 'Uploading...' : 'Select JPEG, PNG, or WebP File'}</span>
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                disabled={uploading}
                onChange={(e) => handleReferenceUpload(e.target.files?.[0])}
              />
            </label>
          </div>
        </section>
      )}

      {/* Filter & Grid */}
      <div className="space-y-4">
        <div className="flex items-center gap-2 overflow-x-auto text-xs">
          {[
            ['all', 'All References'],
            ['character', 'Characters'],
            ['location', 'Locations'],
            ['architecture', 'Architecture'],
            ['clothing', 'Clothing'],
            ['prop', 'Props & Objects'],
          ].map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setFilterCat(key)}
              className={`px-3 py-1.5 rounded-lg border transition-colors whitespace-nowrap ${
                filterCat === key
                  ? 'border-[var(--ink-accent)] bg-[var(--ink-accent)]/10 text-[var(--ink-text)] font-medium'
                  : 'border-[var(--ink-border)] text-[var(--ink-text-muted)]'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {visibleRefs.length === 0 ? (
          <p className="text-sm text-[var(--ink-text-muted)] py-10 text-center border border-dashed border-[var(--ink-border)] rounded-xl">
            No reference images uploaded in this category yet.
          </p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {visibleRefs.map((img) => {
              const linkedChar = characters.find((c) => c.id === img.entityId);
              return (
                <div
                  key={img.id}
                  className="rounded-xl border border-[var(--ink-border)] bg-[var(--ink-surface)] overflow-hidden flex flex-col"
                >
                  <div className="h-48 bg-[var(--ink-bg)] border-b border-[var(--ink-border)]">
                    <img
                      src={img.url}
                      alt={img.title}
                      referrerPolicy="no-referrer"
                      className="w-full h-full object-cover"
                    />
                  </div>
                  <div className="p-4 flex-1 flex flex-col justify-between gap-2">
                    <div>
                      <div className="flex items-start justify-between gap-2">
                        <h4 className="font-medium text-sm">{img.title}</h4>
                        {!isReadOnly && (
                          <button
                            type="button"
                            onClick={async () => {
                              await api.deleteImage(img.id);
                              await onRefresh();
                            }}
                            className="p-1 text-[var(--ink-text-muted)] hover:text-red-500"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                      <p className="text-xs text-[var(--ink-text-muted)] mt-0.5">
                        {img.category}
                        {linkedChar ? ` · Linked to ${linkedChar.name}` : ''}
                      </p>
                      {img.notes && (
                        <p className="text-xs text-[var(--ink-text-muted)] mt-2 leading-relaxed">
                          {img.notes}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
