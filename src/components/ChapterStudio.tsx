import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Check,
  Copy,
  Edit3,
  Expand,
  History,
  Image as ImageIcon,
  Lightbulb,
  MoreVertical,
  PanelLeftClose,
  PanelLeftOpen,
  Play,
  Plus,
  Redo2,
  RotateCcw,
  Save,
  Sparkles,
  Square,
  Trash2,
  Undo2,
  X,
} from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';
import { api, streamGeneration } from '../lib/api';
import { offlineDb } from '../lib/offlineDb';
import { countWordsClient, formatRelativeDate } from '../lib/theme';
import type {
  AiModelInfo,
  AiProviderId,
  CanonFact,
  Chapter,
  ChapterStatus,
  ChapterVersion,
  GenerationLifecycleState,
  Novel,
  PreflightContextSummary,
  ProviderCredentialPublic,
  ScratchpadNote,
  UploadedImage,
  UserProfile,
} from '../types';

interface ChapterStudioProps {
  user: UserProfile;
  novel: Novel;
  chapters: Chapter[];
  trashedChapters: Chapter[];
  images: UploadedImage[];
  canonFacts: CanonFact[];
  scratchpadNotes: ScratchpadNote[];
  activeChapterId: string | null;
  isOffline: boolean;
  isReadOnly: boolean;
  pendingPromptInsert: string | null;
  onClearPendingPromptInsert: () => void;
  onSelectChapter: (chapterId: string) => void;
  onChaptersChanged: () => Promise<void>;
  onChapterSavedLocal: (chapter: Chapter) => void;
}

