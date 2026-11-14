import * as XLSX from 'xlsx';
import { CatalogoOp, Ingreso, PlanDespacho, PlanOp, Registro } from '../types';
import {
  agruparReporte,
  compararSapConDespacho,
  entregasReales,
  estadoDe,
  estadoReg,
  fcorta,
  norm,
} from '../utils/helpers';

function xe(v: any): string {
  return String(v == null ? '' : v)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

const BD =
  '<Borders>' +
  ['Top', 'Bottom', 'Left', 'Right']
    .map(
      (q) =>
        '<Border ss:Position="' +
        q +
        '" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#B7B7B7"/>'
    )
    .join('') +
  '</Borders>';

function est(id: string, font: string, fill: string, al: string): string {
  return (
    '<Style ss:ID="' +
    id +
    '">' +
    font +
    (fill ? '<Interior ss:Color="' + fill + '" ss:Pattern="Solid"/>' : '') +
    '<Alignment ss:Horizontal="' +
    al +
    '" ss:Vertical="Center" ss:WrapText="1"/>' +
    BD +
    '</Style>'
  );
}

const BLANCO = '<Font ss:Bold="1" ss:Color="#FFFFFF"/>';

const ESTILOS =
  '<Styles><Style ss:ID="sT"><Font ss:Bold="1" ss:Size="14" ss:Color="#FFFFFF"/><Interior ss:Color="#12161F" ss:Pattern="Solid"/><Alignment ss:Horizontal="Center" ss:Vertical="Center"/></Style>' +
  est('sH', '<Font ss:Bold="1" ss:Color="#12161F"/>', '#F2A93B', 'Center') +
  est('sC', '', '', 'Left') +
  est('sN', '', '', 'Right') +
  est('sX', '<Font ss:Bold="1" ss:Color="#C0392B"/>', '#FADBD8', 'Right') +
  est('sK', '', '', 'Center') +
  est('sE', '<Font ss:Bold="1"/>', '#E6F4EA', 'Right') +
  est('sP', '<Font ss:Bold="1"/>', '#FDEBD0', 'Right') +
  est('sOk', BLANCO, '#38A169', 'Center') +
  est('sPr', BLANCO, '#4299E1', 'Center') +
  est('sIn', BLANCO, '#E53E3E', 'Center') +
  '</Styles>';

const EST_STYLE: Record<string, string> = {
  COMPLETO: 'sOk',
  'EN PRODUCCION': 'sPr',
  INCOMPLETO: 'sIn',
};

function ce(v: any, st: string, num?: boolean, merge?: number): string {
  return (
    '<Cell ss:StyleID="' +
    st +
    '"' +
    (merge ? ' ss:MergeAcross="' + merge + '"' : '') +
    '><Data ss:Type="' +
    (num ? 'Number' : 'String') +
    '">' +
    (num ? v || 0 : xe(v)) +
    '</Data></Cell>'
  );
}

function detalle(r: { empaque: string; c: number; u: number }): string {
  const n =
    r.empaque === 'caja'
      ? r.c === 1
        ? 'caja'
        : 'cajas'
      : r.c === 1
      ? 'paquete'
      : 'paquetes';
  return `${r.c} ${n} × ${r.u}`;
}

function hojaXml(nombre: string, anchos: number[], rows: string[]): string {
  return (
    '<Worksheet ss:Name="' +
    nombre +
    '"><Table ss:DefaultColumnWidth="70">' +
    anchos.map((w) => '<Column ss:Width="' + w + '"/>').join('') +
    rows.join('') +
    '</Table><WorksheetOptions xmlns="urn:schemas-microsoft-com:office:excel"><PageSetup><Layout x:Orientation="Landscape"/></PageSetup></WorksheetOptions></Worksheet>'
  );
}

function filaH(heads: string[]): string {
  return '<Row ss:Height="22">' + heads.map((h) => ce(h, 'sH')).join('') + '</Row>';
}

function filaT(t: string, n: number): string {
  return '<Row ss:Height="28">' + ce(t, 'sT', false, n) + '</Row>';
}

export function xmlEntregas(
  fl: Registro[],
  registrosContext: Registro[],
  fDespFiltro: string,
  planesOp: Record<string, PlanOp>,
  opExtra?: Record<string, import('../types').OpExtra>,
  planes?: Record<string, PlanDespacho>
): string {
  const g = agruparReporte(fl, registrosContext, fDespFiltro, planesOp, opExtra, planes);
  const ents = entregasReales(fl);

  const r1 = [
    filaT('ENTREGAS REGISTRADAS POR EL HABILITADOR', 11),
    filaH([
      'FECHA DESPACHO',
      'FECHA REGISTRO',
      'TURNO',
      'HABILITADOR',
      'OP',
      'SAP',
      'DESCRIPCIÓN',
      'CLIENTE',
      'PEDIDO (OP)',
      'ENTREGADO',
      'DETALLE',
      'ESTADO',
    ]),
  ];

  if (!ents.length) {
    r1.push('<Row>' + ce('Sin entregas registradas', 'sK', false, 11) + '</Row>');
  }
  ents.forEach((r) => {
    let st = estadoReg(r, registrosContext, planesOp, opExtra);
    if (st === 'INCOMPLETO' && r.sap) {
      const sc = compararSapConDespacho(
        r.sap,
        r.fdesp || r.fecha,
        registrosContext,
        planes || {},
        r.op
      );
      if (sc && sc.otrasOps.length > 0 && sc.pedidoSap > 0 && sc.acumuladoSap >= sc.pedidoSap) {
        st = 'COMPLETO';
      }
    }
    r1.push(
      '<Row>' +
        ce(fcorta(r.fdesp || r.fecha), 'sK') +
        ce(fcorta(r.fecha), 'sK') +
        ce(r.turno, 'sK') +
        ce(r.nombre, 'sC') +
        ce(r.op, 'sK') +
        ce(r.sap || '', 'sK') +
        ce(r.descripcion, 'sC') +
        ce(r.cliente, 'sC') +
        ce(r.pedido || 0, 'sP', true) +
        ce(r.total || 0, 'sE', true) +
        ce(detalle(r), 'sK') +
        ce(st, EST_STYLE[st] || 'sK') +
        '</Row>'
    );
  });

  const r2 = [
    filaT('RESUMEN POR OP (lista completa, en el orden de la carga)', 13),
    filaH([
      'DESPACHO',
      'OP',
      'CLIENTE',
      'DESCRIPCIÓN',
      'PEDIDO',
      'STOCK INICIAL',
      'ENTREGADO (filtro)',
      'ACUMULADO (stock + entregado)',
      'FALTANTE',
      'EXCEDENTE',
      'EN PLANTA (sin registrar)',
      '¿EN PRODUCCIÓN?',
      'ESTADO',
    ]),
  ];

  g.ops.forEach((o) => {
    const pd = o.pedido - o.acum;
    const ex = o.pedido > 0 ? Math.max(-pd, 0) : 0;
    let es = estadoDe(o.op, o.fdesp, registrosContext, planesOp, opExtra);
    const cantPl = o.cantPlanta || 0;
    const enPr = Boolean(o.enProduccion);
    const sapsDeOp = Object.keys(o.lineas)
      .map((k) => o.lineas[k].sap)
      .filter(Boolean)
      .join(' + ');
    const sapCheck = sapsDeOp
      ? compararSapConDespacho(sapsDeOp, o.fdesp, registrosContext, planes || {}, o.op)
      : null;
    const sapCubierto = Boolean(
      sapCheck &&
        sapCheck.otrasOps.length > 0 &&
        sapCheck.pedidoSap > 0 &&
        sapCheck.acumuladoSap >= sapCheck.pedidoSap
    );
    const faltVal = sapCubierto ? 0 : Math.max(pd, 0);
    let esLabel = es;
    if (sapCubierto && pd > 0 && !enPr) {
      es = 'COMPLETO';
      esLabel = 'COMPLETO (SAP)';
    }
    r2.push(
      '<Row>' +
        ce(fcorta(o.fdesp), 'sK') +
        ce(o.op, 'sK') +
        ce(o.cliente, 'sC') +
        ce(o.desc, 'sC') +
        ce(o.pedido, 'sP', true) +
        ce(o.stock || 0, 'sN', true) +
        ce(o.entF, 'sE', true) +
        ce(o.acum, 'sN', true) +
        ce(faltVal, faltVal > 0 ? 'sP' : 'sE', true) +
        ce(ex, ex > 0 ? 'sX' : 'sN', true) +
        ce(cantPl, cantPl > 0 ? 'sPr' : 'sN', true) +
        ce(enPr ? 'SÍ' : 'NO', enPr ? 'sPr' : 'sK') +
        ce(esLabel, EST_STYLE[es] || 'sK') +
        '</Row>'
    );
  });

  const r3 = [
    filaT('RESUMEN POR SAP (lista completa, en el orden de la carga)', 11),
    filaH([
      'DESPACHO',
      'SAP',
      'DESCRIPCIÓN',
      'CLIENTE',
      'PEDIDO',
      'STOCK INICIAL',
      'ENTREGADO (filtro)',
      'ACUMULADO (stock + entregado)',
      'FALTANTE',
      'EXCEDENTE',
      'ESTADO',
      'OP',
    ]),
  ];

  g.saps.forEach((x) => {
    r3.push(
      '<Row>' +
        ce(fcorta(x.fdesp), 'sK') +
        ce(x.sap || '', 'sK') +
        ce(x.desc, 'sC') +
        ce(x.cliente, 'sC') +
        (x.conj ? ce('CONJUNTO OP', 'sK') : ce(x.pedido, 'sP', true)) +
        ce(x.stock || 0, 'sN', true) +
        ce(x.entF, 'sE', true) +
        ce(x.acum, 'sN', true) +
        (x.conj ? ce('—', 'sK') : ce(x.falt, (x.falt ?? 0) > 0 ? 'sP' : 'sE', true)) +
        (x.conj ? ce('—', 'sK') : ce(x.exc, (x.exc ?? 0) > 0 ? 'sX' : 'sN', true)) +
        ce(x.estado || '', EST_STYLE[x.estado || ''] || 'sK') +
        ce(Object.keys(x.ops).join(', '), 'sC') +
        '</Row>'
    );
  });

  return (
    '<?xml version="1.0"?><?mso-application progid="Excel.Sheet"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet" xmlns:html="http://www.w3.org/TR/REC-html40">' +
    ESTILOS +
    hojaXml('Entregas', [85, 85, 60, 115, 85, 85, 280, 160, 95, 85, 130, 105], r1) +
    hojaXml('Resumen OP', [85, 90, 180, 260, 90, 95, 120, 150, 100, 100, 110, 100, 110], r2) +
    hojaXml('Resumen SAP', [85, 90, 300, 170, 90, 95, 120, 150, 100, 100, 100, 200], r3) +
    '</Workbook>'
  );
}

export function xmlIngresos(rs: Ingreso[]): string {
  const r1 = [
    filaT('INGRESOS AL ALMACÉN', 8),
    filaH([
      'FECHA',
      'TURNO',
      'HABILITADOR',
      'OP',
      'SAP',
      'DESCRIPCIÓN',
      'CLIENTE',
      'ENTREGADO',
      'DETALLE',
    ]),
  ];

  rs.forEach((r) => {
    r1.push(
      '<Row>' +
        ce(fcorta(r.fecha), 'sK') +
        ce(r.turno, 'sK') +
        ce(r.nombre, 'sC') +
        ce(r.op, 'sK') +
        ce(r.sap || '', 'sK') +
        ce(r.descripcion, 'sC') +
        ce(r.cliente, 'sC') +
        ce(r.total || 0, 'sE', true) +
        ce(detalle(r), 'sK') +
        '</Row>'
    );
  });

  return (
    '<?xml version="1.0"?><?mso-application progid="Excel.Sheet"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet" xmlns:html="http://www.w3.org/TR/REC-html40">' +
    ESTILOS +
    hojaXml('Ingresos', [85, 60, 115, 85, 85, 280, 160, 95, 130], r1) +
    '</Workbook>'
  );
}

export function descargarXml(
  xml: string,
  nombre: string,
  onToast: (t: 'ok' | 'error', m: string) => void
): void {
  const mime = 'application/vnd.ms-excel';
  try {
    const blob = new Blob(['\ufeff', xml], { type: mime });
    let done = false;
    const nav = navigator as any;
    if (nav.canShare && window.File) {
      try {
        const f = new File([blob], nombre, { type: mime });
        if (nav.canShare({ files: [f] })) {
          nav
            .share({ files: [f], title: nombre })
            .then(() => onToast('ok', 'Excel exportado'))
            .catch((e: any) => {
              if (e && e.name !== 'AbortError') triggerDownload(blob, nombre, onToast);
            });
          done = true;
        }
      } catch {}
    }
    if (!done) {
      triggerDownload(blob, nombre, onToast);
    }
  } catch {
    onToast('error', 'No se pudo exportar');
  }
}

function triggerDownload(
  blob: Blob,
  nombre: string,
  onToast: (t: 'ok' | 'error', m: string) => void
) {
  const u = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = u;
  a.download = nombre;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(u), 4000);
  onToast('ok', 'Excel exportado');
}

