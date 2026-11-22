import { CatalogoOp } from '../types';
import { extraerSaps } from './helpers';

export interface QrOpPayload {
  op: string;
  sap?: string;
  desc?: string;
  cli?: string;
  ped?: number;
  u?: number;
  c?: number;
  emp?: 'caja' | 'paquete';
}

export interface QrParsedResult {
  raw: string;
  op: string;
  sap: string;
  desc: string;
  cli: string;
  ped: number;
  u: number;
  c: number;
  emp: 'caja' | 'paquete' | '';
  catMatch: CatalogoOp | null;
  modeloIdx: number; // -1 = single/default, >=0 = specific model index
  sapMatchesCatOps: CatalogoOp[];
}

export type LabelSizeId = '100x50' | '100x100' | '70x40' | '50x30';

export const LABEL_SIZES: Record<
  LabelSizeId,
  { id: LabelSizeId; label: string; widthMm: number; heightMm: number; qrDots: number }
> = {
  '100x50': { id: '100x50', label: '100 × 50 mm (Estándar almacén)', widthMm: 100, heightMm: 50, qrDots: 5 },
  '100x100': { id: '100x100', label: '100 × 100 mm (Pallet / Caja grande)', widthMm: 100, heightMm: 100, qrDots: 7 },
  '70x40': { id: '70x40', label: '70 × 40 mm (Mediana)', widthMm: 70, heightMm: 40, qrDots: 4 },
  '50x30': { id: '50x30', label: '50 × 30 mm (Compacta)', widthMm: 50, heightMm: 30, qrDots: 3 },
};

function cleanToken(s: string): string {
  return String(s || '')
    .replace(/[\r\n|]+/g, ' ')
    .trim();
}

export function buildQrString(payload: QrOpPayload, includeDescCli = false): string {
  const parts: string[] = [];
  if (payload.op) parts.push(`OP:${cleanToken(payload.op)}`);
  if (payload.sap) parts.push(`SAP:${cleanToken(payload.sap)}`);
  if (payload.ped && payload.ped > 0) parts.push(`PED:${Math.round(payload.ped)}`);
  if (payload.u && payload.u > 0) parts.push(`U:${Math.round(payload.u)}`);
  if (payload.c && payload.c > 0) parts.push(`C:${Math.round(payload.c)}`);
  if (payload.emp) parts.push(`EMP:${payload.emp}`);
  if (includeDescCli) {
    if (payload.cli) parts.push(`CLI:${cleanToken(payload.cli).slice(0, 40)}`);
    if (payload.desc) parts.push(`DESC:${cleanToken(payload.desc).slice(0, 60)}`);
  }
  return parts.join('|');
}

