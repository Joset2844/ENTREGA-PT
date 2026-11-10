import { CatalogoOp, OpExtra, PlanDespacho, PlanOp, Registro } from '../types';

export const LIM = {
  fechaFut: 3,
  fechaPas: 30,
  unid: 20000,
  cant: 2000,
  total: 100000,
  pedido: 500000,
};

export function norm(h: any): string {
  return String(h || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

export function hoy(): string {
  const d = new Date();
  return (
    d.getFullYear() +
    '-' +
    String(d.getMonth() + 1).padStart(2, '0') +
    '-' +
    String(d.getDate()).padStart(2, '0')
  );
}

export function fcorta(f: string | undefined): string {
  if (!f) return '';
  const p = String(f).split('-');
  return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : f;
}

export function esEntero(v: any): boolean {
  return /^\d+$/.test(String(v == null ? '' : v).trim());
}

export function difDias(f: string): number {
  const a = new Date(f + 'T00:00:00');
  const b = new Date(hoy() + 'T00:00:00');
  return Math.round((a.getTime() - b.getTime()) / 864e5);
}

export function avisoFecha(f: string, nom: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f || '')) return `La fecha de ${nom} no es válida`;
  const d = difDias(f);
  if (d > LIM.fechaFut) return `La fecha de ${nom} (${fcorta(f)}) está ${d} días en el futuro`;
  if (d < -LIM.fechaPas) return `La fecha de ${nom} (${fcorta(f)}) es de hace ${-d} días`;
  return '';
}

export function avisoCant(u: number, c: number): string[] {
  const w: string[] = [];
  if (u > LIM.unid) w.push(`Unidades por empaque muy alta (${u})`);
  if (c > LIM.cant) w.push(`Cantidad de empaques muy alta (${c})`);
  if (u * c > LIM.total) w.push(`Total muy alto (${u * c} u)`);
  return w;
}

export function confirmarAvisos(w: string[]): boolean {
  const clean = w.filter(Boolean);
  if (!clean.length) return true;
  return window.confirm(`Revisa antes de guardar:\n\n• ${clean.join('\n• ')}\n\n¿Guardar de todas formas?`);
}

export function esStock(r: Partial<Registro> | undefined): boolean {
  return !!r && r.empaque === 'stock';
}

/**
 * Retorna el stock inicial único de una OP en un despacho determinado.
 * Si por alguna razón existen registros duplicados en el historial, NO los suma:
 * toma el valor canónico (el más alto / más reciente) para evitar que se dupliquen las cifras.
 */
export function stockDe(op: string, fd: string, registros: Registro[]): number {
  const q = (op || '').trim().toLowerCase();
  const f = (fd || '').trim();
  let maxStock = 0;
  registros.forEach((x) => {
    if (
      esStock(x) &&
      x.op.trim().toLowerCase() === q &&
      (x.fdesp || x.fecha || '').trim() === f
    ) {
      if ((x.total || 0) > maxStock) {
        maxStock = x.total || 0;
      }
    }
  });
  return maxStock;
}

/**
 * Calcula el acumulado real de una OP en un despacho:
 * Suma de todas las entregas reales (excluyendo entradas de tipo stock) + el stock inicial único.
 * Esto garantiza matemáticamente que el stock inicial jamás se duplique en el acumulado.
 */
export function acumulado(op: string, fd: string, registros: Registro[]): number {
  const q = (op || '').trim().toLowerCase();
  const f = (fd || '').trim();
  let entregas = 0;
  registros.forEach((x) => {
    if (
      !esStock(x) &&
      x.op.trim().toLowerCase() === q &&
      (x.fdesp || x.fecha || '').trim() === f
    ) {
      entregas += x.total || 0;
    }
  });
  const stk = stockDe(op, fd, registros);
  return entregas + stk;
}

/**
 * Detecta y consolida registros de stock inicial duplicados para la misma OP y despacho.
 * Devuelve la lista limpia y la lista de registros duplicados eliminados.
 */