export function archivoOk(f: File, onToast: (t: 'ok' | 'error', m: string) => void): boolean {
  if (!/\.(xlsx|xls|csv)$/i.test(f.name)) {
    onToast('error', 'El archivo debe ser .xlsx, .xls o .csv');
    return false;
  }
  if (f.size === 0) {
    onToast('error', 'El archivo está vacío');
    return false;
  }
  if (f.size > 15e6) {
    onToast('error', 'El archivo pesa más de 15 MB; revisa que sea el correcto');
    return false;
  }
  return true;
}

export function colStock(r: string[], usados: number[], permitirBlanco: boolean): number {
  const i = r.findIndex((h) => h.indexOf('stock') >= 0 || h === 'inicial');
  if (i >= 0) return i;
  if (permitirBlanco && r.length > 2 && usados.indexOf(2) < 0 && String(r[2]).trim() === '') {
    return 2;
  }
  return -1;
}

export function hayTercera(a: any[][]): number {
  return a.some((r) => r.length > 2 && String(r[2]).trim() !== '') ? 2 : -1;
}

export function valStock(row: any[], c: number): number {
  if (c < 0) return 0;
  const t = String(row[c] == null ? '' : row[c])
    .replace(/,/g, '')
    .trim();
  return t !== '' && isFinite(Number(t)) ? parseFloat(t) : 0;
}

export function opsDeSap(sap: string, catalogo: CatalogoOp[]) {
  const q = String(sap).trim().toUpperCase();
  const r: { m: CatalogoOp; i: number }[] = [];
  catalogo.forEach((c) => {
    const modelos =
      c.modelos && c.modelos.length
        ? c.modelos
        : c.sap
        ? [{ descripcion: c.descripcion || '', sap: c.sap }]
        : [];
    modelos.forEach((mo, i) => {
      if (String(mo.sap || '').trim().toUpperCase() === q) {
        r.push({ m: c, i });
      }
    });
  });
  return r;
}

export function buscarSap(sap: string, catalogo: CatalogoOp[], registros: Registro[]): string {
  const q = String(sap).trim().toUpperCase();
  for (let i = 0; i < catalogo.length; i++) {
    const ms = catalogo[i].modelos || [];
    for (let j = 0; j < ms.length; j++) {
      if (String(ms[j].sap || '').trim().toUpperCase() === q) {
        return ms[j].descripcion || (ms[j] as any).desc || '';
      }
    }
  }
  for (let r = registros.length - 1; r >= 0; r--) {
    if (String(registros[r].sap || '').trim().toUpperCase() === q) {
      return registros[r].descripcion || '';
    }
  }
  return '';
}
