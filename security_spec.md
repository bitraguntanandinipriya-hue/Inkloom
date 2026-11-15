# Inkloom Firestore Security Specification

## 1. Data Invariants
1. **Strict Author Isolation (Zero Cross-Tenant Reads/Writes)**: Every document in `/users/{userId}`, `/users/{userId}/private/{infoId}`, `/novels/{novelId}`, and every subcollection under `/novels/{novelId}` belongs strictly to `userId == request.auth.uid` with `request.auth.token.email_verified == true`.
2. **PII Split Collection Isolation**: Email addresses and avatar URLs live exclusively in `/users/{userId}/private/info` and are readable/writable ONLY by `isOwner(userId)`. Non-PII display preferences live in `/users/{userId}` and remain owner-private.
3. **Master Gate Parent Integrity**: No character, chapter, chapter version, canon fact, summary, state proposal, scratchpad note, or image metadata document can be created, read via `get`, updated, or deleted unless the parent `/novels/{novelId}` exists and `novel.data.userId == request.auth.uid`.
4. **Completed Read-Only Mode Enforcement**: When `/novels/{novelId}.status == 'completed'`, all writes (`create`, `update`, `delete`) to all novel subcollections are strictly denied. A completed novel itself can only transition via explicit `reopen` (`status: 'active'`, `completedAt: null`) or `trash` (`status: 'trashed'`, `trashedAt: request.time`) actions—never arbitrary metadata/Story DNA edits.
5. **Immutable Relational Keys & Server Timestamps**: `id`, `userId`, `novelId`, `chapterId`, and `createdAt` are immutable after creation. All `createdAt` (create) and `updatedAt` (create/update) fields MUST equal `request.time`.
6. **Terminal State Locking for Proposals & Immutable Versions**: `ChapterVersion` snapshots are append-only (`allow update: if false`). `CharacterStateProposal` records lock permanently once `approvalStatus` becomes `'approved'` or `'rejected'`.
7. **No Secrets in Firestore**: AI provider API keys remain AES-256-GCM encrypted in server-side storage and are never stored in Firestore.
8. **Secure List Queries Without `get()` Amplification**: All `allow list` rules check `resource.data.userId == request.auth.uid` directly without calling `get()` or `exists()`.

## 2. The "Dirty Dozen" Attack Payloads (All Must Yield PERMISSION_DENIED)
1. **Unauthenticated Novel Read/Write**: Read or write `/novels/{novelId}` with `auth = null`.
2. **Unverified Email Spoof**: Write `/novels/{novelId}` with valid `uid` but `email_verified: false`.
3. **Cross-Tenant Identity Spoofing**: User A creates `/novels/n1` with `{ userId: "user_B" }`.
4. **Shadow / Ghost Field Injection**: User A creates or updates `/novels/n1` including unexpected field `{ isAdmin: true }`.
5. **Orphaned Subcollection Write**: User A creates `/novels/nonexistent_novel/chapters/c1` where parent `/novels/nonexistent_novel` does not exist.
6. **Completed Read-Only Bypass**: User A updates `/novels/completed_novel/chapters/c1` content while parent novel has `status == 'completed'`.
7. **Completed Novel Metadata Tampering**: User A updates `title` or `storyDna` on `/novels/completed_novel` without reopening it first.
8. **ID Poisoning / Resource Exhaustion**: User A creates `/novels/` with a 1,500-character ID or invalid characters (`../evil`).
9. **Client Timestamp Forgery**: User A creates `/novels/n1` with backdated `createdAt` (`Timestamp(2020-01-01)`) instead of `request.time`.
10. **PII Cross-Tenant Read**: User B attempts `get` on `/users/user_A/private/info` or `/users/user_A`.
11. **Unfiltered Collection List Scrape**: User A executes `list(/novels)` without `where('userId', '==', 'user_A')`.
12. **Terminal Proposal & Snapshot Tampering**: User A updates an `'approved'` `CharacterStateProposal` back to `'pending'`, or updates an immutable `ChapterVersion` snapshot.