export function sanitizarStockDuplicados(registros: Registro[]): {
  registrosLimpios: Registro[];
  duplicadosEliminados: Registro[];
} {
  const vistosStock: Record<string, Registro> = {};
  const duplicadosEliminados: Registro[] = [];
  const registrosLimpios: Registro[] = [];

  registros.forEach((r) => {
    if (!esStock(r)) {
      registrosLimpios.push(r);
      return;
    }

    const opKey = (r.op || '').trim().toLowerCase();
    const fdKey = (r.fdesp || r.fecha || '').trim();
    const k = `${opKey}|${fdKey}`;

    if (!vistosStock[k]) {
      vistosStock[k] = r;
      registrosLimpios.push(r);
    } else {
      // Ya existe un registro de stock para esta OP en este despacho. Es un duplicado.
      const principal = vistosStock[k];
      if ((r.total || 0) > (principal.total || 0)) {
        principal.u = r.u || r.total || 0;
        principal.total = r.total || 0;
        principal.c = 1;
        principal.sync = false;
      }
      duplicadosEliminados.push(r);
    }
  });

  return { registrosLimpios, duplicadosEliminados };
}

export function ultimoPedido(op: string, fd: string, registros: Registro[]): number {
  const q = (op || '').trim().toLowerCase();
  if (!q) return 0;
  let best: Registro | null = null;
  registros.forEach((x) => {
    if (
      x.op.toLowerCase() === q &&
      (x.fdesp || '') === (fd || '') &&
      x.pedido > 0 &&
      (!best || String(x.creado) > String(best.creado))
    ) {
      best = x;
    }
  });
  return best ? (best as Registro).pedido : 0;
}

export function pedidoPlanOp(op: string, fd: string, planesOp: Record<string, PlanOp>): number {
  const p = planesOp[fd];
  if (!p) return 0;
  const q = (op || '').trim().toUpperCase();
  for (let i = 0; i < p.items.length; i++) {
    if (p.items[i].op.toUpperCase() === q) return p.items[i].cant;
  }
  return 0;
}

export function pedidoPlanSap(sap: string, fd: string, planes: Record<string, PlanDespacho>): number {
  const p = planes[fd];
  if (!p || !sap) return 0;
  const q = String(sap).trim().toUpperCase();
  for (let i = 0; i < p.items.length; i++) {
    if (p.items[i].sap.toUpperCase() === q) return p.items[i].cant;
  }
  return 0;
}

export function pedidoDe(
  op: string,
  fd: string,
  registros: Registro[],
  catalogo: CatalogoOp[],
  planesOp: Record<string, PlanOp>,
  planes: Record<string, PlanDespacho>
): number {
  const x = pedidoPlanOp(op, fd, planesOp);
  if (x) return x;
  const u = ultimoPedido(op, fd, registros);
  if (u) return u;
  if (planesOp[fd] || planes[fd]) return 0;
  const m = catalogo.find((c) => c.op.toLowerCase() === op.trim().toLowerCase());
  return m && m.cantidadTotal ? (parseInt(String(m.cantidadTotal), 10) || 0) : 0;
}

export function estadoDe(
  op: string,
  fd: string,
  registros: Registro[],
  planesOp: Record<string, PlanOp>,
  opExtra?: Record<string, OpExtra>
): string {
  const k = op.trim().toLowerCase() + '|' + (fd || '');
  const extra = opExtra?.[k] || opExtra?.[op.trim().toLowerCase()];
  if (extra?.enProduccion) {
    return 'EN PRODUCCION';
  }
  const p = pedidoPlanOp(op, fd, planesOp) || ultimoPedido(op, fd, registros);
  if (!p) return '';
  return acumulado(op, fd, registros) >= p ? 'COMPLETO' : 'INCOMPLETO';
}

export function estadoReg(
  r: Registro,
  registros: Registro[],
  planesOp: Record<string, PlanOp>,
  opExtra?: Record<string, OpExtra>
): string {
  return estadoDe(r.op, r.fdesp, registros, planesOp, opExtra) || r.estado || '';
}

export function recalcularEstados(
  op: string,
  fd: string,
  registros: Registro[],
  planesOp: Record<string, PlanOp>,
  opExtra?: Record<string, OpExtra>
): Registro[] {
  const q = op.toLowerCase();
  const ch: Registro[] = [];
  const e = estadoDe(op, fd, registros, planesOp, opExtra);
  registros.forEach((x) => {
    if (x.op.toLowerCase() === q && (x.fdesp || '') === (fd || '') && x.estado !== e) {
      x.estado = e;
      x.sync = false;
      ch.push(x);
    }
  });
  return ch;
}

export function entregasReales(fl: Registro[]): Registro[] {
  return fl.filter((r) => !esStock(r) && (r.total || 0) > 0);
}

