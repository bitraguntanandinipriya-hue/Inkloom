import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { onAuthStateChanged, type User as FirebaseUser } from 'firebase/auth';
import type { UserProfile } from '../types';
import { api } from './api';
import {
  auth,
  formatFirestoreQuotaNotice,
  signInWithGooglePopup,
} from './firebase';
import { firestoreStore } from './firestoreStore';

interface FirebaseContextValue {
  firebaseUser: FirebaseUser | null;
  authReady: boolean;
  firebaseProfile: UserProfile | null;
  firestoreError: string | null;
  reportFirestoreError: (err: unknown) => void;
  clearFirestoreError: () => void;
  signInWithGoogle: () => Promise<UserProfile>;
}

const FirebaseContext = createContext<FirebaseContextValue | null>(null);

export function formatReadableFirestoreError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  let extracted = raw;
  try {
    const parsed = JSON.parse(raw) as { error?: string; operationType?: string; path?: string | null };
    if (parsed && typeof parsed.error === 'string') {
      extracted = parsed.error;
    }
  } catch {
    // raw string
  }

  const quotaNotice = formatFirestoreQuotaNotice(extracted);
  if (quotaNotice) return quotaNotice;

  if (extracted.includes('permission-denied') || extracted.includes('Missing or insufficient permissions')) {
    return 'Cloud Firestore access denied. Verify your verified Google sign-in session and security rules.';
  }
  return extracted || 'Cloud Firestore sync encountered an error.';
}

export const FirebaseProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(null);
  const [firebaseProfile, setFirebaseProfile] = useState<UserProfile | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [firestoreError, setFirestoreError] = useState<string | null>(null);

  const activeBootstrapRef = useRef<Promise<UserProfile> | null>(null);

  const reportFirestoreError = useCallback((err: unknown) => {
    setFirestoreError(formatReadableFirestoreError(err));
  }, []);

  const clearFirestoreError = useCallback(() => {
    setFirestoreError(null);
  }, []);

  const bootstrapFirebaseSession = useCallback(
    async (fbUser: FirebaseUser): Promise<UserProfile> => {
      if (activeBootstrapRef.current) {
        return activeBootstrapRef.current;
      }
      const run = (async () => {
        const idToken = await fbUser.getIdToken();
        const { user } = await api.firebaseSession(idToken);
        const seeded = await firestoreStore.ensureFirebaseUserSeeded(fbUser, user);
        setFirebaseProfile(seeded);
        return seeded;
      })();
      activeBootstrapRef.current = run;
      try {
        return await run;
      } finally {
        activeBootstrapRef.current = null;
      }
    },
    []
  );

  useEffect(() => {
    const handleMirrorError = (evt: Event) => {
      const custom = evt as CustomEvent<unknown>;
      reportFirestoreError(custom.detail);
    };
    window.addEventListener('inkloom:firestore-error', handleMirrorError);
    return () => {
      window.removeEventListener('inkloom:firestore-error', handleMirrorError);
    };
  }, [reportFirestoreError]);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (fbUser) => {
      setFirebaseUser(fbUser);
      if (fbUser && fbUser.emailVerified) {
        try {
          await bootstrapFirebaseSession(fbUser);
        } catch (err) {
          reportFirestoreError(err);
        }
      } else {
        setFirebaseProfile(null);
      }
      setAuthReady(true);
    });
    return () => unsub();
  }, [bootstrapFirebaseSession, reportFirestoreError]);

  const signInWithGoogle = useCallback(async (): Promise<UserProfile> => {
    const fbUser = await signInWithGooglePopup();
    if (!fbUser.emailVerified) {
      throw new Error('Your Google account email must be verified to access Inkloom.');
    }
    setFirebaseUser(fbUser);
    const seeded = await bootstrapFirebaseSession(fbUser);
    setAuthReady(true);
    return seeded;
  }, [bootstrapFirebaseSession]);

  return (
    <FirebaseContext.Provider
      value={{
        firebaseUser,
        authReady,
        firebaseProfile,
        firestoreError,
        reportFirestoreError,
        clearFirestoreError,
        signInWithGoogle,
      }}
    >
      {children}
    </FirebaseContext.Provider>
  );
};

export function useFirebase(): FirebaseContextValue {
  const ctx = useContext(FirebaseContext);
  if (!ctx) {
    throw new Error('useFirebase must be used inside FirebaseProvider');
  }
  return ctx;
}
