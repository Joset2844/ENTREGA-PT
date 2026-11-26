import { User } from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';
import { Ingreso, OpExtra, PlanDespacho, PlanOp, Registro } from '../types';
import { hoy } from '../utils/helpers';
import {
  ADMIN_EMAIL,
  db,
  handleFirestoreError,
  OperationType,
  WORKSPACE_DOC_ID,
} from './firebase';

export const COL_REGISTROS = 'registros';
export const COL_INGRESOS = 'ingresos';
export const COL_PLANES = 'despachos_plan';
export const COL_OP_EXTRAS = 'op_extras';
export const COL_WORKSPACES = 'workspaces';

export interface DocMeta {
  ownerUid: string;
  ownerEmail: string;
  allowedEmails: string[];
  createdAt: Timestamp | unknown;
}

export interface WorkspaceState {
  nombres: string[];
  teamEmails: string[];
  meta?: DocMeta;
}

// Track ownership metadata of loaded Firestore documents to keep updates immutable & tier-safe
const metaRegistros = new Map<string, DocMeta>();
const metaIngresos = new Map<string, DocMeta>();
const metaPlanes = new Map<string, DocMeta>();
const metaOpExtras = new Map<string, DocMeta>();

export function setDocMetaCache(
  kind: 'reg' | 'ing' | 'plan' | 'extra',
  entries: Map<string, DocMeta>
): void {
  const target =
    kind === 'reg'
      ? metaRegistros
      : kind === 'ing'
      ? metaIngresos
      : kind === 'plan'
      ? metaPlanes
      : metaOpExtras;
  target.clear();
  entries.forEach((v, k) => target.set(k, v));
}

export function trunc(v: unknown, maxLen: number): string {
  const s = v == null ? '' : String(v).trim();
  return s.length > maxLen ? s.slice(0, maxLen) : s;
}

export function toInt(v: unknown, maxVal = 100000000): number {
  const n = Math.floor(Number(v) || 0);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(n, maxVal);
}

