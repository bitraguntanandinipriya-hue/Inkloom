import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
  type Unsubscribe,
} from 'firebase/firestore';
import type { User as FirebaseUser } from 'firebase/auth';
import type {
  CanonFact,
  Chapter,
  ChapterSummary,
  ChapterVersion,
  CharacterProfile,
  CharacterStateProposal,
  Novel,
  ScratchpadNote,
  StoryDna,
  UploadedImage,
  UserProfile,
} from '../types';
import type { NovelBundleResponse } from './api';
import { auth, db, handleFirestoreError, OperationType } from './firebase';

const VALID_ID_REGEX = /^[a-zA-Z0-9_-]{1,128}$/;

function assertValidId(id: string, label: string): string {
  if (!VALID_ID_REGEX.test(id)) {
    throw new Error(`Invalid ${label} ID format.`);
  }
  return id;
}

function clampStr(val: unknown, maxLen: number, fallback = ''): string {
  const s = typeof val === 'string' ? val : fallback;
  return s.length > maxLen ? s.slice(0, maxLen) : s;
}

function clampRequiredStr(val: unknown, maxLen: number, fallback: string): string {
  const trimmed = clampStr(val, maxLen, fallback).trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

function toIso(val: unknown): string {
  if (val instanceof Timestamp) return val.toDate().toISOString();
  if (typeof val === 'string' && val.length > 0) return val;
  if (val && typeof val === 'object' && 'toDate' in val && typeof (val as { toDate: () => Date }).toDate === 'function') {
    return (val as { toDate: () => Date }).toDate().toISOString();
  }
  return new Date().toISOString();
}

function toNullableIso(val: unknown): string | null {
  if (val === null || val === undefined) return null;
  return toIso(val);
}

function sanitizeStoryDna(dna: StoryDna): StoryDna {
  const langs = Array.isArray(dna.dialogueLanguages)
    ? dna.dialogueLanguages.map((l) => clampStr(l, 80).trim()).filter(Boolean).slice(0, 10)
    : ['English'];
  const sanitized: StoryDna = {
    narrationLanguage: clampRequiredStr(dna.narrationLanguage, 80, 'English'),
    dialogueLanguages: langs.length > 0 ? langs : ['English'],
    mixedLanguageWriting: Boolean(dna.mixedLanguageWriting),
    romanScriptOnly: Boolean(dna.romanScriptOnly),
    perspective: dna.perspective || 'Third Person Limited',
    tense: dna.tense || 'Past Tense',
    pacing: dna.pacing || 'Measured',
    contentBoundaries: clampStr(dna.contentBoundaries, 3000),
    writingRules: clampStr(dna.writingRules, 3000),
  };
  if (dna.customGenreLabel !== undefined) {
    sanitized.customGenreLabel = clampStr(dna.customGenreLabel, 100);
  }
  return sanitized;
}

function sanitizeStringList(list: unknown, maxItems = 30, maxItemLen = 120): string[] {
  if (!Array.isArray(list)) return [];
  return list
    .map((item) => clampStr(item, maxItemLen).trim())
    .filter(Boolean)
    .slice(0, maxItems);
}

function mapDocToNovel(data: Record<string, unknown>, id: string): Novel {
  return {
    id,
    userId: String(data.userId || ''),
    title: String(data.title || 'Untitled Novel'),
    authorName: String(data.authorName || ''),
    genre: String(data.genre || 'Dark Romance'),
    synopsis: String(data.synopsis || ''),
    coverImageId: typeof data.coverImageId === 'string' && data.coverImageId ? data.coverImageId : null,
    status: (data.status as Novel['status']) || 'active',
    completedAt: toNullableIso(data.completedAt),
    trashedAt: toNullableIso(data.trashedAt),
    storyDna: data.storyDna as StoryDna,
    chapterCount: typeof data.chapterCount === 'number' ? data.chapterCount : 0,
    totalWordCount: typeof data.totalWordCount === 'number' ? data.totalWordCount : 0,
    createdAt: toIso(data.createdAt),
    updatedAt: toIso(data.updatedAt),
  };
}

function mapDocToCharacter(data: Record<string, unknown>, id: string): CharacterProfile {
  return {
    id,
    novelId: String(data.novelId || ''),
    userId: String(data.userId || ''),
    roleType: (data.roleType as CharacterProfile['roleType']) || 'supporting',
    name: String(data.name || ''),
    age: String(data.age || ''),
    role: String(data.role || ''),
    archetype: String(data.archetype || ''),
    personality: String(data.personality || ''),
    psychologicalTraits: String(data.psychologicalTraits || ''),
    triggers: String(data.triggers || ''),
    vulnerabilities: String(data.vulnerabilities || ''),
    relationshipDynamics: String(data.relationshipDynamics || ''),
    relationships: String(data.relationships || ''),
    physicalAppearance: String(data.physicalAppearance || ''),
    backstory: String(data.backstory || ''),
    characterDevelopment: String(data.characterDevelopment || ''),
    status: (data.status as CharacterProfile['status']) || 'Active',
    customStatus: String(data.customStatus || ''),
    location: String(data.location || ''),
    imageId: typeof data.imageId === 'string' && data.imageId ? data.imageId : null,
    sortOrder: typeof data.sortOrder === 'number' ? data.sortOrder : 0,
    createdAt: toIso(data.createdAt),
    updatedAt: toIso(data.updatedAt),
  };
}

function mapDocToChapter(data: Record<string, unknown>, id: string): Chapter {
  return {
    id,
    novelId: String(data.novelId || ''),
    userId: String(data.userId || ''),
    chapterNumber: typeof data.chapterNumber === 'number' ? data.chapterNumber : 1,
    title: String(data.title || 'Untitled Chapter'),
    content: String(data.content || ''),
    prompt: String(data.prompt || ''),
    timelineAnchor: String(data.timelineAnchor || ''),
    locationAnchor: String(data.locationAnchor || ''),
    status: (data.status as Chapter['status']) || 'Draft',
    wordCount: typeof data.wordCount === 'number' ? data.wordCount : 0,
    trashedAt: toNullableIso(data.trashedAt),
    clientUpdatedAt: String(data.clientUpdatedAt || toIso(data.updatedAt)),
    version: typeof data.version === 'number' ? data.version : 1,
    createdAt: toIso(data.createdAt),
    updatedAt: toIso(data.updatedAt),
    syncState: 'synced',
  };
}

function mapDocToCanon(data: Record<string, unknown>, id: string): CanonFact {
  return {
    id,
    novelId: String(data.novelId || ''),
    factText: String(data.factText || ''),
    category: String(data.category || 'General'),
    sourceChapterId: typeof data.sourceChapterId === 'string' && data.sourceChapterId ? data.sourceChapterId : null,
    approvalStatus: (data.approvalStatus as CanonFact['approvalStatus']) || 'pending',
    isPinned: Boolean(data.isPinned),
    createdAt: toIso(data.createdAt),
    updatedAt: toIso(data.updatedAt),
  };
}

function mapDocToSummary(data: Record<string, unknown>, id: string): ChapterSummary {
  return {
    id,
    novelId: String(data.novelId || ''),
    chapterId: String(data.chapterId || ''),
    chapterNumber: typeof data.chapterNumber === 'number' ? data.chapterNumber : undefined,
    chapterTitle: typeof data.chapterTitle === 'string' ? data.chapterTitle : undefined,
    summaryText: String(data.summaryText || ''),
    timelineNote: String(data.timelineNote || ''),
    locations: Array.isArray(data.locations) ? (data.locations as string[]) : [],
    characters: Array.isArray(data.characters) ? (data.characters as string[]) : [],
    objects: Array.isArray(data.objects) ? (data.objects as string[]) : [],
    revelations: Array.isArray(data.revelations) ? (data.revelations as string[]) : [],
    createdAt: toIso(data.createdAt),
    updatedAt: toIso(data.updatedAt),
  };
}

function mapDocToProposal(data: Record<string, unknown>, id: string): CharacterStateProposal {
  return {
    id,
    novelId: String(data.novelId || ''),
    chapterId: String(data.chapterId || ''),
    characterId: String(data.characterId || ''),
    characterName: typeof data.characterName === 'string' ? data.characterName : undefined,
    proposedStatus: (data.proposedStatus as CharacterStateProposal['proposedStatus']) || 'Active',
    proposedLocation: String(data.proposedLocation || ''),
    reason: String(data.reason || ''),
    approvalStatus: (data.approvalStatus as CharacterStateProposal['approvalStatus']) || 'pending',
    createdAt: toIso(data.createdAt),
  };
}

function mapDocToScratchpad(data: Record<string, unknown>, id: string): ScratchpadNote {
  return {
    id,
    novelId: String(data.novelId || ''),
    title: String(data.title || 'Untitled Note'),
    content: String(data.content || ''),
    category: String(data.category || 'Idea'),
    createdAt: toIso(data.createdAt),
    updatedAt: toIso(data.updatedAt),
  };
}

function mapDocToImage(data: Record<string, unknown>, id: string): UploadedImage {
  return {
    id,
    userId: String(data.userId || ''),
    novelId: String(data.novelId || ''),
    entityType: (data.entityType as UploadedImage['entityType']) || 'reference',
    entityId: typeof data.entityId === 'string' && data.entityId ? data.entityId : null,
    category: (data.category as UploadedImage['category']) || 'other',
    title: String(data.title || ''),
    notes: String(data.notes || ''),
    mimeType: (data.mimeType as UploadedImage['mimeType']) || 'image/jpeg',
    sizeBytes: typeof data.sizeBytes === 'number' ? data.sizeBytes : 0,
    url: String(data.url || `/api/images/${id}/file`),
    createdAt: toIso(data.createdAt),
  };
}

export const firestoreStore = {
  // --------------------------------------------------------------------------
  // USER PROFILE (Split PII Collection)
  // --------------------------------------------------------------------------
  async syncUserProfile(user: UserProfile): Promise<void> {
    const uid = assertValidId(auth.currentUser?.uid || user.id, 'user');
    const pubPath = `users/${uid}`;
    const privPath = `users/${uid}/private/info`;

    const pubRef = doc(db, 'users', uid);
    const privRef = doc(db, 'users', uid, 'private', 'info');

    try {
      const pubSnap = await getDoc(pubRef);
      const displayName = clampRequiredStr(user.name, 120, 'Author');
      if (!pubSnap.exists()) {
        await setDoc(pubRef, {
          id: uid,
          displayName,
          themePreference: user.themePreference || 'system',
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } else {
        await updateDoc(pubRef, {
          displayName,
          themePreference: user.themePreference || 'system',
          updatedAt: serverTimestamp(),
        });
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, pubPath);
    }

    try {
      const privSnap = await getDoc(privRef);
      const payload = {
        userId: uid,
        email: clampRequiredStr(user.email, 254, 'author@inkloom.local'),
        avatarUrl: user.avatarUrl ? clampStr(user.avatarUrl, 1000) : null,
        authMethod: user.authMethod === 'google' ? 'google' : 'email',
        editorPrefs: user.editorPrefs,
        aiPrefs: {
          ...user.aiPrefs,
          defaultModelId: clampRequiredStr(user.aiPrefs.defaultModelId, 160, 'gemini-4-hydrogen'),
          economicalModelId: clampRequiredStr(user.aiPrefs.economicalModelId, 160, 'gemini-3.1-flash-lite'),
        },
      };
      if (!privSnap.exists()) {
        await setDoc(privRef, {
          ...payload,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } else {
        await updateDoc(privRef, {
          email: payload.email,
          avatarUrl: payload.avatarUrl,
          authMethod: payload.authMethod,
          editorPrefs: payload.editorPrefs,
          aiPrefs: payload.aiPrefs,
          updatedAt: serverTimestamp(),
        });
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, privPath);
    }
  },

  async ensureFirebaseUserSeeded(fbUser: FirebaseUser, fallbackUser: UserProfile): Promise<UserProfile> {
    const uid = assertValidId(fbUser.uid, 'user');
    const privPath = `users/${uid}/private/info`;
    try {
      const [pubSnap, privSnap] = await Promise.all([
        getDoc(doc(db, 'users', uid)),
        getDoc(doc(db, 'users', uid, 'private', 'info')),
      ]);
      if (pubSnap.exists() && privSnap.exists()) {
        const pub = pubSnap.data();
        const priv = privSnap.data();
        return {
          id: uid,
          email: String(priv.email || fbUser.email || fallbackUser.email),
          name: String(pub.displayName || fbUser.displayName || fallbackUser.name),
          avatarUrl: typeof priv.avatarUrl === 'string' ? priv.avatarUrl : fallbackUser.avatarUrl,
          authMethod: 'google',
          themePreference: (pub.themePreference as UserProfile['themePreference']) || fallbackUser.themePreference,
          editorPrefs: (priv.editorPrefs as UserProfile['editorPrefs']) || fallbackUser.editorPrefs,
          aiPrefs: (priv.aiPrefs as UserProfile['aiPrefs']) || fallbackUser.aiPrefs,
          createdAt: toIso(priv.createdAt),
          updatedAt: toIso(priv.updatedAt),
        };
      }
      await this.syncUserProfile(fallbackUser);
      return fallbackUser;
    } catch (error) {
      handleFirestoreError(error, OperationType.GET, privPath);
    }
  },

  // --------------------------------------------------------------------------
  // NOVELS SUBSCRIPTION & MUTATIONS
  // --------------------------------------------------------------------------
  subscribeNovels(
    uid: string,
    onData: (novels: Novel[]) => void,
    onError: (err: Error) => void
  ): Unsubscribe {
    const path = 'novels';
    const q = query(collection(db, 'novels'), where('userId', '==', uid));
    return onSnapshot(
      q,
      (snap) => {
        const novels = snap.docs
          .map((d) => mapDocToNovel(d.data() as Record<string, unknown>, d.id))
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
        onData(novels);
      },
      (error) => {
        try {
          handleFirestoreError(error, OperationType.LIST, path);
        } catch (wrapped) {
          onError(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
        }
      }
    );
  },

  async fetchUserNovels(uid: string): Promise<Novel[]> {
    const path = 'novels';
    try {
      const q = query(collection(db, 'novels'), where('userId', '==', uid));
      const snap = await getDocs(q);
      return snap.docs
        .map((d) => mapDocToNovel(d.data() as Record<string, unknown>, d.id))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    } catch (error) {
      handleFirestoreError(error, OperationType.LIST, path);
    }
  },

  async saveNovel(novel: Novel): Promise<void> {
    const novelId = assertValidId(novel.id, 'novel');
    const userId = assertValidId(auth.currentUser?.uid || novel.userId, 'user');
    const path = `novels/${novelId}`;
    const ref = doc(db, 'novels', novelId);
    try {
      const snap = await getDoc(ref);
      const editablePayload = {
        title: clampRequiredStr(novel.title, 200, 'Untitled Novel'),
        authorName: clampStr(novel.authorName, 120),
        genre: clampRequiredStr(novel.genre, 80, 'Dark Romance'),
        synopsis: clampStr(novel.synopsis, 5000),
        coverImageId: novel.coverImageId && VALID_ID_REGEX.test(novel.coverImageId) ? novel.coverImageId : null,
        storyDna: sanitizeStoryDna(novel.storyDna),
        chapterCount: Math.max(0, Math.min(10000, Math.floor(novel.chapterCount ?? 0))),
        totalWordCount: Math.max(0, Math.min(10000000, Math.floor(novel.totalWordCount ?? 0))),
      };
      if (!snap.exists()) {
        await setDoc(ref, {
          id: novelId,
          userId,
          ...editablePayload,
          status: 'active',
          completedAt: null,
          trashedAt: null,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } else if (snap.data().status === 'active') {
        await updateDoc(ref, {
          ...editablePayload,
          updatedAt: serverTimestamp(),
        });
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, path);
    }
  },

  async applyNovelAction(
    novelId: string,
    action: 'complete' | 'reopen' | 'trash' | 'restore',
    resultingStatus?: Novel['status']
  ): Promise<void> {
    const id = assertValidId(novelId, 'novel');
    const path = `novels/${id}`;
    const ref = doc(db, 'novels', id);
    try {
      if (action === 'complete') {
        await updateDoc(ref, {
          status: 'completed',
          completedAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } else if (action === 'reopen') {
        await updateDoc(ref, {
          status: 'active',
          completedAt: null,
          updatedAt: serverTimestamp(),
        });
      } else if (action === 'trash') {
        await updateDoc(ref, {
          status: 'trashed',
          trashedAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } else if (action === 'restore') {
        await updateDoc(ref, {
          status: resultingStatus === 'completed' ? 'completed' : 'active',
          trashedAt: null,
          updatedAt: serverTimestamp(),
        });
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, path);
    }
  },

  async setNovelCoverImage(novelId: string, coverImageId: string | null): Promise<void> {
    const id = assertValidId(novelId, 'novel');
    const path = `novels/${id}`;
    try {
      const ref = doc(db, 'novels', id);
      const snap = await getDoc(ref);
      if (snap.exists() && snap.data().status === 'active') {
        await updateDoc(ref, {
          coverImageId: coverImageId && VALID_ID_REGEX.test(coverImageId) ? coverImageId : null,
          updatedAt: serverTimestamp(),
        });
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, path);
    }
  },

  async setCharacterImage(
    novelId: string,
    characterId: string,
    imageId: string | null
  ): Promise<void> {
    const nId = assertValidId(novelId, 'novel');
    const cId = assertValidId(characterId, 'character');
    const path = `novels/${nId}/characters/${cId}`;
    try {
      const ref = doc(db, 'novels', nId, 'characters', cId);
      const snap = await getDoc(ref);
      if (snap.exists()) {
        await updateDoc(ref, {
          imageId: imageId && VALID_ID_REGEX.test(imageId) ? imageId : null,
          updatedAt: serverTimestamp(),
        });
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, path);
    }
  },

  async deleteNovelCascade(uid: string, novelId: string): Promise<void> {
    const id = assertValidId(novelId, 'novel');
    const path = `novels/${id}`;
    try {
      // Delete chapters & their versions first while novel still exists for Master Gate rules
      const chaptersSnap = await getDocs(
        query(collection(db, 'novels', id, 'chapters'), where('userId', '==', uid))
      );
      for (const chDoc of chaptersSnap.docs) {
        const verSnap = await getDocs(
          query(collection(db, 'novels', id, 'chapters', chDoc.id, 'versions'), where('userId', '==', uid))
        );
        if (!verSnap.empty) {
          const batch = writeBatch(db);
          verSnap.docs.forEach((v) => batch.delete(v.ref));
          await batch.commit();
        }
      }

      const subcollections = [
        'characters',
        'chapters',
        'canonFacts',
        'summaries',
        'stateProposals',
        'scratchpadNotes',
        'images',
      ] as const;

      // If novel is completed, reopen temporarily so subcollection deletes pass Master Gate
      const novelRef = doc(db, 'novels', id);
      const novelSnap = await getDoc(novelRef);
      if (novelSnap.exists() && novelSnap.data().status === 'completed') {
        await updateDoc(novelRef, {
          status: 'active',
          completedAt: null,
          updatedAt: serverTimestamp(),
        });
      }

      for (const sub of subcollections) {
        const subSnap = await getDocs(
          query(collection(db, 'novels', id, sub), where('userId', '==', uid))
        );
        if (!subSnap.empty) {
          const batch = writeBatch(db);
          subSnap.docs.forEach((d) => batch.delete(d.ref));
          await batch.commit();
        }
      }

      if (novelSnap.exists()) {
        await deleteDoc(novelRef);
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, path);
    }
  },

  // --------------------------------------------------------------------------
  // CHARACTERS, CHAPTERS, VERSIONS, STORY BIBLE & IMAGES
  // --------------------------------------------------------------------------
  async saveCharacter(character: CharacterProfile): Promise<void> {
    const novelId = assertValidId(character.novelId, 'novel');
    const charId = assertValidId(character.id, 'character');
    const userId = assertValidId(auth.currentUser?.uid || character.userId, 'user');
    const path = `novels/${novelId}/characters/${charId}`;
    const ref = doc(db, 'novels', novelId, 'characters', charId);
    try {
      const snap = await getDoc(ref);
      const fields = {
        roleType: character.roleType || 'supporting',
        name: clampRequiredStr(character.name, 120, 'Unnamed Character'),
        age: clampStr(character.age, 40),
        role: clampStr(character.role, 120),
        archetype: clampStr(character.archetype, 120),
        personality: clampStr(character.personality, 2000),
        psychologicalTraits: clampStr(character.psychologicalTraits, 2000),
        triggers: clampStr(character.triggers, 1000),
        vulnerabilities: clampStr(character.vulnerabilities, 1000),
        relationshipDynamics: clampStr(character.relationshipDynamics, 2000),
        relationships: clampStr(character.relationships, 2000),
        physicalAppearance: clampStr(character.physicalAppearance, 2000),
        backstory: clampStr(character.backstory, 4000),
        characterDevelopment: clampStr(character.characterDevelopment, 2000),
        status: character.status || 'Active',
        customStatus: clampStr(character.customStatus, 80),
        location: clampStr(character.location, 160),
        imageId: character.imageId && VALID_ID_REGEX.test(character.imageId) ? character.imageId : null,
        sortOrder: Math.max(0, Math.min(1000, Math.floor(character.sortOrder || 0))),
      };
      if (!snap.exists()) {
        await setDoc(ref, {
          id: charId,
          novelId,
          userId,
          ...fields,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } else {
        await updateDoc(ref, {
          ...fields,
          updatedAt: serverTimestamp(),
        });
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, path);
    }
  },

  async deleteCharacter(novelId: string, characterId: string): Promise<void> {
    const nId = assertValidId(novelId, 'novel');
    const cId = assertValidId(characterId, 'character');
    const path = `novels/${nId}/characters/${cId}`;
    try {
      await deleteDoc(doc(db, 'novels', nId, 'characters', cId));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, path);
    }
  },

  async saveChapter(chapter: Chapter): Promise<void> {
    const novelId = assertValidId(chapter.novelId, 'novel');
    const chapterId = assertValidId(chapter.id, 'chapter');
    const userId = assertValidId(auth.currentUser?.uid || chapter.userId, 'user');
    const path = `novels/${novelId}/chapters/${chapterId}`;
    const ref = doc(db, 'novels', novelId, 'chapters', chapterId);
    try {
      const snap = await getDoc(ref);
      const editable = {
        chapterNumber: Math.max(1, Math.min(5000, Math.floor(chapter.chapterNumber || 1))),
        title: clampRequiredStr(chapter.title, 200, 'Untitled Chapter'),
        content: clampStr(chapter.content, 250000),
        prompt: clampStr(chapter.prompt, 20000),
        timelineAnchor: clampStr(chapter.timelineAnchor, 300),
        locationAnchor: clampStr(chapter.locationAnchor, 300),
        status: chapter.status || 'Draft',
        wordCount: Math.max(0, Math.min(200000, Math.floor(chapter.wordCount || 0))),
        clientUpdatedAt: clampRequiredStr(chapter.clientUpdatedAt, 64, new Date().toISOString()),
        version: Math.max(1, Math.min(1000000, Math.floor(chapter.version || 1))),
      };
      if (!snap.exists()) {
        await setDoc(ref, {
          id: chapterId,
          novelId,
          userId,
          ...editable,
          trashedAt: null,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } else {
        await updateDoc(ref, {
          ...editable,
          updatedAt: serverTimestamp(),
        });
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, path);
    }
  },

  async trashChapter(novelId: string, chapterId: string): Promise<void> {
    const nId = assertValidId(novelId, 'novel');
    const cId = assertValidId(chapterId, 'chapter');
    const path = `novels/${nId}/chapters/${cId}`;
    try {
      await updateDoc(doc(db, 'novels', nId, 'chapters', cId), {
        trashedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, path);
    }
  },

  async restoreChapter(novelId: string, chapterId: string): Promise<void> {
    const nId = assertValidId(novelId, 'novel');
    const cId = assertValidId(chapterId, 'chapter');
    const path = `novels/${nId}/chapters/${cId}`;
    try {
      await updateDoc(doc(db, 'novels', nId, 'chapters', cId), {
        trashedAt: null,
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, path);
    }
  },

  async deleteChapterPermanent(uid: string, novelId: string, chapterId: string): Promise<void> {
    const nId = assertValidId(novelId, 'novel');
    const cId = assertValidId(chapterId, 'chapter');
    const path = `novels/${nId}/chapters/${cId}`;
    try {
      const verSnap = await getDocs(
        query(collection(db, 'novels', nId, 'chapters', cId, 'versions'), where('userId', '==', uid))
      );
      if (!verSnap.empty) {
        const batch = writeBatch(db);
        verSnap.docs.forEach((v) => batch.delete(v.ref));
        await batch.commit();
      }
      await deleteDoc(doc(db, 'novels', nId, 'chapters', cId));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, path);
    }
  },

  async saveChapterVersion(
    uid: string,
    novelId: string,
    version: ChapterVersion
  ): Promise<void> {
    const nId = assertValidId(novelId, 'novel');
    const cId = assertValidId(version.chapterId, 'chapter');
    const vId = assertValidId(version.id, 'version');
    const userId = assertValidId(uid, 'user');
    const path = `novels/${nId}/chapters/${cId}/versions/${vId}`;
    const ref = doc(db, 'novels', nId, 'chapters', cId, 'versions', vId);
    try {
      const snap = await getDoc(ref);
      if (snap.exists()) return; // Versions are immutable
      await setDoc(ref, {
        id: vId,
        novelId: nId,
        chapterId: cId,
        userId,
        title: clampRequiredStr(version.title, 200, 'Snapshot'),
        content: clampStr(version.content, 250000),
        prompt: clampStr(version.prompt, 20000),
        wordCount: Math.max(0, Math.min(200000, Math.floor(version.wordCount || 0))),
        reason: clampStr(version.reason, 200),
        createdAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, path);
    }
  },

  async saveCanonFact(uid: string, fact: CanonFact): Promise<void> {
    const nId = assertValidId(fact.novelId, 'novel');
    const fId = assertValidId(fact.id, 'canonFact');
    const userId = assertValidId(uid, 'user');
    const path = `novels/${nId}/canonFacts/${fId}`;
    const ref = doc(db, 'novels', nId, 'canonFacts', fId);
    try {
      const snap = await getDoc(ref);
      const editable = {
        factText: clampRequiredStr(fact.factText, 1000, 'Canon fact'),
        category: clampRequiredStr(fact.category, 80, 'General'),
        approvalStatus: fact.approvalStatus || 'pending',
        isPinned: Boolean(fact.isPinned),
      };
      if (!snap.exists()) {
        await setDoc(ref, {
          id: fId,
          novelId: nId,
          userId,
          ...editable,
          sourceChapterId:
            fact.sourceChapterId && VALID_ID_REGEX.test(fact.sourceChapterId)
              ? fact.sourceChapterId
              : null,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } else {
        await updateDoc(ref, {
          ...editable,
          updatedAt: serverTimestamp(),
        });
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, path);
    }
  },

  async deleteCanonFact(novelId: string, canonId: string): Promise<void> {
    const nId = assertValidId(novelId, 'novel');
    const fId = assertValidId(canonId, 'canonFact');
    const path = `novels/${nId}/canonFacts/${fId}`;
    try {
      await deleteDoc(doc(db, 'novels', nId, 'canonFacts', fId));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, path);
    }
  },

  async saveChapterSummary(uid: string, summary: ChapterSummary): Promise<void> {
    const nId = assertValidId(summary.novelId, 'novel');
    const sId = assertValidId(summary.id, 'summary');
    const cId = assertValidId(summary.chapterId, 'chapter');
    const userId = assertValidId(uid, 'user');
    const path = `novels/${nId}/summaries/${sId}`;
    const ref = doc(db, 'novels', nId, 'summaries', sId);
    try {
      const snap = await getDoc(ref);
      const editable = {
        chapterNumber: summary.chapterNumber ? Math.max(1, Math.min(5000, Math.floor(summary.chapterNumber))) : 1,
        chapterTitle: clampStr(summary.chapterTitle, 200),
        summaryText: clampRequiredStr(summary.summaryText, 5000, 'Summary'),
        timelineNote: clampStr(summary.timelineNote, 300),
        locations: sanitizeStringList(summary.locations, 30, 120),
        characters: sanitizeStringList(summary.characters, 30, 120),
        objects: sanitizeStringList(summary.objects, 30, 120),
        revelations: sanitizeStringList(summary.revelations, 30, 300),
      };
      if (!snap.exists()) {
        await setDoc(ref, {
          id: sId,
          novelId: nId,
          chapterId: cId,
          userId,
          ...editable,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } else {
        await updateDoc(ref, {
          ...editable,
          updatedAt: serverTimestamp(),
        });
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, path);
    }
  },

  async saveStateProposal(uid: string, proposal: CharacterStateProposal): Promise<void> {
    const nId = assertValidId(proposal.novelId, 'novel');
    const pId = assertValidId(proposal.id, 'proposal');
    const cId = assertValidId(proposal.chapterId, 'chapter');
    const chId = assertValidId(proposal.characterId, 'character');
    const userId = assertValidId(uid, 'user');
    const path = `novels/${nId}/stateProposals/${pId}`;
    const ref = doc(db, 'novels', nId, 'stateProposals', pId);
    try {
      const snap = await getDoc(ref);
      if (!snap.exists()) {
        await setDoc(ref, {
          id: pId,
          novelId: nId,
          chapterId: cId,
          characterId: chId,
          userId,
          characterName: clampStr(proposal.characterName, 120),
          proposedStatus: proposal.proposedStatus || 'Active',
          proposedLocation: clampStr(proposal.proposedLocation, 160),
          reason: clampStr(proposal.reason, 500),
          approvalStatus: 'pending',
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, path);
    }
  },

  async resolveStateProposal(
    novelId: string,
    proposalId: string,
    status: 'approved' | 'rejected'
  ): Promise<void> {
    const nId = assertValidId(novelId, 'novel');
    const pId = assertValidId(proposalId, 'proposal');
    const path = `novels/${nId}/stateProposals/${pId}`;
    try {
      await updateDoc(doc(db, 'novels', nId, 'stateProposals', pId), {
        approvalStatus: status,
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, path);
    }
  },

  async saveScratchpadNote(uid: string, note: ScratchpadNote): Promise<void> {
    const nId = assertValidId(note.novelId, 'novel');
    const noteId = assertValidId(note.id, 'note');
    const userId = assertValidId(uid, 'user');
    const path = `novels/${nId}/scratchpadNotes/${noteId}`;
    const ref = doc(db, 'novels', nId, 'scratchpadNotes', noteId);
    try {
      const snap = await getDoc(ref);
      const editable = {
        title: clampRequiredStr(note.title, 200, 'Untitled Note'),
        content: clampStr(note.content, 20000),
        category: clampRequiredStr(note.category, 80, 'Idea'),
      };
      if (!snap.exists()) {
        await setDoc(ref, {
          id: noteId,
          novelId: nId,
          userId,
          ...editable,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } else {
        await updateDoc(ref, {
          ...editable,
          updatedAt: serverTimestamp(),
        });
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, path);
    }
  },

  async deleteScratchpadNote(novelId: string, noteId: string): Promise<void> {
    const nId = assertValidId(novelId, 'novel');
    const id = assertValidId(noteId, 'note');
    const path = `novels/${nId}/scratchpadNotes/${id}`;
    try {
      await deleteDoc(doc(db, 'novels', nId, 'scratchpadNotes', id));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, path);
    }
  },

  async saveImageMetadata(image: UploadedImage): Promise<void> {
    const nId = assertValidId(image.novelId, 'novel');
    const imgId = assertValidId(image.id, 'image');
    const userId = assertValidId(auth.currentUser?.uid || image.userId, 'user');
    const path = `novels/${nId}/images/${imgId}`;
    const ref = doc(db, 'novels', nId, 'images', imgId);
    try {
      const snap = await getDoc(ref);
      const editable = {
        category: image.category || 'other',
        title: clampStr(image.title, 200),
        notes: clampStr(image.notes, 3000),
        entityId: image.entityId && VALID_ID_REGEX.test(image.entityId) ? image.entityId : null,
      };
      if (!snap.exists()) {
        await setDoc(ref, {
          id: imgId,
          userId,
          novelId: nId,
          entityType: image.entityType || 'reference',
          ...editable,
          mimeType: image.mimeType,
          sizeBytes: Math.max(1, Math.min(8388608, Math.floor(image.sizeBytes))),
          url: clampRequiredStr(image.url, 500, `/api/images/${imgId}/file`),
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } else {
        await updateDoc(ref, {
          ...editable,
          updatedAt: serverTimestamp(),
        });
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, path);
    }
  },

  async deleteImageMetadata(novelId: string, imageId: string): Promise<void> {
    const nId = assertValidId(novelId, 'novel');
    const id = assertValidId(imageId, 'image');
    const path = `novels/${nId}/images/${id}`;
    try {
      await deleteDoc(doc(db, 'novels', nId, 'images', id));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, path);
    }
  },

  // --------------------------------------------------------------------------
  // BUNDLE SYNC & REAL-TIME LISTENERS
  // --------------------------------------------------------------------------
  async syncBundleToFirestore(uid: string, bundle: NovelBundleResponse): Promise<void> {
    const ownerUid = auth.currentUser?.uid || uid;
    await this.saveNovel(bundle.novel);
    if (bundle.novel.status === 'completed') return;

    for (const ch of bundle.characters) {
      await this.saveCharacter(ch);
    }
    for (const chap of bundle.chapters) {
      await this.saveChapter(chap);
    }
    for (const chap of bundle.trashedChapters) {
      await this.saveChapter(chap);
      await this.trashChapter(chap.novelId, chap.id);
    }
    for (const fact of bundle.canonFacts) {
      await this.saveCanonFact(ownerUid, fact);
    }
    for (const sum of bundle.summaries) {
      await this.saveChapterSummary(ownerUid, sum);
    }
    for (const prop of bundle.stateProposals) {
      await this.saveStateProposal(ownerUid, prop);
    }
    for (const note of bundle.scratchpadNotes) {
      await this.saveScratchpadNote(ownerUid, note);
    }
    for (const img of bundle.images) {
      await this.saveImageMetadata(img);
    }
  },

  async fetchBundleFromFirestore(uid: string, novelId: string): Promise<NovelBundleResponse | null> {
    const id = assertValidId(novelId, 'novel');
    const novelPath = `novels/${id}`;
    try {
      const novelSnap = await getDoc(doc(db, 'novels', id));
      if (!novelSnap.exists()) return null;
      const novel = mapDocToNovel(novelSnap.data() as Record<string, unknown>, novelSnap.id);

      const [charsSnap, chapsSnap, canonSnap, sumSnap, propSnap, notesSnap, imgSnap] =
        await Promise.all([
          getDocs(query(collection(db, 'novels', id, 'characters'), where('userId', '==', uid))),
          getDocs(query(collection(db, 'novels', id, 'chapters'), where('userId', '==', uid))),
          getDocs(query(collection(db, 'novels', id, 'canonFacts'), where('userId', '==', uid))),
          getDocs(query(collection(db, 'novels', id, 'summaries'), where('userId', '==', uid))),
          getDocs(query(collection(db, 'novels', id, 'stateProposals'), where('userId', '==', uid))),
          getDocs(query(collection(db, 'novels', id, 'scratchpadNotes'), where('userId', '==', uid))),
          getDocs(query(collection(db, 'novels', id, 'images'), where('userId', '==', uid))),
        ]);

      const characters = charsSnap.docs
        .map((d) => mapDocToCharacter(d.data() as Record<string, unknown>, d.id))
        .sort((a, b) => a.sortOrder - b.sortOrder);

      const allChapters = chapsSnap.docs
        .map((d) => mapDocToChapter(d.data() as Record<string, unknown>, d.id))
        .sort((a, b) => a.chapterNumber - b.chapterNumber);

      return {
        novel,
        characters,
        chapters: allChapters.filter((c) => !c.trashedAt),
        trashedChapters: allChapters.filter((c) => Boolean(c.trashedAt)),
        images: imgSnap.docs.map((d) => mapDocToImage(d.data() as Record<string, unknown>, d.id)),
        canonFacts: canonSnap.docs
          .map((d) => mapDocToCanon(d.data() as Record<string, unknown>, d.id))
          .sort((a, b) => Number(b.isPinned) - Number(a.isPinned)),
        summaries: sumSnap.docs
          .map((d) => mapDocToSummary(d.data() as Record<string, unknown>, d.id))
          .sort((a, b) => (a.chapterNumber || 0) - (b.chapterNumber || 0)),
        stateProposals: propSnap.docs
          .map((d) => mapDocToProposal(d.data() as Record<string, unknown>, d.id))
          .filter((p) => p.approvalStatus === 'pending'),
        scratchpadNotes: notesSnap.docs
          .map((d) => mapDocToScratchpad(d.data() as Record<string, unknown>, d.id))
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
      };
    } catch (error) {
      handleFirestoreError(error, OperationType.GET, novelPath);
    }
  },

  subscribeNovelRealtime(
    uid: string,
    novelId: string,
    onPatch: (patch: Partial<NovelBundleResponse>) => void,
    onError: (err: Error) => void
  ): Unsubscribe {
    const id = assertValidId(novelId, 'novel');
    const handleErr = (op: OperationType, path: string) => (error: unknown) => {
      try {
        handleFirestoreError(error, op, path);
      } catch (wrapped) {
        onError(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
      }
    };

    const unsubs: Unsubscribe[] = [
      onSnapshot(
        doc(db, 'novels', id),
        (snap) => {
          if (snap.exists()) {
            onPatch({ novel: mapDocToNovel(snap.data() as Record<string, unknown>, snap.id) });
          }
        },
        handleErr(OperationType.GET, `novels/${id}`)
      ),
      onSnapshot(
        query(collection(db, 'novels', id, 'characters'), where('userId', '==', uid)),
        (snap) => {
          const characters = snap.docs
            .map((d) => mapDocToCharacter(d.data() as Record<string, unknown>, d.id))
            .sort((a, b) => a.sortOrder - b.sortOrder);
          onPatch({ characters });
        },
        handleErr(OperationType.LIST, `novels/${id}/characters`)
      ),
      onSnapshot(
        query(collection(db, 'novels', id, 'chapters'), where('userId', '==', uid)),
        (snap) => {
          const all = snap.docs
            .map((d) => mapDocToChapter(d.data() as Record<string, unknown>, d.id))
            .sort((a, b) => a.chapterNumber - b.chapterNumber);
          onPatch({
            chapters: all.filter((c) => !c.trashedAt),
            trashedChapters: all.filter((c) => Boolean(c.trashedAt)),
          });
        },
        handleErr(OperationType.LIST, `novels/${id}/chapters`)
      ),
      onSnapshot(
        query(collection(db, 'novels', id, 'canonFacts'), where('userId', '==', uid)),
        (snap) => {
          const canonFacts = snap.docs
            .map((d) => mapDocToCanon(d.data() as Record<string, unknown>, d.id))
            .sort((a, b) => Number(b.isPinned) - Number(a.isPinned));
          onPatch({ canonFacts });
        },
        handleErr(OperationType.LIST, `novels/${id}/canonFacts`)
      ),
      onSnapshot(
        query(collection(db, 'novels', id, 'summaries'), where('userId', '==', uid)),
        (snap) => {
          const summaries = snap.docs
            .map((d) => mapDocToSummary(d.data() as Record<string, unknown>, d.id))
            .sort((a, b) => (a.chapterNumber || 0) - (b.chapterNumber || 0));
          onPatch({ summaries });
        },
        handleErr(OperationType.LIST, `novels/${id}/summaries`)
      ),
      onSnapshot(
        query(collection(db, 'novels', id, 'stateProposals'), where('userId', '==', uid)),
        (snap) => {
          const stateProposals = snap.docs
            .map((d) => mapDocToProposal(d.data() as Record<string, unknown>, d.id))
            .filter((p) => p.approvalStatus === 'pending');
          onPatch({ stateProposals });
        },
        handleErr(OperationType.LIST, `novels/${id}/stateProposals`)
      ),
      onSnapshot(
        query(collection(db, 'novels', id, 'scratchpadNotes'), where('userId', '==', uid)),
        (snap) => {
          const scratchpadNotes = snap.docs
            .map((d) => mapDocToScratchpad(d.data() as Record<string, unknown>, d.id))
            .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
          onPatch({ scratchpadNotes });
        },
        handleErr(OperationType.LIST, `novels/${id}/scratchpadNotes`)
      ),
      onSnapshot(
        query(collection(db, 'novels', id, 'images'), where('userId', '==', uid)),
        (snap) => {
          onPatch({
            images: snap.docs.map((d) => mapDocToImage(d.data() as Record<string, unknown>, d.id)),
          });
        },
        handleErr(OperationType.LIST, `novels/${id}/images`)
      ),
    ];

    return () => {
      unsubs.forEach((u) => u());
    };
  },

  async deleteAllUserFirestoreData(uid: string): Promise<void> {
    const cleanUid = assertValidId(uid, 'user');
    try {
      const novels = await this.fetchUserNovels(cleanUid);
      for (const n of novels) {
        await this.deleteNovelCascade(cleanUid, n.id);
      }
      const privRef = doc(db, 'users', cleanUid, 'private', 'info');
      const pubRef = doc(db, 'users', cleanUid);
      const [privSnap, pubSnap] = await Promise.all([getDoc(privRef), getDoc(pubRef)]);
      if (privSnap.exists()) await deleteDoc(privRef);
      if (pubSnap.exists()) await deleteDoc(pubRef);
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `users/${cleanUid}`);
    }
  },
};
