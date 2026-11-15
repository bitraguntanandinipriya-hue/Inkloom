# Inkloom Platform Architecture, Limitations & Migration Guide

## 1. Live Runtime Implementation (Single Unified System)

In this container environment (Node.js + Vite preview server on port 3000 without MongoDB, Python/FastAPI pip runtime, or Android SDK/Expo simulator), Inkloom is built as **one cohesive, production-grade full-stack web application** without duplicate or incompatible backend systems:

- **Frontend Workspace**: React 19 + TypeScript + Tailwind CSS v4 (responsive desktop studio and touch-friendly mobile layout)
- **Offline-First Local Persistence**: Browser **IndexedDB** (`inkloom_offline_db`) mirroring local SQLite semantics — supports offline reading, drafting, editing, version recovery after crashes/restarts, and timestamp/version conflict-aware synchronization.
- **Backend API**: Express + TypeScript (`server.ts`) serving REST + Server-Sent Events (SSE) endpoints.
- **Server Database**: **SQLite** (`better-sqlite3` in WAL mode at `./data/inkloom.db`) with strict user-level foreign-key isolation.
- **Object Storage**: Disk-backed private object storage (`./data/uploads/<userId>/`) validated for JPEG, PNG, and WebP and served exclusively through authenticated user-scoped endpoints (`/api/images/:id/file`).
- **Credential Security**: Author-supplied API keys encrypted at rest with **AES-256-GCM** (`./data/.vault_key`). Managed `GEMINI_API_KEY` remains strictly server-side (`process.env.GEMINI_API_KEY`).

---

## 2. Documented Platform Limitations in This Sandbox

1. **Expo React Native / Native Android APK**: An Android SDK, Gradle, and Expo Go runtime are not present in this web sandbox; therefore no APK/AAB binary is compiled here. All UI flows are responsive across mobile viewports and structured around clean REST/SSE contracts ready for mobile consumption.
2. **FastAPI + MongoDB**: Neither `mongod` nor `pip3` is available in this runtime container. Rather than shipping an untested mock Python codebase alongside Express, all business logic runs natively in the unified TypeScript/Express/SQLite backend.
3. **Google Sign-In & Transactional Email**:
   - Real Google ID token verification (`/api/auth/google`) is implemented and activates automatically when `VITE_GOOGLE_CLIENT_ID` is configured in the environment.
   - Password reset issues cryptographically random single-use reset tokens (`password_resets` table). Without an external SMTP provider configured, the reset token can be verified directly in the reset flow for local testing.

---

## 3. Migration Path to Expo React Native + FastAPI + MongoDB + Kotlin Android

### A. Database Mapping (SQLite → MongoDB)
- `users` → `users` collection (`_id`, `email`, `password_hash`, `editor_prefs`, `ai_prefs`)
- `novels` → `novels` collection (`user_id` indexed, embedded `story_dna`)
- `characters` → `characters` collection (`novel_id`, `user_id`, `image_id`)
- `chapters` → `chapters` collection (`novel_id`, `user_id`, `version`, `client_updated_at`, `trashed_at`)
- `chapter_versions` → `chapter_versions` collection (`chapter_id`)
- `canon_facts`, `chapter_summaries`, `scratchpad_notes` → dedicated collections indexed by `(novel_id, user_id)`
- `images` → metadata in `images` collection; binary blobs in S3 / Cloud Storage / MinIO signed URLs
- `provider_credentials` → `provider_credentials` collection using envelope encryption (KMS / Fernet / AES-GCM)

### B. Mobile Local Persistence (IndexedDB → `expo-sqlite` / Room)
- All offline records in `src/lib/offlineDb.ts` map 1:1 to `expo-sqlite` tables in React Native or Android **Room** entities (`@Entity` tables for `NovelEntity`, `ChapterEntity`, `DraftRecoveryEntity`) in a future native Kotlin client.
- Sync protocol uses `clientUpdatedAt` + monotonic `version` integers (`syncState: 'synced' | 'pending' | 'conflict'`), preserving newer local edits over stale cloud data.

### C. Android Build Preparation (When Exporting to Expo / Kotlin)
1. Install Expo CLI and EAS CLI: `npm install -g eas-cli`
2. Configure `app.json` (`expo.android.package`, `expo.plugins: ["expo-sqlite", "expo-document-picker", "expo-sharing"]`)
3. Build Android App Bundle (AAB) or APK via EAS:
   - Preview APK: `eas build -p android --profile preview`
   - Production AAB: `eas build -p android --profile production`
4. Ensure `GEMINI_API_KEY` and encryption keys remain exclusively on the FastAPI/Express server — never bundled into the APK/AAB.
