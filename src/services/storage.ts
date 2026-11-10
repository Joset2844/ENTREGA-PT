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
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {
    if (onError) {
      onError('No se pudo guardar: la memoria del navegador está llena. Descarga un respaldo en Config');
    }
  }
}
