import React, { useState } from 'react';
import { ArrowLeft, ArrowRight, Check, Plus, Trash2, Upload, X } from 'lucide-react';
import { api } from '../lib/api';
import type {
  CharacterProfile,
  CharacterStatus,
  NovelGenre,
  StoryDna,
} from '../types';

interface DraftCharacterInput {
  tempId: string;
  roleType: CharacterProfile['roleType'];
  name: string;
  age: string;
  role: string;
  archetype: string;
  personality: string;
  psychologicalTraits: string;
  triggers: string;
  vulnerabilities: string;
  relationshipDynamics: string;
  relationships: string;
  physicalAppearance: string;
  backstory: string;
  characterDevelopment: string;
  status: CharacterStatus;
  customStatus: string;
  location: string;
  imageFile: File | null;
  imagePreviewUrl: string | null;
}

const GENRES: NovelGenre[] = [
  'Dark Romance',
  'Romance',
  'Epic Fantasy',
  'Psychological Thriller',
  'Sci-Fi',
  'Historical Fiction',
  'Contemporary Drama',
  'Custom',
];

const CHAR_STATUSES: CharacterStatus[] = [
  'Active',
  'Injured',
  'Missing',
  'Estranged',
  'Deceased',
  'Custom',
];

function createEmptyLead(roleType: 'lead_male' | 'lead_female', defaultRole: string): DraftCharacterInput {
  return {
    tempId: `${roleType}-${Math.random().toString(36).slice(2)}`,
    roleType,
    name: '',
    age: '',
    role: defaultRole,
    archetype: '',
    personality: '',
    psychologicalTraits: '',
    triggers: '',
    vulnerabilities: '',
    relationshipDynamics: '',
    relationships: '',
    physicalAppearance: '',
    backstory: '',
    characterDevelopment: '',
    status: 'Active',
    customStatus: '',
    location: '',
    imageFile: null,
    imagePreviewUrl: null,
  };
}

function createEmptySupporting(): DraftCharacterInput {
  return {
    tempId: `sup-${Math.random().toString(36).slice(2)}`,
    roleType: 'supporting',
    name: '',
    age: '',
    role: 'Supporting',
    archetype: '',
    personality: '',
    psychologicalTraits: '',
    triggers: '',
    vulnerabilities: '',
    relationshipDynamics: '',
    relationships: '',
    physicalAppearance: '',
    backstory: '',
    characterDevelopment: '',
    status: 'Active',
    customStatus: '',
    location: '',
    imageFile: null,
    imagePreviewUrl: null,
  };
}

interface NovelWizardModalProps {
  defaultAuthorName: string;
  onClose: () => void;
  onCreated: (novelId: string) => void;
}

