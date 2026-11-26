/**
 * Security Rules Verification Suite (Dirty Dozen + Legitimate Team Flows)
 * Aligned with /security_spec.md and /firestore.rules
 */
export const DIRTY_DOZEN_CASES = [
  { name: '1. Unauthenticated get /registros/reg_1', expected: 'PERMISSION_DENIED' },
  { name: '2. Unverified admin email spoof create /registros/reg_1', expected: 'PERMISSION_DENIED' },
  { name: '3. Cross-user get /registros/reg_1 outside allowedEmails', expected: 'PERMISSION_DENIED' },
  { name: '4. Cross-user blanket list /registros without matching filter', expected: 'PERMISSION_DENIED' },
  { name: '5. Identity spoofing ownerUid != auth.uid on create', expected: 'PERMISSION_DENIED' },
  { name: '6. Shadow ghost field (isAdmin: true) on create', expected: 'PERMISSION_DENIED' },
  { name: '7. Shadow field (extraField) on update', expected: 'PERMISSION_DENIED' },
  { name: '8. Immutable field mutation (ownerUid / createdAt) on update', expected: 'PERMISSION_DENIED' },
  { name: '9. Client-forged timestamp (createdAt != request.time)', expected: 'PERMISSION_DENIED' },
  { name: '10. ID poisoning (../ or >128 chars) on create', expected: 'PERMISSION_DENIED' },
  { name: '11. Value poisoning (descripcion > 240 chars or u < 0)', expected: 'PERMISSION_DENIED' },
  { name: '12. Unbounded allowedEmails array (> 15 entries)', expected: 'PERMISSION_DENIED' },
] as const;
