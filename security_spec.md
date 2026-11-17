# Security Specification & Invariants

## 1. Data Invariants
1. No unauthenticated or unverified-email read/write access on any document.
2. A `/rooms/{roomId}` document can only be created when `ownerUid == request.auth.uid`, `roomId == roomId` path variable, and `createdAt == request.time && updatedAt == request.time`.
3. Only the `ownerUid` or a verified entry in `/rooms/{roomId}/members/{request.auth.uid}` can read or update `/rooms/{roomId}`.
4. On `/rooms/{roomId}` update, `ownerUid`, `roomId`, `shareToken`, and `createdAt` are strictly immutable; `sections` (1..30) and `slideTheses` (1..40) are size-bounded lists; `updatedAt == request.time`.
5. A user can create their own `/rooms/{roomId}/members/{memberUid}` ONLY when `memberUid == request.auth.uid`, `uid == request.auth.uid`, `joinedAt == request.time`, AND either they are the room's `ownerUid` (`role == 'owner'`) OR `joinToken` matches the parent room's `shareToken` (`role == 'editor'`).
6. No user can escalate their own member role from `editor` to `owner`, and only the room owner or self can delete a member entry.
7. `/rooms/{roomId}/presence/{memberUid}` can only be read by room members and written by `memberUid == request.auth.uid`.
8. Zero PII (`email`, `phone`) is stored in shared `/rooms/{roomId}`, `members`, or `presence`.
9. `allow list` on `/rooms` is strictly restricted to `resource.data.ownerUid == request.auth.uid` to prevent room enumeration.

## 2. The "Dirty Dozen" Adversarial Payloads
1. **Unauthenticated read/write**: Read `/rooms/vholodilnike` with `request.auth == null` -> DENIED.
2. **Unverified email**: Create `/rooms/r1` with `email_verified: false` -> DENIED.
3. **Owner spoofing**: Create `/rooms/r1` with `ownerUid: "victim-uid"` != `request.auth.uid` -> DENIED.
4. **Shadow / Ghost field**: Create `/rooms/r1` with extra field `isAdmin: true` -> DENIED (`hasOnly` check).
5. **ID Poisoning**: Create `/rooms/invalid$id` or 300-char ID -> DENIED (`isValidId`).
6. **Timestamp forgery**: Create `/rooms/r1` with client-supplied past `createdAt` != `request.time` -> DENIED.
7. **Unauthorized member join**: Create `/rooms/r1/members/attacker` with wrong `joinToken` -> DENIED.
8. **Self-escalation to owner**: Non-owner creates `/rooms/r1/members/attacker` with `role: 'owner'` -> DENIED.
9. **Unauthorized room read**: User not in `members` tries `get /rooms/r1` -> DENIED.
10. **Room enumeration scrape**: User runs `list /rooms` without `ownerUid == request.auth.uid` -> DENIED.
11. **Immutable shareToken overwrite**: Editor updates `/rooms/r1` trying to modify `shareToken` or `ownerUid` -> DENIED (`affectedKeys().hasOnly(...)`).
12. **Presence spoofing**: User A tries to write `/rooms/r1/presence/userB` -> DENIED.
