# Security Specification — Control de Entregas (Firestore)

## 1. Data Invariants
1. Every document in `registros`, `ingresos`, `despachos_plan`, `op_extras`, and `workspaces` requires an authenticated Google user with `request.auth.token.email_verified == true`.
2. `ownerUid`, `ownerEmail`, and `createdAt` are immutable once created (`ownerUid == request.auth.uid`, `ownerEmail == request.auth.token.email`, `createdAt == request.time`).
3. `updatedAt` must always equal `request.time` on creation and update.
4. No unauthenticated or blanket `isSignedIn()` reads are permitted: `get` and `list` require `ownerUid == request.auth.uid`, bootstrapped verified admin (`josetejera44@gmail.com`), or verified email membership in `resource.data.allowedEmails` (bounded to `<= 15` items).
5. All string fields enforce explicit `.size()` ceilings and numeric fields enforce `is int` and `>= 0`.
6. Document IDs are strictly validated via `isValidId(id)` (`^[a-zA-Z0-9_\-]+$`, max 128 chars) on single-document operations (`get`, `create`, `update`, `delete`).
7. Update operations use explicit action branches with `incoming().diff(existing()).affectedKeys().hasOnly([...])` and wrap the full update rule with `isValid[Entity](incoming())`.

## 2. The "Dirty Dozen" Attack Payloads (All Must Fail with PERMISSION_DENIED)
1. **Unauthenticated read/write**: `get /registros/reg_1` with `auth == null`.
2. **Unverified email spoofing**: `create /registros/reg_1` with `token.email == "josetejera44@gmail.com"` and `email_verified == false`.
3. **Cross-user read**: `get /registros/reg_1` as `other@gmail.com` when `other@gmail.com` is not `ownerUid` and not in `allowedEmails`.
4. **Cross-user list scraping**: `list /registros` without matching `ownerUid` or `allowedEmails` (or non-admin).
5. **Identity spoofing on create**: `create /registros/reg_1` with `ownerUid: "someone-else"`.
6. **Shadow ghost field on create**: `create /registros/reg_1` including extra `"isAdmin": true`.
7. **Shadow field on update**: `update /registros/reg_1` adding `"extraField": "hack"`.
8. **Immutable field mutation**: `update /registros/reg_1` changing `ownerUid`, `ownerEmail`, or `createdAt`.
9. **Client-forged timestamp**: `create /registros/reg_1` with `createdAt: Timestamp(2020-01-01)`.
10. **ID poisoning**: `create /registros/../../etc/passwd` or 200-char ID.
11. **Value poisoning / resource exhaustion**: `update /registros/reg_1` setting `descripcion` to a 5000-char string or `u: -5`.
12. **Unbounded array abuse**: `create /workspaces/planta-principal` with `allowedEmails` having 50 entries (> 15 max).
