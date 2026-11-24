export const K_CAT = 'ctrl_catalogo';
export const K_NOM = 'ctrl_nombres';
export const K_REG = 'ctrl_registros';
export const K_ING = 'ctrl_ingresos';
export const K_DEL = 'ctrl_borrados';
export const K_PLAN = 'ctrl_plan_despacho';
export const K_PLANOP = 'ctrl_plan_op';
export const K_CATTS = 'ctrl_catalogo_ts';
export const K_SESION = 'ctrl_sesion';
export const K_SES_ING = 'ctrl_ses_ing';
export const K_MODO_REG = 'ctrl_modo_reg';
export const K_MODO_ING = 'ctrl_modo_ing';
export const K_RES = 'ctrl_ultimo_respaldo';
export const K_GRID = 'ctrl_grid_';
export const K_IGRID = 'ctrl_grid_ing_';
export const K_OP_EXTRA = 'ctrl_op_extra';

export function requestStoragePersistence() {
  try {
    if (navigator.storage && navigator.storage.persist) {
      navigator.storage.persist();
    }
  } catch {}
}

export function ld<T>(k: string, d: T, onCorrupt?: (msg: string) => void): T {
  let v: string | null = null;
  try {
    v = localStorage.getItem(k);
    return v ? JSON.parse(v) : d;
  } catch {
    try {
      if (v) {
        localStorage.setItem(k + '_corrupto', v);
        if (onCorrupt) {
          onCorrupt(`Datos dañados en ${k}: se guardó una copia y se empieza vacío`);
        }
      }
    } catch {}
    return d;
  }
}

export function sv<T>(k: string, v: T, onError?: (msg: string) => void): void {
  const payload = JSON.stringify(v);
  try {
    localStorage.setItem(k, payload);
  } catch {
    // Attempt to free space from stale corrupt backups & old grid drafts (>7 days)
    try {
      const keysToRemove: string[] = [];
      const cutoff = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key) continue;
        if (key.endsWith('_corrupto')) {
          keysToRemove.push(key);
        } else if (key.startsWith(K_GRID) || key.startsWith(K_IGRID)) {
          const datePart = key.slice(key.lastIndexOf('_') + 1);
          if (/^\d{4}-\d{2}-\d{2}$/.test(datePart) && datePart < cutoff) {
            keysToRemove.push(key);
          }
        }
      }
      keysToRemove.forEach((rk) => localStorage.removeItem(rk));
      localStorage.setItem(k, payload);
      return;
    } catch {}
    if (onError) {
      onError('No se pudo guardar: la memoria del navegador está llena. Descarga un respaldo en Config');
    }
  }
}

const IDB_NAME = 'ctrl_entregas_db';
const IDB_STORE = 'kv';

function openIdb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('IndexedDB open error'));
  });
}

export async function idbGet<T>(key: string): Promise<T | null> {
  try {
    const db = await openIdb();
    return await new Promise<T | null>((resolve) => {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const store = tx.objectStore(IDB_STORE);
      const req = store.get(key);
      req.onsuccess = () => resolve(req.result !== undefined ? (req.result as T) : null);
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

export async function idbSet<T>(key: string, val: T): Promise<void> {
  try {
    const db = await openIdb();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      const store = tx.objectStore(IDB_STORE);
      store.put(val, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch {}
}