export const NovelWizardModal: React.FC<NovelWizardModalProps> = ({
  defaultAuthorName,
  onClose,
  onCreated,
}) => {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Step 1: Story DNA & Cover
  const [title, setTitle] = useState('');
  const [authorName, setAuthorName] = useState(defaultAuthorName);
  const [genre, setGenre] = useState<NovelGenre>('Dark Romance');
  const [customGenre, setCustomGenre] = useState('');
  const [synopsis, setSynopsis] = useState('');
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [coverPreview, setCoverPreview] = useState<string | null>(null);

  const [storyDna, setStoryDna] = useState<StoryDna>({
    narrationLanguage: 'English',
    dialogueLanguages: ['English'],
    mixedLanguageWriting: false,
    romanScriptOnly: false,
    perspective: 'Third Person Limited',
    tense: 'Past Tense',
    pacing: 'Measured',
    contentBoundaries: '',
    writingRules: '',
  });
  const [dialogueLangText, setDialogueLangText] = useState('English');

  // Step 2: Two Primary Leads
  const [leads, setLeads] = useState<DraftCharacterInput[]>([
    createEmptyLead('lead_male', 'Male Lead'),
    createEmptyLead('lead_female', 'Female Lead'),
  ]);

  // Step 3: Supporting Cast (up to 30)
  const [supporting, setSupporting] = useState<DraftCharacterInput[]>([]);

  const handleImagePick = (
    file: File | undefined,
    onDone: (file: File, previewUrl: string) => void
  ) => {
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setError('Only JPEG, PNG, and WebP images are supported.');
      return;
    }
    setError(null);
    const url = URL.createObjectURL(file);
    onDone(file, url);
  };

  const updateLead = (idx: number, patch: Partial<DraftCharacterInput>) => {
    setLeads((prev) => prev.map((item, i) => (i === idx ? { ...item, ...patch } : item)));
  };

  const updateSupporting = (idx: number, patch: Partial<DraftCharacterInput>) => {
    setSupporting((prev) => prev.map((item, i) => (i === idx ? { ...item, ...patch } : item)));
  };

  const handleFinish = async () => {
    if (!title.trim()) {
      setError('Novel title is required.');
      setStep(1);
      return;
    }
    setError(null);
    setSubmitting(true);

    try {
      const parsedDialogueLangs = dialogueLangText
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);

      const finalGenre = genre === 'Custom' && customGenre.trim() ? customGenre.trim() : genre;

      const allChars = [...leads, ...supporting].filter((c) => c.name.trim());

      const { novel } = await api.createNovel({
        title: title.trim(),
        authorName: authorName.trim(),
        genre: finalGenre,
        synopsis: synopsis.trim(),
        storyDna: {
          ...storyDna,
          dialogueLanguages: parsedDialogueLangs.length ? parsedDialogueLangs : ['English'],
        },
        characters: allChars.map((c) => ({
          roleType: c.roleType,
          name: c.name.trim(),
          age: c.age,
          role: c.role,
          archetype: c.archetype,
          personality: c.personality,
          psychologicalTraits: c.psychologicalTraits,
          triggers: c.triggers,
          vulnerabilities: c.vulnerabilities,
          relationshipDynamics: c.relationshipDynamics,
          relationships: c.relationships,
          physicalAppearance: c.physicalAppearance,
          backstory: c.backstory,
          characterDevelopment: c.characterDevelopment,
          status: c.status,
          customStatus: c.customStatus,
          location: c.location,
        })),
      });

      // Upload cover image if chosen
      if (coverFile) {
        const fd = new FormData();
        fd.append('file', coverFile);
        fd.append('entityType', 'cover');
        fd.append('category', 'cover');
        fd.append('title', `${novel.title} Cover`);
        await api.uploadImage(novel.id, fd);
      }

      // Match newly created characters by name + upload their images if provided
      if (allChars.some((c) => c.imageFile)) {
        const bundle = await api.getNovelBundle(novel.id);
        for (const draftChar of allChars) {
          if (!draftChar.imageFile) continue;
          const match = bundle.characters.find(
            (bc) => bc.name.toLowerCase() === draftChar.name.trim().toLowerCase()
          );
          if (match) {
            const fd = new FormData();
            fd.append('file', draftChar.imageFile);
            fd.append('entityType', 'character');
            fd.append('entityId', match.id);
            fd.append('category', 'character');
            fd.append('title', `${match.name} Portrait`);
            await api.uploadImage(novel.id, fd);
          }
        }
      }

      onCreated(novel.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create novel');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4 overflow-y-auto">
      <div className="w-full max-w-4xl rounded-xl border border-[var(--ink-border)] bg-[var(--ink-surface)] flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="px-6 py-4 border-b border-[var(--ink-border)] flex items-center justify-between gap-4">
          <div>
            <p className="text-xs text-[var(--ink-text-muted)]">
              Step {step} of 3 · Novel Creation Wizard
            </p>
            <h2 className="font-lora text-xl font-semibold">
              {step === 1
                ? 'Story DNA & Cover'
                : step === 2
                  ? 'Primary Lead Profiles'
                  : 'Supporting Cast (Optional, up to 30)'}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close wizard"
            className="p-2 rounded-lg text-[var(--ink-text-muted)] hover:text-[var(--ink-text)]"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 overflow-y-auto space-y-6 flex-1">
          {error && (
            <div className="p-3 rounded-lg border border-red-500/40 bg-red-500/10 text-sm text-red-600 dark:text-red-300">
              {error}
            </div>
          )}

          {step === 1 && (
            <div className="space-y-5">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                <div className="md:col-span-2 space-y-4">
                  <div>
                    <label className="block text-xs font-medium text-[var(--ink-text-muted)] mb-1">
                      Novel Title *
                    </label>
                    <input
                      type="text"
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      placeholder="Enter your novel title"
                      className="w-full px-3.5 py-2.5 rounded-lg bg-[var(--ink-bg)] border border-[var(--ink-border)] text-sm"
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-medium text-[var(--ink-text-muted)] mb-1">
                        Author / Pen Name
                      </label>
                      <input
                        type="text"
                        value={authorName}
                        onChange={(e) => setAuthorName(e.target.value)}
                        className="w-full px-3.5 py-2 rounded-lg bg-[var(--ink-bg)] border border-[var(--ink-border)] text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-[var(--ink-text-muted)] mb-1">
                        Genre
                      </label>
                      <select
                        value={genre}
                        onChange={(e) => setGenre(e.target.value as NovelGenre)}
                        className="w-full px-3.5 py-2 rounded-lg bg-[var(--ink-bg)] border border-[var(--ink-border)] text-sm"
                      >
                        {GENRES.map((g) => (
                          <option key={g} value={g}>
                            {g}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {genre === 'Custom' && (
                    <div>
                      <label className="block text-xs font-medium text-[var(--ink-text-muted)] mb-1">
                        Custom Genre Label
                      </label>
                      <input
                        type="text"
                        value={customGenre}
                        onChange={(e) => setCustomGenre(e.target.value)}
                        placeholder="e.g., Gothic Mystery / Mythology"
                        className="w-full px-3.5 py-2 rounded-lg bg-[var(--ink-bg)] border border-[var(--ink-border)] text-sm"
                      />
                    </div>
                  )}

                  <div>
                    <label className="block text-xs font-medium text-[var(--ink-text-muted)] mb-1">
                      Premise & Synopsis
                    </label>
                    <textarea
                      rows={3}
                      value={synopsis}
                      onChange={(e) => setSynopsis(e.target.value)}
                      placeholder="Core premise, central conflict, and thematic arc..."
                      className="w-full px-3.5 py-2 rounded-lg bg-[var(--ink-bg)] border border-[var(--ink-border)] text-sm"
                    />
                  </div>
                </div>

                {/* Author-Uploaded Cover Image */}
                <div>
                  <label className="block text-xs font-medium text-[var(--ink-text-muted)] mb-1">
                    Novel Cover (Author Upload Only)
                  </label>
                  <label className="block border border-dashed border-[var(--ink-border)] rounded-xl h-56 bg-[var(--ink-bg)] cursor-pointer overflow-hidden flex flex-col items-center justify-center p-4 text-center hover:border-[var(--ink-accent)] transition-colors">
                    {coverPreview ? (
                      <img
                        src={coverPreview}
                        alt="Cover preview"
                        className="w-full h-full object-cover rounded-lg"
                      />
                    ) : (
                      <>
                        <Upload className="w-5 h-5 text-[var(--ink-accent)] mb-2" />
                        <span className="text-xs font-medium">Upload Cover Image</span>
                        <span className="text-[11px] text-[var(--ink-text-muted)] mt-1">
                          JPEG, PNG or WebP (max 8 MB)
                        </span>
                      </>
                    )}
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      className="hidden"
                      onChange={(e) =>
                        handleImagePick(e.target.files?.[0], (file, url) => {
                          setCoverFile(file);
                          setCoverPreview(url);
                        })
                      }
                    />
                  </label>
                </div>
              </div>

              {/* Language & Voice */}
              <div className="pt-4 border-t border-[var(--ink-border)] grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-medium text-[var(--ink-text-muted)] mb-1">
                    Narration Language
                  </label>
                  <input
                    type="text"
                    value={storyDna.narrationLanguage}
                    onChange={(e) =>
                      setStoryDna({ ...storyDna, narrationLanguage: e.target.value })
                    }
                    className="w-full px-3 py-2 rounded-lg bg-[var(--ink-bg)] border border-[var(--ink-border)] text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[var(--ink-text-muted)] mb-1">
                    Dialogue Languages (comma-separated)
                  </label>
                  <input
                    type="text"
                    value={dialogueLangText}
                    onChange={(e) => setDialogueLangText(e.target.value)}
                    placeholder="English, Hindi, Italian"
                    className="w-full px-3 py-2 rounded-lg bg-[var(--ink-bg)] border border-[var(--ink-border)] text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[var(--ink-text-muted)] mb-1">
                    Perspective
                  </label>
                  <select
                    value={storyDna.perspective}
                    onChange={(e) =>
                      setStoryDna({
                        ...storyDna,
                        perspective: e.target.value as StoryDna['perspective'],
                      })
                    }
                    className="w-full px-3 py-2 rounded-lg bg-[var(--ink-bg)] border border-[var(--ink-border)] text-sm"
                  >
                    <option value="First Person">First Person</option>
                    <option value="Third Person Limited">Third Person Limited</option>
                    <option value="Third Person Omniscient">Third Person Omniscient</option>
                    <option value="Multi-POV">Multi-POV</option>
                    <option value="Second Person">Second Person</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-[var(--ink-text-muted)] mb-1">
                    Narrative Tense
                  </label>
                  <select
                    value={storyDna.tense}
                    onChange={(e) =>
                      setStoryDna({ ...storyDna, tense: e.target.value as StoryDna['tense'] })
                    }
                    className="w-full px-3 py-2 rounded-lg bg-[var(--ink-bg)] border border-[var(--ink-border)] text-sm"
                  >
                    <option value="Past Tense">Past Tense</option>
                    <option value="Present Tense">Present Tense</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-[var(--ink-text-muted)] mb-1">
                    Pacing
                  </label>
                  <select
                    value={storyDna.pacing}
                    onChange={(e) =>
                      setStoryDna({ ...storyDna, pacing: e.target.value as StoryDna['pacing'] })
                    }
                    className="w-full px-3 py-2 rounded-lg bg-[var(--ink-bg)] border border-[var(--ink-border)] text-sm"
                  >
                    <option value="Slow Burn">Slow Burn</option>
                    <option value="Measured">Measured</option>
                    <option value="Fast-Paced">Fast-Paced</option>
                    <option value="Atmospheric">Atmospheric</option>
                  </select>
                </div>
              </div>

              <div className="flex flex-wrap gap-6">
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={storyDna.mixedLanguageWriting}
                    onChange={(e) =>
                      setStoryDna({ ...storyDna, mixedLanguageWriting: e.target.checked })
                    }
                  />
                  <span>Enable mixed-language dialogue</span>
                </label>
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={storyDna.romanScriptOnly}
                    onChange={(e) =>
                      setStoryDna({ ...storyDna, romanScriptOnly: e.target.checked })
                    }
                  />
                  <span>Roman-script-only transliteration</span>
                </label>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-[var(--ink-text-muted)] mb-1">
                    Content Boundaries
                  </label>
                  <textarea
                    rows={2}
                    value={storyDna.contentBoundaries}
                    onChange={(e) =>
                      setStoryDna({ ...storyDna, contentBoundaries: e.target.value })
                    }
                    placeholder="Themes to handle sensitively or exclude..."
                    className="w-full px-3 py-2 rounded-lg bg-[var(--ink-bg)] border border-[var(--ink-border)] text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[var(--ink-text-muted)] mb-1">
                    Writing Style & Rules
                  </label>
                  <textarea
                    rows={2}
                    value={storyDna.writingRules}
                    onChange={(e) => setStoryDna({ ...storyDna, writingRules: e.target.value })}
                    placeholder="Prose cadence, sensory focus, dialogue conventions..."
                    className="w-full px-3 py-2 rounded-lg bg-[var(--ink-bg)] border border-[var(--ink-border)] text-sm"
                  />
                </div>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-8">
              {leads.map((lead, idx) => (
                <div
                  key={lead.tempId}
                  className="p-5 rounded-xl border border-[var(--ink-border)] bg-[var(--ink-bg)] space-y-4"
                >
                  <div className="flex flex-col sm:flex-row gap-5">
                    <label className="w-32 h-36 shrink-0 rounded-lg border border-dashed border-[var(--ink-border)] bg-[var(--ink-surface)] cursor-pointer flex flex-col items-center justify-center text-center overflow-hidden hover:border-[var(--ink-accent)]">
                      {lead.imagePreviewUrl ? (
                        <img
                          src={lead.imagePreviewUrl}
                          alt={lead.name || lead.role}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="p-2">
                          <Upload className="w-4 h-4 mx-auto text-[var(--ink-accent)] mb-1" />
                          <span className="text-[11px] text-[var(--ink-text-muted)]">
                            Lead Portrait
                          </span>
                        </div>
                      )}
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        className="hidden"
                        onChange={(e) =>
                          handleImagePick(e.target.files?.[0], (file, url) =>
                            updateLead(idx, { imageFile: file, imagePreviewUrl: url })
                          )
                        }
                      />
                    </label>

                    <div className="flex-1 grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div>
                        <label className="block text-xs text-[var(--ink-text-muted)] mb-1">
                          Lead {idx + 1} Name
                        </label>
                        <input
                          type="text"
                          value={lead.name}
                          onChange={(e) => updateLead(idx, { name: e.target.value })}
                          placeholder="Full name"
                          className="w-full px-3 py-2 rounded-lg bg-[var(--ink-surface)] border border-[var(--ink-border)] text-sm"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-[var(--ink-text-muted)] mb-1">
                          Age
                        </label>
                        <input
                          type="text"
                          value={lead.age}
                          onChange={(e) => updateLead(idx, { age: e.target.value })}
                          placeholder="e.g., 28"
                          className="w-full px-3 py-2 rounded-lg bg-[var(--ink-surface)] border border-[var(--ink-border)] text-sm"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-[var(--ink-text-muted)] mb-1">
                          Role
                        </label>
                        <input
                          type="text"
                          value={lead.role}
                          onChange={(e) => updateLead(idx, { role: e.target.value })}
                          className="w-full px-3 py-2 rounded-lg bg-[var(--ink-surface)] border border-[var(--ink-border)] text-sm"
                        />
                      </div>
                      <div className="sm:col-span-3">
                        <label className="block text-xs text-[var(--ink-text-muted)] mb-1">
                          Physical Appearance
                        </label>
                        <input
                          type="text"
                          value={lead.physicalAppearance}
                          onChange={(e) => updateLead(idx, { physicalAppearance: e.target.value })}
                          placeholder="Height, build, eyes, posture, signature wardrobe..."
                          className="w-full px-3 py-2 rounded-lg bg-[var(--ink-surface)] border border-[var(--ink-border)] text-sm"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-[var(--ink-text-muted)] mb-1">
                        Personality & Temperament
                      </label>
                      <textarea
                        rows={2}
                        value={lead.personality}
                        onChange={(e) => updateLead(idx, { personality: e.target.value })}
                        className="w-full px-3 py-2 rounded-lg bg-[var(--ink-surface)] border border-[var(--ink-border)] text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-[var(--ink-text-muted)] mb-1">
                        Psychological Traits
                      </label>
                      <textarea
                        rows={2}
                        value={lead.psychologicalTraits}
                        onChange={(e) => updateLead(idx, { psychologicalTraits: e.target.value })}
                        className="w-full px-3 py-2 rounded-lg bg-[var(--ink-surface)] border border-[var(--ink-border)] text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-[var(--ink-text-muted)] mb-1">
                        Triggers
                      </label>
                      <input
                        type="text"
                        value={lead.triggers}
                        onChange={(e) => updateLead(idx, { triggers: e.target.value })}
                        className="w-full px-3 py-2 rounded-lg bg-[var(--ink-surface)] border border-[var(--ink-border)] text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-[var(--ink-text-muted)] mb-1">
                        Vulnerabilities
                      </label>
                      <input
                        type="text"
                        value={lead.vulnerabilities}
                        onChange={(e) => updateLead(idx, { vulnerabilities: e.target.value })}
                        className="w-full px-3 py-2 rounded-lg bg-[var(--ink-surface)] border border-[var(--ink-border)] text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-[var(--ink-text-muted)] mb-1">
                        Relationship Dynamics
                      </label>
                      <textarea
                        rows={2}
                        value={lead.relationshipDynamics}
                        onChange={(e) =>
                          updateLead(idx, { relationshipDynamics: e.target.value })
                        }
                        className="w-full px-3 py-2 rounded-lg bg-[var(--ink-surface)] border border-[var(--ink-border)] text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-[var(--ink-text-muted)] mb-1">
                        Backstory
                      </label>
                      <textarea
                        rows={2}
                        value={lead.backstory}
                        onChange={(e) => updateLead(idx, { backstory: e.target.value })}
                        className="w-full px-3 py-2 rounded-lg bg-[var(--ink-surface)] border border-[var(--ink-border)] text-sm"
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="block text-xs text-[var(--ink-text-muted)] mb-1">
                        Planned Character Development Arc
                      </label>
                      <input
                        type="text"
                        value={lead.characterDevelopment}
                        onChange={(e) =>
                          updateLead(idx, { characterDevelopment: e.target.value })
                        }
                        className="w-full px-3 py-2 rounded-lg bg-[var(--ink-surface)] border border-[var(--ink-border)] text-sm"
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-sm text-[var(--ink-text-muted)]">
                  Add up to 30 supporting characters ({supporting.length}/30). You can also add or edit them anytime in the Story Bible.
                </p>
                <button
                  type="button"
                  disabled={supporting.length >= 30}
                  onClick={() => setSupporting((prev) => [...prev, createEmptySupporting()])}
                  className="px-3.5 py-2 rounded-lg border border-[var(--ink-border)] hover:border-[var(--ink-accent)] text-sm font-medium flex items-center gap-1.5 whitespace-nowrap disabled:opacity-50"
                >
                  <Plus className="w-4 h-4" />
                  <span>Add Supporting Character</span>
                </button>
              </div>

              {supporting.length === 0 ? (
                <div className="py-12 rounded-xl border border-dashed border-[var(--ink-border)] text-center text-sm text-[var(--ink-text-muted)]">
                  No supporting characters added yet. Click "Add Supporting Character" or finish now and add them later.
                </div>
              ) : (
                <div className="space-y-4">
                  {supporting.map((char, idx) => (
                    <div
                      key={char.tempId}
                      className="p-4 rounded-xl border border-[var(--ink-border)] bg-[var(--ink-bg)] space-y-3"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-medium text-[var(--ink-text-muted)]">
                          Supporting Character #{idx + 1}
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            setSupporting((prev) => prev.filter((_, i) => i !== idx))
                          }
                          className="text-xs text-red-600 dark:text-red-400 flex items-center gap-1"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          <span>Remove</span>
                        </button>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                        <input
                          type="text"
                          value={char.name}
                          onChange={(e) => updateSupporting(idx, { name: e.target.value })}
                          placeholder="Name"
                          className="px-3 py-2 rounded-lg bg-[var(--ink-surface)] border border-[var(--ink-border)] text-sm"
                        />
                        <input
                          type="text"
                          value={char.age}
                          onChange={(e) => updateSupporting(idx, { age: e.target.value })}
                          placeholder="Age"
                          className="px-3 py-2 rounded-lg bg-[var(--ink-surface)] border border-[var(--ink-border)] text-sm"
                        />
                        <input
                          type="text"
                          value={char.archetype}
                          onChange={(e) => updateSupporting(idx, { archetype: e.target.value })}
                          placeholder="Archetype (e.g., Confidant)"
                          className="px-3 py-2 rounded-lg bg-[var(--ink-surface)] border border-[var(--ink-border)] text-sm"
                        />
                        <select
                          value={char.status}
                          onChange={(e) =>
                            updateSupporting(idx, { status: e.target.value as CharacterStatus })
                          }
                          className="px-3 py-2 rounded-lg bg-[var(--ink-surface)] border border-[var(--ink-border)] text-sm"
                        >
                          {CHAR_STATUSES.map((st) => (
                            <option key={st} value={st}>
                              {st}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <input
                          type="text"
                          value={char.relationships}
                          onChange={(e) =>
                            updateSupporting(idx, { relationships: e.target.value })
                          }
                          placeholder="Relationships to leads"
                          className="px-3 py-2 rounded-lg bg-[var(--ink-surface)] border border-[var(--ink-border)] text-sm"
                        />
                        <input
                          type="text"
                          value={char.location}
                          onChange={(e) => updateSupporting(idx, { location: e.target.value })}
                          placeholder="Current location"
                          className="px-3 py-2 rounded-lg bg-[var(--ink-surface)] border border-[var(--ink-border)] text-sm"
                        />
                        <label className="px-3 py-2 rounded-lg bg-[var(--ink-surface)] border border-[var(--ink-border)] text-xs flex items-center gap-2 cursor-pointer truncate">
                          <Upload className="w-3.5 h-3.5 text-[var(--ink-accent)] shrink-0" />
                          <span className="truncate">
                            {char.imageFile ? char.imageFile.name : 'Upload portrait (optional)'}
                          </span>
                          <input
                            type="file"
                            accept="image/jpeg,image/png,image/webp"
                            className="hidden"
                            onChange={(e) =>
                              handleImagePick(e.target.files?.[0], (file, url) =>
                                updateSupporting(idx, { imageFile: file, imagePreviewUrl: url })
                              )
                            }
                          />
                        </label>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <input
                          type="text"
                          value={char.personality}
                          onChange={(e) => updateSupporting(idx, { personality: e.target.value })}
                          placeholder="Personality"
                          className="px-3 py-2 rounded-lg bg-[var(--ink-surface)] border border-[var(--ink-border)] text-sm"
                        />
                        <input
                          type="text"
                          value={char.backstory}
                          onChange={(e) => updateSupporting(idx, { backstory: e.target.value })}
                          placeholder="Backstory summary"
                          className="px-3 py-2 rounded-lg bg-[var(--ink-surface)] border border-[var(--ink-border)] text-sm"
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer Controls */}
        <div className="px-6 py-4 border-t border-[var(--ink-border)] flex items-center justify-between gap-4">
          <button
            type="button"
            onClick={() => (step === 1 ? onClose() : setStep((s) => (s - 1) as 1 | 2))}
            className="px-4 py-2 rounded-lg border border-[var(--ink-border)] text-sm flex items-center gap-1.5"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>{step === 1 ? 'Cancel' : 'Back'}</span>
          </button>

          {step < 3 ? (
            <button
              type="button"
              onClick={() => {
                if (step === 1 && !title.trim()) {
                  setError('Please enter a novel title before continuing.');
                  return;
                }
                setError(null);
                setStep((s) => (s + 1) as 2 | 3);
              }}
              className="px-5 py-2 rounded-lg bg-[var(--ink-accent)] hover:bg-[var(--ink-accent-hover)] text-white text-sm font-medium flex items-center gap-1.5"
            >
              <span>Continue</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          ) : (
            <button
              type="button"
              disabled={submitting}
              onClick={handleFinish}
              className="px-5 py-2 rounded-lg bg-[var(--ink-accent)] hover:bg-[var(--ink-accent-hover)] text-white text-sm font-medium flex items-center gap-1.5 disabled:opacity-60"
            >
              <Check className="w-4 h-4" />
              <span>{submitting ? 'Creating Novel...' : 'Create Novel'}</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
