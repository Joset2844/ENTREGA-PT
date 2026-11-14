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
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f || '')) return `La fecha de ${nom} no tiene un formato válido (AAAA-MM-DD)`;
  const d = difDias(f);
  if (d > LIM.fechaFut) return `La fecha de ${nom} (${fcorta(f)}) está programada para dentro de ${d} días`;
  if (d < -LIM.fechaPas) return `La fecha de ${nom} (${fcorta(f)}) corresponde a hace ${-d} días`;
  return '';
}

export function avisoCant(u: number, c: number): string[] {
  const w: string[] = [];
  if (u > LIM.unid) w.push(`Cantidad de unidades por empaque inusualmente alta (${u} u)`);
  if (c > LIM.cant) w.push(`Cantidad de empaques inusualmente alta (${c} empaques)`);
  if (u * c > LIM.total) w.push(`Total calculado inusualmente alto (${u * c} unidades)`);
  return w;
}

export function confirmarAvisos(w: string[]): boolean {
  const clean = w.filter(Boolean);
  if (!clean.length) return true;
  return window.confirm(`Por favor verifica antes de guardar:\n\n• ${clean.join('\n• ')}\n\n¿Deseas continuar y guardar de todas formas?`);
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

export function extraerSaps(sapStr: string | undefined): string[] {
  return String(sapStr || '')
    .split(/[+,;/]+/)
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
}

export function sapsDeCatalogoOp(m: CatalogoOp | null | undefined): string[] {
  if (!m) return [];
  const set = new Set<string>();
  if (m.sap) extraerSaps(m.sap).forEach((s) => set.add(s));
  (m.modelos || []).forEach((mo) => {
    if (mo.sap) extraerSaps(mo.sap).forEach((s) => set.add(s));
  });
  return Array.from(set);
}

export function pedidoPlanSap(sap: string, fd: string, planes: Record<string, PlanDespacho>): number {
  const p = planes[fd];
  if (!p || !sap) return 0;
  const saps = extraerSaps(sap);
  if (!saps.length) return 0;
  let total = 0;
  const vistos = new Set<string>();
  for (let i = 0; i < p.items.length; i++) {
    const itemSap = String(p.items[i].sap || '').trim().toUpperCase();
    if (saps.includes(itemSap) && !vistos.has(itemSap)) {
      vistos.add(itemSap);
      total += p.items[i].cant || 0;
    }
  }
  return total;
}

export interface OpSapResumen {
  op: string;
  pedido: number;
  ent: number;
  stock: number;
  acum: number;
}

export interface InfoSapDespacho {
  sap: string;
  enPlanSap: boolean;
  enRegistrosDesp: boolean;
  enDespacho: boolean;
  hayPlanSapCargado: boolean;
  pedidoSap: number;
  stockRegistrado: number;
  stockPlanSinReg: number;
  entregadoSap: number;
  acumuladoSap: number;
  cubiertoOtrasOps: number;
  pendienteSap: number;
  pendienteOtrasOps: number;
  excedenteSap: number;
  opsRelacionadas: OpSapResumen[];
  otrasOps: OpSapResumen[];
}

export function compararSapConDespacho(
  sapInput: string,
  fd: string,
  registros: Registro[],
  planes: Record<string, PlanDespacho>,
  opActual?: string
): InfoSapDespacho | null {
  const targetSaps = extraerSaps(sapInput);
  if (!targetSaps.length || !fd) return null;

  const targetFd = fd.trim();
  const opNorm = (opActual || '').trim().toLowerCase();
  const planActual = planes[targetFd];
  const hayPlanSapCargado = Boolean(planActual && planActual.items && planActual.items.length > 0);

  // Match against SAP plan items
  let pedidoPlan = 0;
  let stockPlan = 0;
  let enPlanSap = false;
  if (planActual?.items) {
    const vistosPlan = new Set<string>();
    planActual.items.forEach((it) => {
      const s = String(it.sap || '').trim().toUpperCase();
      if (targetSaps.includes(s) && !vistosPlan.has(s)) {
        vistosPlan.add(s);
        enPlanSap = true;
        pedidoPlan += it.cant || 0;
        stockPlan += it.stock || 0;
      }
    });
  }

  // Build fallback SAP lookup per OP (same fdesp first, then any record) so stock records without SAP still match
  const opSapFallback: Record<string, string> = {};
  registros.forEach((r) => {
    const rSap = (r.sap || '').trim();
    if (!rSap) return;
    const rOp = (r.op || '').trim().toLowerCase();
    const rFd = (r.fdesp || r.fecha || '').trim();
    if (!opSapFallback[rOp + '|' + rFd] || !esStock(r)) {
      opSapFallback[rOp + '|' + rFd] = rSap;
    }
    if (!opSapFallback[rOp] || !esStock(r)) {
      opSapFallback[rOp] = rSap;
    }
  });

  // Match against registros in the same despacho
  const opsMap: Record<string, OpSapResumen> = {};
  registros.forEach((r) => {
    const rFd = (r.fdesp || r.fecha || '').trim();
    if (rFd !== targetFd) return;
    const okKey = r.op.trim().toLowerCase();
    const effectiveSap =
      (r.sap || '').trim() || opSapFallback[okKey + '|' + rFd] || opSapFallback[okKey] || '';
    const rSaps = extraerSaps(effectiveSap);
    const matches = targetSaps.some((ts) => rSaps.includes(ts));
    if (!matches) return;

    if (!opsMap[okKey]) {
      opsMap[okKey] = {
        op: r.op.trim(),
        pedido: 0,
        ent: 0,
        stock: 0,
        acum: 0,
      };
    }
    const entry = opsMap[okKey];
    if (!esStock(r)) {
      entry.ent += r.total || 0;
    }
    if ((r.pedido || 0) > entry.pedido) {
      entry.pedido = r.pedido || 0;
    }
  });

  const opsRelacionadas = Object.values(opsMap).map((o) => {
    const stock = stockDe(o.op, targetFd, registros);
    return {
      ...o,
      stock,
      acum: o.ent + stock,
    };
  });

  const otrasOps = opsRelacionadas.filter((o) => o.op.toLowerCase() !== opNorm);
  const enRegistrosDesp = opsRelacionadas.length > 0;
  const enDespacho = enPlanSap || enRegistrosDesp;

  const entregadoSap = opsRelacionadas.reduce((a, o) => a + o.ent, 0);
  const stockRegistrado = opsRelacionadas.reduce((a, o) => a + o.stock, 0);
  const stockPlanSinReg =
    enPlanSap && stockRegistrado === 0 && stockPlan > 0 ? stockPlan : 0;
  const acumuladoSap = entregadoSap + stockRegistrado + stockPlanSinReg;
  const cubiertoOtrasOps = otrasOps.reduce((a, o) => a + o.acum, 0);

  let pedidoSap = pedidoPlan;
  if (!pedidoSap && opsRelacionadas.length > 0) {
    pedidoSap = Math.max(...opsRelacionadas.map((o) => o.pedido || 0), 0);
  }

  const pendienteSap = pedidoSap > 0 ? Math.max(pedidoSap - acumuladoSap, 0) : 0;
  const pendienteOtrasOps = pedidoSap > 0 ? Math.max(pedidoSap - cubiertoOtrasOps, 0) : 0;
  const excedenteSap = pedidoSap > 0 ? Math.max(acumuladoSap - pedidoSap, 0) : 0;

  return {
    sap: targetSaps.join(' + '),
    enPlanSap,
    enRegistrosDesp,
    enDespacho,
    hayPlanSapCargado,
    pedidoSap,
    stockRegistrado,
    stockPlanSinReg,
    entregadoSap,
    acumuladoSap,
    cubiertoOtrasOps,
    pendienteSap,
    pendienteOtrasOps,
    excedenteSap,
    opsRelacionadas,
    otrasOps,
  };
}

export function pedidoDe(
  op: string,
  fd: string,
  registros: Registro[],
  catalogo: CatalogoOp[],
  planesOp: Record<string, PlanOp>,
  planes: Record<string, PlanDespacho>,
  sapOverride?: string
): number {
  const x = pedidoPlanOp(op, fd, planesOp);
  if (x) return x;
  const u = ultimoPedido(op, fd, registros);
  if (u) return u;

  // Compare OP's SAP code(s) against SAP codes scheduled for dispatch
  const m = catalogo.find((c) => c.op.toLowerCase() === op.trim().toLowerCase());
  const sapToUse = (sapOverride || '').trim() || sapsDeCatalogoOp(m).join(' + ');
  if (sapToUse) {
    const infoSap = compararSapConDespacho(sapToUse, fd, registros, planes, op);
    if (infoSap && infoSap.enDespacho && infoSap.pedidoSap > 0) {
      return infoSap.pendienteOtrasOps > 0 ? infoSap.pendienteOtrasOps : infoSap.pedidoSap;
    }
  }

  if (planesOp[fd] || planes[fd]) return 0;
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
  const q = op.trim().toLowerCase();
  const targetFd = (fd || '').trim();
  const ch: Registro[] = [];
  const e = estadoDe(op, fd, registros, planesOp, opExtra);
  registros.forEach((x) => {
    const xFd = (x.fdesp || x.fecha || '').trim();
    if (x.op.trim().toLowerCase() === q && xFd === targetFd && x.estado !== e) {
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

function buildOpSapFallback(registros: Registro[]): Record<string, string> {
  const map: Record<string, string> = {};
  registros.forEach((r) => {
    const sap = (r.sap || '').trim();
    if (!sap) return;
    const opKey = (r.op || '').trim().toLowerCase();
    const fd = (r.fdesp || r.fecha || '').trim();
    if (!opKey) return;
    if (!map[opKey + '|' + fd] || !esStock(r)) {
      map[opKey + '|' + fd] = sap;
    }
    if (!map[opKey] || !esStock(r)) {
      map[opKey] = sap;
    }
  });
  return map;
}

function sapDeRegistro(r: Registro, opSapFallback: Record<string, string>): string {
  const direct = (r.sap || '').trim();
  if (direct) return direct;
  const opKey = (r.op || '').trim().toLowerCase();
  const fd = (r.fdesp || r.fecha || '').trim();
  return opSapFallback[opKey + '|' + fd] || opSapFallback[opKey] || '';
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
  const opSapFallback = buildOpSapFallback(registrosContext);

  rs.forEach((r) => {
    const fd = (r.fdesp || r.fecha || '').trim();
    const opTrim = (r.op || '').trim();
    const opKey = opTrim.toLowerCase();
    const k = opKey + '|' + fd;
    if (!ops[k]) {
      ops[k] = {
        op: opTrim,
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
    const pp = pedidoPlanOp(opTrim, fd, planesOp);
    if (pp) o.pedido = pp;

    const effSap = sapDeRegistro(r, opSapFallback);
    const sapNorm = effSap.trim().toUpperCase();
    const sk = sapNorm || 'd:' + (r.descripcion || '').trim();
    const L = o.lineas[sk] || (o.lineas[sk] = { sap: effSap, desc: r.descripcion, ent: 0 });
    if (!L.desc && r.descripcion) L.desc = r.descripcion;
    L.ent += tt;

    const gk = fd + '|' + sk;
    const S =
      saps[gk] ||
      (saps[gk] = {
        fdesp: fd,
        sap: effSap,
        desc: r.descripcion,
        ent: 0,
        stock: 0,
        cli: {},
        ops: {},
        _stockOps: {},
      });
    if (!S.desc && r.descripcion) S.desc = r.descripcion;
    if (ordenS.indexOf(gk) === -1) ordenS.push(gk);
    S.ent += tt;
    if (esS) {
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
    S.ops[opTrim] = 1;
  });

  const lo: GrupoOp[] = ordenO.map((k) => {
    const o = ops[k];
    o.stock = stockDe(o.op, o.fdesp, registrosContext);
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
  opExtra?: Record<string, OpExtra>,
  planes?: Record<string, PlanDespacho>
) {
  const fds: Record<string, number> = {};
  fl.forEach((r) => {
    fds[(r.fdesp || r.fecha || '').trim()] = 1;
  });
  if (fDespFiltro) fds[fDespFiltro.trim()] = 1;

  const base = todosRegistros.filter((r) => fds[(r.fdesp || r.fecha || '').trim()]);
  const pos: Record<string, number> = {};
  todosRegistros.forEach((r, i) => {
    pos[r.id] = i;
  });

  const opSapFallback = buildOpSapFallback(todosRegistros);
  const g = agrupar(base, todosRegistros, planesOp, opExtra);
  const eo: Record<string, number> = {};
  const es: Record<string, number> = {};

  entregasReales(fl).forEach((r) => {
    const fd = (r.fdesp || r.fecha || '').trim();
    const ko = r.op.trim().toLowerCase() + '|' + fd;
    const effSap = sapDeRegistro(r, opSapFallback);
    const sk = effSap ? effSap.trim().toUpperCase() : 'd:' + (r.descripcion || '').trim();
    const ks = fd + '|' + sk;
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
    const k = o.op.trim().toLowerCase();
    const recs = base.filter(
      (r) => r.op.trim().toLowerCase() === k && (r.fdesp || r.fecha || '').trim() === o.fdesp
    );
    const m = meta(recs);
    const sp: Record<string, number> = {};
    recs.forEach((r) => {
      const effSap = sapDeRegistro(r, opSapFallback);
      sp[effSap ? effSap.trim().toUpperCase() : 'd:' + (r.descripcion || '').trim()] = 1;
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
    const kk = x.sap ? x.sap.trim().toUpperCase() : 'd:' + (x.desc || '').trim();
    const recs = base.filter((r) => {
      if ((r.fdesp || r.fecha || '').trim() !== x.fdesp) return false;
      const effSap = sapDeRegistro(r, opSapFallback);
      const rKey = effSap ? effSap.trim().toUpperCase() : 'd:' + (r.descripcion || '').trim();
      return rKey === kk;
    });
    const m = meta(recs);
    const opsK: Record<string, number> = {};
    let entSap = 0;
    recs.forEach((r) => {
      opsK[r.op.trim().toLowerCase()] = 1;
      if (!esStock(r)) {
        entSap += r.total || 0;
      }
    });
    let stockSap = 0;
    Object.keys(opsK).forEach((opKey) => {
      stockSap += stockDe(opKey, x.fdesp, todosRegistros);
    });

    // If SAP dispatch plan defines stock and no stock record exists yet in registros, include it
    let planSapStock = 0;
    if (x.sap && planes?.[x.fdesp]?.items) {
      const targetSaps = extraerSaps(x.sap);
      const vistosPlan = new Set<string>();
      planes[x.fdesp].items.forEach((it) => {
        const s = String(it.sap || '').trim().toUpperCase();
        if (targetSaps.includes(s) && !vistosPlan.has(s)) {
          vistosPlan.add(s);
          planSapStock += it.stock || 0;
        }
      });
    }
    const stockEfectivo = stockSap > 0 ? stockSap : planSapStock;
    const acum = entSap + stockEfectivo;

    let ped = 0;
    let conj = false;
    let inc = false;
    let comp = false;
    let enProd = false;
    const sapOpsList: GrupoOp[] = [];

    Object.keys(opsK).forEach((k) => {
      const o = g.ops.find((q) => q.op.trim().toLowerCase() === k && q.fdesp === x.fdesp);
      if (!o) return;
      sapOpsList.push(o);
      if (o.nsap && o.nsap > 1) conj = true;
      if (o.enProduccion) enProd = true;
      const e = estadoDe(o.op, o.fdesp, todosRegistros, planesOp, opExtra);
      if (e === 'INCOMPLETO') inc = true;
      if (e === 'COMPLETO') comp = true;
    });

    // If a SAP dispatch plan is loaded for this despacho, its target quantity takes precedence
    // so multiple OPs with the same SAP don't double-count the SAP's pedido.
    const planSapCant = x.sap && planes ? pedidoPlanSap(x.sap, x.fdesp, planes) : 0;
    if (planSapCant > 0) {
      ped = planSapCant;
      conj = false;
    } else if (!conj && sapOpsList.length > 0) {
      ped = calcularPedidoCompartido(sapOpsList, acum);
    }

    x.ord = m.ord;
    x.pos = m.pos;
    x.entF = es[x.fdesp + '|' + kk] || 0;
    x.stock = stockEfectivo;
    x.acum = acum;
    x.conj = conj;

    if (conj) {
      x.pedido = null;
      x.falt = null;
      x.exc = null;
      x.estado = inc ? 'INCOMPLETO' : enProd ? 'EN PRODUCCION' : comp ? 'COMPLETO' : '';
    } else {
      x.pedido = ped;
      x.falt = Math.max(ped - acum, 0);
      x.exc = ped > 0 ? Math.max(acum - ped, 0) : 0;
      x.estado =
        ped > 0
          ? acum >= ped
            ? 'COMPLETO'
            : enProd
            ? 'EN PRODUCCION'
            : 'INCOMPLETO'
          : enProd
          ? 'EN PRODUCCION'
          : '';
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

export function calcularPedidoCompartido(opsList: GrupoOp[], acumTotal: number): number {
  if (!opsList.length) return 0;
  if (opsList.length === 1) return opsList[0].pedido || 0;
  const sumPed = opsList.reduce((a, o) => a + (o.pedido || 0), 0);
  const maxPed = Math.max(...opsList.map((o) => o.pedido || 0), 0);
  if (
    maxPed > 0 &&
    opsList.some((o) => o.pedido === maxPed && o.pedido > o.acum) &&
    (opsList.some((o) => o.pedido !== maxPed && o.pedido <= maxPed - o.acum) ||
      opsList.every((o) => o.pedido === maxPed) ||
      acumTotal <= maxPed)
  ) {
    return maxPed;
  }
  if (maxPed > 0 && acumTotal <= maxPed && opsList.some((o) => o.pedido > o.acum)) {
    return maxPed;
  }
  return sumPed;
}

export interface OpMiembroResumen {
  op: string;
  fdesp: string;
  cliente: string;
  pedido: number;
  ent: number;
  entF: number;
  stock: number;
  acum: number;
  enProduccion: boolean;
  cantPlanta: number;
}

export interface GrupoOpConsolidado {
  key: string;
  op: string;
  fdesp: string;
  sap: string;
  cliente: string;
  desc: string;
  pedido: number;
  stock: number;
  ent: number;
  entF: number;
  acum: number;
  falt: number;
  exc: number;
  enProduccion: boolean;
  cantPlanta: number;
  estado: string;
  lineas: Record<string, { sap: string; desc: string; ent: number }>;
  opsMiembros: OpMiembroResumen[];
  esGrupoSap: boolean;
}

export function consolidarOpsPorSap(
  ops: GrupoOp[],
  planes?: Record<string, PlanDespacho>
): GrupoOpConsolidado[] {
  const grupos: Record<string, { sap: string; fdesp: string; members: GrupoOp[] }> = {};
  const orden: string[] = [];

  ops.forEach((o) => {
    const sapSet = new Set<string>();
    Object.values(o.lineas || {}).forEach((l) => {
      extraerSaps(l.sap).forEach((s) => sapSet.add(s));
    });
    const sapsUnicos = Array.from(sapSet);
    const singleSap = sapsUnicos.length === 1 ? sapsUnicos[0] : '';
    const key = singleSap
      ? `${o.fdesp}|SAP|${singleSap}`
      : `${o.fdesp}|OP|${o.op.trim().toLowerCase()}`;

    if (!grupos[key]) {
      grupos[key] = {
        sap: singleSap || sapsUnicos.join(' + '),
        fdesp: o.fdesp,
        members: [],
      };
      orden.push(key);
    }
    grupos[key].members.push(o);
  });

  return orden.map((key) => {
    const { sap, fdesp, members } = grupos[key];
    const opsMiembros: OpMiembroResumen[] = members.map((o) => ({
      op: o.op,
      fdesp: o.fdesp,
      cliente: o.cliente,
      pedido: o.pedido,
      ent: o.ent,
      entF: o.entF ?? o.ent,
      stock: o.stock,
      acum: o.acum,
      enProduccion: Boolean(o.enProduccion),
      cantPlanta: o.cantPlanta || 0,
    }));

    const clientesSet = new Set<string>();
    const descSet = new Set<string>();
    const lineas: Record<string, { sap: string; desc: string; ent: number }> = {};

    members.forEach((o) => {
      if (o.cliente) clientesSet.add(o.cliente);
      if (o.desc) descSet.add(o.desc);
      Object.keys(o.lineas || {}).forEach((lk) => {
        const L = o.lineas[lk];
        if (!lineas[lk]) {
          lineas[lk] = { sap: L.sap, desc: L.desc, ent: 0 };
        }
        if (!lineas[lk].desc && L.desc) lineas[lk].desc = L.desc;
        lineas[lk].ent += L.ent || 0;
      });
    });

    const ent = opsMiembros.reduce((a, m) => a + m.ent, 0);
    const entF = opsMiembros.reduce((a, m) => a + m.entF, 0);
    const stockReg = opsMiembros.reduce((a, m) => a + m.stock, 0);

    let planSapStock = 0;
    if (sap && stockReg === 0 && planes?.[fdesp]?.items) {
      const targetSaps = extraerSaps(sap);
      const vistosPlan = new Set<string>();
      planes[fdesp].items.forEach((it) => {
        const s = String(it.sap || '').trim().toUpperCase();
        if (targetSaps.includes(s) && !vistosPlan.has(s)) {
          vistosPlan.add(s);
          planSapStock += it.stock || 0;
        }
      });
    }

    const stock = stockReg > 0 ? stockReg : planSapStock;
    const acum = opsMiembros.reduce((a, m) => a + m.acum, 0) + (stockReg === 0 ? planSapStock : 0);

    let pedido = 0;
    const planSapCant = sap && planes ? pedidoPlanSap(sap, fdesp, planes) : 0;
    if (planSapCant > 0) {
      pedido = planSapCant;
    } else {
      pedido = calcularPedidoCompartido(members, acum);
    }

    const enProduccion = opsMiembros.some((m) => m.enProduccion);
    const cantPlanta = opsMiembros.reduce((a, m) => a + m.cantPlanta, 0);
    const falt = pedido > 0 ? Math.max(pedido - acum, 0) : 0;
    const exc = pedido > 0 ? Math.max(acum - pedido, 0) : 0;
    const estado = enProduccion
      ? 'EN PRODUCCION'
      : pedido > 0
      ? acum >= pedido
        ? 'COMPLETO'
        : 'INCOMPLETO'
      : '';

    return {
      key,
      op: opsMiembros.map((m) => m.op).join(' / '),
      fdesp,
      sap,
      cliente: Array.from(clientesSet).join(', '),
      desc: Array.from(descSet).join(' + '),
      pedido,
      stock,
      ent,
      entF,
      acum,
      falt,
      exc,
      enProduccion,
      cantPlanta,
      estado,
      lineas,
      opsMiembros,
      esGrupoSap: opsMiembros.length > 1,
    };
  });
}

export interface ResumenSapDespachoItem {
  sap: string;
  desc: string;
  cliente: string;
  enPlanSap: boolean;
  pedidoSap: number;
  stockRegistrado: number;
  stockPlanSinReg: number;
  entregado: number;
  acumulado: number;
  pendiente: number;
  excedente: number;
  ops: { op: string; ent: number; stock: number; acum: number; enProduccion?: boolean; cantPlanta?: number }[];
  catalogoOps: string[];
  estado: 'COMPLETO' | 'EN PRODUCCION' | 'INCOMPLETO' | '';
}

export function resumenSapsDespacho(
  fd: string,
  registros: Registro[],
  planes: Record<string, PlanDespacho>,
  opExtra?: Record<string, OpExtra>,
  catalogo?: CatalogoOp[]
): ResumenSapDespachoItem[] {
  if (!fd) return [];
  const targetFd = fd.trim();
  const planActual = planes[targetFd];
  const sapsOrder: string[] = [];
  const sapsSeen = new Set<string>();

  const addSapKey = (rawSap: string) => {
    const s = rawSap.trim().toUpperCase();
    if (!s || sapsSeen.has(s)) return;
    sapsSeen.add(s);
    sapsOrder.push(s);
  };

  if (planActual?.items) {
    planActual.items.forEach((it) => addSapKey(it.sap));
  }

  registros.forEach((r) => {
    if ((r.fdesp || r.fecha || '').trim() !== targetFd) return;
    extraerSaps(r.sap).forEach((s) => addSapKey(s));
  });

  return sapsOrder.map((sap) => {
    const info = compararSapConDespacho(sap, targetFd, registros, planes);

    let desc = '';
    const clientesSet = new Set<string>();
    registros.forEach((r) => {
      if ((r.fdesp || r.fecha || '').trim() !== targetFd) return;
      if (extraerSaps(r.sap).includes(sap)) {
        if (!desc && r.descripcion) desc = r.descripcion;
        if (r.cliente) clientesSet.add(r.cliente);
      }
    });

    const catOps: string[] = [];
    if (catalogo) {
      catalogo.forEach((c) => {
        const hasSap = sapsDeCatalogoOp(c).includes(sap);
        if (hasSap) {
          catOps.push(c.op);
          if (!desc) {
            const mo = (c.modelos || []).find((m) => extraerSaps(m.sap).includes(sap));
            desc = mo?.descripcion || c.descripcion || '';
          }
          if (c.cliente && !clientesSet.size) clientesSet.add(c.cliente);
        }
      });
    }

    const opsDetailed = (info?.opsRelacionadas || []).map((o) => {
      const k = o.op.trim().toLowerCase() + '|' + targetFd;
      const ex = opExtra?.[k] || opExtra?.[o.op.trim().toLowerCase()];
      return {
        ...o,
        enProduccion: Boolean(ex?.enProduccion),
        cantPlanta: typeof ex?.cantPlanta === 'number' ? ex.cantPlanta : 0,
      };
    });

    const pedidoSap = info?.pedidoSap || 0;
    const acumuladoSap = info?.acumuladoSap || 0;
    const hayEnProd = opsDetailed.some((o) => o.enProduccion);

    let estado: 'COMPLETO' | 'EN PRODUCCION' | 'INCOMPLETO' | '' = '';
    if (pedidoSap > 0) {
      if (acumuladoSap >= pedidoSap) estado = 'COMPLETO';
      else if (hayEnProd) estado = 'EN PRODUCCION';
      else estado = 'INCOMPLETO';
    } else if (hayEnProd) {
      estado = 'EN PRODUCCION';
    }

    return {
      sap,
      desc,
      cliente: Array.from(clientesSet).join(', '),
      enPlanSap: Boolean(info?.enPlanSap),
      pedidoSap,
      stockRegistrado: info?.stockRegistrado || 0,
      stockPlanSinReg: info?.stockPlanSinReg || 0,
      entregado: info?.entregadoSap || 0,
      acumulado: acumuladoSap,
      pendiente: info?.pendienteSap || 0,
      excedente: info?.excedenteSap || 0,
      ops: opsDetailed,
      catalogoOps: catOps,
      estado,
    };
  });
}
