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

let delTimer: ReturnType<typeof setTimeout> | null = null;
let delInFlight: Promise<void> | null = null;
let rpcQueue: Promise<any> = Promise.resolve();

export function encolarDel(id: string, tabla: 'registros' | 'ingresos'): void {
  const a = colaDel();
  if (!a.some((x) => x.id === id && x.tabla === tabla)) {
    a.push({ id, tabla });
    sv(K_DEL, a);
  }
  if (delTimer) clearTimeout(delTimer);
  delTimer = setTimeout(() => {
    delTimer = null;
    procesarDel();
  }, 200);
}

async function ejecutarFetchSheets(url: string, payload: any): Promise<any> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 25000);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const text = await res.text();
    let json: any;
    try {
      json = JSON.parse(text);
    } catch {
      const err = new Error(
        "El script no devolvió datos válidos. Implementa una NUEVA VERSIÓN con acceso 'Cualquier persona'"
      );
      (err as any).fromScript = true;
      throw err;
    }
    if (!json.ok) {
      const err = new Error(json.error || 'Error del script');
      (err as any).fromScript = true;
      throw err;
    }
    return json;
  } finally {
    clearTimeout(timeoutId);
  }
}

export function llamar(payload: any): Promise<any> {
  const c = cfgSb();
  if (!c.url) return Promise.reject(new Error('Sin URL configurada'));
  const bodyPayload = { ...payload, token: c.token };

  const task = rpcQueue.then(async () => {
    let lastErr: any;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        if (attempt > 0) {
          await new Promise((r) => setTimeout(r, 1200));
        }
        const result = await ejecutarFetchSheets(c.url, bodyPayload);
        // Small gap between consecutive Google Apps Script requests
        await new Promise((r) => setTimeout(r, 150));
        return result;
      } catch (err: any) {
        lastErr = err;
        if (err?.fromScript && !String(err.message || '').includes('script no devolvió')) {
          throw err;
        }
      }
    }
    if (lastErr?.fromScript) throw lastErr;
    throw new Error(
      "No se pudo conectar. Revisa internet y que el acceso del script sea 'Cualquier persona'"
    );
  });

  rpcQueue = task.catch(() => {});
  return task;
}

export async function procesarDel(): Promise<void> {
  if (delInFlight) return delInFlight;
  const a = colaDel();
  if (!a.length || !navigator.onLine || !cfgSb().url) return;

  delInFlight = (async () => {
    try {
      const snapshot = colaDel();
      for (const x of snapshot) {
        try {
          const pl: any = { action: 'delete', id: x.id };
          if (x.tabla === 'ingresos') pl.tabla = 'ingresos';
          await llamar(pl);
          const remaining = colaDel().filter((y) => !(y.id === x.id && y.tabla === x.tabla));
          sv(K_DEL, remaining);
        } catch {
          // Stop processing queue if offline/rate-limited; next cycle retries
          break;
        }
      }
    } finally {
      delInFlight = null;
    }
  })();

  return delInFlight;
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
