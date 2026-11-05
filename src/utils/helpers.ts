import { CatalogoOp, PlanDespacho, PlanOp, Registro } from '../types';

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

export function stockDe(op: string, fd: string, registros: Registro[]): number {
  const q = (op || '').trim().toLowerCase();
  let t = 0;
  registros.forEach((x) => {
    if (esStock(x) && x.op.toLowerCase() === q && (x.fdesp || '') === (fd || '')) {
      t += x.total || 0;
    }
  });
  return t;
}

export function acumulado(op: string, fd: string, registros: Registro[]): number {
  const q = (op || '').trim().toLowerCase();
  let t = 0;
  registros.forEach((x) => {
    if (x.op.toLowerCase() === q && (x.fdesp || '') === (fd || '')) {
      t += x.total || 0;
    }
  });
  return t;
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
  planesOp: Record<string, PlanOp>
): string {
  const p = pedidoPlanOp(op, fd, planesOp) || ultimoPedido(op, fd, registros);
  if (!p) return '';
  return acumulado(op, fd, registros) >= p ? 'COMPLETO' : 'INCOMPLETO';
}

export function estadoReg(
  r: Registro,
  registros: Registro[],
  planesOp: Record<string, PlanOp>
): string {
  return estadoDe(r.op, r.fdesp, registros, planesOp) || r.estado || '';
}

export function recalcularEstados(
  op: string,
  fd: string,
  registros: Registro[],
  planesOp: Record<string, PlanOp>
): Registro[] {
  const q = op.toLowerCase();
  const ch: Registro[] = [];
  const e = estadoDe(op, fd, registros, planesOp);
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
  planesOp: Record<string, PlanOp>
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
    if (esS) o.stock += r.total || 0;
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
      });
    if (ordenS.indexOf(gk) === -1) ordenS.push(gk);
    S.ent += tt;
    if (esS) S.stock += r.total || 0;
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
  planesOp: Record<string, PlanOp>
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

  const g = agrupar(base, todosRegistros, planesOp);
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
  });

  g.saps.forEach((x) => {
    const kk = x.sap || 'd:' + x.desc;
    const recs = base.filter(
      (r) => (r.fdesp || '') === x.fdesp && (r.sap || 'd:' + r.descripcion) === kk
    );
    const m = meta(recs);
    const opsK: Record<string, number> = {};
    let acum = 0;
    recs.forEach((r) => {
      opsK[r.op.toLowerCase()] = 1;
      acum += r.total || 0;
    });

    let ped = 0;
    let conj = false;
    let inc = false;
    let comp = false;

    Object.keys(opsK).forEach((k) => {
      const o = g.ops.find((q) => q.op.toLowerCase() === k && q.fdesp === x.fdesp);
      if (!o) return;
      if (o.nsap && o.nsap > 1) conj = true;
      else ped += o.pedido;
      const e = estadoDe(o.op, o.fdesp, todosRegistros, planesOp);
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