export function sanitizeDocId(raw: unknown, fallbackPrefix = 'id'): string {
  const clean = String(raw == null ? '' : raw)
    .trim()
    .replace(/[^a-zA-Z0-9_\-]/g, '_')
    .slice(0, 80);
  if (clean && /^[a-zA-Z0-9_\-]+$/.test(clean)) return clean;
  return `${fallbackPrefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

export function opExtraDocId(op: string, fdesp: string): string {
  const raw = `${op.trim().toLowerCase()}_${(fdesp || 'global').trim()}`;
  const clean = raw.replace(/[^a-zA-Z0-9_\-]/g, '_').slice(0, 120);
  return clean || 'extra_global';
}

export function normFecha(v: any): string {
  v = v == null ? '' : String(v).trim();
  if (!v) return '';
  let m = v.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return v;
  if (/^\d{4}-\d{2}-\d{2}T/.test(v)) {
    const d = new Date(v);
    if (!isNaN(d.getTime())) {
      return `${d.getFullYear()}-${('0' + (d.getMonth() + 1)).slice(-2)}-${('0' + d.getDate()).slice(-2)}`;
    }
  }
  m = v.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/);
  if (m) {
    const y = m[3].length === 2 ? '20' + m[3] : m[3];
    return `${y}-${('0' + m[2]).slice(-2)}-${('0' + m[1]).slice(-2)}`;
  }
  if (/^\d{5}(\.\d+)?$/.test(v)) {
    const e = new Date(Date.UTC(1899, 11, 30) + parseFloat(v) * 864e5);
    return e.toISOString().slice(0, 10);
  }
  const d2 = new Date(v);
  if (!isNaN(d2.getTime())) {
    return `${d2.getFullYear()}-${('0' + (d2.getMonth() + 1)).slice(-2)}-${('0' + d2.getDate()).slice(-2)}`;
  }
  return '';
}

export function normalizeTurno(v: unknown): 'Día' | 'Noche' {
  const s = String(v == null ? '' : v).trim().toLowerCase();
  if (s === 'noche') return 'Noche';
  return 'Día';
}

export function validoRec(r: any): boolean {
  return (
    !!r &&
    String(r.id || '').trim() !== '' &&
    String(r.op || '').trim() !== '' &&
    /^\d{4}-\d{2}-\d{2}$/.test(normFecha(r.fecha)) &&
    Number.isInteger(Number(r.u)) &&
    Number.isInteger(Number(r.c)) &&
    Number.isInteger(Number(r.total)) &&
    Number(r.u) >= 0 &&
    Number(r.c) >= 0 &&
    Number(r.total) >= 0
  );
}

export function buildAllowedEmails(ownerEmail: string, teamEmails: string[]): string[] {
  const set = new Set<string>();
  const owner = trunc(ownerEmail.toLowerCase(), 160);
  if (owner && owner.includes('@')) set.add(owner);
  set.add(ADMIN_EMAIL);
  teamEmails.forEach((e) => {
    const clean = trunc(String(e || '').toLowerCase(), 160);
    if (clean && clean.includes('@') && set.size < 15) {
      set.add(clean);
    }
  });
  return Array.from(set).slice(0, 15);
}

function canEditAllowedEmails(meta: DocMeta | undefined, user: User): boolean {
  const email = (user.email || '').toLowerCase();
  if (!meta) return true;
  return meta.ownerUid === user.uid || email === ADMIN_EMAIL;
}

function buildRegistroCreatePayload(
  r: Registro,
  user: User,
  teamEmails: string[]
): Record<string, unknown> {
  const id = sanitizeDocId(r.id, 'reg');
  const fecha = normFecha(r.fecha) || hoy();
  const fdesp = normFecha(r.fdesp) || fecha;
  const userEmail = trunc((user.email || '').toLowerCase(), 160);

  const payload: Record<string, unknown> = {
    id,
    fecha,
    fdesp,
    turno: normalizeTurno(r.turno),
    nombre: trunc(r.nombre, 100),
    op: trunc(r.op, 60) || 'SIN-OP',
    sap: trunc(r.sap, 120),
    descripcion: trunc(r.descripcion, 240),
    cliente: trunc(r.cliente, 140),
    pedido: toInt(r.pedido, 100000000),
    empaque: trunc(r.empaque || 'caja', 20),
    u: toInt(r.u, 100000000),
    c: toInt(r.c, 100000000),
    total: toInt(r.total, 1000000000),
    estado: trunc(r.estado, 30),
    creado: trunc(r.creado || new Date().toISOString(), 40),
    ownerUid: user.uid,
    ownerEmail: userEmail,
    allowedEmails: buildAllowedEmails(userEmail, teamEmails),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
  if (typeof r.ord === 'number' && Number.isFinite(r.ord) && r.ord >= 0) {
    payload.ord = toInt(r.ord, 1000000);
  }
  return payload;
}

function buildRegistroUpdatePayload(
  r: Registro,
  meta: DocMeta,
  user: User,
  teamEmails: string[]
): Record<string, unknown> {
  const fecha = normFecha(r.fecha) || hoy();
  const fdesp = normFecha(r.fdesp) || fecha;

  const payload: Record<string, unknown> = {
    fecha,
    fdesp,
    turno: normalizeTurno(r.turno),
    nombre: trunc(r.nombre, 100),
    sap: trunc(r.sap, 120),
    descripcion: trunc(r.descripcion, 240),
    cliente: trunc(r.cliente, 140),
    pedido: toInt(r.pedido, 100000000),
    empaque: trunc(r.empaque || 'caja', 20),
    u: toInt(r.u, 100000000),
    c: toInt(r.c, 100000000),
    total: toInt(r.total, 1000000000),
    estado: trunc(r.estado, 30),
    updatedAt: serverTimestamp(),
  };
  if (typeof r.ord === 'number' && Number.isFinite(r.ord) && r.ord >= 0) {
    payload.ord = toInt(r.ord, 1000000);
  }
  if (canEditAllowedEmails(meta, user)) {
    payload.allowedEmails = buildAllowedEmails(meta.ownerEmail, teamEmails);
  }
  return payload;
}

function buildIngresoCreatePayload(
  r: Ingreso,
  user: User,
  teamEmails: string[]
): Record<string, unknown> {
  const id = sanitizeDocId(r.id, 'ing');
  const fecha = normFecha(r.fecha) || hoy();
  const userEmail = trunc((user.email || '').toLowerCase(), 160);

  return {
    id,
    fecha,
    turno: normalizeTurno(r.turno),
    nombre: trunc(r.nombre, 100),
    op: trunc(r.op, 60) || 'SIN-OP',
    sap: trunc(r.sap, 120),
    descripcion: trunc(r.descripcion, 240),
    cliente: trunc(r.cliente, 140),
    empaque: trunc(r.empaque || 'caja', 20),
    u: toInt(r.u, 100000000),
    c: toInt(r.c, 100000000),
    total: toInt(r.total, 1000000000),
    creado: trunc(r.creado || new Date().toISOString(), 40),
    ownerUid: user.uid,
    ownerEmail: userEmail,
    allowedEmails: buildAllowedEmails(userEmail, teamEmails),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
}

function buildIngresoUpdatePayload(
  r: Ingreso,
  meta: DocMeta,
  user: User,
  teamEmails: string[]
): Record<string, unknown> {
  const fecha = normFecha(r.fecha) || hoy();

  const payload: Record<string, unknown> = {
    fecha,
    turno: normalizeTurno(r.turno),
    nombre: trunc(r.nombre, 100),
    sap: trunc(r.sap, 120),
    descripcion: trunc(r.descripcion, 240),
    cliente: trunc(r.cliente, 140),
    empaque: trunc(r.empaque || 'caja', 20),
    u: toInt(r.u, 100000000),
    c: toInt(r.c, 100000000),
    total: toInt(r.total, 1000000000),
    updatedAt: serverTimestamp(),
  };
  if (canEditAllowedEmails(meta, user)) {
    payload.allowedEmails = buildAllowedEmails(meta.ownerEmail, teamEmails);
  }
  return payload;
}

export async function saveRegistrosBatchFs(
  regs: Registro[],
  user: User,
  teamEmails: string[]
): Promise<void> {
  if (!regs.length) return;
  const CHUNK = 400;
  for (let i = 0; i < regs.length; i += CHUNK) {
    const slice = regs.slice(i, i + CHUNK);
    const batch = writeBatch(db);
    slice.forEach((r) => {
      const id = sanitizeDocId(r.id, 'reg');
      const ref = doc(db, COL_REGISTROS, id);
      const existing = metaRegistros.get(id);
      if (existing) {
        batch.update(ref, buildRegistroUpdatePayload(r, existing, user, teamEmails));
      } else {
        batch.set(ref, buildRegistroCreatePayload({ ...r, id }, user, teamEmails));
      }
    });
    try {
      await batch.commit();
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, COL_REGISTROS);
    }
  }
}

export async function deleteRegistroFs(id: string): Promise<void> {
  const cleanId = sanitizeDocId(id, 'reg');
  const path = `${COL_REGISTROS}/${cleanId}`;
  try {
    await deleteDoc(doc(db, COL_REGISTROS, cleanId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function saveIngresosBatchFs(
  ings: Ingreso[],
  user: User,
  teamEmails: string[]
): Promise<void> {
  if (!ings.length) return;
  const CHUNK = 400;
  for (let i = 0; i < ings.length; i += CHUNK) {
    const slice = ings.slice(i, i + CHUNK);
    const batch = writeBatch(db);
    slice.forEach((r) => {
      const id = sanitizeDocId(r.id, 'ing');
      const ref = doc(db, COL_INGRESOS, id);
      const existing = metaIngresos.get(id);
      if (existing) {
        batch.update(ref, buildIngresoUpdatePayload(r, existing, user, teamEmails));
      } else {
        batch.set(ref, buildIngresoCreatePayload({ ...r, id }, user, teamEmails));
      }
    });
    try {
      await batch.commit();
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, COL_INGRESOS);
    }
  }
}

export async function deleteIngresoFs(id: string): Promise<void> {
  const cleanId = sanitizeDocId(id, 'ing');
  const path = `${COL_INGRESOS}/${cleanId}`;
  try {
    await deleteDoc(doc(db, COL_INGRESOS, cleanId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function savePlanFs(
  tipo: 'sap' | 'op',
  fdesp: string,
  plan: PlanDespacho | PlanOp,
  user: User,
  teamEmails: string[]
): Promise<void> {
  const fechaPlan = normFecha(fdesp) || hoy();
  const docId = sanitizeDocId(`${tipo}_${fechaPlan}`, tipo);
  const path = `${COL_PLANES}/${docId}`;
  const existing = metaPlanes.get(docId);
  const items = (plan.items || []).slice(0, 250).map((it: any) =>
    tipo === 'sap'
      ? {
          sap: trunc(it.sap, 60),
          cant: toInt(it.cant),
          stock: toInt(it.stock),
        }
      : {
          op: trunc(it.op, 60),
          cant: toInt(it.cant),
          stock: toInt(it.stock),
        }
  );
  const archivo = trunc(plan.archivo || '', 160);

  try {
    if (existing) {
      const upd: Record<string, unknown> = {
        archivo,
        items,
        updatedAt: serverTimestamp(),
      };
      if (canEditAllowedEmails(existing, user)) {
        upd.allowedEmails = buildAllowedEmails(existing.ownerEmail, teamEmails);
      }
      await updateDoc(doc(db, COL_PLANES, docId), upd);
    } else {
      const userEmail = trunc((user.email || '').toLowerCase(), 160);
      await setDoc(doc(db, COL_PLANES, docId), {
        id: docId,
        tipo,
        fdesp: fechaPlan,
        archivo,
        items,
        ownerUid: user.uid,
        ownerEmail: userEmail,
        allowedEmails: buildAllowedEmails(userEmail, teamEmails),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, existing ? OperationType.UPDATE : OperationType.CREATE, path);
  }
}

export async function saveOpExtraFs(
  op: string,
  fdesp: string,
  extra: OpExtra,
  user: User,
  teamEmails: string[]
): Promise<void> {
  const cleanOp = trunc(op, 60);
  if (!cleanOp) return;
  const cleanFd = normFecha(fdesp) || trunc(fdesp, 10);
  const key = trunc(`${cleanOp.toLowerCase()}|${cleanFd}`, 100);
  const docId = opExtraDocId(cleanOp, cleanFd);
  const path = `${COL_OP_EXTRAS}/${docId}`;
  const existing = metaOpExtras.get(docId);

  try {
    if (existing) {
      const upd: Record<string, unknown> = {
        enProduccion: Boolean(extra.enProduccion),
        cantPlanta: toInt(extra.cantPlanta),
        updatedAt: serverTimestamp(),
      };
      if (canEditAllowedEmails(existing, user)) {
        upd.allowedEmails = buildAllowedEmails(existing.ownerEmail, teamEmails);
      }
      await updateDoc(doc(db, COL_OP_EXTRAS, docId), upd);
    } else {
      const userEmail = trunc((user.email || '').toLowerCase(), 160);
      await setDoc(doc(db, COL_OP_EXTRAS, docId), {
        key,
        op: cleanOp,
        fdesp: cleanFd,
        enProduccion: Boolean(extra.enProduccion),
        cantPlanta: toInt(extra.cantPlanta),
        ownerUid: user.uid,
        ownerEmail: userEmail,
        allowedEmails: buildAllowedEmails(userEmail, teamEmails),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, existing ? OperationType.UPDATE : OperationType.CREATE, path);
  }
}

export async function saveWorkspaceConfigFs(
  nombres: string[],
  teamEmails: string[],
  existingMeta: DocMeta | undefined,
  user: User,
  updateTeam = false
): Promise<void> {
  const path = `${COL_WORKSPACES}/${WORKSPACE_DOC_ID}`;
  const cleanNombres = nombres
    .map((n) => trunc(n, 100))
    .filter(Boolean)
    .slice(0, 100);
  const cleanEmails = buildAllowedEmails(existingMeta?.ownerEmail || user.email || '', teamEmails);

  try {
    if (existingMeta) {
      const upd: Record<string, unknown> = {
        nombres: cleanNombres,
        updatedAt: serverTimestamp(),
      };
      if (updateTeam && canEditAllowedEmails(existingMeta, user)) {
        upd.teamEmails = cleanEmails;
        upd.allowedEmails = cleanEmails;
      }
      await updateDoc(doc(db, COL_WORKSPACES, WORKSPACE_DOC_ID), upd);
    } else {
      const userEmail = trunc((user.email || '').toLowerCase(), 160);
      await setDoc(doc(db, COL_WORKSPACES, WORKSPACE_DOC_ID), {
        nombres: cleanNombres,
        teamEmails: cleanEmails,
        ownerUid: user.uid,
        ownerEmail: userEmail,
        allowedEmails: cleanEmails,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, existingMeta ? OperationType.UPDATE : OperationType.CREATE, path);
  }
}

export async function propagateTeamEmailsFs(
  user: User,
  teamEmails: string[]
): Promise<number> {
  const email = (user.email || '').toLowerCase();
  const maps: { col: string; map: Map<string, DocMeta> }[] = [
    { col: COL_REGISTROS, map: metaRegistros },
    { col: COL_INGRESOS, map: metaIngresos },
    { col: COL_PLANES, map: metaPlanes },
    { col: COL_OP_EXTRAS, map: metaOpExtras },
  ];

  let updated = 0;
  let batch = writeBatch(db);
  let opsInBatch = 0;

  for (const { col, map } of maps) {
    for (const [docId, meta] of map.entries()) {
      if (meta.ownerUid !== user.uid && email !== ADMIN_EMAIL) continue;
      const nextAllowed = buildAllowedEmails(meta.ownerEmail, teamEmails);
      batch.update(doc(db, col, docId), {
        allowedEmails: nextAllowed,
        updatedAt: serverTimestamp(),
      });
      opsInBatch++;
      updated++;
      if (opsInBatch >= 400) {
        try {
          await batch.commit();
        } catch (error) {
          handleFirestoreError(error, OperationType.UPDATE, col);
        }
        batch = writeBatch(db);
        opsInBatch = 0;
      }
    }
  }

  if (opsInBatch > 0) {
    try {
      await batch.commit();
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, COL_REGISTROS);
    }
  }

  return updated;
}

export async function migrateLegacyLocalDataFs(params: {
  user: User;
  teamEmails: string[];
  workspaceMeta?: DocMeta;
  cloudRegistrosIds: Set<string>;
  cloudIngresosIds: Set<string>;
  cloudPlanesKeys: Set<string>;
  cloudPlanesOpKeys: Set<string>;
  cloudExtraKeys: Set<string>;
  localRegistros: Registro[];
  localIngresos: Ingreso[];
  localPlanes: Record<string, PlanDespacho>;
  localPlanesOp: Record<string, PlanOp>;
  localOpExtra: Record<string, OpExtra>;
  localNombres: string[];
  cloudNombres: string[];
}): Promise<{ regs: number; ings: number; planes: number; extras: number }> {
  const {
    user,
    teamEmails,
    workspaceMeta,
    cloudRegistrosIds,
    cloudIngresosIds,
    cloudPlanesKeys,
    cloudPlanesOpKeys,
    cloudExtraKeys,
    localRegistros,
    localIngresos,
    localPlanes,
    localPlanesOp,
    localOpExtra,
    localNombres,
    cloudNombres,
  } = params;

  const missingRegs = localRegistros.filter((r) => {
    const id = sanitizeDocId(r.id, 'reg');
    return validoRec(r) && !cloudRegistrosIds.has(id);
  });
  const missingIngs = localIngresos.filter((r) => {
    const id = sanitizeDocId(r.id, 'ing');
    return validoRec(r) && !cloudIngresosIds.has(id);
  });

  if (missingRegs.length) {
    await saveRegistrosBatchFs(missingRegs, user, teamEmails);
  }
  if (missingIngs.length) {
    await saveIngresosBatchFs(missingIngs, user, teamEmails);
  }

  let planesCount = 0;
  for (const fd of Object.keys(localPlanes)) {
    const cleanFd = normFecha(fd);
    if (!cleanFd || cloudPlanesKeys.has(cleanFd) || !localPlanes[fd]?.items?.length) continue;
    await savePlanFs('sap', cleanFd, localPlanes[fd], user, teamEmails);
    planesCount++;
  }
  for (const fd of Object.keys(localPlanesOp)) {
    const cleanFd = normFecha(fd);
    if (!cleanFd || cloudPlanesOpKeys.has(cleanFd) || !localPlanesOp[fd]?.items?.length) continue;
    await savePlanFs('op', cleanFd, localPlanesOp[fd], user, teamEmails);
    planesCount++;
  }

  let extrasCount = 0;
  for (const k of Object.keys(localOpExtra)) {
    if (cloudExtraKeys.has(k) || !k.includes('|')) continue;
    const [opPart, fdPart] = k.split('|');
    if (!opPart) continue;
    await saveOpExtraFs(opPart, fdPart || '', localOpExtra[k], user, teamEmails);
    extrasCount++;
  }

  const mergedNombres = Array.from(new Set([...cloudNombres, ...localNombres]))
    .map((x) => x.trim())
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }));

  if (!workspaceMeta || mergedNombres.length > cloudNombres.length) {
    await saveWorkspaceConfigFs(mergedNombres, teamEmails, workspaceMeta, user, false);
  }

  return {
    regs: missingRegs.length,
    ings: missingIngs.length,
    planes: planesCount,
    extras: extrasCount,
  };
}
