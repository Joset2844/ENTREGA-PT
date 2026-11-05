import { Ingreso, Registro } from '../types';
import { K_DEL, ld, sv } from './storage';

export const DEFAULT_SB_URL =
  'https://script.google.com/macros/s/AKfycbyGl0Z5bhefLY8ZC4rf2IH1wXqtkKZYBsfo6CvXeXwI5W1vrataEqa9M5NnT84iDSw2hQ/exec';
export const DEFAULT_SB_TOKEN = '123456';

export function cfgSb() {
  return { url: DEFAULT_SB_URL, token: DEFAULT_SB_TOKEN };
}

export function validoRec(r: any): boolean {
  return (
    !!r &&
    String(r.id || '').trim() !== '' &&
    String(r.op || '').trim() !== '' &&
    /^\d{4}-\d{2}-\d{2}$/.test(String(r.fecha || '')) &&
    Number.isInteger(r.u) &&
    Number.isInteger(r.c) &&
    Number.isInteger(r.total) &&
    r.u >= 0 &&
    r.c >= 0 &&
    r.total >= 0
  );
}

export function soloValidos<T>(rs: T[], showWarning?: boolean, onToast?: (t: 'ok' | 'error', m: string) => void): T[] {
  const ok = rs.filter(validoRec);
  const mal = rs.length - ok.length;
  if (mal && showWarning && onToast) {
    onToast('error', `${mal} registro(s) con datos incompletos no se enviaron a Sheets`);
  }
  return ok;
}

export interface DelQueueItem {
  id: string;
  tabla: 'registros' | 'ingresos';
}

export function colaDel(): DelQueueItem[] {
  const a = ld<DelQueueItem[]>(K_DEL, []);
  return Array.isArray(a) ? a : [];
}

export function encolarDel(id: string, tabla: 'registros' | 'ingresos'): void {
  const a = colaDel();
  if (!a.some((x) => x.id === id && x.tabla === tabla)) {
    a.push({ id, tabla });
  }
  sv(K_DEL, a);
  procesarDel();
}

export async function llamar(payload: any): Promise<any> {
  const c = cfgSb();
  if (!c.url) throw new Error('Sin URL configurada');
  payload.token = c.token;

  try {
    const res = await fetch(c.url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload),
    });
    const text = await res.text();
    let json: any;
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error(
        "El script no devolvió datos válidos. Implementa una NUEVA VERSIÓN con acceso 'Cualquier persona'"
      );
    }
    if (!json.ok) throw new Error(json.error || 'Error del script');
    return json;
  } catch (err: any) {
    if (err.message && err.message.includes('script no devolvió')) throw err;
    throw new Error(
      "No se pudo conectar. Revisa internet y que el acceso del script sea 'Cualquier persona'"
    );
  }
}

export async function procesarDel(): Promise<void> {
  const a = colaDel();
  if (!a.length || !navigator.onLine || !cfgSb().url) return;

  for (const x of a) {
    try {
      const pl: any = { action: 'delete', id: x.id };
      if (x.tabla === 'ingresos') pl.tabla = 'ingresos';
      await llamar(pl);
      const remaining = colaDel().filter((y) => !(y.id === x.id && y.tabla === x.tabla));
      sv(K_DEL, remaining);
    } catch {}
  }
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
  return v;
}

export function huella(rs: any[]): string {
  const t = JSON.stringify(rs);
  let h = 5381;
  for (let i = 0; i < t.length; i++) {
    h = ((h << 5) + h + t.charCodeAt(i)) | 0;
  }
  return `${rs.length}:${h}`;
}

export function recRemotoOk(x: any, pend: DelQueueItem[], tabla: 'registros' | 'ingresos'): boolean {
  if (!x || String(x.id == null ? '' : x.id).trim() === '' || String(x.op == null ? '' : x.op).trim() === '') {
    return false;
  }
  const id = String(x.id).trim();
  return !pend.some((p) => p.id === id && p.tabla === tabla);
}
