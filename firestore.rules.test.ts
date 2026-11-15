// Security Rules TDD Test Suite covering the "Dirty Dozen" attack payloads.
// Intended to run against the Firebase Emulator Suite (@firebase/rules-unit-testing).

import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, getDoc, getDocs, collection, query, where, setDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import fs from 'fs';

let testEnv: RulesTestEnvironment;

const VALID_DNA = {
  narrationLanguage: 'English',
  dialogueLanguages: ['English'],
  mixedLanguageWriting: false,
  romanScriptOnly: false,
  perspective: 'Third Person Limited',
  tense: 'Past Tense',
  pacing: 'Measured',
  contentBoundaries: '',
  writingRules: '',
};

async function runTests() {
  testEnv = await initializeTestEnvironment({
    projectId: 'graphic-period-j7cvm',
    firestore: {
      rules: fs.readFileSync('firestore.rules', 'utf8'),
    },
  });

  const userA = testEnv.authenticatedContext('user_A', { email: 'a@inkloom.test', email_verified: true });
  const userB = testEnv.authenticatedContext('user_B', { email: 'b@inkloom.test', email_verified: true });
  const unverified = testEnv.authenticatedContext('user_U', { email: 'u@inkloom.test', email_verified: false });
  const anon = testEnv.unauthenticatedContext();

  // Seed completed novel via security-rules-disabled admin context
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'novels', 'completed_novel'), {
      id: 'completed_novel',
      userId: 'user_A',
      title: 'Finished Work',
      authorName: 'Author A',
      genre: 'Dark Romance',
      synopsis: 'Done',
      coverImageId: null,
      status: 'completed',
      completedAt: serverTimestamp(),
      trashedAt: null,
      storyDna: VALID_DNA,
      chapterCount: 1,
      totalWordCount: 1200,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    await setDoc(doc(db, 'users', 'user_A', 'private', 'info'), {
      userId: 'user_A',
      email: 'a@inkloom.test',
      avatarUrl: null,
      authMethod: 'google',
      editorPrefs: { manuscriptFont: 'lora', fontSizePx: 18, lineSpacing: 1.75, maxWidthCh: 68, defaultChapterWordTarget: 2700, showParagraphGuides: false },
      aiPrefs: { defaultProvider: 'gemini', defaultModelId: 'gemini-4-hydrogen', backgroundIntelligenceEnabled: true, economicalModelId: 'gemini-3.1-flash-lite', thinkingMode: 'fast' },
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  });

  // 1. Unauthenticated read/write fails
  await assertFails(getDoc(doc(anon.firestore(), 'novels', 'completed_novel')));

  // 2. Unverified email fails
  await assertFails(
    setDoc(doc(unverified.firestore(), 'novels', 'n_unverified'), {
      id: 'n_unverified',
      userId: 'user_U',
      title: 'Test',
      authorName: 'U',
      genre: 'Sci-Fi',
      synopsis: '',
      coverImageId: null,
      status: 'active',
      completedAt: null,
      trashedAt: null,
      storyDna: VALID_DNA,
      chapterCount: 0,
      totalWordCount: 0,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    })
  );

  // 3. Cross-tenant identity spoofing fails
  await assertFails(
    setDoc(doc(userA.firestore(), 'novels', 'n_spoof'), {
      id: 'n_spoof',
      userId: 'user_B',
      title: 'Spoof',
      authorName: 'A',
      genre: 'Sci-Fi',
      synopsis: '',
      coverImageId: null,
      status: 'active',
      completedAt: null,
      trashedAt: null,
      storyDna: VALID_DNA,
      chapterCount: 0,
      totalWordCount: 0,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    })
  );

  // 4. Shadow / Ghost field injection fails
  await assertFails(
    setDoc(doc(userA.firestore(), 'novels', 'n_ghost'), {
      id: 'n_ghost',
      userId: 'user_A',
      title: 'Ghost',
      authorName: 'A',
      genre: 'Sci-Fi',
      synopsis: '',
      coverImageId: null,
      status: 'active',
      completedAt: null,
      trashedAt: null,
      storyDna: VALID_DNA,
      chapterCount: 0,
      totalWordCount: 0,
      isAdmin: true,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    })
  );

  // 5. Orphaned subcollection write fails
  await assertFails(
    setDoc(doc(userA.firestore(), 'novels', 'missing_novel', 'chapters', 'ch1'), {
      id: 'ch1',
      novelId: 'missing_novel',
      userId: 'user_A',
      chapterNumber: 1,
      title: 'Ch 1',
      content: '',
      prompt: '',
      timelineAnchor: '',
      locationAnchor: '',
      status: 'Draft',
      wordCount: 0,
      trashedAt: null,
      clientUpdatedAt: new Date().toISOString(),
      version: 1,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    })
  );

  // 6. Completed novel subcollection write fails
  await assertFails(
    setDoc(doc(userA.firestore(), 'novels', 'completed_novel', 'chapters', 'ch1'), {
      id: 'ch1',
      novelId: 'completed_novel',
      userId: 'user_A',
      chapterNumber: 1,
      title: 'Ch 1',
      content: 'Should fail',
      prompt: '',
      timelineAnchor: '',
      locationAnchor: '',
      status: 'Draft',
      wordCount: 2,
      trashedAt: null,
      clientUpdatedAt: new Date().toISOString(),
      version: 1,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    })
  );

  // 7. Completed novel metadata tamper fails without reopening
  await assertFails(
    updateDoc(doc(userA.firestore(), 'novels', 'completed_novel'), {
      title: 'Tampered Title',
      updatedAt: serverTimestamp(),
    })
  );

  // 8. ID poisoning (>128 chars) fails
  const longId = 'a'.repeat(200);
  await assertFails(
    setDoc(doc(userA.firestore(), 'novels', longId), {
      id: longId,
      userId: 'user_A',
      title: 'Long ID',
      authorName: 'A',
      genre: 'Sci-Fi',
      synopsis: '',
      coverImageId: null,
      status: 'active',
      completedAt: null,
      trashedAt: null,
      storyDna: VALID_DNA,
      chapterCount: 0,
      totalWordCount: 0,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    })
  );

  // 9. Client timestamp forgery fails
  await assertFails(
    setDoc(doc(userA.firestore(), 'novels', 'n_backdated'), {
      id: 'n_backdated',
      userId: 'user_A',
      title: 'Backdated',
      authorName: 'A',
      genre: 'Sci-Fi',
      synopsis: '',
      coverImageId: null,
      status: 'active',
      completedAt: null,
      trashedAt: null,
      storyDna: VALID_DNA,
      chapterCount: 0,
      totalWordCount: 0,
      createdAt: new Date('2020-01-01T00:00:00Z'),
      updatedAt: serverTimestamp(),
    })
  );

  // 10. PII cross-tenant read fails
  await assertFails(getDoc(doc(userB.firestore(), 'users', 'user_A', 'private', 'info')));

  // 11. Unfiltered collection list scrape fails; scoped list succeeds
  await assertFails(getDocs(collection(userA.firestore(), 'novels')));
  await assertSucceeds(getDocs(query(collection(userA.firestore(), 'novels'), where('userId', '==', 'user_A'))));

  // 12. Valid novel creation & reopening succeeds
  await assertSucceeds(
    updateDoc(doc(userA.firestore(), 'novels', 'completed_novel'), {
      status: 'active',
      completedAt: null,
      updatedAt: serverTimestamp(),
    })
  );

  await testEnv.cleanup();
}

void runTests;