function normalizeKeyName(k: string): string {
  return k
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

export function parseQrString(rawInput: string, catalogo: CatalogoOp[]): QrParsedResult {
  const raw = String(rawInput || '').trim();
  let op = '';
  let sap = '';
  let desc = '';
  let cli = '';
  let ped = 0;
  let u = 0;
  let c = 0;
  let emp: 'caja' | 'paquete' | '' = '';

  const applyPair = (rawKey: string, rawVal: string) => {
    const k = normalizeKeyName(rawKey);
    const v = String(rawVal || '').trim();
    if (!v) return;
    if (k === 'op' || k === 'orden' || k === 'ordenproduccion') op = v;
    else if (k === 'sap' || k === 'codsap' || k === 'codigosap') sap = v;
    else if (k === 'ped' || k === 'pedido' || k === 'cant' || k === 'cantidad' || k === 'cantidadtotal') {
      const n = parseInt(v.replace(/,/g, ''), 10);
      if (!isNaN(n) && n > 0) ped = n;
    } else if (k === 'u' || k === 'uxc' || k === 'unid' || k === 'unidades' || k === 'unidxemp') {
      const n = parseInt(v.replace(/,/g, ''), 10);
      if (!isNaN(n) && n > 0) u = n;
    } else if (k === 'c' || k === 'cajas' || k === 'paquetes' || k === 'bultos') {
      const n = parseInt(v.replace(/,/g, ''), 10);
      if (!isNaN(n) && n > 0) c = n;
    } else if (k === 'emp' || k === 'empaque') {
      const lv = v.toLowerCase();
      if (lv.startsWith('paq') || lv === 'p') emp = 'paquete';
      else if (lv.startsWith('caj') || lv === 'c') emp = 'caja';
    } else if (k === 'cli' || k === 'cliente') {
      cli = v;
    } else if (k === 'desc' || k === 'descripcion' || k === 'modelo' || k === 'producto') {
      desc = v;
    }
  };

  if (raw.startsWith('{') && raw.endsWith('}')) {
    try {
      const obj = JSON.parse(raw);
      if (obj && typeof obj === 'object') {
        Object.keys(obj).forEach((k) => {
          applyPair(k, String(obj[k] ?? ''));
        });
      }
    } catch {
      // Fallback to line/delimiter parsing below
    }
  }

  if (!op && !sap) {
    // Check delimited key:value / key=value pairs separated by | ; or newlines
    const segments = raw.split(/[|\r\n;]+/).map((s) => s.trim()).filter(Boolean);
    const hasKeyVal = segments.some((seg) => /^[^:=]+[:=].+$/.test(seg));
    if (hasKeyVal) {
      segments.forEach((seg) => {
        const idx = seg.search(/[:=]/);
        if (idx > 0) {
          applyPair(seg.slice(0, idx), seg.slice(idx + 1));
        }
      });
    } else if (segments.length === 1) {
      const single = segments[0];
      // Match against catalog OP first
      const exactOp = catalogo.find((x) => x.op.trim().toLowerCase() === single.toLowerCase());
      if (exactOp) {
        op = exactOp.op;
      } else {
        // Match against catalog SAP
        const qUpper = single.toUpperCase();
        const catBySap = catalogo.find(
          (x) =>
            String(x.sap || '').trim().toUpperCase() === qUpper ||
            (x.modelos || []).some((m) => String(m.sap || '').trim().toUpperCase() === qUpper)
        );
        if (catBySap) {
          op = catBySap.op;
          sap = single;
        } else {
          // Treat plain single token as OP
          op = single;
        }
      }
    } else if (segments.length >= 2) {
      // Positional fallback: OP|SAP|PED|U
      op = segments[0] || '';
      if (segments[1]) sap = segments[1];
      if (segments[2]) {
        const p = parseInt(segments[2], 10);
        if (!isNaN(p) && p > 0) ped = p;
      }
      if (segments[3]) {
        const un = parseInt(segments[3], 10);
        if (!isNaN(un) && un > 0) u = un;
      }
    }
  }

  // Resolve against catalog
  const catMatch = op
    ? catalogo.find((x) => x.op.trim().toLowerCase() === op.trim().toLowerCase()) || null
    : null;

  let modeloIdx = -1;
  if (catMatch) {
    op = catMatch.op;
    if (!cli && catMatch.cliente) cli = catMatch.cliente;
    const ms = catMatch.modelos || [];
    if (ms.length === 1) {
      modeloIdx = 0;
      if (!sap) sap = ms[0].sap || catMatch.sap || '';
      if (!desc) desc = ms[0].descripcion || catMatch.descripcion || '';
      if (!ped && catMatch.cantidadTotal > 0) ped = catMatch.cantidadTotal;
    } else if (ms.length > 1) {
      if (sap) {
        const targetSaps = extraerSaps(sap);
        const foundIdx = ms.findIndex((m) =>
          targetSaps.includes(String(m.sap || '').trim().toUpperCase())
        );
        if (foundIdx >= 0) {
          modeloIdx = foundIdx;
          const m = ms[foundIdx];
          sap = m.sap || sap;
          if (!desc) desc = m.descripcion || '';
          const mPed = parseInt(String(m.cantidadTotal || ''), 10);
          if (!ped && !isNaN(mPed) && mPed > 0) ped = mPed;
        }
      }
      if (!ped && catMatch.cantidadTotal > 0) ped = catMatch.cantidadTotal;
    } else {
      if (!sap) sap = catMatch.sap || '';
      if (!desc) desc = catMatch.descripcion || '';
      if (!ped && catMatch.cantidadTotal > 0) ped = catMatch.cantidadTotal;
    }
  }

  const sapMatchesCatOps = sap
    ? catalogo.filter((x) => {
        const q = sap.trim().toUpperCase();
        return (
          String(x.sap || '').trim().toUpperCase() === q ||
          (x.modelos || []).some((m) => String(m.sap || '').trim().toUpperCase() === q)
        );
      })
    : [];

  return {
    raw,
    op,
    sap,
    desc,
    cli,
    ped,
    u,
    c,
    emp,
    catMatch,
    modeloIdx,
    sapMatchesCatOps,
  };
}

function zplSafe(s: string): string {
  return String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\^~]/g, ' ')
    .trim();
}

export function buildZplLabel(
  item: QrOpPayload,
  qrData: string,
  sizeId: LabelSizeId,
  copies = 1
): string {
  const sz = LABEL_SIZES[sizeId] || LABEL_SIZES['100x50'];
  const pw = Math.round(sz.widthMm * 8); // 203 dpi ~ 8 dots/mm
  const ll = Math.round(sz.heightMm * 8);
  const margin = 24;
  const textX = sizeId === '50x30' ? 175 : sizeId === '70x40' ? 235 : 290;
  const textWidth = Math.max(180, pw - textX - margin);

  const lines: string[] = [
    '^XA',
    '^CI28',
    `^PW${pw}`,
    `^LL${ll}`,
    `^FO${margin},${margin}^BQN,2,${sz.qrDots}^FDQA,${zplSafe(qrData)}^FS`,
    `^FO${textX},${margin}^A0N,${sizeId === '50x30' ? 28 : 40},${sizeId === '50x30' ? 28 : 40}^FDOP: ${zplSafe(item.op)}^FS`,
  ];

  let y = margin + (sizeId === '50x30' ? 34 : 48);
  if (item.sap) {
    lines.push(
      `^FO${textX},${y}^A0N,${sizeId === '50x30' ? 22 : 30},${sizeId === '50x30' ? 22 : 30}^FDSAP: ${zplSafe(item.sap)}^FS`
    );
    y += sizeId === '50x30' ? 28 : 36;
  }
  if (item.cli) {
    lines.push(
      `^FO${textX},${y}^A0N,22,22^FB${textWidth},2,2,L,0^FD${zplSafe(item.cli)}^FS`
    );
    y += 46;
  }
  if (item.desc) {
    lines.push(
      `^FO${textX},${y}^A0N,22,22^FB${textWidth},3,2,L,0^FD${zplSafe(item.desc)}^FS`
    );
    y += 70;
  }
  if (item.u && item.u > 0) {
    lines.push(
      `^FO${textX},${Math.min(ll - 34, y)}^A0N,24,24^FD${item.u} u/${item.emp || 'caja'}^FS`
    );
  }
  if (copies > 1) {
    lines.push(`^PQ${Math.min(999, Math.max(1, copies))}`);
  }
  lines.push('^XZ');
  return lines.join('\n');
}
