import React, { useState } from 'react';
import { Download, FileText, Share2, X } from 'lucide-react';
import type { Novel } from '../types';

interface ExportModalProps {
  novel: Novel;
  onClose: () => void;
}

export const ExportModal: React.FC<ExportModalProps> = ({ novel, onClose }) => {
  const [includeStoryBible, setIncludeStoryBible] = useState(false);
  const [downloading, setDownloading] = useState<'docx' | 'txt' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleDownload = async (format: 'docx' | 'txt', share = false) => {
    setDownloading(format);
    setError(null);
    try {
      const url = `/api/novels/${novel.id}/export/${format}?includeStoryBible=${includeStoryBible}`;
      const resp = await fetch(url, { credentials: 'include' });
      if (!resp.ok) {
        throw new Error('Export failed.');
      }
      const blob = await resp.blob();
      const ext = format;
      const safeName =
        novel.title.replace(/[^a-z0-9\-_]+/gi, '_').replace(/^_+|_+$/g, '') || 'novel';
      const filename = `${safeName}.${ext}`;

      if (share && navigator.share && navigator.canShare) {
        const file = new File([blob], filename, { type: blob.type });
        if (navigator.canShare({ files: [file] })) {
          await navigator.share({
            title: novel.title,
            text: `Manuscript export: ${novel.title}`,
            files: [file],
          });
          return;
        }
      }

      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objectUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setDownloading(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/55 flex items-center justify-center p-4">
      <div className="w-full max-w-md rounded-xl border border-[var(--ink-border)] bg-[var(--ink-surface)] p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-lora text-xl font-semibold">Export Manuscript</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close export modal"
            className="p-1.5 text-[var(--ink-text-muted)] hover:text-[var(--ink-text)]"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <p className="text-sm text-[var(--ink-text-muted)] mb-5">
          Export "{novel.title}" as a clean publication manuscript. AI prompts, summaries, scratchpad notes, and internal metadata are excluded by default.
        </p>

        {error && (
          <div className="mb-4 p-3 rounded-lg border border-red-500/40 bg-red-500/10 text-sm text-red-600 dark:text-red-300">
            {error}
          </div>
        )}

        <label className="flex items-start gap-2.5 p-3.5 rounded-lg border border-[var(--ink-border)] bg-[var(--ink-bg)] text-sm cursor-pointer mb-5">
          <input
            type="checkbox"
            checked={includeStoryBible}
            onChange={(e) => setIncludeStoryBible(e.target.checked)}
            className="mt-0.5"
          />
          <div>
            <span className="font-medium block">Include Story Bible appendix</span>
            <span className="text-xs text-[var(--ink-text-muted)]">
              Optional: appends character profiles and pinned canon after the manuscript.
            </span>
          </div>
        </label>

        <div className="space-y-2.5">
          <button
            type="button"
            disabled={downloading !== null}
            onClick={() => handleDownload('docx')}
            className="w-full py-2.5 px-4 rounded-lg bg-[var(--ink-accent)] hover:bg-[var(--ink-accent-hover)] text-white text-sm font-medium flex items-center justify-center gap-2 disabled:opacity-60"
          >
            <Download className="w-4 h-4" />
            <span>
              {downloading === 'docx'
                ? 'Preparing Word Document...'
                : 'Download DOCX (Title Page & Serif Formatting)'}
            </span>
          </button>

          <button
            type="button"
            disabled={downloading !== null}
            onClick={() => handleDownload('txt')}
            className="w-full py-2.5 px-4 rounded-lg border border-[var(--ink-border)] hover:border-[var(--ink-accent)] text-sm font-medium flex items-center justify-center gap-2 disabled:opacity-60"
          >
            <FileText className="w-4 h-4" />
            <span>{downloading === 'txt' ? 'Preparing Text File...' : 'Download Plain TXT'}</span>
          </button>

          {typeof navigator !== 'undefined' && 'share' in navigator && (
            <button
              type="button"
              disabled={downloading !== null}
              onClick={() => handleDownload('docx', true)}
              className="w-full py-2 px-4 rounded-lg text-xs text-[var(--ink-text-muted)] hover:text-[var(--ink-text)] flex items-center justify-center gap-1.5"
            >
              <Share2 className="w-3.5 h-3.5" />
              <span>Share DOCX via System Share Sheet</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