export interface GrupoOp {
  op: string;
  fdesp: string;
  cliente: string;
  pedido: number;
  ent: number;
  stock: number;
  lineas: Record<string, { sap: string; desc: string; ent: number }>;
  acum: number;
  desc: string;
  enProduccion?: boolean;
  cantPlanta?: number;
  ord?: number;
  pos?: number;
  nsap?: number;
  entF?: number;
}

export interface GrupoSap {
  fdesp: string;
  sap: string;
  desc: string;
  ent: number;
  stock: number;
  cliente: string;
  cli: Record<string, number>;
  ops: Record<string, number>;
  ord?: number;
  pos?: number;
  entF?: number;
  acum?: number;
  conj?: boolean;
  pedido?: number | null;
  falt?: number | null;
  exc?: number | null;
  estado?: string;
}

export function agrupar(
  rs: Registro[],
  registrosContext: Registro[],
  planesOp: Record<string, PlanOp>,
  opExtra?: Record<string, OpExtra>
): { ops: GrupoOp[]; saps: GrupoSap[] } {
  const ops: Record<string, any> = {};
  const ordenO: string[] = [];
  const saps: Record<string, any> = {};
  const ordenS: string[] = [];

  rs.forEach((r) => {
    const fd = r.fdesp || '';
    const k = r.op.toLowerCase() + '|' + fd;
    if (!ops[k]) {
      ops[k] = {
        op: r.op,
        fdesp: fd,
        cliente: r.cliente,
        pedido: 0,
        ent: 0,
        stock: 0,
        lineas: {},
      };
      ordenO.push(k);
    }
    const o = ops[k];
    const esS = esStock(r);
    const tt = esS ? 0 : r.total || 0;
    o.ent += tt;
    if (esS) {
      o.stock = Math.max(o.stock, r.total || 0);
    }
    if (r.pedido) o.pedido = r.pedido;
    const pp = pedidoPlanOp(r.op, fd, planesOp);
    if (pp) o.pedido = pp;

    const sk = r.sap || 'd:' + r.descripcion;
    const L = o.lineas[sk] || (o.lineas[sk] = { sap: r.sap || '', desc: r.descripcion, ent: 0 });
    L.ent += tt;

    const gk = fd + '|' + sk;
    const S =
      saps[gk] ||
      (saps[gk] = {
        fdesp: fd,
        sap: r.sap || '',
        desc: r.descripcion,
        ent: 0,
        stock: 0,
        cli: {},
        ops: {},
        _stockOps: {},
      });
    if (ordenS.indexOf(gk) === -1) ordenS.push(gk);
    S.ent += tt;
    if (esS) {
      const opKey = r.op.trim().toLowerCase();
      if (!S._stockOps) S._stockOps = {};
      if (!S._stockOps[opKey]) {
        S._stockOps[opKey] = r.total || 0;
        S.stock += r.total || 0;
      } else if ((r.total || 0) > S._stockOps[opKey]) {
        S.stock += (r.total || 0) - S._stockOps[opKey];
        S._stockOps[opKey] = r.total || 0;
      }
    }
    if (r.cliente) S.cli[r.cliente] = 1;
    S.ops[r.op] = 1;
  });

  const lo: GrupoOp[] = ordenO.map((k) => {
    const o = ops[k];
    o.acum = acumulado(o.op, o.fdesp, registrosContext);
    const ds: Record<string, number> = {};
    Object.keys(o.lineas).forEach((sk) => {
      const d = o.lineas[sk].desc;
      if (d) ds[d] = 1;
    });
    o.desc = Object.keys(ds).join(' + ');
    const extra = opExtra?.[k] || opExtra?.[o.op.trim().toLowerCase()];
    o.enProduccion = Boolean(extra?.enProduccion);
    o.cantPlanta = typeof extra?.cantPlanta === 'number' ? extra.cantPlanta : 0;
    return o;
  });

  const ls: GrupoSap[] = ordenS.map((k) => {
    const x = saps[k];
    x.cliente = Object.keys(x.cli).join(', ');
    return x;
  });

  return { ops: lo, saps: ls };
}

