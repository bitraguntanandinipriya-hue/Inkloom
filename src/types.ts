export type ThemeMode = 'system' | 'light' | 'dark';

export type ManuscriptFont = 'lora' | 'merriweather' | 'source-serif' | 'inter';

export interface EditorPreferences {
  manuscriptFont: ManuscriptFont;
  fontSizePx: number;
  lineSpacing: number;
  maxWidthCh: number;
  defaultChapterWordTarget: number;
  showParagraphGuides: boolean;
}

export interface AiPreferences {
  defaultProvider: AiProviderId;
  defaultModelId: string;
  backgroundIntelligenceEnabled: boolean;
  economicalModelId: string;
  thinkingMode: 'fast' | 'balanced' | 'deep';
}

export interface UserProfile {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  authMethod: 'email' | 'google';
  themePreference: ThemeMode;
  editorPrefs: EditorPreferences;
  aiPrefs: AiPreferences;
  createdAt: string;
  updatedAt: string;
}

export type NovelGenre =
  | 'Dark Romance'
  | 'Romance'
  | 'Epic Fantasy'
  | 'Psychological Thriller'
  | 'Sci-Fi'
  | 'Historical Fiction'
  | 'Contemporary Drama'
  | 'Custom';

export interface StoryDna {
  narrationLanguage: string;
  dialogueLanguages: string[];
  mixedLanguageWriting: boolean;
  romanScriptOnly: boolean;
  perspective: 'First Person' | 'Third Person Limited' | 'Third Person Omniscient' | 'Second Person' | 'Multi-POV';
  tense: 'Past Tense' | 'Present Tense';
  pacing: 'Slow Burn' | 'Measured' | 'Fast-Paced' | 'Atmospheric';
  contentBoundaries: string;
  writingRules: string;
  customGenreLabel?: string;
}

export type NovelStatus = 'active' | 'completed' | 'trashed';

export interface Novel {
  id: string;
  userId: string;
  title: string;
  authorName: string;
  genre: NovelGenre | string;
  synopsis: string;
  coverImageId: string | null;
  status: NovelStatus;
  completedAt: string | null;
  trashedAt: string | null;
  storyDna: StoryDna;
  chapterCount?: number;
  totalWordCount?: number;
  createdAt: string;
  updatedAt: string;
}

export type CharacterStatus =
  | 'Active'
  | 'Injured'
  | 'Missing'
  | 'Estranged'
  | 'Deceased'
  | 'Custom';

export type CharacterRoleType = 'lead_male' | 'lead_female' | 'lead_custom' | 'supporting';

