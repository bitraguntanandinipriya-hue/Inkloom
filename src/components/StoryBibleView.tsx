import React, { useState } from 'react';
import {
  AlertCircle,
  Check,
  Edit3,
  Pin,
  Plus,
  RefreshCw,
  Send,
  Trash2,
  Upload,
  UserPlus,
  X,
} from 'lucide-react';
import { api } from '../lib/api';
import type {
  BackgroundJob,
  CanonFact,
  Chapter,
  ChapterSummary,
  CharacterProfile,
  CharacterStateProposal,
  CharacterStatus,
  Novel,
  ScratchpadNote,
} from '../types';

interface StoryBibleViewProps {
  novel: Novel;
  characters: CharacterProfile[];
  chapters: Chapter[];
  canonFacts: CanonFact[];
  summaries: ChapterSummary[];
  stateProposals: CharacterStateProposal[];
  scratchpadNotes: ScratchpadNote[];
  jobs: BackgroundJob[];
  isReadOnly: boolean;
  onRefresh: () => Promise<void>;
  onInsertScratchpadToPrompt: (text: string) => void;
}

const CHAR_STATUSES: CharacterStatus[] = [
  'Active',
  'Injured',
  'Missing',
  'Estranged',
  'Deceased',
  'Custom',
];

export const StoryBibleView: React.FC<StoryBibleViewProps> = ({
  novel,
  characters,
  chapters,
  canonFacts,
  summaries,
  stateProposals,
  scratchpadNotes,
  jobs,
  isReadOnly,
  onRefresh,
  onInsertScratchpadToPrompt,
}) => {
  const [section, setSection] = useState<'cast' | 'canon' | 'summaries' | 'scratchpad'>('cast');
  const [error, setError] = useState<string | null>(null);

  // Character Editor Modal
  const [editingChar, setEditingChar] = useState<Partial<CharacterProfile> | null>(null);
  const [charBusy, setCharBusy] = useState(false);

  // Canon forms
  const [newFactText, setNewFactText] = useState('');
  const [newFactCat, setNewFactCat] = useState('Plot');
  const [editingFactId, setEditingFactId] = useState<string | null>(null);
  const [editingFactText, setEditingFactText] = useState('');

  // Summaries
  const [summarizingChapterId, setSummarizingChapterId] = useState<string | null>(null);
  const [editingSummaryId, setEditingSummaryId] = useState<string | null>(null);
  const [editingSummaryText, setEditingSummaryText] = useState('');

  // Scratchpad
  const [noteTitle, setNoteTitle] = useState('');
  const [noteCategory, setNoteCategory] = useState('Scene Idea');
  const [noteContent, setNoteContent] = useState('');

  const pendingCanon = canonFacts.filter((f) => f.approvalStatus === 'pending');
  const pinnedCanon = canonFacts.filter((f) => f.isPinned && f.approvalStatus === 'pinned');
  const leads = characters.filter((c) => c.roleType !== 'supporting');
  const supporting = characters.filter((c) => c.roleType === 'supporting');

  const handleUploadCharImage = async (characterId: string, file: File | undefined) => {
    if (!file) return;
    setError(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('entityType', 'character');
      fd.append('entityId', characterId);
      fd.append('category', 'character');
      fd.append('title', 'Character Portrait');
      await api.uploadImage(novel.id, fd);
      await onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Image upload failed');
    }
  };

  const handleSaveCharacter = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingChar || !editingChar.name?.trim()) return;
    setCharBusy(true);
    setError(null);
    try {
      if (editingChar.id) {
        await api.updateCharacter(novel.id, editingChar.id, editingChar);
      } else {
        await api.createCharacter(novel.id, editingChar);
      }
      setEditingChar(null);
      await onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save character');
    } finally {
      setCharBusy(false);
    }
  };

  const handleAddCanon = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFactText.trim()) return;
    setError(null);
    try {
      await api.addCanonFact(novel.id, {
        factText: newFactText.trim(),
        category: newFactCat,
        isPinned: true,
      });
      setNewFactText('');
      await onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add canon fact');
    }
  };

  const handleAddScratchpad = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!noteTitle.trim() && !noteContent.trim()) return;
    await api.addScratchpadNote(novel.id, {
      title: noteTitle.trim() || 'Untitled Note',
      content: noteContent,
      category: noteCategory,
    });
    setNoteTitle('');
    setNoteContent('');
    await onRefresh();
  };

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-8 py-8">
      {/* Sub-navigation */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[var(--ink-border)] pb-4 mb-6">
        <div className="flex items-center gap-6 text-sm overflow-x-auto">
          {(
            [
              ['cast', `Cast (${characters.length})`],
              [
                'canon',
                `Pinned Canon (${pinnedCanon.length}${pendingCanon.length ? ` · ${pendingCanon.length} pending` : ''})`,
              ],
              ['summaries', `Summaries (${summaries.length}/${chapters.length})`],
              ['scratchpad', `Scratchpad (${scratchpadNotes.length})`],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setSection(key)}
              className={`pb-2 -mb-[17px] border-b-2 transition-colors whitespace-nowrap ${
                section === key
                  ? 'border-[var(--ink-accent)] text-[var(--ink-text)] font-medium'
                  : 'border-transparent text-[var(--ink-text-muted)] hover:text-[var(--ink-text)]'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="mb-5 p-3.5 rounded-lg border border-red-500/40 bg-red-500/10 text-sm text-red-600 dark:text-red-300 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* A. CAST SECTION */}
      {section === 'cast' && (
        <div className="space-y-8">
          {/* Pending Character State Change Proposals */}
          {stateProposals.length > 0 && (
            <div className="p-5 rounded-xl border border-[var(--ink-accent)]/50 bg-[var(--ink-surface)] space-y-3">
              <h3 className="text-sm font-semibold">
                Proposed Character State Changes (Awaiting Author Approval)
              </h3>
              <div className="space-y-2.5">
                {stateProposals.map((p) => (
                  <div
                    key={p.id}
                    className="p-3.5 rounded-lg border border-[var(--ink-border)] bg-[var(--ink-bg)] flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                  >
                    <div>
                      <p className="text-sm font-medium">
                        {p.characterName} → Status: {p.proposedStatus}
                        {p.proposedLocation ? ` · Location: ${p.proposedLocation}` : ''}
                      </p>
                      <p className="text-xs text-[var(--ink-text-muted)] mt-0.5">{p.reason}</p>
                    </div>
                    {!isReadOnly && (
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={async () => {
                            await api.resolveStateProposal(p.id, 'approve');
                            await onRefresh();
                          }}
                          className="px-3 py-1.5 rounded-md bg-[var(--ink-accent)] text-white text-xs font-medium"
                        >
                          Approve Change
                        </button>
                        <button
                          type="button"
                          onClick={async () => {
                            await api.resolveStateProposal(p.id, 'reject');
                            await onRefresh();
                          }}
                          className="px-3 py-1.5 rounded-md border border-[var(--ink-border)] text-xs"
                        >
                          Reject
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Primary Leads */}
          <div>
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-lora text-xl font-semibold">Primary Leads</h2>
              {!isReadOnly && (
                <button
                  type="button"
                  onClick={() =>
                    setEditingChar({
                      roleType: 'lead_custom',
                      name: '',
                      role: 'Lead',
                      status: 'Active',
                    })
                  }
                  className="text-xs font-medium text-[var(--ink-accent)] hover:underline flex items-center gap-1"
                >
                  <UserPlus className="w-3.5 h-3.5" />
                  <span>Add Lead Profile</span>
                </button>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              {leads.map((char) => (
                <div
                  key={char.id}
                  className="p-5 rounded-xl border border-[var(--ink-border)] bg-[var(--ink-surface)] flex gap-4"
                >
                  <div className="w-24 shrink-0 space-y-2">
                    <div className="w-24 h-28 rounded-lg border border-[var(--ink-border)] bg-[var(--ink-bg)] overflow-hidden flex items-center justify-center">
                      {char.imageId ? (
                        <img
                          src={`/api/images/${char.imageId}/file`}
                          alt={char.name}
                          referrerPolicy="no-referrer"
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <span className="font-lora text-2xl text-[var(--ink-text-muted)]">
                          {char.name.slice(0, 1).toUpperCase()}
                        </span>
                      )}
                    </div>
                    {!isReadOnly && (
                      <div className="flex items-center justify-between text-[11px]">
                        <label className="text-[var(--ink-accent)] hover:underline cursor-pointer">
                          {char.imageId ? 'Replace' : 'Upload'}
                          <input
                            type="file"
                            accept="image/jpeg,image/png,image/webp"
                            className="hidden"
                            onChange={(e) => handleUploadCharImage(char.id, e.target.files?.[0])}
                          />
                        </label>
                        {char.imageId && (
                          <button
                            type="button"
                            onClick={async () => {
                              await api.deleteImage(char.imageId!);
                              await onRefresh();
                            }}
                            className="text-red-600 dark:text-red-400 hover:underline"
                          >
                            Remove
                          </button>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <h3 className="font-lora text-lg font-semibold truncate">{char.name}</h3>
                        <p className="text-xs text-[var(--ink-text-muted)]">
                          {char.role || char.roleType.replace('_', ' ')}
                          {char.age ? ` · Age ${char.age}` : ''} ·{' '}
                          {char.status === 'Custom' && char.customStatus
                            ? char.customStatus
                            : char.status}
                          {char.location ? ` · ${char.location}` : ''}
                        </p>
                      </div>
                      {!isReadOnly && (
                        <button
                          type="button"
                          onClick={() => setEditingChar(char)}
                          className="p-1.5 rounded-md text-[var(--ink-text-muted)] hover:text-[var(--ink-text)]"
                          aria-label={`Edit ${char.name}`}
                        >
                          <Edit3 className="w-4 h-4" />
                        </button>
                      )}
                    </div>

                    <div className="mt-3 space-y-1.5 text-xs text-[var(--ink-text-muted)] leading-relaxed">
                      {char.personality && (
                        <p className="line-clamp-2">
                          <strong className="text-[var(--ink-text)]">Personality:</strong>{' '}
                          {char.personality}
                        </p>
                      )}
                      {char.psychologicalTraits && (
                        <p className="line-clamp-2">
                          <strong className="text-[var(--ink-text)]">Psychology:</strong>{' '}
                          {char.psychologicalTraits}
                        </p>
                      )}
                      {char.relationshipDynamics && (
                        <p className="line-clamp-2">
                          <strong className="text-[var(--ink-text)]">Dynamics:</strong>{' '}
                          {char.relationshipDynamics}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Supporting Cast */}
          <div>
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-lora text-xl font-semibold">
                Supporting Cast ({supporting.length}/30)
              </h2>
              {!isReadOnly && supporting.length < 30 && (
                <button
                  type="button"
                  onClick={() =>
                    setEditingChar({
                      roleType: 'supporting',
                      name: '',
                      role: 'Supporting',
                      status: 'Active',
                    })
                  }
                  className="px-3.5 py-2 rounded-lg bg-[var(--ink-accent)] text-white text-xs font-medium flex items-center gap-1.5"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Add Supporting Character</span>
                </button>
              )}
            </div>

            {supporting.length === 0 ? (
              <p className="text-sm text-[var(--ink-text-muted)] py-8 text-center border border-dashed border-[var(--ink-border)] rounded-xl">
                No supporting characters added yet.
              </p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {supporting.map((char) => (
                  <div
                    key={char.id}
                    className="p-4 rounded-xl border border-[var(--ink-border)] bg-[var(--ink-surface)] flex gap-3.5"
                  >
                    <label className="w-16 h-16 rounded-lg border border-[var(--ink-border)] bg-[var(--ink-bg)] shrink-0 overflow-hidden flex items-center justify-center cursor-pointer">
                      {char.imageId ? (
                        <img
                          src={`/api/images/${char.imageId}/file`}
                          alt={char.name}
                          referrerPolicy="no-referrer"
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <Upload className="w-4 h-4 text-[var(--ink-text-muted)]" />
                      )}
                      {!isReadOnly && (
                        <input
                          type="file"
                          accept="image/jpeg,image/png,image/webp"
                          className="hidden"
                          onChange={(e) => handleUploadCharImage(char.id, e.target.files?.[0])}
                        />
                      )}
                    </label>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <h4 className="font-medium text-sm truncate">{char.name}</h4>
                        {!isReadOnly && (
                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              type="button"
                              onClick={() => setEditingChar(char)}
                              className="p-1 text-[var(--ink-text-muted)] hover:text-[var(--ink-text)]"
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={async () => {
                                await api.deleteCharacter(novel.id, char.id);
                                await onRefresh();
                              }}
                              className="p-1 text-[var(--ink-text-muted)] hover:text-red-500"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        )}
                      </div>
                      <p className="text-xs text-[var(--ink-text-muted)] mt-0.5 truncate">
                        {char.archetype || char.role || 'Supporting'} ·{' '}
                        {char.status === 'Custom' && char.customStatus
                          ? char.customStatus
                          : char.status}
                      </p>
                      {char.location && (
                        <p className="text-xs text-[var(--ink-text-muted)] truncate">
                          Location: {char.location}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* B. PINNED CANON SECTION */}
      {section === 'canon' && (
        <div className="space-y-6">
          {!isReadOnly && (
            <form
              onSubmit={handleAddCanon}
              className="p-4 rounded-xl border border-[var(--ink-border)] bg-[var(--ink-surface)] flex flex-col sm:flex-row gap-3"
            >
              <select
                value={newFactCat}
                onChange={(e) => setNewFactCat(e.target.value)}
                className="px-3 py-2 rounded-lg bg-[var(--ink-bg)] border border-[var(--ink-border)] text-sm"
              >
                <option value="Plot">Plot</option>
                <option value="Relationship">Relationship</option>
                <option value="World">World</option>
                <option value="Character">Character</option>
                <option value="Timeline">Timeline</option>
                <option value="Object">Object</option>
              </select>
              <input
                type="text"
                value={newFactText}
                onChange={(e) => setNewFactText(e.target.value)}
                placeholder="Add a permanent canon fact (never violated during generation)..."
                className="flex-1 px-3.5 py-2 rounded-lg bg-[var(--ink-bg)] border border-[var(--ink-border)] text-sm"
              />
              <button
                type="submit"
                className="px-4 py-2 rounded-lg bg-[var(--ink-accent)] text-white text-sm font-medium whitespace-nowrap"
              >
                Pin to Canon
              </button>
            </form>
          )}

          {pendingCanon.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-sm font-semibold">
                Proposed Canon Facts (Requires Author Approval)
              </h3>
              {pendingCanon.map((fact) => (
                <div
                  key={fact.id}
                  className="p-4 rounded-xl border border-[var(--ink-accent)]/50 bg-[var(--ink-surface)] flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                >
                  <div className="flex-1">
                    <span className="text-xs text-[var(--ink-accent)] font-medium">
                      {fact.category}
                    </span>
                    <p className="text-sm mt-0.5">{fact.factText}</p>
                  </div>
                  {!isReadOnly && (
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={async () => {
                          await api.updateCanonFact(fact.id, {
                            approvalStatus: 'pinned',
                            isPinned: true,
                          });
                          await onRefresh();
                        }}
                        className="px-3 py-1.5 rounded-md bg-[var(--ink-accent)] text-white text-xs font-medium flex items-center gap-1"
                      >
                        <Check className="w-3.5 h-3.5" />
                        <span>Pin Canon</span>
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          await api.updateCanonFact(fact.id, {
                            approvalStatus: 'rejected',
                            isPinned: false,
                          });
                          await onRefresh();
                        }}
                        className="px-3 py-1.5 rounded-md border border-[var(--ink-border)] text-xs"
                      >
                        Reject
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          <div className="space-y-2.5">
            <h3 className="text-sm font-semibold">Pinned Canon ({pinnedCanon.length})</h3>
            {pinnedCanon.length === 0 ? (
              <p className="text-sm text-[var(--ink-text-muted)] py-8 text-center border border-dashed border-[var(--ink-border)] rounded-xl">
                No pinned canon yet. Phrases like "Remember that..." or "Keep in mind..." in your chapter prompts will also surface here for your approval.
              </p>
            ) : (
              pinnedCanon.map((fact) => (
                <div
                  key={fact.id}
                  className="p-4 rounded-xl border border-[var(--ink-border)] bg-[var(--ink-surface)] flex items-start justify-between gap-4"
                >
                  <div className="flex-1">
                    <div className="flex items-center gap-2 text-xs text-[var(--ink-text-muted)] mb-1">
                      <Pin className="w-3.5 h-3.5 text-[var(--ink-accent)]" />
                      <span>{fact.category}</span>
                    </div>
                    {editingFactId === fact.id ? (
                      <div className="flex gap-2 mt-1">
                        <input
                          type="text"
                          value={editingFactText}
                          onChange={(e) => setEditingFactText(e.target.value)}
                          className="flex-1 px-3 py-1.5 rounded-md bg-[var(--ink-bg)] border border-[var(--ink-border)] text-sm"
                        />
                        <button
                          type="button"
                          onClick={async () => {
                            await api.updateCanonFact(fact.id, { factText: editingFactText });
                            setEditingFactId(null);
                            await onRefresh();
                          }}
                          className="px-3 py-1.5 rounded-md bg-[var(--ink-accent)] text-white text-xs"
                        >
                          Save
                        </button>
                      </div>
                    ) : (
                      <p className="text-sm leading-relaxed">{fact.factText}</p>
                    )}
                  </div>
                  {!isReadOnly && (
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => {
                          setEditingFactId(fact.id);
                          setEditingFactText(fact.factText);
                        }}
                        className="p-1.5 text-[var(--ink-text-muted)] hover:text-[var(--ink-text)]"
                      >
                        <Edit3 className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          await api.deleteCanonFact(fact.id);
                          await onRefresh();
                        }}
                        className="p-1.5 text-[var(--ink-text-muted)] hover:text-red-500"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* C. CHAPTER SUMMARIES SECTION */}
      {section === 'summaries' && (
        <div className="space-y-5">
          {jobs.some((j) => j.status === 'failed') && (
            <div className="p-4 rounded-xl border border-amber-500/40 bg-amber-500/10 space-y-2">
              <p className="text-sm font-medium">Failed Background Summary Tasks</p>
              {jobs
                .filter((j) => j.status === 'failed')
                .map((j) => (
                  <div key={j.id} className="flex items-center justify-between text-xs gap-3">
                    <span className="text-[var(--ink-text-muted)] truncate">
                      {j.lastError || 'Task failed'}
                    </span>
                    <button
                      type="button"
                      onClick={async () => {
                        await api.retryJob(j.id);
                        setTimeout(onRefresh, 1500);
                      }}
                      className="px-2.5 py-1 rounded border border-[var(--ink-border)] hover:border-[var(--ink-accent)] shrink-0"
                    >
                      Retry Task
                    </button>
                  </div>
                ))}
            </div>
          )}

          {chapters.map((ch) => {
            const sum = summaries.find((s) => s.chapterId === ch.id);
            const busy = summarizingChapterId === ch.id;
            return (
              <div
                key={ch.id}
                className="p-5 rounded-xl border border-[var(--ink-border)] bg-[var(--ink-surface)] space-y-3"
              >
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <h4 className="font-lora font-semibold">
                      Chapter {ch.chapterNumber}: {ch.title}
                    </h4>
                    <p className="text-xs text-[var(--ink-text-muted)] font-mono-tabular">
                      {ch.wordCount.toLocaleString()} words ·{' '}
                      {sum?.timelineNote || ch.timelineAnchor || 'No timeline note'}
                    </p>
                  </div>
                  {!isReadOnly && ch.wordCount > 20 && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={async () => {
                        setSummarizingChapterId(ch.id);
                        setError(null);
                        try {
                          await api.summarizeChapter(ch.id);
                          await onRefresh();
                        } catch (err) {
                          setError(err instanceof Error ? err.message : 'Summary failed');
                        } finally {
                          setSummarizingChapterId(null);
                        }
                      }}
                      className="px-3 py-1.5 rounded-lg border border-[var(--ink-border)] hover:border-[var(--ink-accent)] text-xs font-medium flex items-center gap-1.5 disabled:opacity-50"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${busy ? 'animate-spin' : ''}`} />
                      <span>{sum ? 'Regenerate Summary' : 'Generate Summary'}</span>
                    </button>
                  )}
                </div>

                {sum ? (
                  editingSummaryId === sum.id ? (
                    <div className="space-y-2">
                      <textarea
                        rows={4}
                        value={editingSummaryText}
                        onChange={(e) => setEditingSummaryText(e.target.value)}
                        className="w-full px-3 py-2 rounded-lg bg-[var(--ink-bg)] border border-[var(--ink-border)] text-sm"
                      />
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={async () => {
                            await api.updateSummary(sum.id, { summaryText: editingSummaryText });
                            setEditingSummaryId(null);
                            await onRefresh();
                          }}
                          className="px-3 py-1.5 rounded bg-[var(--ink-accent)] text-white text-xs"
                        >
                          Save Summary
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingSummaryId(null)}
                          className="px-3 py-1.5 rounded border border-[var(--ink-border)] text-xs"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div>
                      <p className="text-sm leading-relaxed text-[var(--ink-text)]">
                        {sum.summaryText}
                      </p>
                      <div className="mt-2 flex items-center justify-between text-xs text-[var(--ink-text-muted)]">
                        <span>
                          {[
                            sum.characters.length ? `Cast: ${sum.characters.join(', ')}` : '',
                            sum.locations.length ? `Locations: ${sum.locations.join(', ')}` : '',
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </span>
                        {!isReadOnly && (
                          <button
                            type="button"
                            onClick={() => {
                              setEditingSummaryId(sum.id);
                              setEditingSummaryText(sum.summaryText);
                            }}
                            className="hover:underline"
                          >
                            Edit Summary
                          </button>
                        )}
                      </div>
                    </div>
                  )
                ) : (
                  <p className="text-xs text-[var(--ink-text-muted)]">
                    No summary yet. Confirming a chapter or clicking "Generate Summary" creates a ~150-word continuity summary.
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* D. SCRATCHPAD SECTION */}
      {section === 'scratchpad' && (
        <div className="space-y-6">
          {!isReadOnly && (
            <form
              onSubmit={handleAddScratchpad}
              className="p-5 rounded-xl border border-[var(--ink-border)] bg-[var(--ink-surface)] space-y-3"
            >
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <input
                  type="text"
                  value={noteTitle}
                  onChange={(e) => setNoteTitle(e.target.value)}
                  placeholder="Idea title (private — never auto-canon)"
                  className="sm:col-span-2 px-3 py-2 rounded-lg bg-[var(--ink-bg)] border border-[var(--ink-border)] text-sm"
                />
                <select
                  value={noteCategory}
                  onChange={(e) => setNoteCategory(e.target.value)}
                  className="px-3 py-2 rounded-lg bg-[var(--ink-bg)] border border-[var(--ink-border)] text-sm"
                >
                  <option value="Scene Idea">Scene Idea</option>
                  <option value="Dialogue Fragment">Dialogue Fragment</option>
                  <option value="Chapter Plan">Chapter Plan</option>
                  <option value="Plot Twist">Plot Twist</option>
                </select>
              </div>
              <textarea
                rows={3}
                value={noteContent}
                onChange={(e) => setNoteContent(e.target.value)}
                placeholder="Write private fragments, future twists, or dialogue lines..."
                className="w-full px-3 py-2 rounded-lg bg-[var(--ink-bg)] border border-[var(--ink-border)] text-sm"
              />
              <div className="flex justify-end">
                <button
                  type="submit"
                  className="px-4 py-2 rounded-lg bg-[var(--ink-accent)] text-white text-sm font-medium"
                >
                  Save Scratchpad Note
                </button>
              </div>
            </form>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {scratchpadNotes.map((note) => (
              <div
                key={note.id}
                className="p-4 rounded-xl border border-[var(--ink-border)] bg-[var(--ink-surface)] flex flex-col justify-between gap-3"
              >
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <span className="text-xs text-[var(--ink-accent)]">{note.category}</span>
                      <h4 className="font-medium text-base">{note.title}</h4>
                    </div>
                    {!isReadOnly && (
                      <button
                        type="button"
                        onClick={async () => {
                          await api.deleteScratchpadNote(note.id);
                          await onRefresh();
                        }}
                        className="p-1 text-[var(--ink-text-muted)] hover:text-red-500"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                  <p className="text-sm text-[var(--ink-text-muted)] mt-2 whitespace-pre-wrap leading-relaxed">
                    {note.content}
                  </p>
                </div>

                {!isReadOnly && (
                  <button
                    type="button"
                    onClick={() => onInsertScratchpadToPrompt(note.content || note.title)}
                    className="self-start text-xs font-medium text-[var(--ink-accent)] hover:underline flex items-center gap-1"
                  >
                    <Send className="w-3.5 h-3.5" />
                    <span>Insert into Chapter Prompt</span>
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Character Edit Modal */}
      {editingChar && (
        <div className="fixed inset-0 z-50 bg-black/55 flex items-center justify-center p-4 overflow-y-auto">
          <div className="w-full max-w-2xl rounded-xl border border-[var(--ink-border)] bg-[var(--ink-surface)] p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-lora text-lg font-semibold">
                {editingChar.id ? `Edit ${editingChar.name}` : 'New Character Profile'}
              </h3>
              <button type="button" onClick={() => setEditingChar(null)}>
                <X className="w-5 h-5 text-[var(--ink-text-muted)]" />
              </button>
            </div>
            <form onSubmit={handleSaveCharacter} className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <input
                  type="text"
                  required
                  value={editingChar.name || ''}
                  onChange={(e) => setEditingChar({ ...editingChar, name: e.target.value })}
                  placeholder="Name *"
                  className="px-3 py-2 rounded-lg bg-[var(--ink-bg)] border border-[var(--ink-border)] text-sm"
                />
                <input
                  type="text"
                  value={editingChar.age || ''}
                  onChange={(e) => setEditingChar({ ...editingChar, age: e.target.value })}
                  placeholder="Age"
                  className="px-3 py-2 rounded-lg bg-[var(--ink-bg)] border border-[var(--ink-border)] text-sm"
                />
                <input
                  type="text"
                  value={editingChar.role || ''}
                  onChange={(e) => setEditingChar({ ...editingChar, role: e.target.value })}
                  placeholder="Role"
                  className="px-3 py-2 rounded-lg bg-[var(--ink-bg)] border border-[var(--ink-border)] text-sm"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <select
                  value={editingChar.status || 'Active'}
                  onChange={(e) =>
                    setEditingChar({
                      ...editingChar,
                      status: e.target.value as CharacterStatus,
                    })
                  }
                  className="px-3 py-2 rounded-lg bg-[var(--ink-bg)] border border-[var(--ink-border)] text-sm"
                >
                  {CHAR_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
                {editingChar.status === 'Custom' && (
                  <input
                    type="text"
                    value={editingChar.customStatus || ''}
                    onChange={(e) =>
                      setEditingChar({ ...editingChar, customStatus: e.target.value })
                    }
                    placeholder="Custom status label"
                    className="px-3 py-2 rounded-lg bg-[var(--ink-bg)] border border-[var(--ink-border)] text-sm"
                  />
                )}
                <input
                  type="text"
                  value={editingChar.location || ''}
                  onChange={(e) => setEditingChar({ ...editingChar, location: e.target.value })}
                  placeholder="Current Location"
                  className="px-3 py-2 rounded-lg bg-[var(--ink-bg)] border border-[var(--ink-border)] text-sm"
                />
                <input
                  type="text"
                  value={editingChar.archetype || ''}
                  onChange={(e) => setEditingChar({ ...editingChar, archetype: e.target.value })}
                  placeholder="Archetype"
                  className="px-3 py-2 rounded-lg bg-[var(--ink-bg)] border border-[var(--ink-border)] text-sm"
                />
              </div>

              <textarea
                rows={2}
                value={editingChar.physicalAppearance || ''}
                onChange={(e) =>
                  setEditingChar({ ...editingChar, physicalAppearance: e.target.value })
                }
                placeholder="Physical appearance"
                className="w-full px-3 py-2 rounded-lg bg-[var(--ink-bg)] border border-[var(--ink-border)] text-sm"
              />
              <textarea
                rows={2}
                value={editingChar.personality || ''}
                onChange={(e) => setEditingChar({ ...editingChar, personality: e.target.value })}
                placeholder="Personality"
                className="w-full px-3 py-2 rounded-lg bg-[var(--ink-bg)] border border-[var(--ink-border)] text-sm"
              />
              <textarea
                rows={2}
                value={editingChar.psychologicalTraits || ''}
                onChange={(e) =>
                  setEditingChar({ ...editingChar, psychologicalTraits: e.target.value })
                }
                placeholder="Psychological traits, triggers & vulnerabilities"
                className="w-full px-3 py-2 rounded-lg bg-[var(--ink-bg)] border border-[var(--ink-border)] text-sm"
              />
              <textarea
                rows={2}
                value={editingChar.relationshipDynamics || ''}
                onChange={(e) =>
                  setEditingChar({ ...editingChar, relationshipDynamics: e.target.value })
                }
                placeholder="Relationship dynamics & connections"
                className="w-full px-3 py-2 rounded-lg bg-[var(--ink-bg)] border border-[var(--ink-border)] text-sm"
              />
              <textarea
                rows={2}
                value={editingChar.backstory || ''}
                onChange={(e) => setEditingChar({ ...editingChar, backstory: e.target.value })}
                placeholder="Backstory & development arc"
                className="w-full px-3 py-2 rounded-lg bg-[var(--ink-bg)] border border-[var(--ink-border)] text-sm"
              />

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setEditingChar(null)}
                  className="px-4 py-2 rounded-lg border border-[var(--ink-border)] text-sm"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={charBusy}
                  className="px-4 py-2 rounded-lg bg-[var(--ink-accent)] text-white text-sm font-medium"
                >
                  {charBusy ? 'Saving...' : 'Save Character'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