export function agruparReporte(
  fl: Registro[],
  todosRegistros: Registro[],
  fDespFiltro: string,
  planesOp: Record<string, PlanOp>,
  opExtra?: Record<string, OpExtra>
) {
  const fds: Record<string, number> = {};
  fl.forEach((r) => {
    fds[r.fdesp || r.fecha || ''] = 1;
  });
  if (fDespFiltro) fds[fDespFiltro] = 1;

  const base = todosRegistros.filter((r) => fds[r.fdesp || r.fecha || '']);
  const pos: Record<string, number> = {};
  todosRegistros.forEach((r, i) => {
    pos[r.id] = i;
  });

  const g = agrupar(base, todosRegistros, planesOp, opExtra);
  const eo: Record<string, number> = {};
  const es: Record<string, number> = {};

  entregasReales(fl).forEach((r) => {
    const fd = r.fdesp || '';
    const ko = r.op.toLowerCase() + '|' + fd;
    const ks = fd + '|' + (r.sap || 'd:' + r.descripcion);
    eo[ko] = (eo[ko] || 0) + (r.total || 0);
    es[ks] = (es[ks] || 0) + (r.total || 0);
  });

  function meta(recs: Registro[]) {
    let mn = Infinity;
    let mx = -1;
    recs.forEach((r) => {
      if (typeof r.ord === 'number' && r.ord > 0 && r.ord < mn) mn = r.ord;
      const p = pos[r.id];
      if (p > mx) mx = p;
    });
    return { ord: mn, pos: mx };
  }

  g.ops.forEach((o) => {
    const k = o.op.toLowerCase();
    const recs = base.filter((r) => r.op.toLowerCase() === k && (r.fdesp || '') === o.fdesp);
    const m = meta(recs);
    const sp: Record<string, number> = {};
    recs.forEach((r) => {
      sp[r.sap || 'd:' + r.descripcion] = 1;
    });
    o.ord = m.ord;
    o.pos = m.pos;
    o.nsap = Object.keys(sp).length;
    o.entF = eo[k + '|' + o.fdesp] || 0;
    const extra = opExtra?.[k + '|' + o.fdesp] || opExtra?.[k];
    o.enProduccion = Boolean(extra?.enProduccion);
    o.cantPlanta = typeof extra?.cantPlanta === 'number' ? extra.cantPlanta : 0;
  });

  g.saps.forEach((x) => {
    const kk = x.sap || 'd:' + x.desc;
    const recs = base.filter(
      (r) => (r.fdesp || '') === x.fdesp && (r.sap || 'd:' + r.descripcion) === kk
    );
    const m = meta(recs);
    const opsK: Record<string, number> = {};
    let entSap = 0;
    recs.forEach((r) => {
      opsK[r.op.toLowerCase()] = 1;
      if (!esStock(r)) {
        entSap += r.total || 0;
      }
    });
    let stockSap = 0;
    Object.keys(opsK).forEach((opKey) => {
      stockSap += stockDe(opKey, x.fdesp, todosRegistros);
    });
    const acum = entSap + stockSap;

    let ped = 0;
    let conj = false;
    let inc = false;
    let comp = false;

    Object.keys(opsK).forEach((k) => {
      const o = g.ops.find((q) => q.op.toLowerCase() === k && q.fdesp === x.fdesp);
      if (!o) return;
      if (o.nsap && o.nsap > 1) conj = true;
      else ped += o.pedido;
      const e = estadoDe(o.op, o.fdesp, todosRegistros, planesOp, opExtra);
      if (e === 'INCOMPLETO') inc = true;
      if (e === 'COMPLETO') comp = true;
    });

    x.ord = m.ord;
    x.pos = m.pos;
    x.entF = es[x.fdesp + '|' + kk] || 0;
    x.acum = acum;
    x.conj = conj;

    if (conj) {
      x.pedido = null;
      x.falt = null;
      x.exc = null;
      x.estado = inc ? 'INCOMPLETO' : comp ? 'COMPLETO' : '';
    } else {
      x.pedido = ped;
      x.falt = Math.max(ped - acum, 0);
      x.exc = ped > 0 ? Math.max(acum - ped, 0) : 0;
      x.estado = ped > 0 ? (acum >= ped ? 'COMPLETO' : 'INCOMPLETO') : '';
    }
  });

  function cmpCarga(a: { fdesp: string; ord?: number; pos?: number }, b: { fdesp: string; ord?: number; pos?: number }) {
    if (a.fdesp !== b.fdesp) return a.fdesp < b.fdesp ? 1 : -1;
    const ha = (a.ord ?? Infinity) < Infinity;
    const hb = (b.ord ?? Infinity) < Infinity;
    if (ha && hb) return ((a.ord ?? 0) - (b.ord ?? 0)) || ((a.pos ?? 0) - (b.pos ?? 0));
    if (ha) return -1;
    if (hb) return 1;
    return (a.pos ?? 0) - (b.pos ?? 0);
  }

  g.ops.sort(cmpCarga);
  g.saps.sort(cmpCarga);
  return g;
}
