import { CatalogoOp } from '../types';
import { K_CAT, K_CATTS, ld, sv } from './storage';

export const SB_CAT_URL = 'https://skoksthbuyrhekfchmug.supabase.co';
export const SB_CAT_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNrb2tzdGhidXlyaGVrZmNobXVnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAyMTEwNjUsImV4cCI6MjEwNTc4NzA2NX0.1vrW7PVIzPvi5a4kIIc-1EoPIYsZcOTeWVq0vXBr5f4';
export const CAT_HORAS = 4;

export function catTs(): number {
  return parseInt(localStorage.getItem(K_CATTS) || '0', 10) || 0;
}

export async function leerCatalogoSb(): Promise<any[]> {
  const out: any[] = [];
  let paginas = 0;

  async function pagina(off: number): Promise<any[]> {
    const res = await fetch(
      `${SB_CAT_URL}/rest/v1/catalogo_op?select=op,datos&order=op.asc&limit=1000&offset=${off}`,
      {
        headers: {
          apikey: SB_CAT_KEY,
          Authorization: `Bearer ${SB_CAT_KEY}`,
        },
        cache: 'no-store',
      }
    );

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`HTTP ${res.status} ${text.slice(0, 80)}`);
    }

    const rows = await res.json();
    if (!Array.isArray(rows)) throw new Error('Respuesta inesperada de Supabase');
    if (!rows.length || ++paginas > 200) return out;
    out.push(...rows);
    return pagina(off + rows.length);
  }

  return pagina(0);
}

function nEnt(v: any): number {
  const n = parseInt(String(v == null ? '' : v).replace(/,/g, ''), 10);
  return isNaN(n) ? 0 : n;
}

export function normOpSb(row: any): CatalogoOp | null {
  if (!row) return null;
  let d = row.datos;
  if (typeof d === 'string') {
    try {
      d = JSON.parse(d);
    } catch {
      d = null;
    }
  }
  if (!d || typeof d !== 'object') d = {};

  const op = String(
    row.op != null && String(row.op).trim() !== '' ? row.op : d.op || ''
  ).trim();
  if (!op) return null;

  let mods = (Array.isArray(d.modelos) ? d.modelos : []).map((m: any) => {
    m = m || {};
    const o: any = {
      descripcion: String(m.descripcion == null ? '' : m.descripcion).trim(),
      sap: String(m.sap == null ? '' : m.sap).trim(),
      cantidadTotal: m.cantidadTotal == null ? '' : m.cantidadTotal,
    };
    if (m.modelo) o.modelo = String(m.modelo).trim();
    return o;
  });

  if (!mods.length) {
    mods = [
      {
        descripcion: String(d.descripcion || '').trim(),
        sap: String(d.sap || '').trim(),
        cantidadTotal: d.cantidadTotal == null ? '' : d.cantidadTotal,
      },
    ];
  }

  let q = nEnt(d.cantidadTotal);
  if (!(q > 0)) {
    q = mods.reduce((a: number, m: any) => a + nEnt(m.cantidadTotal), 0);
  }

  const it: CatalogoOp = {
    op,
    cliente: String(d.cliente == null ? '' : d.cliente).trim(),
    modelos: mods,
    cantidadTotal: q,
    descripcion: '',
    sap: '',
    descripcionBase: '',
  };

  if (mods.length > 1) {
    it.descripcion = `Varios modelos (${mods.length})`;
    it.sap = '';
    it.descripcionBase = String(d.descripcionBase || mods[0].descripcion || '').trim();
  } else {
    it.descripcion = mods[0].descripcion;
    it.sap = mods[0].sap;
    it.descripcionBase = it.descripcion;
  }

  return it;
}