export const ChapterStudio: React.FC<ChapterStudioProps> = ({
  user,
  novel,
  chapters,
  trashedChapters,
  images,
  canonFacts,
  scratchpadNotes,
  activeChapterId,
  isOffline,
  isReadOnly,
  pendingPromptInsert,
  onClearPendingPromptInsert,
  onSelectChapter,
  onChaptersChanged,
  onChapterSavedLocal,
}) => {
  const activeChapter = useMemo(
    () => chapters.find((c) => c.id === activeChapterId) || chapters[0] || null,
    [chapters, activeChapterId]
  );

  // Sidebar state
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarTab, setSidebarTab] = useState<'chapters' | 'trash'>('chapters');
  const [chapterMenuId, setChapterMenuId] = useState<string | null>(null);
  const [renamingChapterId, setRenamingChapterId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [confirmTrashChapter, setConfirmTrashChapter] = useState<Chapter | null>(null);
  const [confirmPermChapter, setConfirmPermChapter] = useState<Chapter | null>(null);

  // Local editable chapter state
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [prompt, setPrompt] = useState('');
  const [timelineAnchor, setTimelineAnchor] = useState('');
  const [locationAnchor, setLocationAnchor] = useState('');
  const [status, setStatus] = useState<ChapterStatus>('Draft');
  const [dirty, setDirty] = useState(false);
  const [saveLabel, setSaveLabel] = useState<string>('Synced');

  // Undo / Redo stacks
  const [undoStack, setUndoStack] = useState<string[]>([]);
  const [redoStack, setRedoStack] = useState<string[]>([]);

  // Crash recovery banner
  const [recoveryDraft, setRecoveryDraft] = useState<{
    content: string;
    prompt: string;
    savedAt: string;
  } | null>(null);

  // Conflict state
  const [conflictServerChapter, setConflictServerChapter] = useState<Chapter | null>(null);

  // Prompt & AI Config
  const [targetWordCount, setTargetWordCount] = useState<number>(
    user.editorPrefs.defaultChapterWordTarget || 2700
  );
  const [selectedProvider, setSelectedProvider] = useState<AiProviderId>(
    user.aiPrefs.defaultProvider || 'gemini'
  );
  const [selectedModelId, setSelectedModelId] = useState<string>(
    user.aiPrefs.defaultModelId || 'gemini-4-hydrogen'
  );
  const [models, setModels] = useState<AiModelInfo[]>([]);
  const [credentials, setCredentials] = useState<ProviderCredentialPublic[]>([]);
  const [selectedImageIds, setSelectedImageIds] = useState<string[]>([]);
  const [fullPromptOpen, setFullPromptOpen] = useState(false);

  // Preflight & Generation Lifecycle
  const [preflightData, setPreflightData] = useState<PreflightContextSummary | null>(null);
  const [preflightEditableCanon, setPreflightEditableCanon] = useState<string[]>([]);
  const [preflightOpen, setPreflightOpen] = useState(false);
  const [lifecycle, setLifecycle] = useState<GenerationLifecycleState>('Idle');
  const [credentialUsedLabel, setCredentialUsedLabel] = useState<string>('');
  const [genError, setGenError] = useState<string | null>(null);
  const [fallbackOffer, setFallbackOffer] = useState<{
    mode: 'draft' | 'regenerate' | 'continue';
  } | null>(null);
  const [truncatedByLimit, setTruncatedByLimit] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  const abortControllerRef = useRef<AbortController | null>(null);
  const activeRequestIdRef = useRef<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Selection editing state
  const [selectionRange, setSelectionRange] = useState<{ start: number; end: number; text: string } | null>(
    null
  );
  const [selectionInstruction, setSelectionInstruction] = useState('');
  const [selectionBusy, setSelectionBusy] = useState(false);

  // Modals / Drawers
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [versions, setVersions] = useState<ChapterVersion[]>([]);
  const [brainstormOpen, setBrainstormOpen] = useState(false);
  const [brainstormCat, setBrainstormCat] = useState<
    'plot_twists' | 'transitions' | 'dialogue' | 'emotional_beats' | 'character_reactions' | 'conflicts'
  >('plot_twists');
  const [brainstormPrompt, setBrainstormPrompt] = useState('');
  const [brainstormResult, setBrainstormResult] = useState('');
  const [brainstormBusy, setBrainstormBusy] = useState(false);
  const [scratchpadDrawerOpen, setScratchpadDrawerOpen] = useState(false);

  // Load models & credentials
  useEffect(() => {
    api
      .discoverModels()
      .then((res) => setModels(res.models))
      .catch(() => {});
    api
      .listCredentials()
      .then((res) => setCredentials(res.credentials))
      .catch(() => {});
  }, []);

  // Load active chapter into editor state + check IndexedDB crash recovery
  useEffect(() => {
    if (!activeChapter) return;
    setTitle(activeChapter.title);
    setContent(activeChapter.content);
    setPrompt(activeChapter.prompt);
    setTimelineAnchor(activeChapter.timelineAnchor);
    setLocationAnchor(activeChapter.locationAnchor);
    setStatus(activeChapter.status);
    setDirty(false);
    setSaveLabel(activeChapter.syncState === 'pending' ? 'Saved locally (pending sync)' : 'Synced');
    setUndoStack([]);
    setRedoStack([]);
    setSelectionRange(null);
    setTruncatedByLimit(false);
    setConflictServerChapter(null);

    offlineDb.getDraftRecovery(activeChapter.id).then((rec) => {
      if (
        rec &&
        (rec.content !== activeChapter.content || rec.prompt !== activeChapter.prompt) &&
        new Date(rec.savedAt).getTime() > new Date(activeChapter.updatedAt).getTime()
      ) {
        setRecoveryDraft({
          content: rec.content,
          prompt: rec.prompt,
          savedAt: rec.savedAt,
        });
      } else {
        setRecoveryDraft(null);
      }
    });
  }, [activeChapter?.id]);

  // Insert scratchpad snippet when triggered from Story Bible
  useEffect(() => {
    if (pendingPromptInsert) {
      setPrompt((p) => (p.trim() ? `${p.trim()}\n\n${pendingPromptInsert}` : pendingPromptInsert));
      setDirty(true);
      onClearPendingPromptInsert();
    }
  }, [pendingPromptInsert, onClearPendingPromptInsert]);

  // Elapsed timer while generating
  useEffect(() => {
    const running = ['Preparing Context', 'Connecting', 'Generating', 'Streaming', 'Saving', 'Summarising'].includes(
      lifecycle
    );
    if (!running) {
      setElapsedSeconds(0);
      return;
    }
    const id = setInterval(() => setElapsedSeconds((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [lifecycle]);

  // Warn before closing tab with unsaved changes
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  // Immediate local crash-recovery buffer + debounced save
  useEffect(() => {
    if (!activeChapter || !dirty || isReadOnly) return;

    void offlineDb.saveDraftRecovery({
      chapterId: activeChapter.id,
      novelId: novel.id,
      title,
      content,
      prompt,
      timelineAnchor,
      locationAnchor,
      savedAt: new Date().toISOString(),
    });

    const timer = setTimeout(() => {
      void persistChapter({ silent: true });
    }, 1800);
    return () => clearTimeout(timer);
  }, [title, content, prompt, timelineAnchor, locationAnchor, status, dirty]);

  const persistChapter = async (opts?: { silent?: boolean; force?: boolean; snapshotReason?: string }) => {
    if (!activeChapter || isReadOnly) return;
    const now = new Date().toISOString();
    const localSnapshot: Chapter = {
      ...activeChapter,
      title: title.trim() || activeChapter.title,
      content,
      prompt,
      timelineAnchor,
      locationAnchor,
      status,
      wordCount: countWordsClient(content),
      clientUpdatedAt: now,
      updatedAt: now,
      syncState: isOffline ? 'pending' : 'synced',
    };

    await offlineDb.saveChapterLocal(localSnapshot, isOffline ? 'pending' : 'synced');
    onChapterSavedLocal(localSnapshot);

    if (isOffline) {
      setDirty(false);
      setSaveLabel('Saved offline (pending sync)');
      return;
    }

    if (!opts?.silent) setSaveLabel('Saving...');
    try {
      const res = await api.updateChapter(activeChapter.id, {
        title: localSnapshot.title,
        content,
        prompt,
        timelineAnchor,
        locationAnchor,
        status,
        clientUpdatedAt: now,
        force: opts?.force,
        snapshotReason: opts?.snapshotReason,
      });
      await offlineDb.saveChapterLocal(res.chapter, 'synced');
      await offlineDb.clearDraftRecovery(activeChapter.id);
      onChapterSavedLocal(res.chapter);
      setDirty(false);
      setSaveLabel('Synced');
      setConflictServerChapter(null);
    } catch (err: unknown) {
      const apiErr = err as { status?: number; data?: { serverChapter?: Chapter } };
      if (apiErr?.status === 409 && apiErr?.data?.serverChapter) {
        setConflictServerChapter(apiErr.data.serverChapter);
        setSaveLabel('Sync conflict');
      } else {
        await offlineDb.saveChapterLocal(localSnapshot, 'pending');
        setSaveLabel('Saved locally (retry pending)');
      }
    }
  };

  const handleSwitchChapter = async (nextId: string) => {
    if (nextId === activeChapter?.id) return;
    if (dirty && !isReadOnly) {
      await persistChapter({ silent: true });
    }
    onSelectChapter(nextId);
  };

  const handleContentChange = (nextVal: string) => {
    setUndoStack((prev) => [...prev.slice(-24), content]);
    setRedoStack([]);
    setContent(nextVal);
    setDirty(true);
  };

  const handleUndo = () => {
    if (undoStack.length === 0) return;
    const prev = undoStack[undoStack.length - 1];
    setRedoStack((r) => [...r, content]);
    setUndoStack((u) => u.slice(0, -1));
    setContent(prev);
    setDirty(true);
  };

  const handleRedo = () => {
    if (redoStack.length === 0) return;
    const next = redoStack[redoStack.length - 1];
    setUndoStack((u) => [...u, content]);
    setRedoStack((r) => r.slice(0, -1));
    setContent(next);
    setDirty(true);
  };

  const handleTextSelect = () => {
    const el = textareaRef.current;
    if (!el || isReadOnly) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    if (end > start) {
      const selected = content.slice(start, end);
      if (selected.trim().length >= 6) {
        setSelectionRange({ start, end, text: selected });
        return;
      }
    }
    setSelectionRange(null);
  };

  const handleSelectionEdit = async (
    action:
      | 'rewrite'
      | 'expand'
      | 'shorten'
      | 'improve_dialogue'
      | 'adjust_intensity'
      | 'correct_grammar'
      | 'translate_dialogue'
      | 'change_style'
  ) => {
    if (!selectionRange || !activeChapter || isOffline || isReadOnly) return;
    setSelectionBusy(true);
    setGenError(null);
    try {
      const surrounding = content.slice(
        Math.max(0, selectionRange.start - 400),
        Math.min(content.length, selectionRange.end + 400)
      );
      const { replacementText } = await api.editSelection({
        novelId: novel.id,
        selectedText: selectionRange.text,
        surroundingContext: surrounding,
        action,
        customInstruction: selectionInstruction,
        provider: selectedProvider,
        modelId: selectedModelId,
      });

      const updated =
        content.slice(0, selectionRange.start) +
        replacementText +
        content.slice(selectionRange.end);

      setUndoStack((prev) => [...prev.slice(-24), content]);
      setContent(updated);
      setSelectionRange(null);
      setSelectionInstruction('');
      setDirty(true);
      await persistChapter({ snapshotReason: `Line edit: ${action}` });
    } catch (err) {
      setGenError(err instanceof Error ? err.message : 'Selection edit failed');
    } finally {
      setSelectionBusy(false);
    }
  };

  const selectedModelMeta = useMemo(
    () => models.find((m) => m.provider === selectedProvider && m.id === selectedModelId),
    [models, selectedProvider, selectedModelId]
  );

  const activeProviderCreds = useMemo(
    () => credentials.filter((c) => c.provider === selectedProvider),
    [credentials, selectedProvider]
  );

  const activeCredentialSummary =
    activeProviderCreds.length > 0
      ? `Author Key (${activeProviderCreds[0].label})`
      : selectedProvider === 'gemini'
        ? 'Managed Universal Key (Server-Side)'
        : 'No Key Configured';

  const openPreflight = async () => {
    if (!activeChapter || isOffline) return;
    setGenError(null);
    try {
      const pinned = canonFacts
        .filter((f) => f.isPinned && f.approvalStatus === 'pinned')
        .map((f) => f.factText);
      setPreflightEditableCanon(pinned);
      const { preflight } = await api.preflight({
        novelId: novel.id,
        chapterId: activeChapter.id,
        prompt,
        timelineAnchor,
        locationAnchor,
        targetWordCount,
        provider: selectedProvider,
        modelId: selectedModelId,
        selectedImageIds,
      });
      setPreflightData(preflight);
      setPreflightOpen(true);
    } catch (err) {
      setGenError(err instanceof Error ? err.message : 'Could not build preflight review');
    }
  };

  const runGeneration = async (
    mode: 'draft' | 'regenerate' | 'continue',
    forceCredentialSource?: 'managed' | 'author'
  ) => {
    if (!activeChapter || isOffline || isReadOnly) return;
    if (!prompt.trim() && mode !== 'continue') {
      setGenError('Enter a scene prompt (50+ words recommended) before generating.');
      return;
    }

    setPreflightOpen(false);
    setGenError(null);
    setFallbackOffer(null);
    setTruncatedByLimit(false);

    const requestId = uuidv4();
    activeRequestIdRef.current = requestId;
    const controller = new AbortController();
    abortControllerRef.current = controller;

    const baseContentBeforeGen = mode === 'continue' ? content : '';
    let streamedAccum = '';

    setLifecycle('Preparing Context');

    try {
      await streamGeneration(
        {
          requestId,
          novelId: novel.id,
          chapterId: activeChapter.id,
          prompt,
          timelineAnchor,
          locationAnchor,
          targetWordCount,
          provider: selectedProvider,
          modelId: selectedModelId,
          selectedImageIds,
          canonOverride: preflightData ? preflightEditableCanon : undefined,
          mode,
          existingContent: mode === 'continue' ? content : undefined,
          forceCredentialSource,
          thinkingMode: user.aiPrefs.thinkingMode || 'fast',
        },
        controller.signal,
        {
          onLifecycle: (p) => {
            setLifecycle(p.state as GenerationLifecycleState);
            if (p.credentialLabel) setCredentialUsedLabel(p.credentialLabel);
          },
          onDelta: (delta) => {
            streamedAccum += delta;
            const nextText =
              mode === 'continue' && baseContentBeforeGen.trim()
                ? `${baseContentBeforeGen.trimEnd()}\n\n${streamedAccum.trimStart()}`
                : streamedAccum;
            setContent(nextText);
            void offlineDb.saveDraftRecovery({
              chapterId: activeChapter.id,
              novelId: novel.id,
              title,
              content: nextText,
              prompt,
              timelineAnchor,
              locationAnchor,
              savedAt: new Date().toISOString(),
            });
          },
          onDone: async (p) => {
            setLifecycle('Completed');
            setTruncatedByLimit(p.truncatedByOutputLimit);
            if (p.chapter) {
              setContent(p.chapter.content);
              await offlineDb.saveChapterLocal(p.chapter, 'synced');
              await offlineDb.clearDraftRecovery(activeChapter.id);
              onChapterSavedLocal(p.chapter);
            }
            setDirty(false);
            setSaveLabel('Synced');
            setTimeout(() => void onChaptersChanged(), 1200);
          },
          onError: (p) => {
            setLifecycle(p.state as GenerationLifecycleState);
            setGenError(p.error);
            if (p.partialText) {
              const recovered =
                mode === 'continue' && baseContentBeforeGen.trim()
                  ? `${baseContentBeforeGen.trimEnd()}\n\n${p.partialText.trimStart()}`
                  : p.partialText;
              setContent(recovered);
              setDirty(true);
            }
            if (p.canFallbackToManaged) {
              setFallbackOffer({ mode });
            }
          },
        }
      );
    } catch (err) {
      if (controller.signal.aborted) {
        setLifecycle('Cancelled');
      } else {
        setLifecycle(streamedAccum ? 'Recoverable Interruption' : 'Failed');
        setGenError(err instanceof Error ? err.message : 'Generation failed');
      }
    } finally {
      abortControllerRef.current = null;
      activeRequestIdRef.current = null;
    }
  };

  const handleStopGeneration = async () => {
    const reqId = activeRequestIdRef.current;
    abortControllerRef.current?.abort();
    if (reqId) {
      await api.cancelGeneration(reqId).catch(() => {});
    }
    setLifecycle('Cancelled');
  };

  const isGenerating = [
    'Preparing Context',
    'Connecting',
    'Generating',
    'Streaming',
    'Saving',
    'Summarising',
  ].includes(lifecycle);

  const fontClass =
    user.editorPrefs.manuscriptFont === 'merriweather'
      ? 'font-merriweather'
      : user.editorPrefs.manuscriptFont === 'source-serif'
        ? 'font-source-serif'
        : user.editorPrefs.manuscriptFont === 'inter'
          ? 'font-ui'
          : 'font-lora';

  const manuscriptWordCount = countWordsClient(content);
  const promptWordCount = countWordsClient(prompt);

  return (
    <div className="flex flex-1 min-h-[calc(100vh-4rem)] bg-[var(--ink-bg)]">
      {/* Chapter List Sidebar */}
      {sidebarOpen && (
        <aside className="w-72 shrink-0 border-r border-[var(--ink-border)] bg-[var(--ink-surface)] flex flex-col">
          <div className="p-3.5 border-b border-[var(--ink-border)] flex items-center justify-between gap-2">
            <div className="flex items-center gap-3 text-xs font-medium">
              <button
                type="button"
                onClick={() => setSidebarTab('chapters')}
                className={
                  sidebarTab === 'chapters'
                    ? 'text-[var(--ink-text)] underline underline-offset-4'
                    : 'text-[var(--ink-text-muted)]'
                }
              >
                Chapters ({chapters.length})
              </button>
              <button
                type="button"
                onClick={() => setSidebarTab('trash')}
                className={
                  sidebarTab === 'trash'
                    ? 'text-[var(--ink-text)] underline underline-offset-4'
                    : 'text-[var(--ink-text-muted)]'
                }
              >
                Trash ({trashedChapters.length})
              </button>
            </div>
            <div className="flex items-center gap-1">
              {!isReadOnly && sidebarTab === 'chapters' && (
                <button
                  type="button"
                  disabled={isOffline}
                  onClick={async () => {
                    const { chapter } = await api.createChapter(novel.id, {});
                    await onChaptersChanged();
                    onSelectChapter(chapter.id);
                  }}
                  title="New Chapter"
                  className="p-1.5 rounded-md hover:bg-[var(--ink-surface-elevated)] text-[var(--ink-accent)] disabled:opacity-40"
                >
                  <Plus className="w-4 h-4" />
                </button>
              )}
              <button
                type="button"
                onClick={() => setSidebarOpen(false)}
                aria-label="Collapse chapter list"
                className="p-1.5 rounded-md text-[var(--ink-text-muted)] hover:text-[var(--ink-text)]"
              >
                <PanelLeftClose className="w-4 h-4" />
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {sidebarTab === 'chapters' ? (
              chapters.map((ch) => {
                const isActive = ch.id === activeChapter?.id;
                return (
                  <div
                    key={ch.id}
                    className={`group relative rounded-lg px-3 py-2.5 transition-colors ${
                      isActive
                        ? 'bg-[var(--ink-surface-elevated)] border border-[var(--ink-border)]'
                        : 'hover:bg-[var(--ink-surface-elevated)]/60 border border-transparent'
                    }`}
                  >
                    {renamingChapterId === ch.id ? (
                      <form
                        onSubmit={async (e) => {
                          e.preventDefault();
                          if (!renameValue.trim()) return;
                          await api.updateChapter(ch.id, { title: renameValue.trim() });
                          if (ch.id === activeChapter?.id) setTitle(renameValue.trim());
                          setRenamingChapterId(null);
                          await onChaptersChanged();
                        }}
                        className="flex items-center gap-1"
                      >
                        <input
                          type="text"
                          autoFocus
                          value={renameValue}
                          onChange={(e) => setRenameValue(e.target.value)}
                          className="w-full px-2 py-1 text-xs rounded bg-[var(--ink-bg)] border border-[var(--ink-accent)]"
                        />
                        <button type="submit" className="p-1 text-[var(--ink-accent)]">
                          <Check className="w-3.5 h-3.5" />
                        </button>
                      </form>
                    ) : (
                      <div className="flex items-start justify-between gap-2">
                        <button
                          type="button"
                          onClick={() => handleSwitchChapter(ch.id)}
                          className="flex-1 text-left min-w-0"
                        >
                          <p className="text-sm font-medium truncate">
                            {ch.chapterNumber}. {ch.title}
                          </p>
                          <p className="text-[11px] text-[var(--ink-text-muted)] font-mono-tabular mt-0.5 truncate">
                            {ch.wordCount.toLocaleString()} w · {ch.status} ·{' '}
                            {formatRelativeDate(ch.updatedAt)}
                          </p>
                        </button>

                        {!isReadOnly && (
                          <div className="relative shrink-0">
                            <button
                              type="button"
                              aria-label={`Menu for ${ch.title}`}
                              onClick={() =>
                                setChapterMenuId(chapterMenuId === ch.id ? null : ch.id)
                              }
                              className="p-1 rounded text-[var(--ink-text-muted)] hover:text-[var(--ink-text)]"
                            >
                              <MoreVertical className="w-3.5 h-3.5" />
                            </button>

                            {chapterMenuId === ch.id && (
                              <div className="absolute right-0 mt-1 w-40 rounded-lg border border-[var(--ink-border)] bg-[var(--ink-surface)] shadow-lg py-1 z-30 text-xs">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setChapterMenuId(null);
                                    void handleSwitchChapter(ch.id);
                                  }}
                                  className="w-full text-left px-3 py-1.5 hover:bg-[var(--ink-surface-elevated)] flex items-center gap-2"
                                >
                                  <Edit3 className="w-3.5 h-3.5" />
                                  <span>Edit</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setChapterMenuId(null);
                                    setRenamingChapterId(ch.id);
                                    setRenameValue(ch.title);
                                  }}
                                  className="w-full text-left px-3 py-1.5 hover:bg-[var(--ink-surface-elevated)] flex items-center gap-2"
                                >
                                  <Edit3 className="w-3.5 h-3.5" />
                                  <span>Rename</span>
                                </button>
                                <button
                                  type="button"
                                  disabled={isOffline}
                                  onClick={async () => {
                                    setChapterMenuId(null);
                                    const { chapter } = await api.duplicateChapter(ch.id);
                                    await onChaptersChanged();
                                    onSelectChapter(chapter.id);
                                  }}
                                  className="w-full text-left px-3 py-1.5 hover:bg-[var(--ink-surface-elevated)] flex items-center gap-2 disabled:opacity-40"
                                >
                                  <Copy className="w-3.5 h-3.5" />
                                  <span>Duplicate</span>
                                </button>
                                <div className="my-1 border-t border-[var(--ink-border)]" />
                                <button
                                  type="button"
                                  onClick={() => {
                                    setChapterMenuId(null);
                                    setConfirmTrashChapter(ch);
                                  }}
                                  className="w-full text-left px-3 py-1.5 hover:bg-red-500/10 text-red-600 dark:text-red-400 flex items-center gap-2"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                  <span>Delete</span>
                                </button>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })
            ) : trashedChapters.length === 0 ? (
              <p className="text-xs text-[var(--ink-text-muted)] text-center py-8">
                Chapter Trash is empty.
              </p>
            ) : (
              trashedChapters.map((ch) => (
                <div
                  key={ch.id}
                  className="p-3 rounded-lg border border-[var(--ink-border)] bg-[var(--ink-bg)] space-y-2"
                >
                  <p className="text-xs font-medium truncate">
                    {ch.chapterNumber}. {ch.title}
                  </p>
                  <div className="flex items-center justify-between text-[11px]">
                    <button
                      type="button"
                      onClick={async () => {
                        await api.restoreChapter(ch.id);
                        await onChaptersChanged();
                      }}
                      className="text-[var(--ink-accent)] hover:underline flex items-center gap-1"
                    >
                      <RotateCcw className="w-3 h-3" />
                      <span>Restore</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmPermChapter(ch)}
                      className="text-red-600 dark:text-red-400 hover:underline"
                    >
                      Delete Forever
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </aside>
      )}

      {/* Main Manuscript & Generation Column */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Studio Sub-Toolbar */}
        <div className="px-4 sm:px-6 py-3 border-b border-[var(--ink-border)] bg-[var(--ink-surface)] flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            {!sidebarOpen && (
              <button
                type="button"
                onClick={() => setSidebarOpen(true)}
                aria-label="Open chapter list"
                className="p-1.5 rounded-md border border-[var(--ink-border)] text-[var(--ink-text-muted)] hover:text-[var(--ink-text)]"
              >
                <PanelLeftOpen className="w-4 h-4" />
              </button>
            )}
            {activeChapter && (
              <input
                type="text"
                disabled={isReadOnly}
                value={title}
                onChange={(e) => {
                  setTitle(e.target.value);
                  setDirty(true);
                }}
                aria-label="Chapter title"
                className="font-lora text-lg font-semibold bg-transparent border-b border-transparent focus:border-[var(--ink-accent)] focus:outline-none min-w-[160px] max-w-md truncate"
              />
            )}
          </div>

          {activeChapter && (
            <div className="flex flex-wrap items-center gap-2.5 text-xs">
              <span className="font-mono-tabular text-[var(--ink-text-muted)]">
                {manuscriptWordCount.toLocaleString()} words · {saveLabel}
              </span>

              <select
                disabled={isReadOnly}
                value={status}
                onChange={(e) => {
                  setStatus(e.target.value as ChapterStatus);
                  setDirty(true);
                }}
                aria-label="Chapter status"
                className="px-2.5 py-1.5 rounded-md bg-[var(--ink-bg)] border border-[var(--ink-border)] text-xs"
              >
                <option value="Draft">Draft</option>
                <option value="Confirmed">Confirmed</option>
                <option value="Completed">Completed</option>
              </select>

              {!isReadOnly && (
                <>
                  <button
                    type="button"
                    onClick={handleUndo}
                    disabled={undoStack.length === 0}
                    title="Undo"
                    className="p-1.5 rounded-md border border-[var(--ink-border)] disabled:opacity-40"
                  >
                    <Undo2 className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={handleRedo}
                    disabled={redoStack.length === 0}
                    title="Redo"
                    className="p-1.5 rounded-md border border-[var(--ink-border)] disabled:opacity-40"
                  >
                    <Redo2 className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => void persistChapter({ snapshotReason: 'Manual save' })}
                    className="px-3 py-1.5 rounded-md border border-[var(--ink-border)] hover:border-[var(--ink-accent)] flex items-center gap-1.5 whitespace-nowrap"
                  >
                    <Save className="w-3.5 h-3.5" />
                    <span>Save</span>
                  </button>
                </>
              )}

              <button
                type="button"
                onClick={async () => {
                  const res = await api.listChapterVersions(activeChapter.id);
                  setVersions(res.versions);
                  setVersionsOpen(true);
                }}
                className="px-3 py-1.5 rounded-md border border-[var(--ink-border)] hover:border-[var(--ink-accent)] flex items-center gap-1.5 whitespace-nowrap"
              >
                <History className="w-3.5 h-3.5" />
                <span>Versions</span>
              </button>

              {!isReadOnly && (
                <button
                  type="button"
                  onClick={() => setBrainstormOpen((v) => !v)}
                  className="px-3 py-1.5 rounded-md border border-[var(--ink-border)] hover:border-[var(--ink-accent)] flex items-center gap-1.5 whitespace-nowrap"
                >
                  <Lightbulb className="w-3.5 h-3.5 text-[var(--ink-accent)]" />
                  <span>Brainstorm</span>
                </button>
              )}
            </div>
          )}
        </div>

        {/* Recovery / Conflict / Error Banners */}
        {recoveryDraft && !isReadOnly && (
          <div className="mx-4 sm:mx-6 mt-4 p-3.5 rounded-lg border border-[var(--ink-accent)]/50 bg-[var(--ink-surface)] flex flex-wrap items-center justify-between gap-3 text-xs">
            <span>
              Recovered local draft from {formatRelativeDate(recoveryDraft.savedAt)} differs from the cloud version.
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setContent(recoveryDraft.content);
                  setPrompt(recoveryDraft.prompt);
                  setDirty(true);
                  setRecoveryDraft(null);
                }}
                className="px-3 py-1 rounded bg-[var(--ink-accent)] text-white font-medium"
              >
                Restore Local Draft
              </button>
              <button
                type="button"
                onClick={() => {
                  if (activeChapter) void offlineDb.clearDraftRecovery(activeChapter.id);
                  setRecoveryDraft(null);
                }}
                className="px-3 py-1 rounded border border-[var(--ink-border)]"
              >
                Discard Local Draft
              </button>
            </div>
          </div>
        )}

        {conflictServerChapter && (
          <div className="mx-4 sm:mx-6 mt-4 p-3.5 rounded-lg border border-amber-500/50 bg-amber-500/10 flex flex-wrap items-center justify-between gap-3 text-xs">
            <span>
              Sync conflict: cloud copy ({conflictServerChapter.wordCount} words) is newer than your offline timestamp. Choose which copy to keep:
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => void persistChapter({ force: true, snapshotReason: 'Resolved conflict keeping local' })}
                className="px-3 py-1 rounded bg-[var(--ink-accent)] text-white font-medium"
              >
                Keep My Local Edits
              </button>
              <button
                type="button"
                onClick={() => {
                  setContent(conflictServerChapter.content);
                  setTitle(conflictServerChapter.title);
                  setPrompt(conflictServerChapter.prompt);
                  setDirty(false);
                  setConflictServerChapter(null);
                }}
                className="px-3 py-1 rounded border border-[var(--ink-border)]"
              >
                Load Cloud Version
              </button>
            </div>
          </div>
        )}

        {/* Timeline & Location Anchors */}
        {activeChapter && (
          <div className="px-4 sm:px-6 py-2.5 border-b border-[var(--ink-border)] flex flex-wrap items-center gap-4 text-xs bg-[var(--ink-bg)]">
            <div className="flex items-center gap-2 flex-1 min-w-[200px]">
              <span className="text-[var(--ink-text-muted)] whitespace-nowrap">Timeline:</span>
              <input
                type="text"
                disabled={isReadOnly}
                value={timelineAnchor}
                onChange={(e) => {
                  setTimelineAnchor(e.target.value);
                  setDirty(true);
                }}
                placeholder="e.g., Night 3 · 11:40 PM"
                className="w-full bg-transparent border-b border-[var(--ink-border)] focus:border-[var(--ink-accent)] focus:outline-none py-0.5"
              />
            </div>
            <div className="flex items-center gap-2 flex-1 min-w-[200px]">
              <span className="text-[var(--ink-text-muted)] whitespace-nowrap">Location:</span>
              <input
                type="text"
                disabled={isReadOnly}
                value={locationAnchor}
                onChange={(e) => {
                  setLocationAnchor(e.target.value);
                  setDirty(true);
                }}
                placeholder="e.g., East Wing Library"
                className="w-full bg-transparent border-b border-[var(--ink-border)] focus:border-[var(--ink-accent)] focus:outline-none py-0.5"
              />
            </div>
          </div>
        )}

        {/* Selected-Text Contextual Editing Bar */}
        {selectionRange && !isReadOnly && (
          <div className="mx-4 sm:mx-6 mt-3 p-3 rounded-lg border border-[var(--ink-accent)]/60 bg-[var(--ink-surface)] space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium">
                Selected Passage ({countWordsClient(selectionRange.text)} words) — Edits ONLY this selection
              </span>
              <button
                type="button"
                onClick={() => setSelectionRange(null)}
                className="text-[var(--ink-text-muted)] hover:text-[var(--ink-text)]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex flex-wrap gap-1.5 text-xs">
              {(
                [
                  ['rewrite', 'Rewrite'],
                  ['expand', 'Expand'],
                  ['shorten', 'Shorten'],
                  ['improve_dialogue', 'Improve Dialogue'],
                  ['adjust_intensity', 'Adjust Intensity'],
                  ['correct_grammar', 'Fix Grammar'],
                  ['translate_dialogue', 'Translate Dialogue'],
                  ['change_style', 'Change Style'],
                ] as const
              ).map(([act, label]) => (
                <button
                  key={act}
                  type="button"
                  disabled={selectionBusy || isOffline}
                  onClick={() => void handleSelectionEdit(act)}
                  className="px-2.5 py-1 rounded border border-[var(--ink-border)] hover:border-[var(--ink-accent)] disabled:opacity-50"
                >
                  {label}
                </button>
              ))}
            </div>
            <input
              type="text"
              value={selectionInstruction}
              onChange={(e) => setSelectionInstruction(e.target.value)}
              placeholder="Optional guidance (e.g., 'Make the tension sharper' or 'Translate dialogue to Romanized Hindi')..."
              className="w-full px-3 py-1.5 rounded bg-[var(--ink-bg)] border border-[var(--ink-border)] text-xs"
            />
          </div>
        )}

        {/* Manuscript Writing Canvas */}
        <div className="flex-1 overflow-y-auto px-4 sm:px-8 py-6">
          {activeChapter ? (
            <div
              className="mx-auto"
              style={{ maxWidth: `${user.editorPrefs.maxWidthCh || 68}ch` }}
            >
              <textarea
                ref={textareaRef}
                readOnly={isReadOnly || isGenerating}
                value={content}
                onChange={(e) => handleContentChange(e.target.value)}
                onMouseUp={handleTextSelect}
                onKeyUp={handleTextSelect}
                placeholder="Begin writing directly here, or compose a scene prompt below to stream a chapter with your Story Bible..."
                style={{
                  fontSize: `${user.editorPrefs.fontSizePx || 18}px`,
                  lineHeight: user.editorPrefs.lineSpacing || 1.75,
                }}
                className={`w-full min-h-[42vh] bg-transparent resize-y focus:outline-none ${fontClass} leading-relaxed`}
              />
            </div>
          ) : (
            <p className="text-center text-sm text-[var(--ink-text-muted)] py-16">
              Create or restore a chapter from the sidebar to begin writing.
            </p>
          )}
        </div>

        {/* AI Generation Lifecycle & Prompt Dock (Hidden in Completed Read-Only Mode) */}
        {!isReadOnly && activeChapter && (
          <div className="border-t border-[var(--ink-border)] bg-[var(--ink-surface)] p-4 sm:px-6 space-y-3">
            {/* Lifecycle / Error / Fallback Banner */}
            {(lifecycle !== 'Idle' || genError || truncatedByLimit) && (
              <div className="p-3 rounded-lg border border-[var(--ink-border)] bg-[var(--ink-bg)] text-xs space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">
                    Status: {lifecycle}
                    {isGenerating ? ` (${elapsedSeconds}s)` : ''}
                    {credentialUsedLabel ? ` · ${credentialUsedLabel}` : ''}
                  </span>
                  {isGenerating && (
                    <button
                      type="button"
                      onClick={() => void handleStopGeneration()}
                      className="px-3 py-1 rounded bg-red-600 text-white font-medium flex items-center gap-1"
                    >
                      <Square className="w-3 h-3 fill-current" />
                      <span>Stop Generation</span>
                    </button>
                  )}
                </div>

                {genError && (
                  <p className="text-red-600 dark:text-red-400 flex items-start gap-1.5">
                    <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>{genError}</span>
                  </p>
                )}

                {fallbackOffer && (
                  <div className="pt-2 border-t border-[var(--ink-border)] flex flex-wrap items-center justify-between gap-2">
                    <span>
                      Your Author Gemini key failed. Would you like to use the Managed Universal Key instead?
                    </span>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => void runGeneration(fallbackOffer.mode, 'managed')}
                        className="px-3 py-1 rounded bg-[var(--ink-accent)] text-white font-medium"
                      >
                        Use Managed Key
                      </button>
                      <button
                        type="button"
                        onClick={() => setFallbackOffer(null)}
                        className="px-3 py-1 rounded border border-[var(--ink-border)]"
                      >
                        Keep Author Key
                      </button>
                    </div>
                  </div>
                )}

                {truncatedByLimit && !isGenerating && (
                  <div className="pt-2 border-t border-[var(--ink-border)] flex items-center justify-between gap-2">
                    <span>
                      Output reached the provider's token limit. Continue seamlessly from the exact ending?
                    </span>
                    <button
                      type="button"
                      onClick={() => void runGeneration('continue')}
                      className="px-3 py-1 rounded bg-[var(--ink-accent)] text-white font-medium"
                    >
                      Continue From Exact Ending
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Prompt Box */}
            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--ink-text-muted)]">
                <div className="flex items-center gap-3">
                  <span className="font-medium text-[var(--ink-text)]">Scene Prompt</span>
                  <span className="font-mono-tabular">{promptWordCount} words</span>
                  <button
                    type="button"
                    onClick={() => setScratchpadDrawerOpen((v) => !v)}
                    className="text-[var(--ink-accent)] hover:underline"
                  >
                    Insert Scratchpad ({scratchpadNotes.length})
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => setFullPromptOpen(true)}
                  className="hover:text-[var(--ink-text)] flex items-center gap-1"
                >
                  <Expand className="w-3.5 h-3.5" />
                  <span>Full-Screen Prompt</span>
                </button>
              </div>

              {scratchpadDrawerOpen && scratchpadNotes.length > 0 && (
                <div className="p-2.5 rounded-lg border border-[var(--ink-border)] bg-[var(--ink-bg)] flex flex-wrap gap-2">
                  {scratchpadNotes.map((n) => (
                    <button
                      key={n.id}
                      type="button"
                      onClick={() => {
                        setPrompt((p) => (p.trim() ? `${p.trim()}\n\n${n.content}` : n.content));
                        setDirty(true);
                        setScratchpadDrawerOpen(false);
                      }}
                      className="px-2.5 py-1 rounded border border-[var(--ink-border)] hover:border-[var(--ink-accent)] text-xs"
                    >
                      + {n.title}
                    </button>
                  ))}
                </div>
              )}

              <textarea
                rows={3}
                value={prompt}
                onChange={(e) => {
                  setPrompt(e.target.value);
                  setDirty(true);
                }}
                placeholder="Describe the scene beats, emotional turns, dialogue cues, or write 'Remember that...' to propose canon facts..."
                className="w-full px-3.5 py-2.5 rounded-lg bg-[var(--ink-bg)] border border-[var(--ink-border)] text-sm focus:outline-none focus:border-[var(--ink-accent)]"
              />
            </div>

            {/* Reference Image Opt-In Strip */}
            {images.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="text-[var(--ink-text-muted)] flex items-center gap-1">
                  <ImageIcon className="w-3.5 h-3.5" />
                  <span>Send Reference Images:</span>
                </span>
                {images.map((img) => {
                  const checked = selectedImageIds.includes(img.id);
                  return (
                    <label
                      key={img.id}
                      className={`px-2 py-1 rounded border cursor-pointer flex items-center gap-1.5 ${
                        checked
                          ? 'border-[var(--ink-accent)] bg-[var(--ink-accent)]/10'
                          : 'border-[var(--ink-border)] text-[var(--ink-text-muted)]'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => {
                          setSelectedImageIds((prev) =>
                            e.target.checked ? [...prev, img.id] : prev.filter((id) => id !== img.id)
                          );
                        }}
                      />
                      <span className="truncate max-w-[140px]">{img.title}</span>
                    </label>
                  );
                })}
                {selectedImageIds.length > 0 &&
                  selectedModelMeta &&
                  !selectedModelMeta.supportsVision && (
                    <span className="text-amber-600 dark:text-amber-400">
                      Text-only model selected: written notes will be sent instead of image files.
                    </span>
                  )}
              </div>
            )}

            {/* Controls Row */}
            <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
              <div className="flex flex-wrap items-center gap-2.5 text-xs">
                <select
                  value={selectedProvider}
                  onChange={(e) => {
                    const p = e.target.value as AiProviderId;
                    setSelectedProvider(p);
                    const firstModel = models.find((m) => m.provider === p);
                    if (firstModel) setSelectedModelId(firstModel.id);
                  }}
                  aria-label="AI Provider"
                  className="px-2.5 py-1.5 rounded-lg bg-[var(--ink-bg)] border border-[var(--ink-border)]"
                >
                  <option value="gemini">Google Gemini</option>
                  <option value="openai">OpenAI GPT</option>
                  <option value="anthropic">Anthropic Claude</option>
                  <option value="deepseek">DeepSeek</option>
                  <option value="meta_llama">Meta Llama</option>
                  <option value="mistral">Mistral</option>
                  <option value="openrouter">OpenRouter</option>
                  <option value="custom">Custom Endpoint</option>
                </select>

                <select
                  value={selectedModelId}
                  onChange={(e) => setSelectedModelId(e.target.value)}
                  aria-label="AI Model"
                  className="px-2.5 py-1.5 rounded-lg bg-[var(--ink-bg)] border border-[var(--ink-border)] max-w-[230px]"
                >
                  {models
                    .filter((m) => m.provider === selectedProvider)
                    .map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.displayName}
                      </option>
                    ))}
                </select>

                <div className="flex items-center gap-1.5">
                  <span className="text-[var(--ink-text-muted)]">Target:</span>
                  <input
                    type="number"
                    min={300}
                    max={8000}
                    step={100}
                    value={targetWordCount}
                    onChange={(e) => setTargetWordCount(Number(e.target.value) || 2700)}
                    className="w-20 px-2 py-1 rounded bg-[var(--ink-bg)] border border-[var(--ink-border)] font-mono-tabular"
                  />
                  <span className="text-[var(--ink-text-muted)]">words</span>
                </div>

                <span className="text-[var(--ink-text-muted)]">· {activeCredentialSummary}</span>
              </div>

              <div className="flex items-center gap-2">
                {content.trim().length > 80 && !isGenerating && (
                  <button
                    type="button"
                    disabled={isOffline}
                    onClick={() => void runGeneration('continue')}
                    className="px-3.5 py-2 rounded-lg border border-[var(--ink-border)] hover:border-[var(--ink-accent)] text-xs font-medium whitespace-nowrap disabled:opacity-50"
                  >
                    Continue Chapter
                  </button>
                )}
                <button
                  type="button"
                  disabled={isOffline || isGenerating}
                  onClick={() => void openPreflight()}
                  className="px-3.5 py-2 rounded-lg border border-[var(--ink-border)] hover:border-[var(--ink-accent)] text-xs font-medium whitespace-nowrap disabled:opacity-50"
                >
                  Preflight Review
                </button>
                <button
                  type="button"
                  disabled={isOffline || isGenerating}
                  onClick={() =>
                    void runGeneration(content.trim() ? 'regenerate' : 'draft')
                  }
                  className="px-4 py-2 rounded-lg bg-[var(--ink-accent)] hover:bg-[var(--ink-accent-hover)] text-white text-xs font-medium flex items-center gap-1.5 whitespace-nowrap disabled:opacity-50"
                >
                  <Play className="w-3.5 h-3.5" />
                  <span>{content.trim() ? 'Regenerate' : 'Generate Chapter'}</span>
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Brainstorm Side Drawer */}
      {brainstormOpen && (
        <aside className="w-80 shrink-0 border-l border-[var(--ink-border)] bg-[var(--ink-surface)] p-4 flex flex-col gap-4 overflow-y-auto">
          <div className="flex items-center justify-between">
            <h3 className="font-lora font-semibold flex items-center gap-1.5">
              <Sparkles className="w-4 h-4 text-[var(--ink-accent)]" />
              <span>Brainstorm</span>
            </h3>
            <button type="button" onClick={() => setBrainstormOpen(false)}>
              <X className="w-4 h-4 text-[var(--ink-text-muted)]" />
            </button>
          </div>
          <select
            value={brainstormCat}
            onChange={(e) => setBrainstormCat(e.target.value as typeof brainstormCat)}
            className="px-3 py-2 rounded-lg bg-[var(--ink-bg)] border border-[var(--ink-border)] text-xs"
          >
            <option value="plot_twists">Plot Twists</option>
            <option value="transitions">Scene Transitions</option>
            <option value="dialogue">Dialogue Beats</option>
            <option value="emotional_beats">Emotional Beats</option>
            <option value="character_reactions">Character Reactions</option>
            <option value="conflicts">Conflicts & Tension</option>
          </select>
          <textarea
            rows={3}
            value={brainstormPrompt}
            onChange={(e) => setBrainstormPrompt(e.target.value)}
            placeholder="What are you trying to solve in this scene?"
            className="w-full px-3 py-2 rounded-lg bg-[var(--ink-bg)] border border-[var(--ink-border)] text-xs"
          />
          <button
            type="button"
            disabled={brainstormBusy || isOffline}
            onClick={async () => {
              setBrainstormBusy(true);
              try {
                const res = await api.brainstorm({
                  novelId: novel.id,
                  category: brainstormCat,
                  prompt: brainstormPrompt,
                  provider: selectedProvider,
                  modelId: selectedModelId,
                });
                setBrainstormResult(res.ideas);
              } catch (err) {
                setBrainstormResult(err instanceof Error ? err.message : 'Brainstorm failed');
              } finally {
                setBrainstormBusy(false);
              }
            }}
            className="py-2 px-3 rounded-lg bg-[var(--ink-accent)] text-white text-xs font-medium disabled:opacity-50"
          >
            {brainstormBusy ? 'Brainstorming...' : 'Generate Ideas'}
          </button>

          {brainstormResult && (
            <div className="p-3 rounded-lg border border-[var(--ink-border)] bg-[var(--ink-bg)] text-xs whitespace-pre-wrap leading-relaxed space-y-2">
              <p>{brainstormResult}</p>
              <button
                type="button"
                onClick={() => {
                  setPrompt((p) => (p.trim() ? `${p.trim()}\n\n${brainstormResult}` : brainstormResult));
                  setDirty(true);
                }}
                className="text-[var(--ink-accent)] hover:underline font-medium"
              >
                Insert into Prompt
              </button>
            </div>
          )}
        </aside>
      )}

      {/* Full-Screen Prompt Editor Modal */}
      {fullPromptOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="w-full max-w-4xl h-[85vh] rounded-xl border border-[var(--ink-border)] bg-[var(--ink-surface)] flex flex-col p-6">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h3 className="font-lora text-lg font-semibold">Full-Screen Scene Prompt</h3>
                <p className="text-xs text-[var(--ink-text-muted)] font-mono-tabular">
                  {promptWordCount} words (supports 50 to 4,500+ words)
                </p>
              </div>
              <button
                type="button"
                onClick={() => setFullPromptOpen(false)}
                className="px-3 py-1.5 rounded-lg border border-[var(--ink-border)] text-xs"
              >
                Done
              </button>
            </div>
            <textarea
              value={prompt}
              onChange={(e) => {
                setPrompt(e.target.value);
                setDirty(true);
              }}
              className="flex-1 w-full p-4 rounded-lg bg-[var(--ink-bg)] border border-[var(--ink-border)] text-sm leading-relaxed focus:outline-none focus:border-[var(--ink-accent)]"
            />
          </div>
        </div>
      )}

      {/* Preflight Review Modal */}
      {preflightOpen && preflightData && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4 overflow-y-auto">
          <div className="w-full max-w-3xl rounded-xl border border-[var(--ink-border)] bg-[var(--ink-surface)] p-6 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <h3 className="font-lora text-xl font-semibold">Preflight Context Review</h3>
              <button type="button" onClick={() => setPreflightOpen(false)}>
                <X className="w-5 h-5 text-[var(--ink-text-muted)]" />
              </button>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs font-mono-tabular">
              <div className="p-3 rounded-lg bg-[var(--ink-bg)] border border-[var(--ink-border)]">
                <span className="text-[var(--ink-text-muted)] block">Provider / Model</span>
                <span className="font-medium truncate block">
                  {preflightData.provider} · {preflightData.modelId}
                </span>
              </div>
              <div className="p-3 rounded-lg bg-[var(--ink-bg)] border border-[var(--ink-border)]">
                <span className="text-[var(--ink-text-muted)] block">Credential Source</span>
                <span className="font-medium truncate block">{preflightData.credentialLabel}</span>
              </div>
              <div className="p-3 rounded-lg bg-[var(--ink-bg)] border border-[var(--ink-border)]">
                <span className="text-[var(--ink-text-muted)] block">Input Context</span>
                <span className="font-medium">
                  ~{preflightData.estimatedInputTokens.toLocaleString()} /{' '}
                  {preflightData.contextWindow.toLocaleString()} tok
                </span>
              </div>
              <div className="p-3 rounded-lg bg-[var(--ink-bg)] border border-[var(--ink-border)]">
                <span className="text-[var(--ink-text-muted)] block">Summaries Selected</span>
                <span className="font-medium">
                  {preflightData.includedSummaryIds.length} of {preflightData.totalSummariesCount}
                </span>
              </div>
            </div>

            {preflightData.warnings.map((w, i) => (
              <div
                key={i}
                className="p-3 rounded-lg border border-amber-500/40 bg-amber-500/10 text-xs"
              >
                {w}
              </div>
            ))}

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
              <div>
                <label className="block text-[var(--ink-text-muted)] mb-1">Timeline Anchor</label>
                <input
                  type="text"
                  value={timelineAnchor}
                  onChange={(e) => setTimelineAnchor(e.target.value)}
                  className="w-full px-3 py-2 rounded bg-[var(--ink-bg)] border border-[var(--ink-border)]"
                />
              </div>
              <div>
                <label className="block text-[var(--ink-text-muted)] mb-1">Location Anchor</label>
                <input
                  type="text"
                  value={locationAnchor}
                  onChange={(e) => setLocationAnchor(e.target.value)}
                  className="w-full px-3 py-2 rounded bg-[var(--ink-bg)] border border-[var(--ink-border)]"
                />
              </div>
              <div>
                <label className="block text-[var(--ink-text-muted)] mb-1">Target Word Count</label>
                <input
                  type="number"
                  value={targetWordCount}
                  onChange={(e) => setTargetWordCount(Number(e.target.value) || 2700)}
                  className="w-full px-3 py-2 rounded bg-[var(--ink-bg)] border border-[var(--ink-border)] font-mono-tabular"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs text-[var(--ink-text-muted)] mb-1">
                Editable Prompt
              </label>
              <textarea
                rows={4}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-[var(--ink-bg)] border border-[var(--ink-border)] text-sm"
              />
            </div>

            <div>
              <label className="block text-xs text-[var(--ink-text-muted)] mb-1">
                Pinned Canon Included ({preflightEditableCanon.length}) — one per line (editable for this run)
              </label>
              <textarea
                rows={3}
                value={preflightEditableCanon.join('\n')}
                onChange={(e) =>
                  setPreflightEditableCanon(
                    e.target.value
                      .split('\n')
                      .map((l) => l.trim())
                      .filter(Boolean)
                  )
                }
                className="w-full px-3 py-2 rounded-lg bg-[var(--ink-bg)] border border-[var(--ink-border)] text-xs"
              />
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setPreflightOpen(false)}
                className="px-4 py-2 rounded-lg border border-[var(--ink-border)] text-sm"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void runGeneration(content.trim() ? 'regenerate' : 'draft')}
                className="px-5 py-2 rounded-lg bg-[var(--ink-accent)] text-white text-sm font-medium"
              >
                Confirm & Generate
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Version History Modal */}
      {versionsOpen && activeChapter && (
        <div className="fixed inset-0 z-50 bg-black/55 flex items-center justify-center p-4">
          <div className="w-full max-w-2xl rounded-xl border border-[var(--ink-border)] bg-[var(--ink-surface)] p-6 max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-lora text-lg font-semibold">
                Version History — {activeChapter.title}
              </h3>
              <div className="flex items-center gap-2">
                {!isReadOnly && (
                  <button
                    type="button"
                    onClick={async () => {
                      await api.createChapterVersion(activeChapter.id, 'Manual snapshot');
                      const res = await api.listChapterVersions(activeChapter.id);
                      setVersions(res.versions);
                    }}
                    className="px-3 py-1 rounded border border-[var(--ink-border)] text-xs"
                  >
                    + Save Snapshot
                  </button>
                )}
                <button type="button" onClick={() => setVersionsOpen(false)}>
                  <X className="w-4 h-4 text-[var(--ink-text-muted)]" />
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto space-y-3">
              {versions.length === 0 ? (
                <p className="text-sm text-[var(--ink-text-muted)] text-center py-8">
                  No saved snapshots yet. Snapshots are created automatically before AI generations and major edits.
                </p>
              ) : (
                versions.map((v) => (
                  <div
                    key={v.id}
                    className="p-4 rounded-lg border border-[var(--ink-border)] bg-[var(--ink-bg)] space-y-2"
                  >
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-medium">
                        {v.reason} · {v.wordCount.toLocaleString()} words
                      </span>
                      <span className="text-[var(--ink-text-muted)]">
                        {formatRelativeDate(v.createdAt)}
                      </span>
                    </div>
                    <p className="text-xs text-[var(--ink-text-muted)] line-clamp-3 font-lora">
                      {v.content || '(empty)'}
                    </p>
                    {!isReadOnly && (
                      <button
                        type="button"
                        onClick={async () => {
                          const { chapter } = await api.restoreChapterVersion(activeChapter.id, v.id);
                          setTitle(chapter.title);
                          setContent(chapter.content);
                          setPrompt(chapter.prompt);
                          setDirty(false);
                          setVersionsOpen(false);
                          onChapterSavedLocal(chapter);
                        }}
                        className="text-xs font-medium text-[var(--ink-accent)] hover:underline"
                      >
                        Restore This Version
                      </button>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* Confirm Chapter Move to Trash */}
      {confirmTrashChapter && (
        <div className="fixed inset-0 z-50 bg-black/55 flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-xl border border-[var(--ink-border)] bg-[var(--ink-surface)] p-6">
            <h3 className="text-lg font-semibold mb-2">Move chapter to Trash?</h3>
            <p className="text-sm text-[var(--ink-text-muted)] mb-5">
              "{confirmTrashChapter.title}" will be moved to Trash. You can restore it anytime from the Trash tab. Other chapters remain untouched.
            </p>
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setConfirmTrashChapter(null)}
                className="px-4 py-2 rounded-lg border border-[var(--ink-border)] text-sm"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={async () => {
                  const target = confirmTrashChapter;
                  setConfirmTrashChapter(null);
                  await api.trashChapter(target.id);
                  await onChaptersChanged();
                }}
                className="px-4 py-2 rounded-lg bg-red-600 text-white text-sm font-medium"
              >
                Move to Trash
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirm Chapter Permanent Delete */}
      {confirmPermChapter && (
        <div className="fixed inset-0 z-50 bg-black/55 flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-xl border border-[var(--ink-border)] bg-[var(--ink-surface)] p-6">
            <h3 className="text-lg font-semibold mb-2">Delete chapter permanently?</h3>
            <p className="text-sm text-[var(--ink-text-muted)] mb-5">
              "{confirmPermChapter.title}" and its version history will be permanently deleted. This cannot be undone.
            </p>
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setConfirmPermChapter(null)}
                className="px-4 py-2 rounded-lg border border-[var(--ink-border)] text-sm"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={async () => {
                  const target = confirmPermChapter;
                  setConfirmPermChapter(null);
                  await api.deleteChapterPermanent(target.id);
                  await onChaptersChanged();
                }}
                className="px-4 py-2 rounded-lg bg-red-600 text-white text-sm font-medium"
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