export interface CharacterProfile {
  id: string;
  novelId: string;
  userId: string;
  roleType: CharacterRoleType;
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
  imageId: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export type ReferenceImageCategory =
  | 'cover'
  | 'character'
  | 'location'
  | 'architecture'
  | 'clothing'
  | 'prop'
  | 'other';

export interface UploadedImage {
  id: string;
  userId: string;
  novelId: string;
  entityType: 'cover' | 'character' | 'reference';
  entityId: string | null;
  category: ReferenceImageCategory;
  title: string;
  notes: string;
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
  sizeBytes: number;
  url: string;
  createdAt: string;
}

export type ChapterStatus = 'Draft' | 'Confirmed' | 'Completed';

export interface Chapter {
  id: string;
  novelId: string;
  userId: string;
  chapterNumber: number;
  title: string;
  content: string;
  prompt: string;
  timelineAnchor: string;
  locationAnchor: string;
  status: ChapterStatus;
  wordCount: number;
  trashedAt: string | null;
  clientUpdatedAt: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  syncState?: 'synced' | 'pending' | 'conflict';
}

export interface ChapterVersion {
  id: string;
  chapterId: string;
  title: string;
  content: string;
  prompt: string;
  wordCount: number;
  reason: string;
  createdAt: string;
}

export interface CanonFact {
  id: string;
  novelId: string;
  factText: string;
  category: string;
  sourceChapterId: string | null;
  approvalStatus: 'pending' | 'pinned' | 'rejected';
  isPinned: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ChapterSummary {
  id: string;
  novelId: string;
  chapterId: string;
  chapterNumber?: number;
  chapterTitle?: string;
  summaryText: string;
  timelineNote: string;
  locations: string[];
  characters: string[];
  objects: string[];
  revelations: string[];
  createdAt: string;
  updatedAt: string;
}

export interface CharacterStateProposal {
  id: string;
  novelId: string;
  chapterId: string;
  characterId: string;
  characterName?: string;
  proposedStatus: CharacterStatus;
  proposedLocation: string;
  reason: string;
  approvalStatus: 'pending' | 'approved' | 'rejected';
  createdAt: string;
}

export interface ScratchpadNote {
  id: string;
  novelId: string;
  title: string;
  content: string;
  category: string;
  createdAt: string;
  updatedAt: string;
}

export type AiProviderId =
  | 'gemini'
  | 'openai'
  | 'anthropic'
  | 'deepseek'
  | 'meta_llama'
  | 'mistral'
  | 'openrouter'
  | 'custom';

export type ModelFilterTag =
  | 'Free'
  | 'Paid'
  | 'Reasoning'
  | 'Creative Writing'
  | 'Long Context'
  | 'Vision'
  | 'Fast';

export interface AiModelInfo {
  id: string;
  provider: AiProviderId;
  displayName: string;
  contextWindow: number;
  maxOutputTokens: number;
  supportsStreaming: boolean;
  supportsVision: boolean;
  pricingTier: 'free_quota' | 'promotional_credits' | 'free_hosted' | 'paid_api' | 'open_weight_self_host';
  pricingSummary: string;
  availabilityNote: string;
  tags: ModelFilterTag[];
  recommendedFor?: string;
}

export interface ProviderCredentialPublic {
  id: string;
  provider: AiProviderId;
  label: string;
  endpointUrl: string | null;
  hasApiKey: boolean;
  keyPreview: string;
  isDefault: boolean;
  lastStatus: 'untested' | 'valid' | 'invalid' | 'rate_limited';
  lastError: string | null;
  lastTestedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type GenerationLifecycleState =
  | 'Idle'
  | 'Preparing Context'
  | 'Connecting'
  | 'Generating'
  | 'Streaming'
  | 'Saving'
  | 'Summarising'
  | 'Completed'
  | 'Failed'
  | 'Cancelled'
  | 'Recoverable Interruption';

export interface PreflightContextSummary {
  provider: AiProviderId;
  modelId: string;
  credentialSource: 'managed' | 'author';
  credentialLabel: string;
  modelSupportsVision: boolean;
  contextWindow: number;
  estimatedInputTokens: number;
  estimatedPromptTokens: number;
  estimatedStoryDnaTokens: number;
  estimatedCanonTokens: number;
  estimatedSummaryTokens: number;
  estimatedRecentProseTokens: number;
  includedCanonCount: number;
  includedSummaryIds: string[];
  totalSummariesCount: number;
  includedCharacterNames: string[];
  writtenImageNotesCount: number;
  selectedImageIds: string[];
  warnings: string[];
  assembledSystemPromptPreview: string;
}

export interface AiUsageLog {
  id: string;
  requestId: string;
  novelId: string | null;
  chapterId: string | null;
  provider: AiProviderId;
  modelId: string;
  credentialSource: 'managed' | 'author';
  inputTokensEst: number;
  outputTokensEst: number;
  estimatedCostUsd: number;
  status: string;
  durationMs: number;
  errorMessage: string | null;
  createdAt: string;
}

export interface BackgroundJob {
  id: string;
  novelId: string;
  chapterId: string;
  jobType: 'summarize_and_extract';
  status: 'queued' | 'running' | 'completed' | 'failed';
  attempts: number;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}
