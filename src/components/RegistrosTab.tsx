import React, { useState } from 'react';
import { OpExtra, PlanDespacho, PlanOp, Registro } from '../types';
import {
  agrupar,
  agruparReporte,
  compararSapConDespacho,
  entregasReales,
  esStock,
  estadoDe,
  estadoReg,
  fcorta,
  hoy,
  recalcularEstados,
  sanitizarStockDuplicados,
} from '../utils/helpers';
import { descargarXml, xmlEntregas } from '../services/excel';
import { encolarDel } from '../services/sheets';
import { EditarStockModal } from './EditarStockModal';
import { EditarPlantaModal } from './EditarPlantaModal';
import { EntregasOpModal } from './EntregasOpModal';

interface RegistrosTabProps {
  registros: Registro[];
  onRegistrosChange: (newRegs: Registro[], toSend?: Registro[]) => void;
  nombres: string[];
  planes?: Record<string, PlanDespacho>;
  planesOp: Record<string, PlanOp>;
  opExtra?: Record<string, OpExtra>;
  onUpdateOpExtra?: (op: string, fdesp: string, changes: Partial<OpExtra>) => void;
  onEnviarSheets: () => void;
  onTraerSheets: () => void;
  onBorrarRemoto: (id: string) => void;
  onToast: (t: 'ok' | 'error', m: string) => void;
}

export const RegistrosTab: React.FC<RegistrosTabProps> = ({
  registros,
  onRegistrosChange,
  nombres,
  planes = {},
  planesOp,
  opExtra = {},
  onUpdateOpExtra,
  onEnviarSheets,
  onTraerSheets,
  onBorrarRemoto,
  onToast,
}) => {
  const [fFecha, setFFecha] = useState('');
  const [fDesp, setFDesp] = useState('');
  const [fTurno, setFTurno] = useState('');
  const [fNombre, setFNombre] = useState('');
  const [fEstado, setFEstado] = useState('');
  const [fTexto, setFTexto] = useState('');
  const [vista, setVista] = useState<'lista' | 'resumen'>('lista');

  // Filter records
  const filtrados = registros
    .filter((r) => {
      if (fFecha && r.fecha !== fFecha) return false;
      if (fDesp && (r.fdesp || r.fecha) !== fDesp) return false;
      if (fTurno && r.turno !== fTurno) return false;
      if (fNombre && r.nombre !== fNombre) return false;
      if (fEstado && estadoReg(r, registros, planesOp, opExtra) !== fEstado) return false;
      if (
        fTexto &&
        `${r.op} ${r.sap || ''} ${r.cliente} ${r.nombre} ${r.descripcion}`
          .toLowerCase()
          .indexOf(fTexto.trim().toLowerCase()) === -1
      ) {
        return false;
      }
      return true;
    })
    .sort((a, b) => {
      if (a.fecha < b.fecha) return 1;
      if (a.fecha > b.fecha) return -1;
      if (a.turno === b.turno) return a.nombre.localeCompare(b.nombre, 'es');
      return a.turno === 'Día' ? -1 : 1;
    });

  const [showPrintModal, setShowPrintModal] = useState(false);
  const [printOpts, setPrintOpts] = useState<{
    entregas: boolean;
    resumenOp: boolean;
    resumenSap: boolean;
  }>(() => {
    try {
      const saved = localStorage.getItem('ctrl_print_opts');
      return saved ? JSON.parse(saved) : { entregas: true, resumenOp: true, resumenSap: true };
    } catch {
      return { entregas: true, resumenOp: true, resumenSap: true };
    }
  });

  const [stockEditModal, setStockEditModal] = useState<{
    op: string;
    fdesp: string;
    currentStock: number;
    pedido?: number;
  } | null>(null);

  const [plantaEditModal, setPlantaEditModal] = useState<{
    op: string;
    fdesp: string;
    currentPlanta: number;
    currentEnProduccion: boolean;
    pedido?: number;
    entregado?: number;
    stock?: number;
  } | null>(null);

  const [entregasModalOp, setEntregasModalOp] = useState<{
    op: string;
    fdesp: string;
    cliente: string;
    pedido: number;
    stock: number;
  } | null>(null);

  const handleToggleEnProduccion = (op: string, fdesp: string, checked: boolean) => {
    if (onUpdateOpExtra) {
      onUpdateOpExtra(op, fdesp, { enProduccion: checked });
    }
    const updatedExtra = {
      ...opExtra,
      [`${op.trim().toLowerCase()}|${fdesp}`]: {
        ...(opExtra[`${op.trim().toLowerCase()}|${fdesp}`] || {}),
        enProduccion: checked,
      },
    };
    const camb = recalcularEstados(op, fdesp, registros, planesOp, updatedExtra);
    if (camb.length > 0) {
      onRegistrosChange(registros, camb);
    }
    onToast('ok', checked ? `OP ${op} marcada EN PRODUCCIÓN` : `OP ${op} desmarcada de producción`);
  };

  const handleSavePlantaModal = (data: { enProduccion: boolean; cantPlanta: number }) => {
    if (!plantaEditModal) return;
    const { op, fdesp } = plantaEditModal;
    if (onUpdateOpExtra) {
      onUpdateOpExtra(op, fdesp, data);
    }
    const updatedExtra = {
      ...opExtra,
      [`${op.trim().toLowerCase()}|${fdesp}`]: {
        ...(opExtra[`${op.trim().toLowerCase()}|${fdesp}`] || {}),
        ...data,
      },
    };
    const camb = recalcularEstados(op, fdesp, registros, planesOp, updatedExtra);
    if (camb.length > 0) {
      onRegistrosChange(registros, camb);
    }
    setPlantaEditModal(null);
    onToast('ok', `Datos de planta para OP ${op} actualizados`);
  };

  const handleGuardarStockEdit = (newStock: number) => {
    if (!stockEditModal) return;
    const { op, fdesp, pedido } = stockEditModal;
    const q = op.trim().toLowerCase();

    let updatedRegs = [...registros];
    const envio: Registro[] = [];

    // Find ALL stock records for this OP and fdesp
    const stockRecs = updatedRegs.filter(
      (x) => esStock(x) && x.op.trim().toLowerCase() === q && (x.fdesp || x.fecha || '') === fdesp
    );

    if (stockRecs.length > 0) {
      if (newStock > 0) {
        const prim = stockRecs[0];
        prim.u = newStock;
        prim.total = newStock;
        prim.c = 1;
        prim.sync = false;
        envio.push(prim);
      } else {
        // newStock is 0: remove all stock records for this OP in this despacho
        updatedRegs = updatedRegs.filter((x) => !stockRecs.some((s) => s.id === x.id));
        stockRecs.forEach((s) => {
          onBorrarRemoto(s.id);
          encolarDel(s.id, 'registros');
        });
      }

      // If duplicate stock records were present, delete them permanently
      if (stockRecs.length > 1) {
        const dups = stockRecs.slice(1);
        updatedRegs = updatedRegs.filter((x) => !dups.some((d) => d.id === x.id));
        dups.forEach((d) => {
          onBorrarRemoto(d.id);
          encolarDel(d.id, 'registros');
        });
      }
    } else if (newStock > 0) {
      const ref = updatedRegs.find(
        (x) => x.op.trim().toLowerCase() === q && (x.fdesp || x.fecha || '') === fdesp
      );
      const newRec: Registro = {
        id: Date.now() + '-' + Math.random().toString(36).slice(2, 6),
        fecha: ref?.fecha || hoy(),
        fdesp: fdesp,
        turno: ref?.turno || 'Día',
        nombre: ref?.nombre || 'Almacén',
        op: ref?.op || op,
        sap: ref?.sap || '',
        descripcion: ref?.descripcion || '',
        cliente: ref?.cliente || '',
        pedido: ref?.pedido || pedido || 0,
        empaque: 'stock',
        u: newStock,
        c: 1,
        total: newStock,
        estado: '',
        creado: new Date().toISOString(),
        sync: false,
      };
      updatedRegs = [newRec, ...updatedRegs];
      envio.push(newRec);
    }

    // Sanitize any remaining duplicates
    const { registrosLimpios, duplicadosEliminados } = sanitizarStockDuplicados(updatedRegs);
    duplicadosEliminados.forEach((d) => {
      onBorrarRemoto(d.id);
      encolarDel(d.id, 'registros');
    });
    updatedRegs = registrosLimpios;

    const camb = recalcularEstados(op, fdesp, updatedRegs, planesOp, opExtra);
    camb.forEach((x) => {
      if (envio.indexOf(x) < 0) envio.push(x);
    });

    onRegistrosChange(updatedRegs, envio);
    setStockEditModal(null);
    onToast('ok', `Stock inicial de ${op} establecido en ${newStock} u`);
  };

  const handleDepurarStock = () => {
    const { registrosLimpios, duplicadosEliminados } = sanitizarStockDuplicados(registros);
    if (!duplicadosEliminados.length) {
      onToast('ok', 'Todo en orden: no se detectaron duplicados de stock inicial');
      return;
    }
    duplicadosEliminados.forEach((d) => {
      onBorrarRemoto(d.id);
      encolarDel(d.id, 'registros');
    });
    onRegistrosChange(registrosLimpios);
    onToast(
      'ok',
      `Se consolidó el stock inicial y se eliminaron ${duplicadosEliminados.length} registro(s) duplicado(s)`
    );
  };

  const handleBorrar = (r: Registro) => {
    if (
      !window.confirm(
        `¿Eliminar este registro de entrega de la OP ${r.op} (${r.total || 0} u - ${r.nombre}) registrado el ${fcorta(r.fecha)}?`
      )
    ) {
      return;
    }
    const remaining = registros.filter((x) => x.id !== r.id);
    const cb = recalcularEstados(r.op, r.fdesp || r.fecha, remaining, planesOp, opExtra);
    onBorrarRemoto(r.id);
    encolarDel(r.id, 'registros');
    onRegistrosChange(remaining, cb);
    onToast('ok', `Registro de OP ${r.op} (${r.total || 0} u) eliminado`);
  };

  const handleBorrarTodasOp = (op: string, fd: string) => {
    const q = op.trim().toLowerCase();
    const targetFd = (fd || '').trim();
    const toDelete = registros.filter(
      (x) => !esStock(x) && x.op.trim().toLowerCase() === q && (x.fdesp || x.fecha || '').trim() === targetFd
    );
    if (!toDelete.length) return;
    if (
      !window.confirm(
        `¿Eliminar TODAS las ${toDelete.length} entregas de la OP ${op} en el despacho ${fcorta(fd)}? Esta acción es definitiva.`
      )
    ) {
      return;
    }
    toDelete.forEach((r) => {
      onBorrarRemoto(r.id);
      encolarDel(r.id, 'registros');
    });
    const toDeleteIds = new Set(toDelete.map((x) => x.id));
    const remaining = registros.filter((x) => !toDeleteIds.has(x.id));
    const cb = recalcularEstados(op, fd, remaining, planesOp, opExtra);
    onRegistrosChange(remaining, cb);
    setEntregasModalOp(null);
    onToast('ok', `Se eliminaron las ${toDelete.length} entregas de OP ${op}`);
  };

  const handleExportExcel = () => {
    if (!entregasReales(filtrados).length && !agruparReporte(filtrados, registros, fDesp, planesOp, opExtra, planes).ops.length) {
      onToast('error', 'Nada que exportar');
      return;
    }
    if (filtrados.length < registros.length) {
      onToast('ok', `Se exporta ${filtrados.length} de ${registros.length} por los filtros activos`);
    }
    const nombreArchivo = `entregas_${hoy()}.xls`;
    const xml = xmlEntregas(filtrados, registros, fDesp, planesOp, opExtra, planes);
    descargarXml(xml, nombreArchivo, onToast);
  };

  const handleAbrirImprimir = () => {
    const ents = entregasReales(filtrados);
    const g = agruparReporte(filtrados, registros, fDesp, planesOp, opExtra, planes);
    if (!ents.length && !g.ops.length) {
      onToast('error', 'Nada que imprimir');
      return;
    }
    setShowPrintModal(true);
  };

  const ejecutarImpresion = (opts: typeof printOpts) => {
    const ents = entregasReales(filtrados);
    const g = agruparReporte(filtrados, registros, fDesp, planesOp, opExtra, planes);
    if (!ents.length && !g.ops.length) {
      onToast('error', 'Nada que imprimir');
      return;
    }

    if (!opts.entregas && !opts.resumenOp && !opts.resumenSap) {
      onToast('error', 'Selecciona al menos una tabla para imprimir');
      return;
    }

    try {
      localStorage.setItem('ctrl_print_opts', JSON.stringify(opts));
    } catch {}

    const escapeHtml = (s: any) =>
      String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      }[c] || c));

    let cuerpoHtml = '';

    if (opts.entregas) {
      const filas = ents.length
        ? ents
            .map((r) => {
              const st = estadoReg(r, registros, planesOp, opExtra);
              const n =
                r.empaque === 'caja'
                  ? r.c === 1
                    ? 'caja'
                    : 'cajas'
                  : r.c === 1
                  ? 'paquete'
                  : 'paquetes';
              const det = `${r.c} ${n} × ${r.u}`;
              return `<tr><td class='k'>${fcorta(r.fdesp || r.fecha)}</td><td class='k'>${fcorta(r.fecha)}</td><td class='k'>${escapeHtml(r.turno)}</td><td>${escapeHtml(r.nombre)}</td><td class='k'>${escapeHtml(r.op)}</td><td class='k'>${escapeHtml(r.sap || '')}</td><td>${escapeHtml(r.descripcion)}</td><td>${escapeHtml(r.cliente)}</td><td class='n p'>${r.pedido || 0}</td><td class='n e'>${r.total || 0}</td><td class='k'>${escapeHtml(det)}</td><td class='k ${st ? 's-' + st : ''}'>${escapeHtml(st)}</td></tr>`;
            })
            .join('')
        : "<tr><td colspan='12' class='k'>Sin entregas registradas</td></tr>";

      cuerpoHtml += `<h2>Entregas registradas por el habilitador</h2><table><thead><tr><th>Despacho</th><th>Registro</th><th>Turno</th><th>Habilitador</th><th>OP</th><th>SAP</th><th>Descripción</th><th>Cliente</th><th>Pedido</th><th>Entregado</th><th>Detalle</th><th>Estado</th></tr></thead><tbody>${filas}</tbody></table>`;
    }

    if (opts.resumenOp) {
      const tablaOp =
        '<h2>Resumen por OP (lista completa, en el orden de la carga)</h2><table><thead><tr><th>Despacho</th><th>OP</th><th>Cliente</th><th>Descripción</th><th>Pedido</th><th>Stock inicial</th><th>Entregado</th><th>Acum. (stock + entreg.)</th><th>Faltante</th><th>Excedente</th><th>En planta</th><th>¿En prod.?</th><th>Estado</th></tr></thead><tbody>' +
        g.ops
          .map((o) => {
            const pd = o.pedido - o.acum;
            const es = estadoDe(o.op, o.fdesp, registros, planesOp, opExtra);
            const cantPl = o.cantPlanta || 0;
            const enPr = o.enProduccion ? 'SÍ' : 'NO';
            return `<tr><td class='k'>${fcorta(o.fdesp)}</td><td class='k'>${escapeHtml(o.op)}</td><td>${escapeHtml(o.cliente)}</td><td>${escapeHtml(o.desc)}</td><td class='n p'>${o.pedido}</td><td class='n s'>${o.stock || ''}</td><td class='n e'>${o.entF}</td><td class='n'>${o.acum}</td><td class='n'>${Math.max(pd, 0)}</td><td class='n${o.pedido > 0 && pd < 0 ? ' x' : ''}'>${o.pedido > 0 ? Math.max(-pd, 0) : 0}</td><td class='n'>${cantPl}</td><td class='k'>${enPr}</td><td class='k${es ? ' s-' + es : ''}'>${es}</td></tr>`;
          })
          .join('') +
        '</tbody></table>';
      cuerpoHtml += tablaOp;
    }

    if (opts.resumenSap) {
      const tablaSap =
        '<h2>Resumen por SAP (lista completa, en el orden de la carga)</h2><table><thead><tr><th>Despacho</th><th>SAP</th><th>Descripción</th><th>Cliente</th><th>Pedido</th><th>Stock inicial</th><th>Entregado</th><th>Acum. (stock + entreg.)</th><th>Faltante</th><th>Excedente</th><th>Estado</th><th>OP</th></tr></thead><tbody>' +
        g.saps
          .map((x) => {
            return `<tr><td class='k'>${fcorta(x.fdesp)}</td><td class='k'>${escapeHtml(x.sap || '')}</td><td>${escapeHtml(x.desc)}</td><td>${escapeHtml(x.cliente)}</td><td class='n p'>${x.conj ? 'CONJUNTO OP' : x.pedido}</td><td class='n s'>${x.stock || ''}</td><td class='n e'>${x.entF}</td><td class='n'>${x.acum}</td><td class='n'>${x.conj ? '—' : x.falt}</td><td class='n${!x.conj && (x.exc ?? 0) > 0 ? ' x' : ''}'>${x.conj ? '—' : x.exc}</td><td class='k${x.estado ? ' s-' + x.estado : ''}'>${x.estado || ''}</td><td>${escapeHtml(Object.keys(x.ops).join(', '))}</td></tr>`;
          })
          .join('') +
        '</tbody></table>';
      cuerpoHtml += tablaSap;
    }

    const html = `<!DOCTYPE html><html lang='es'><head><meta charset='UTF-8'><title>Control de Entregas</title><style>@page{size:A4 landscape;margin:10mm}*{-webkit-print-color-adjust:exact;print-color-adjust:exact}body{font-family:Arial,sans-serif;font-size:10px;color:#111}h1{font-size:15px;margin:0 0 6px}h2{font-size:12px;margin:14px 0 4px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #888;padding:3px 5px;text-align:left}th{background:#F2A93B;text-align:center}.k{text-align:center}.n{text-align:right;font-weight:700;white-space:nowrap}.e{background:#E6F4EA}.p{background:#FDEBD0}.s{background:#E3F2FD}.x{background:#FADBD8;color:#C0392B}.s-COMPLETO{background:#38A169;color:#fff;font-weight:700}.s-ENPRODUCCION{background:#4299E1;color:#fff;font-weight:700}.s-INCOMPLETO{background:#E53E3E;color:#fff;font-weight:700}</style></head><body><h1>Control de Entregas</h1>${cuerpoHtml}</body></html>`;

    setShowPrintModal(false);
    const fr = document.createElement('iframe');
    fr.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
    document.body.appendChild(fr);
    const d = fr.contentWindow?.document;
    if (d) {
      d.open();
      d.write(html);
      d.close();
      setTimeout(() => {
        fr.contentWindow?.focus();
        fr.contentWindow?.print();
        setTimeout(() => fr.remove(), 2000);
      }, 300);
    }
  };

  const handleLimpiarFiltros = () => {
    setFFecha('');
    setFDesp('');
    setFTurno('');
    setFNombre('');
    setFEstado('');
    setFTexto('');
  };

  const gSummary = agrupar(filtrados, registros, planesOp, opExtra);
  const gReporte = agruparReporte(filtrados, registros, fDesp, planesOp, opExtra, planes);
  const totEntregadasSummary = filtrados.reduce(
    (a, r) => a + (esStock(r) ? 0 : r.total || 0),
    0
  );

  return (
    <div id="t-lista">
      {/* Filters panel */}
      <div className="panel">
        <div className="row2">
          <div className="field">
            <label>Fecha registro</label>
            <input
              type="date"
              id="fFecha"
              value={fFecha}
              onChange={(e) => setFFecha(e.target.value)}
            />
          </div>
          <div className="field">
            <label>Fecha despacho</label>
            <input
              type="date"
              id="fDesp"
              value={fDesp}
              onChange={(e) => setFDesp(e.target.value)}
            />
          </div>
          <div className="field">
            <label>Turno</label>
            <select
              id="fTurno"
              value={fTurno}
              onChange={(e) => setFTurno(e.target.value)}
            >
              <option value="">Todos</option>
              <option value="Día">Día</option>
              <option value="Noche">Noche</option>
            </select>
          </div>
        </div>
        <div className="row2">
          <div className="field">
            <label>Habilitador</label>
            <select
              id="fNombre"
              value={fNombre}
              onChange={(e) => setFNombre(e.target.value)}
            >
              <option value="">Todos</option>
              {nombres.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Estado</label>
            <select
              id="fEstado"
              value={fEstado}
              onChange={(e) => setFEstado(e.target.value)}
            >
              <option value="">Todos</option>
              <option value="COMPLETO">COMPLETO</option>
              <option value="INCOMPLETO">INCOMPLETO</option>
              <option value="EN PRODUCCION">EN PRODUCCIÓN</option>
            </select>
          </div>
        </div>
        <div className="field">
          <label>Buscar (OP, SAP, cliente, descripción)</label>
          <input
            type="text"
            id="fTexto"
            placeholder="Buscar..."
            value={fTexto}
            onChange={(e) => setFTexto(e.target.value)}
          />
        </div>
      </div>

      {/* View Switcher */}
      <div className="chips modo" id="vistaChips">
        <button
          className={`chip ${vista === 'lista' ? 'active' : ''}`}
          type="button"
          onClick={() => setVista('lista')}
        >
          Entradas
        </button>
        <button
          className={`chip ${vista === 'resumen' ? 'active' : ''}`}
          type="button"
          onClick={() => setVista('resumen')}
        >
          Resumen por OP / SAP
        </button>
      </div>

      {/* Actions Toolbar */}
      <div className="tools">
        <button className="btn-s" id="exp" type="button" onClick={handleExportExcel}>
          Excel
        </button>
        <button className="btn-s" id="imp" type="button" onClick={handleAbrirImprimir}>
          Imprimir
        </button>
        <button className="btn-s" id="envSb" type="button" onClick={onEnviarSheets}>
          Enviar a Sheets
        </button>
        <button className="btn-s" id="traeSb" type="button" onClick={onTraerSheets}>
          Traer de Sheets
        </button>
        <button
          className="btn-s"
          id="depurarStock"
          type="button"
          onClick={handleDepurarStock}
          title="Detecta, consolida y elimina stock inicial duplicado"
        >
          🧹 Depurar stock
        </button>
        <button
          className="btn-s"
          id="limpiarFiltro"
          type="button"
          onClick={handleLimpiarFiltros}
        >
          Quitar filtros
        </button>
        <span id="cuenta">{filtrados.length} registro(s)</span>
      </div>

      {/* View 1: ENTRADAS LIST TABLE */}
      {vista === 'lista' && (
        <div id="lista">
          {!filtrados.length ? (
            <div className="empty">Sin registros.</div>
          ) : (
            <div className="table-wrap">
              <table className="list-table">
                <thead>
                  <tr>
                    <th className="k">#</th>
                    <th>Despacho</th>
                    <th>Registro</th>
                    <th>Turno</th>
                    <th>Habilitador</th>
                    <th className="th-op">OP</th>
                    <th>Cliente</th>
                    <th>SAP / Descripción</th>
                    <th className="n">Pedido</th>
                    <th className="n">Entregado / Stock</th>
                    <th>Detalle</th>
                    <th className="k">Estado</th>
                    <th className="k">Sync</th>
                    <th style={{ textAlign: 'right' }}>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {filtrados.map((r, idx) => {
                    const est = estadoReg(r, registros, planesOp, opExtra);
                    const n =
                      r.empaque === 'caja'
                        ? r.c === 1
                          ? 'caja'
                          : 'cajas'
                        : r.c === 1
                        ? 'paquete'
                        : 'paquetes';
                    const isStk = esStock(r);

                    return (
                      <tr key={r.id}>
                        <td className="k" style={{ color: 'var(--muted)', fontSize: '0.78rem' }}>
                          {idx + 1}
                        </td>
                        <td className="mono">{fcorta(r.fdesp || r.fecha)}</td>
                        <td className="mono">{fcorta(r.fecha)}</td>
                        <td>{r.turno}</td>
                        <td>{r.nombre}</td>
                        <td className="td-op op-cell">
                          <span className="op mono">{r.op}</span>
                        </td>
                        <td>{r.cliente}</td>
                        <td>
                          <div style={{ fontWeight: 500 }}>{r.descripcion}</div>
                          {r.sap && (
                            <div className="mono" style={{ fontSize: '0.74rem', color: 'var(--muted)' }}>
                              SAP {r.sap}
                            </div>
                          )}
                        </td>
                        <td className="n mono">{r.pedido || 0} u</td>
                        <td className="n mono">
                          {isStk ? (
                            <span className="badge-stock">Stock {r.total} u</span>
                          ) : (
                            <strong>{r.total || 0} u</strong>
                          )}
                        </td>
                        <td style={{ fontSize: '0.82rem', color: 'var(--muted2)' }}>
                          {isStk ? (
                            <span style={{ color: 'var(--muted)' }}>Stock inicial</span>
                          ) : r.total ? (
                            `${r.c} ${n} × ${r.u}`
                          ) : (
                            '0'
                          )}
                        </td>
                        <td className="k">
                          {est && <span className={`badge b-${est}`}>{est}</span>}
                        </td>
                        <td className="k" title={r.sync ? 'Sincronizado' : 'Pendiente'}>
                          {r.sync ? '☁️' : '⏳'}
                        </td>
                        <td className="actions">
                          {isStk && (
                            <button
                              className="stock-btn"
                              type="button"
                              title="Editar stock inicial"
                              onClick={() =>
                                setStockEditModal({
                                  op: r.op,
                                  fdesp: r.fdesp || r.fecha,
                                  currentStock: r.total || 0,
                                  pedido: r.pedido,
                                })
                              }
                            >
                              ✏️ Stock
                            </button>
                          )}
                          <button
                            className="del-btn"
                            type="button"
                            onClick={() => handleBorrar(r)}
                          >
                            Borrar
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* View 2: RESUMEN POR OP / SAP TABLES */}
      {vista === 'resumen' && (
        <div id="lista">
          {!filtrados.length ? (
            <div className="empty">Sin registros.</div>
          ) : (
            <>
              {/* Table 1: Resumen por OP */}
              <div className="panel" style={{ padding: '14px', marginBottom: '8px' }}>
                <div
                  className="sec"
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    flexWrap: 'wrap',
                    gap: '8px',
                    marginBottom: '12px',
                  }}
                >
                  <span>Resumen por OP y Despacho ({gSummary.ops.length} OPs)</span>
                  <span style={{ fontSize: '0.88rem', fontWeight: 600, color: 'var(--amber-ink)' }}>
                    Total entregado: {totEntregadasSummary} u
                  </span>
                </div>

                <div className="table-wrap">
                  <table className="list-table">
                    <thead>
                      <tr>
                        <th>Despacho</th>
                        <th className="th-op">OP</th>
                        <th>Cliente</th>
                        <th>Detalle / Líneas</th>
                        <th className="n">Pedido</th>
                        <th className="n">Stock inicial</th>
                        <th className="n">Entregado</th>
                        <th className="n">Acumulado</th>
                        <th className="n">Pendiente</th>
                        <th className="n">Excedente</th>
                        <th className="n">En planta</th>
                        <th className="k">¿En prod.?</th>
                        <th className="k">Estado</th>
                        <th style={{ textAlign: 'right' }}>Acciones</th>
                      </tr>
                    </thead>
                    <tbody>
                      {gSummary.ops.map((o) => {
                        const pd = o.pedido - o.acum;
                        const ok = o.pedido > 0 && pd <= 0;
                        const enProd = Boolean(o.enProduccion);
                        const cantPlanta = o.cantPlanta || 0;
                        return (
                          <tr key={o.op + '|' + o.fdesp}>
                            <td className="mono">{fcorta(o.fdesp)}</td>
                            <td className="td-op op-cell">
                              <span className="op mono">{o.op}</span>
                            </td>
                            <td>{o.cliente}</td>
                            <td style={{ fontSize: '0.82rem' }}>
                              {Object.keys(o.lineas).length > 0 ? (
                                Object.keys(o.lineas).map((k) => {
                                  const L = o.lineas[k];
                                  return (
                                    <div key={k} style={{ marginBottom: '2px' }}>
                                      {L.sap && (
                                        <span className="mono" style={{ color: 'var(--muted)' }}>
                                          SAP {L.sap} ·{' '}
                                        </span>
                                      )}
                                      {L.desc}: <strong>{L.ent} u</strong>
                                    </div>
                                  );
                                })
                              ) : (
                                <span style={{ color: 'var(--muted)' }}>—</span>
                              )}
                            </td>
                            <td className="n mono">{o.pedido || 0}</td>
                            <td className="n mono">{o.stock > 0 ? `${o.stock} u` : '—'}</td>
                            <td className="n mono">
                              <strong>{o.ent} u</strong>
                            </td>
                            <td className="n mono">
                              <strong>{o.acum} u</strong>
                            </td>
                            <td className="n mono">
                              {Math.max(pd, 0) > 0 ? `${Math.max(pd, 0)} u` : '0'}
                            </td>
                            <td className="n mono">
                              {pd < 0 && o.pedido > 0 ? (
                                <span style={{ color: 'var(--red)', fontWeight: 700 }}>
                                  {-pd} u
                                </span>
                              ) : (
                                '0'
                              )}
                            </td>
                            <td className="n">
                              <button
                                type="button"
                                className="btn-s"
                                style={{
                                  padding: '3px 8px',
                                  fontSize: '0.82rem',
                                  fontWeight: 700,
                                  minHeight: '28px',
                                  background: cantPlanta > 0 ? 'var(--blue)' : 'var(--field)',
                                  color: cantPlanta > 0 ? '#fff' : 'var(--muted2)',
                                  borderColor: cantPlanta > 0 ? 'var(--blue)' : 'var(--inp)',
                                  borderRadius: '6px',
                                  cursor: 'pointer',
                                }}
                                onClick={() =>
                                  setPlantaEditModal({
                                    op: o.op,
                                    fdesp: o.fdesp,
                                    currentPlanta: cantPlanta,
                                    currentEnProduccion: enProd,
                                    pedido: o.pedido,
                                    entregado: o.ent,
                                    stock: o.stock,
                                  })
                                }
                                title="Clic para editar la cantidad restante en planta"
                              >
                                {cantPlanta > 0 ? `🏭 ${cantPlanta} u` : '0 u'}
                              </button>
                            </td>
                            <td className="k" style={{ textAlign: 'center' }}>
                              <label
                                style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '5px',
                                  cursor: 'pointer',
                                  margin: 0,
                                  fontSize: '0.82rem',
                                  fontWeight: 600,
                                  userSelect: 'none',
                                }}
                                title="Marcar si esta OP está en producción"
                              >
                                <input
                                  type="checkbox"
                                  checked={enProd}
                                  onChange={(e) => handleToggleEnProduccion(o.op, o.fdesp, e.target.checked)}
                                  style={{
                                    width: '18px',
                                    height: '18px',
                                    minHeight: '18px',
                                    cursor: 'pointer',
                                    accentColor: 'var(--blue)',
                                  }}
                                />
                                <span
                                  style={{
                                    color: enProd ? 'var(--blue)' : 'var(--muted)',
                                    fontWeight: enProd ? 700 : 500,
                                  }}
                                >
                                  {enProd ? 'En prod.' : 'No'}
                                </span>
                              </label>
                            </td>
                            <td className="k">
                              {(() => {
                                const sapsDeOp = Object.keys(o.lineas)
                                  .map((k) => o.lineas[k].sap)
                                  .filter(Boolean)
                                  .join(' + ');
                                const sapCheck = sapsDeOp
                                  ? compararSapConDespacho(sapsDeOp, o.fdesp, registros, planes, o.op)
                                  : null;
                                const sapCubiertoPorOtras =
                                  sapCheck &&
                                  sapCheck.otrasOps.length > 0 &&
                                  sapCheck.pedidoSap > 0 &&
                                  sapCheck.acumuladoSap >= sapCheck.pedidoSap;

                                return (
                                  <>
                                    {enProd ? (
                                      <div>
                                        <span className="badge b-ENPRODUCCION">EN PRODUCCIÓN</span>
                                        {o.pedido > 0 && (
                                          <div
                                            style={{
                                              fontSize: '0.72rem',
                                              marginTop: '3px',
                                              fontWeight: 600,
                                              color: ok ? 'var(--green)' : 'var(--muted)',
                                            }}
                                          >
                                            {ok
                                              ? pd < 0
                                                ? `Cubierto (+${-pd})`
                                                : 'Cubierto'
                                              : `Faltan ${pd} u${cantPlanta > 0 ? ` (${cantPlanta} en planta)` : ''}`}
                                          </div>
                                        )}
                                      </div>
                                    ) : o.pedido > 0 ? (
                                      <div>
                                        <span className={`badge ${ok ? 'b-COMPLETO' : 'b-INCOMPLETO'}`}>
                                          {ok
                                            ? pd < 0
                                              ? `COMPLETO (+${-pd})`
                                              : 'COMPLETO'
                                            : `Faltan ${pd}`}
                                        </span>
                                        {cantPlanta > 0 && !ok && (
                                          <div
                                            style={{
                                              fontSize: '0.72rem',
                                              marginTop: '3px',
                                              color: 'var(--blue)',
                                              fontWeight: 600,
                                            }}
                                          >
                                            🏭 {cantPlanta} u en planta
                                          </div>
                                        )}
                                      </div>
                                    ) : (
                                      cantPlanta > 0 && (
                                        <span
                                          style={{
                                            fontSize: '0.76rem',
                                            color: 'var(--blue)',
                                            fontWeight: 600,
                                          }}
                                        >
                                          🏭 {cantPlanta} u en planta
                                        </span>
                                      )
                                    )}
                                    {sapCubiertoPorOtras && !ok && (
                                      <div
                                        style={{
                                          fontSize: '0.7rem',
                                          marginTop: '3px',
                                          color: 'var(--green)',
                                          fontWeight: 700,
                                        }}
                                        title={`Completado junto con ${sapCheck!.otrasOps.map((x) => x.op).join(', ')}`}
                                      >
                                        ✓ SAP cubierto ({sapCheck!.acumuladoSap}/{sapCheck!.pedidoSap} u)
                                      </div>
                                    )}
                                  </>
                                );
                              })()}
                            </td>
                            <td className="actions" style={{ whiteSpace: 'nowrap' }}>
                              <div style={{ display: 'inline-flex', gap: '4px', justifyContent: 'flex-end' }}>
                                <button
                                  className="stock-btn"
                                  type="button"
                                  onClick={() =>
                                    setEntregasModalOp({
                                      op: o.op,
                                      fdesp: o.fdesp,
                                      cliente: o.cliente,
                                      pedido: o.pedido,
                                      stock: o.stock,
                                    })
                                  }
                                  title="Ver y borrar entregas individuales registradas para esta OP"
                                  style={{ borderColor: 'var(--amber)' }}
                                >
                                  👁️ Entregas
                                </button>
                                <button
                                  className="stock-btn"
                                  type="button"
                                  onClick={() =>
                                    setPlantaEditModal({
                                      op: o.op,
                                      fdesp: o.fdesp,
                                      currentPlanta: cantPlanta,
                                      currentEnProduccion: enProd,
                                      pedido: o.pedido,
                                      entregado: o.ent,
                                      stock: o.stock,
                                    })
                                  }
                                  title="Editar cantidad en planta y estado de producción"
                                  style={{
                                    borderColor: cantPlanta > 0 || enProd ? 'var(--blue)' : undefined,
                                  }}
                                >
                                  🏭 Planta
                                </button>
                                <button
                                  className="stock-btn"
                                  type="button"
                                  onClick={() =>
                                    setStockEditModal({
                                      op: o.op,
                                      fdesp: o.fdesp,
                                      currentStock: o.stock || 0,
                                      pedido: o.pedido,
                                    })
                                  }
                                >
                                  ✏️ Stock ({o.stock || 0})
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Table 2: Resumen por SAP */}
              <div className="panel" style={{ padding: '14px', marginBottom: '8px' }}>
                <div className="sec" style={{ marginBottom: '12px' }}>
                  Resumen por SAP y Despacho ({gReporte.saps.length} códigos SAP — suma de OPs del mismo despacho)
                </div>

                <div className="table-wrap">
                  <table className="list-table">
                    <thead>
                      <tr>
                        <th>Despacho</th>
                        <th>SAP</th>
                        <th>Descripción</th>
                        <th>OPs agrupadas</th>
                        <th className="n">Pedido SAP</th>
                        <th className="n">Stock inicial</th>
                        <th className="n">Entregado</th>
                        <th className="n">Acumulado</th>
                        <th className="n">Faltante</th>
                        <th className="n">Excedente</th>
                        <th className="k">Estado</th>
                      </tr>
                    </thead>
                    <tbody>
                      {gReporte.saps.map((x) => {
                        const opsList = Object.keys(x.ops);
                        return (
                          <tr key={x.fdesp + '|' + (x.sap || x.desc)}>
                            <td className="mono">{fcorta(x.fdesp)}</td>
                            <td>
                              <span
                                className="mono"
                                style={{
                                  fontWeight: 700,
                                  background: 'var(--alt)',
                                  padding: '2px 8px',
                                  borderRadius: '6px',
                                }}
                              >
                                {x.sap || '—'}
                              </span>
                            </td>
                            <td>{x.desc}</td>
                            <td className="mono" style={{ fontSize: '0.82rem' }}>
                              {opsList.join(', ')}
                              {opsList.length > 1 && (
                                <span
                                  style={{
                                    marginLeft: '6px',
                                    fontSize: '0.72rem',
                                    color: 'var(--blue)',
                                    fontWeight: 700,
                                  }}
                                >
                                  ({opsList.length} OPs)
                                </span>
                              )}
                            </td>
                            <td className="n mono">{x.conj ? 'CONJUNTO' : x.pedido || 0}</td>
                            <td className="n mono">{x.stock > 0 ? `${x.stock} u` : '—'}</td>
                            <td className="n mono">
                              <strong>{x.ent} u</strong>
                            </td>
                            <td className="n mono">
                              <strong>{x.acum ?? x.ent} u</strong>
                            </td>
                            <td className="n mono">
                              {x.conj ? '—' : (x.falt ?? 0) > 0 ? `${x.falt} u` : '0'}
                            </td>
                            <td className="n mono">
                              {x.conj ? (
                                '—'
                              ) : (x.exc ?? 0) > 0 ? (
                                <span style={{ color: 'var(--red)', fontWeight: 700 }}>{x.exc} u</span>
                              ) : (
                                '0'
                              )}
                            </td>
                            <td className="k">
                              {x.estado ? (
                                <span className={`badge b-${x.estado.replace(/\s+/g, '')}`}>
                                  {x.estado}
                                </span>
                              ) : (
                                '—'
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {showPrintModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.65)',
            zIndex: 999,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '16px',
          }}
        >
          <div
            className="card"
            style={{
              maxWidth: '540px',
              width: '100%',
              background: 'var(--panel)',
              boxShadow: '0 12px 36px rgba(0,0,0,0.3)',
              borderRadius: '16px',
              padding: '20px 22px',
            }}
          >
            <div className="sec" style={{ fontSize: '1.15rem', marginBottom: '6px' }}>
              Tablas para el reporte de impresión
            </div>
            <p className="info" style={{ margin: '0 0 16px', fontSize: '0.88rem' }}>
              Selecciona cuáles de las tablas deseas incluir en el documento de impresión:
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '18px' }}>
              <label
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '12px',
                  padding: '10px 14px',
                  borderRadius: '10px',
                  border: '1px solid var(--border)',
                  background: printOpts.entregas ? 'var(--amber-soft)' : 'var(--field)',
                  cursor: 'pointer',
                  userSelect: 'none',
                }}
              >
                <input
                  type="checkbox"
                  checked={printOpts.entregas}
                  onChange={(e) => setPrintOpts({ ...printOpts, entregas: e.target.checked })}
                  style={{ width: '20px', height: '20px', minHeight: 0, marginTop: '2px', accentColor: 'var(--amber)' }}
                />
                <div>
                  <div style={{ fontWeight: 700, color: 'var(--text)', fontSize: '0.92rem' }}>
                    1. Entregas registradas por el habilitador
                  </div>
                  <div style={{ fontSize: '0.78rem', color: 'var(--muted)', marginTop: '2px' }}>
                    Detalle individual de cada entrega (fecha, turno, habilitador, OP, SAP, pedido, entregado y estado).
                  </div>
                </div>
              </label>

              <label
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '12px',
                  padding: '10px 14px',
                  borderRadius: '10px',
                  border: '1px solid var(--border)',
                  background: printOpts.resumenOp ? 'var(--amber-soft)' : 'var(--field)',
                  cursor: 'pointer',
                  userSelect: 'none',
                }}
              >
                <input
                  type="checkbox"
                  checked={printOpts.resumenOp}
                  onChange={(e) => setPrintOpts({ ...printOpts, resumenOp: e.target.checked })}
                  style={{ width: '20px', height: '20px', minHeight: 0, marginTop: '2px', accentColor: 'var(--amber)' }}
                />
                <div>
                  <div style={{ fontWeight: 700, color: 'var(--text)', fontSize: '0.92rem' }}>
                    2. Resumen por OP (lista completa)
                  </div>
                  <div style={{ fontSize: '0.78rem', color: 'var(--muted)', marginTop: '2px' }}>
                    Totalización consolidada por Orden de Producción, cliente, pedido, stock inicial, entregado y saldo.
                  </div>
                </div>
              </label>

              <label
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '12px',
                  padding: '10px 14px',
                  borderRadius: '10px',
                  border: '1px solid var(--border)',
                  background: printOpts.resumenSap ? 'var(--amber-soft)' : 'var(--field)',
                  cursor: 'pointer',
                  userSelect: 'none',
                }}
              >
                <input
                  type="checkbox"
                  checked={printOpts.resumenSap}
                  onChange={(e) => setPrintOpts({ ...printOpts, resumenSap: e.target.checked })}
                  style={{ width: '20px', height: '20px', minHeight: 0, marginTop: '2px', accentColor: 'var(--amber)' }}
                />
                <div>
                  <div style={{ fontWeight: 700, color: 'var(--text)', fontSize: '0.92rem' }}>
                    3. Resumen por SAP (lista completa)
                  </div>
                  <div style={{ fontSize: '0.78rem', color: 'var(--muted)', marginTop: '2px' }}>
                    Consolidado agrupado por código SAP con la suma de las OPs del mismo despacho.
                  </div>
                </div>
              </label>
            </div>

            <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap' }}>
              <button
                type="button"
                className="btn-s"
                style={{ padding: '4px 10px', fontSize: '0.75rem' }}
                onClick={() => setPrintOpts({ entregas: true, resumenOp: true, resumenSap: true })}
              >
                Marcar todas
              </button>
              <button
                type="button"
                className="btn-s"
                style={{ padding: '4px 10px', fontSize: '0.75rem' }}
                onClick={() => setPrintOpts({ entregas: true, resumenOp: false, resumenSap: false })}
              >
                Solo entregas
              </button>
              <button
                type="button"
                className="btn-s"
                style={{ padding: '4px 10px', fontSize: '0.75rem' }}
                onClick={() => setPrintOpts({ entregas: false, resumenOp: true, resumenSap: true })}
              >
                Solo resúmenes
              </button>
            </div>

            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
              <button
                className="btn-s"
                type="button"
                onClick={() => setShowPrintModal(false)}
              >
                Cancelar
              </button>
              <button
                className="btn-s"
                type="button"
                disabled={!printOpts.entregas && !printOpts.resumenOp && !printOpts.resumenSap}
                style={{
                  background: 'var(--amber)',
                  color: 'var(--on-amber)',
                  fontWeight: 700,
                  opacity: !printOpts.entregas && !printOpts.resumenOp && !printOpts.resumenSap ? 0.5 : 1,
                }}
                onClick={() => ejecutarImpresion(printOpts)}
              >
                Imprimir reporte
              </button>
            </div>
          </div>
        </div>
      )}

      {stockEditModal && (
        <EditarStockModal
          op={stockEditModal.op}
          fdesp={stockEditModal.fdesp}
          currentStock={stockEditModal.currentStock}
          pedido={stockEditModal.pedido}
          onSave={handleGuardarStockEdit}
          onClose={() => setStockEditModal(null)}
        />
      )}

      {plantaEditModal && (
        <EditarPlantaModal
          op={plantaEditModal.op}
          fdesp={plantaEditModal.fdesp}
          currentPlanta={plantaEditModal.currentPlanta}
          currentEnProduccion={plantaEditModal.currentEnProduccion}
          pedido={plantaEditModal.pedido}
          entregado={plantaEditModal.entregado}
          stock={plantaEditModal.stock}
          onSave={handleSavePlantaModal}
          onClose={() => setPlantaEditModal(null)}
        />
      )}

      {entregasModalOp && (
        <EntregasOpModal
          op={entregasModalOp.op}
          fdesp={entregasModalOp.fdesp}
          cliente={entregasModalOp.cliente}
          pedido={entregasModalOp.pedido}
          stock={entregasModalOp.stock}
          entregas={registros.filter(
            (r) =>
              r.op.trim().toLowerCase() === entregasModalOp.op.trim().toLowerCase() &&
              (r.fdesp || r.fecha || '').trim() === entregasModalOp.fdesp.trim()
          )}
          onDeleteRegistro={handleBorrar}
          onDeleteAllForOp={() => handleBorrarTodasOp(entregasModalOp.op, entregasModalOp.fdesp)}
          onClose={() => setEntregasModalOp(null)}
        />
      )}
    </div>
  );
};
