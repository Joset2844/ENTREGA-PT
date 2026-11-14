import React, { useState, useEffect } from 'react';
import { CatalogoOp, Ingreso, IngresoGridRow } from '../types';
import {
  avisoCant,
  avisoFecha,
  confirmarAvisos,
  esEntero,
  fcorta,
  hoy,
} from '../utils/helpers';
import { K_IGRID, ld, sv } from '../services/storage';
import { descargarXml, xmlIngresos } from '../services/excel';
import { encolarDel } from '../services/sheets';

interface IngresosTabProps {
  iFecha: string;
  iNombre: string;
  iTurno: string;
  ingresos: Ingreso[];
  onIngresosChange: (newIngs: Ingreso[], toSend?: Ingreso[]) => void;
  catalogo: CatalogoOp[];
  nombres: string[];
  modoIng: 'tabla' | 'form';
  onModoIngChange: (m: 'tabla' | 'form') => void;
  onEnviarSheets: () => void;
  onTraerSheets: () => void;
  onBorrarRemoto: (id: string) => void;
  onToast: (t: 'ok' | 'error', m: string) => void;
}

export const IngresosTab: React.FC<IngresosTabProps> = ({
  iFecha,
  iNombre,
  iTurno,
  ingresos,
  onIngresosChange,
  catalogo,
  nombres,
  modoIng,
  onModoIngChange,
  onEnviarSheets,
  onTraerSheets,
  onBorrarRemoto,
  onToast,
}) => {
  // Form State
  const [formOp, setFormOp] = useState('');
  const [formDesc, setFormDesc] = useState('');
  const [formSap, setFormSap] = useState('');
  const [formCliente, setFormCliente] = useState('');
  const [formEmp, setFormEmp] = useState('caja');
  const [formU, setFormU] = useState('');
  const [formC, setFormC] = useState('');
  const [formModeloSel, setFormModeloSel] = useState<number>(-1);
  const [showSug, setShowSug] = useState(false);
  const [opAplicada, setOpAplicada] = useState('');

  // Grid State
  const [igrid, setIgrid] = useState<IngresoGridRow[]>(() => {
    const saved = ld<IngresoGridRow[]>(K_IGRID + (iFecha || 'x'), []);
    return saved.length ? saved : [{ op: '', mod: '', emp: 'caja', u: '', c: '' }];
  });
  const [igridSavePending, setIgridSavePending] = useState(false);

  // Filters State
  const [filterFecha, setFilterFecha] = useState('');
  const [filterTurno, setFilterTurno] = useState('');
  const [filterNombre, setFilterNombre] = useState('');
  const [filterTexto, setFilterTexto] = useState('');

  // Load grid draft on date change
  useEffect(() => {
    const saved = ld<IngresoGridRow[]>(K_IGRID + (iFecha || 'x'), []);
    if (saved.length) {
      setIgrid([...saved, { op: '', mod: '', emp: 'caja', u: '', c: '' }]);
    } else {
      setIgrid([{ op: '', mod: '', emp: 'caja', u: '', c: '' }]);
    }
  }, [iFecha]);

  const saveGridDraft = (newGrid: IngresoGridRow[]) => {
    const clean = newGrid.filter((r) => r.op || r.u || r.c);
    sv(K_IGRID + (iFecha || 'x'), clean);
  };

  const buscarCatalogo = (op: string) => {
    const q = (op || '').trim().toLowerCase();
    if (!q) return null;
    return catalogo.find((c) => c.op.toLowerCase() === q) || null;
  };

  const aplicarOpForm = (m: CatalogoOp) => {
    setOpAplicada(m.op);
    setFormOp(m.op);
    setFormCliente(m.cliente || '');
    setShowSug(false);

    if (m.modelos.length === 1) {
      setFormModeloSel(0);
      setFormDesc(m.modelos[0].descripcion);
      setFormSap(m.modelos[0].sap || '');
    } else {
      setFormModeloSel(-1);
      setFormDesc('');
      setFormSap('');
    }
  };

  const handleSelectModeloForm = (idx: number, m: CatalogoOp) => {
    setFormModeloSel(idx);
    if (idx >= 0 && m.modelos[idx]) {
      setFormDesc(m.modelos[idx].descripcion);
      setFormSap(m.modelos[idx].sap || '');
    }
  };

  const formTotalCalc = (parseInt(formU, 10) || 0) * (parseInt(formC, 10) || 0);

  const handleGuardarForm = () => {
    if (!iFecha) {
      onToast('error', 'Por favor ingresa la fecha del ingreso');
      return;
    }
    if (!iNombre) {
      onToast('error', 'Por favor selecciona el habilitador');
      return;
    }
    if (!formOp.trim()) {
      onToast('error', 'Por favor ingresa el número de OP');
      return;
    }
    const m = buscarCatalogo(formOp);
    if (m && m.modelos.length > 1 && formModeloSel < 0) {
      onToast('error', 'Por favor selecciona el modelo de la OP');
      return;
    }
    if (!(formTotalCalc > 0)) {
      onToast('error', 'Ingresa unidades por empaque y cantidad de bultos');
      return;
    }
    if (!esEntero(formU) || !esEntero(formC)) {
      onToast('error', 'Unidades y cantidad deben ser números enteros (sin decimales ni negativos)');
      return;
    }

    const u = parseInt(formU, 10) || 0;
    const c = parseInt(formC, 10) || 0;

    const w: string[] = [];
    w.push(avisoFecha(iFecha, 'ingreso'));
    avisoCant(u, c).forEach((a) => w.push(a));
    if (!m) {
      w.push(
        `La OP ${formOp.trim()} no está en el catálogo de OP${!formDesc && !formCliente ? ' y se guardará sin descripción ni cliente' : ''}`
      );
    } else {
      if (!formDesc) w.push('La descripción está vacía');
      if (!formCliente) w.push('El cliente está vacío');
    }
    const isDup = ingresos.some(
      (r) =>
        r.op.toLowerCase() === formOp.trim().toLowerCase() &&
        r.fecha === iFecha &&
        r.u === u &&
        r.c === c &&
        r.total > 0 &&
        Date.now() - new Date(r.creado).getTime() < 9e5
    );
    if (isDup) w.push('Igual a un ingreso guardado hace menos de 15 min');

    if (!confirmarAvisos(w)) return;

    const r: Ingreso = {
      id: Date.now() + '-' + Math.random().toString(36).slice(2, 6),
      fecha: iFecha,
      turno: iTurno,
      nombre: iNombre,
      op: formOp.trim(),
      sap: formSap.trim(),
      descripcion: formDesc.trim(),
      cliente: formCliente.trim(),
      empaque: formEmp,
      u,
      c,
      total: formTotalCalc,
      creado: new Date().toISOString(),
      sync: false,
    };

    const newIngs = [r, ...ingresos];
    onIngresosChange(newIngs, [r]);

    setFormU('');
    setFormC('');

    if (m && m.modelos.length > 1) {
      setFormModeloSel(-1);
      setFormDesc('');
      setFormSap('');
      onToast('ok', `Guardado. Elige el siguiente modelo de ${m.op}`);
    } else {
      setFormOp('');
      setFormDesc('');
      setFormSap('');
      setFormCliente('');
      setOpAplicada('');
      setFormModeloSel(-1);
      onToast('ok', 'Ingreso guardado');
    }
  };

  // Grid helpers
  const getGridInfo = (i: number) => {
    const r = igrid[i];
    const o: any = { err: [], warn: [] };
    const vacia = !r.op && !r.u && !r.c;
    o.vacia = vacia;
    if (vacia) return o;

    const op = r.op.trim();
    const u = parseInt(r.u, 10) || 0;
    const c = parseInt(r.c, 10) || 0;
    o.m = buscarCatalogo(op);

    let sap = '';
    let desc = '';
    if (o.m) {
      const ms = o.m.modelos || [];
      if (!ms.length) {
        desc = o.m.descripcion || '';
      } else if (ms.length === 1) {
        sap = ms[0].sap || '';
        desc = ms[0].descripcion || '';
      } else if (r.mod !== '') {
        const x = ms[parseInt(r.mod, 10)];
        if (x) {
          sap = x.sap || '';
          desc = x.descripcion || '';
        }
      }
    }
    o.mo = { sap, desc };
    o.total = u * c;

    if (!op) o.err.push('Falta OP');
    else if (!o.m) o.warn.push('OP no está en el catálogo');
    if (o.m && (o.m.modelos || []).length > 1 && r.mod === '') o.err.push('Elige modelo');
    if (!(u > 0)) o.err.push('Falta unid.');
    if (!(c > 0)) o.err.push('Falta cant.');
    if (r.u !== '' && !esEntero(r.u)) o.err.push('Unid. no entera');
    if (r.c !== '' && !esEntero(r.c)) o.err.push('Cant. no entera');
    avisoCant(u, c).forEach((x) => o.warn.push(x));

    let dup = false;
    for (let j = 0; j < i; j++) {
      const g = igrid[j];
      if (
        op &&
        u > 0 &&
        g.op.trim().toLowerCase() === op.toLowerCase() &&
        g.mod === r.mod &&
        (parseInt(g.u, 10) || 0) === u &&
        (parseInt(g.c, 10) || 0) === c
      ) {
        dup = true;
      }
    }
    if (dup) o.warn.push('Repetida en la tabla');

    const rec =
      op &&
      ingresos.find(
        (x) =>
          x.op.toLowerCase() === op.toLowerCase() &&
          x.fecha === iFecha &&
          x.u === u &&
          x.c === c &&
          x.total > 0 &&
          Date.now() - new Date(x.creado).getTime() < 15 * 60000
      );
    if (rec) o.warn.push('Igual a un ingreso de hace poco');

    return o;
  };

  let gridListas = 0;
  let gridConErr = 0;
  let gridUds = 0;
  igrid.forEach((_, i) => {
    const o = getGridInfo(i);
    if (o.vacia) return;
    if (o.err.length) gridConErr++;
    else {
      gridListas++;
      gridUds += o.total;
    }
  });

  const updateGridRow = (i: number, field: keyof IngresoGridRow, val: string) => {
    const updated = [...igrid];
    updated[i] = { ...updated[i], [field]: val };

    if (field === 'op') {
      const m = buscarCatalogo(val);
      if (m && m.op !== val) {
        updated[i].op = m.op;
      }
      updated[i].mod = '';
    }

    if (i === updated.length - 1 && (updated[i].op || updated[i].u || updated[i].c)) {
      updated.push({ op: '', mod: '', emp: 'caja', u: '', c: '' });
    }

    setIgrid(updated);
    saveGridDraft(updated);
  };

  const handleGridPaste = (e: React.ClipboardEvent<HTMLInputElement>, i: number) => {
    const tx = e.clipboardData.getData('text');
    if (!/[\t\n]/.test(tx)) return;
    e.preventDefault();

    const ls = tx
      .replace(/\r/g, '')
      .split('\n')
      .filter((l) => l.trim());
    const updated = [...igrid];

    ls.forEach((l, k) => {
      const c = l.split('\t');
      const rowIdx = i + k;
      if (!updated[rowIdx]) {
        updated.push({ op: '', mod: '', emp: 'caja', u: '', c: '' });
      }
      const m = buscarCatalogo(c[0]);
      updated[rowIdx].op = m ? m.op : String(c[0] || '').trim();
      updated[rowIdx].mod = '';
      if (c[1] != null && c[1] !== '') {
        updated[rowIdx].u = String(parseInt(c[1], 10) || '');
      }
      if (c[2] != null && c[2] !== '') {
        updated[rowIdx].c = String(parseInt(c[2], 10) || '');
      }
    });

    const last = updated[updated.length - 1];
    if (last && (last.op || last.u || last.c)) {
      updated.push({ op: '', mod: '', emp: 'caja', u: '', c: '' });
    }

    setIgrid(updated);
    saveGridDraft(updated);
    onToast('ok', `${ls.length} fila(s) pegadas`);
  };

  const handleGuardarGrid = () => {
    if (igridSavePending) return;
    if (!iFecha) {
      onToast('error', 'Por favor ingresa la fecha del ingreso');
      return;
    }
    if (!iNombre) {
      onToast('error', 'Por favor selecciona el habilitador');
      return;
    }

    const okList: { i: number; r: IngresoGridRow; o: any }[] = [];
    const avisos: string[] = [avisoFecha(iFecha, 'ingreso')].filter(Boolean);
    let errs = 0;

    igrid.forEach((r, i) => {
      const o = getGridInfo(i);
      if (o.vacia) return;
      if (o.err.length) {
        errs++;
        return;
      }
      okList.push({ i, r, o });
      if (o.warn.length) {
        avisos.push(`Fila ${i + 1} (${r.op}): ${o.warn.join(', ')}`);
      }
    });

    if (!okList.length) {
      onToast('error', 'Ninguna fila está lista. Revisa las filas marcadas con error');
      return;
    }

    if (avisos.length && !confirmarAvisos(avisos)) return;
    if (
      !window.confirm(
        `Se guardarán ${okList.length} ingreso(s) al almacén del ${fcorta(iFecha)}${errs ? `\n(${errs} fila(s) con errores quedan pendientes en la tabla)` : ''}.\n\n¿Deseas continuar?`
      )
    ) {
      return;
    }

    setIgridSavePending(true);
    const t0 = Date.now();
    const nuevos: Ingreso[] = [];

    okList.forEach((x, k) => {
      const r = x.r;
      const o = x.o;
      const n: Ingreso = {
        id: Date.now() + '-' + Math.random().toString(36).slice(2, 6),
        fecha: iFecha,
        turno: iTurno,
        nombre: iNombre,
        op: o.m ? o.m.op : r.op.trim(),
        sap: o.mo ? o.mo.sap : '',
        descripcion: o.mo ? o.mo.desc : '',
        cliente: o.m ? o.m.cliente || '' : '',
        empaque: r.emp || 'caja',
        u: parseInt(r.u, 10) || 0,
        c: parseInt(r.c, 10) || 0,
        total: (parseInt(r.u, 10) || 0) * (parseInt(r.c, 10) || 0),
        creado: new Date(t0 + k).toISOString(),
        sync: false,
      };
      nuevos.push(n);
    });

    const newCombined = [...nuevos.slice().reverse(), ...ingresos];
    onIngresosChange(newCombined, nuevos);

    const savedIdx = okList.map((x) => x.i);
    const remaining = igrid.filter((_, i) => savedIdx.indexOf(i) < 0 && (igrid[i].op || igrid[i].u || igrid[i].c));
    remaining.push({ op: '', mod: '', emp: 'caja', u: '', c: '' });
    setIgrid(remaining);
    saveGridDraft(remaining);
    setIgridSavePending(false);
    onToast('ok', `${nuevos.length} ingreso(s) guardado(s) exitosamente${errs ? ` · ${errs} pendiente(s) por corregir` : ''}`);
  };

  // Filtered ingresos
  const filtrados = ingresos
    .filter((r) => {
      if (filterFecha && r.fecha !== filterFecha) return false;
      if (filterTurno && r.turno !== filterTurno) return false;
      if (filterNombre && r.nombre !== filterNombre) return false;
      if (
        filterTexto &&
        `${r.op} ${r.sap || ''} ${r.cliente} ${r.nombre} ${r.descripcion}`
          .toLowerCase()
          .indexOf(filterTexto.trim().toLowerCase()) === -1
      ) {
        return false;
      }
      return true;
    })
    .sort((a, b) => {
      if (a.fecha < b.fecha) return 1;
      if (a.fecha > b.fecha) return -1;
      if (a.turno === b.turno) return String(a.creado).localeCompare(String(b.creado));
      return a.turno === 'Día' ? -1 : 1;
    });

  const handleBorrar = (r: Ingreso) => {
    if (
      !window.confirm(
        `¿Eliminar este ingreso al almacén de la OP ${r.op} (${r.total || 0} u - ${r.nombre}) registrado el ${fcorta(r.fecha)}?`
      )
    ) {
      return;
    }
    const remaining = ingresos.filter((x) => x.id !== r.id);
    onBorrarRemoto(r.id);
    encolarDel(r.id, 'ingresos');
    onIngresosChange(remaining);
    onToast('ok', `Ingreso de OP ${r.op} (${r.total || 0} u) eliminado`);
  };

  const handleExportExcel = () => {
    if (!filtrados.length) {
      onToast('error', 'Nada que exportar');
      return;
    }
    if (filtrados.length < ingresos.length) {
      onToast('ok', `Se exporta ${filtrados.length} de ${ingresos.length} por los filtros activos`);
    }
    const nombreArchivo = `ingresos_${hoy()}.xls`;
    const xml = xmlIngresos(filtrados);
    descargarXml(xml, nombreArchivo, onToast);
  };

  const handleImprimir = () => {
    if (!filtrados.length) {
      onToast('error', 'Nada que imprimir');
      return;
    }

    const escapeHtml = (s: any) =>
      String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      }[c] || c));

    const filas = filtrados
      .map((r) => {
        const n =
          r.empaque === 'caja'
            ? r.c === 1
              ? 'caja'
              : 'cajas'
            : r.c === 1
            ? 'paquete'
            : 'paquetes';
        const det = `${r.c} ${n} × ${r.u}`;
        return `<tr><td class='k'>${fcorta(r.fecha)}</td><td class='k'>${escapeHtml(r.turno)}</td><td>${escapeHtml(r.nombre)}</td><td class='k'>${escapeHtml(r.op)}</td><td class='k'>${escapeHtml(r.sap || '')}</td><td>${escapeHtml(r.descripcion)}</td><td>${escapeHtml(r.cliente)}</td><td class='n e'>${r.total || 0}</td><td class='k'>${escapeHtml(det)}</td></tr>`;
      })
      .join('');

    const html = `<!DOCTYPE html><html lang='es'><head><meta charset='UTF-8'><title>Ingresos a almacén</title><style>@page{size:A4 landscape;margin:10mm}*{-webkit-print-color-adjust:exact;print-color-adjust:exact}body{font-family:Arial,sans-serif;font-size:10px;color:#111}h1{font-size:15px;margin:0 0 6px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #888;padding:3px 5px;text-align:left}th{background:#F2A93B;text-align:center}.k{text-align:center}.n{text-align:right;font-weight:700;white-space:nowrap}.e{background:#E6F4EA}</style></head><body><h1>Ingresos al almacén</h1><table><thead><tr><th>Fecha</th><th>Turno</th><th>Habilitador</th><th>OP</th><th>SAP</th><th>Descripción</th><th>Cliente</th><th>Entregado</th><th>Detalle</th></tr></thead><tbody>${filas}</tbody></table></body></html>`;

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

  const sugList = formOp.trim()
    ? catalogo
        .filter((c) =>
          c.op.toLowerCase().includes(formOp.trim().toLowerCase())
        )
        .slice(0, 8)
    : [];

  return (
    <div id="t-ing">
      {/* Mode switcher */}
      <div className="chips modo" id="imodoReg">
        <button
          className={`chip ${modoIng === 'tabla' ? 'active' : ''}`}
          type="button"
          onClick={() => onModoIngChange('tabla')}
        >
          Tabla rápida (tipo Excel)
        </button>
        <button
          className={`chip ${modoIng === 'form' ? 'active' : ''}`}
          type="button"
          onClick={() => onModoIngChange('form')}
        >
          Formulario
        </button>
      </div>

      {/* TABLA RÁPIDA (GRID) */}
      {modoIng === 'tabla' && (
        <div id="igPanel" className="panel gpanel">
          <div className="sec">Ingreso rápido a almacén</div>
          <div className="resumen" id="igResumen">
            Filas listas: <b>{gridListas}</b> · Con errores: <b>{gridConErr}</b> · Unidades a
            ingresar: <b>{gridUds}</b>
          </div>
          <div className="tools" style={{ marginBottom: 0 }}>
            <button
              className="btn-s"
              type="button"
              onClick={() => {
                const updated = [...igrid, { op: '', mod: '', emp: 'caja', u: '', c: '' }];
                setIgrid(updated);
                saveGridDraft(updated);
              }}
            >
              + Fila
            </button>
            <button
              className="btn-s"
              type="button"
              onClick={() => {
                if (
                  igrid.some((r) => r.op || r.u || r.c) &&
                  !window.confirm('¿Vaciar toda la tabla?')
                ) {
                  return;
                }
                const cleared = [{ op: '', mod: '', emp: 'caja', u: '', c: '' }];
                setIgrid(cleared);
                saveGridDraft(cleared);
              }}
            >
              Vaciar tabla
            </button>
          </div>

          <div className="gwrap">
            <table className="gt">
              <thead>
                <tr>
                  <th>#</th>
                  <th className="th-op">OP</th>
                  <th>Modelo</th>
                  <th>Cliente</th>
                  <th>SAP</th>
                  <th>Descripción</th>
                  <th>Empaque</th>
                  <th className="n">Unid. x emp.</th>
                  <th className="n">Cant.</th>
                  <th className="n">Total</th>
                  <th>Estado</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {igrid.map((r, i) => {
                  const o = getGridInfo(i);
                  const msg = o.vacia
                    ? ''
                    : o.err.length
                    ? o.err.join(' · ')
                    : o.warn.length
                    ? o.warn.join(' · ')
                    : 'Listo';

                  const rowClass = o.vacia
                    ? ''
                    : o.err.length
                    ? 'err'
                    : o.warn.length
                    ? 'warn'
                    : 'ok';

                  return (
                    <tr key={i} className={rowClass}>
                      <td className="idx">{i + 1}</td>
                      <td className="td-op">
                        <input
                          className="mono in-op"
                          data-f="op"
                          value={r.op}
                          placeholder="OP"
                          onChange={(e) => updateGridRow(i, 'op', e.target.value)}
                          onPaste={(e) => handleGridPaste(e, i)}
                        />
                      </td>
                      <td className="mod">
                        {o.m && o.m.modelos && o.m.modelos.length > 1 ? (
                          <select
                            value={r.mod}
                            onChange={(e) => updateGridRow(i, 'mod', e.target.value)}
                          >
                            <option value="">Elige modelo…</option>
                            {o.m.modelos.map((mo: any, k: number) => (
                              <option key={k} value={String(k)}>
                                {mo.modelo || mo.descripcion}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <span className="dash">—</span>
                        )}
                      </td>
                      <td className="ro cli">{o.m?.cliente || ''}</td>
                      <td className="ro mono sap">{o.mo?.sap || ''}</td>
                      <td className="ro desc">{o.mo?.desc || ''}</td>
                      <td>
                        <select
                          value={r.emp || 'caja'}
                          onChange={(e) => updateGridRow(i, 'emp', e.target.value)}
                        >
                          <option value="caja">Caja</option>
                          <option value="paquete">Paquete</option>
                        </select>
                      </td>
                      <td>
                        <input
                          className="n mono"
                          type="number"
                          min="0"
                          value={r.u}
                          onChange={(e) => updateGridRow(i, 'u', e.target.value)}
                        />
                      </td>
                      <td>
                        <input
                          className="n mono"
                          type="number"
                          min="0"
                          value={r.c}
                          onChange={(e) => updateGridRow(i, 'c', e.target.value)}
                        />
                      </td>
                      <td className="num tot">{o.vacia ? '' : o.total}</td>
                      <td className="msg">{msg}</td>
                      <td>
                        <button
                          className="x"
                          type="button"
                          title="Quitar fila"
                          onClick={() => {
                            if (!o.vacia && !window.confirm(`¿Quitar la fila ${i + 1}?`)) return;
                            const updated = igrid.filter((_, idx) => idx !== i);
                            if (!updated.length) {
                              updated.push({ op: '', mod: '', emp: 'caja', u: '', c: '' });
                            }
                            setIgrid(updated);
                            saveGridDraft(updated);
                          }}
                        >
                          ✕
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <button
            className="btn"
            id="igGuardar"
            type="button"
            disabled={!gridListas || igridSavePending}
            style={{ opacity: gridListas ? 1 : 0.5 }}
            onClick={handleGuardarGrid}
          >
            {gridListas ? `Guardar ${gridListas} fila(s) lista(s)` : 'Guardar filas listas'}
          </button>
          <div className="ayuda">
            Enter o Tab: siguiente celda · Enter en la última celda: nueva fila · Flechas ↑ ↓:
            cambiar de fila · Ctrl+Enter: guardar · Puedes pegar desde Excel columnas OP, Unid.,
            Cant. en la celda OP. La tabla se guarda sola como borrador por fecha de ingreso.
          </div>
        </div>
      )}

      {/* FORMULARIO */}
      {modoIng === 'form' && (
        <div id="ingForm" className="panel">
          <div className="fcol">
            <div className="sec">Ingreso a almacén</div>
            <div className="field">
              <label>OP</label>
              <input
                type="text"
                className="mono"
                placeholder="Ej. OP-10234"
                autoComplete="off"
                value={formOp}
                onChange={(e) => {
                  setFormOp(e.target.value);
                  setShowSug(true);
                  const m = buscarCatalogo(e.target.value);
                  if (m) {
                    if (opAplicada !== m.op) aplicarOpForm(m);
                  } else if (opAplicada) {
                    setOpAplicada('');
                    setFormModeloSel(-1);
                    setFormDesc('');
                    setFormSap('');
                    setFormCliente('');
                  }
                }}
                onFocus={() => setShowSug(true)}
                onBlur={() => setTimeout(() => setShowSug(false), 200)}
              />
              {showSug && sugList.length > 0 && (
                <div className="sug" id="iSug">
                  {sugList.map((m) => (
                    <button
                      key={m.op}
                      type="button"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        aplicarOpForm(m);
                      }}
                    >
                      <div className="o mono">{m.op}</div>
                      <div className="m">
                        {m.descripcion} · {m.cliente}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {buscarCatalogo(formOp) &&
              (buscarCatalogo(formOp)?.modelos || []).length > 1 && (
                <div id="iModelos" className="chips" style={{ flexWrap: 'wrap' }}>
                  {buscarCatalogo(formOp)?.modelos.map((mo, i) => (
                    <button
                      key={i}
                      type="button"
                      className={`chip ${formModeloSel === i ? 'active' : ''}`}
                      style={{ flex: '0 0 auto' }}
                      onClick={() =>
                        handleSelectModeloForm(i, buscarCatalogo(formOp)!)
                      }
                    >
                      {mo.modelo || mo.descripcion}
                    </button>
                  ))}
                </div>
              )}

            <div className="field">
              <label>Descripción</label>
              <input
                type="text"
                placeholder="Se autocompleta con la OP"
                value={formDesc}
                onChange={(e) => setFormDesc(e.target.value)}
              />
            </div>
            <div className="row2">
              <div className="field">
                <label>Cliente</label>
                <input
                  type="text"
                  placeholder="Se autocompleta con la OP"
                  value={formCliente}
                  onChange={(e) => setFormCliente(e.target.value)}
                />
              </div>
              <div className="field">
                <label>Código SAP</label>
                <input
                  type="text"
                  className="mono"
                  placeholder="Según modelo"
                  value={formSap}
                  onChange={(e) => setFormSap(e.target.value)}
                />
              </div>
            </div>
          </div>

          <div className="fcol">
            <div className="sec">Cantidad ingresada</div>
            <div className="chips" id="iEmpTipo">
              <button
                className={`chip ${formEmp === 'caja' ? 'active' : ''}`}
                type="button"
                onClick={() => setFormEmp('caja')}
              >
                Caja
              </button>
              <button
                className={`chip ${formEmp === 'paquete' ? 'active' : ''}`}
                type="button"
                onClick={() => setFormEmp('paquete')}
              >
                Paquete
              </button>
            </div>
            <div className="row2">
              <div className="field">
                <label>Unid. x {formEmp}</label>
                <input
                  type="number"
                  min="0"
                  className="mono"
                  placeholder="0"
                  value={formU}
                  onChange={(e) => setFormU(e.target.value)}
                />
              </div>
              <div className="field">
                <label>Cant. {formEmp === 'caja' ? 'cajas' : 'paquetes'}</label>
                <input
                  type="number"
                  min="0"
                  className="mono"
                  placeholder="0"
                  value={formC}
                  onChange={(e) => setFormC(e.target.value)}
                />
              </div>
            </div>
            <div className="total">
              <span>Total ingresado</span>
              <b className="mono">{formTotalCalc}</b>
            </div>
            <button className="btn" type="button" onClick={handleGuardarForm}>
              Guardar ingreso
            </button>
          </div>
        </div>
      )}

      {/* Filtros de Ingresos */}
      <div className="panel" id="iFiltros">
        <div className="row2">
          <div className="field">
            <label>Fecha</label>
            <input
              type="date"
              id="iFFecha"
              value={filterFecha}
              onChange={(e) => setFilterFecha(e.target.value)}
            />
          </div>
          <div className="field">
            <label>Turno</label>
            <select
              id="iFTurno"
              value={filterTurno}
              onChange={(e) => setFilterTurno(e.target.value)}
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
              id="iFNombre"
              value={filterNombre}
              onChange={(e) => setFilterNombre(e.target.value)}
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
            <label>Buscar (OP, SAP, cliente…)</label>
            <input
              type="text"
              id="iFTexto"
              placeholder="Buscar..."
              value={filterTexto}
              onChange={(e) => setFilterTexto(e.target.value)}
            />
          </div>
        </div>
      </div>

      {/* Tools */}
      <div className="tools">
        <button className="btn-s" id="iExp" type="button" onClick={handleExportExcel}>
          Excel
        </button>
        <button className="btn-s" id="iImp" type="button" onClick={handleImprimir}>
          Imprimir
        </button>
        <button className="btn-s" id="iEnv" type="button" onClick={onEnviarSheets}>
          Enviar a Sheets
        </button>
        <button className="btn-s" id="iTraer" type="button" onClick={onTraerSheets}>
          Traer de Sheets
        </button>
        <button
          className="btn-s"
          id="iLimpiar"
          type="button"
          onClick={() => {
            setFilterFecha('');
            setFilterTurno('');
            setFilterNombre('');
            setFilterTexto('');
          }}
        >
          Quitar filtros
        </button>
        <span id="iCuenta">{filtrados.length} ingreso(s)</span>
      </div>

      {/* Ingresos List Table */}
      <div id="iLista">
        {!filtrados.length ? (
          <div className="empty">Sin ingresos.</div>
        ) : (
          <div className="table-wrap">
            <table className="list-table">
              <thead>
                <tr>
                  <th className="k">#</th>
                  <th>Fecha</th>
                  <th>Turno</th>
                  <th>Habilitador</th>
                  <th className="th-op">OP</th>
                  <th>Cliente</th>
                  <th>SAP / Descripción</th>
                  <th>Empaque</th>
                  <th>Detalle</th>
                  <th className="n">Total</th>
                  <th className="k">Sync</th>
                  <th style={{ textAlign: 'right' }}>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {filtrados.map((r, idx) => {
                  const n =
                    r.empaque === 'caja'
                      ? r.c === 1
                        ? 'caja'
                        : 'cajas'
                      : r.c === 1
                      ? 'paquete'
                      : 'paquetes';

                  return (
                    <tr key={r.id}>
                      <td className="k" style={{ color: 'var(--muted)', fontSize: '0.78rem' }}>
                        {idx + 1}
                      </td>
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
                      <td style={{ textTransform: 'capitalize' }}>{r.empaque}</td>
                      <td style={{ fontSize: '0.82rem', color: 'var(--muted2)' }}>
                        {r.c} {n} × {r.u}
                      </td>
                      <td className="n mono">
                        <strong>{r.total || 0} u</strong>
                      </td>
                      <td className="k" title={r.sync ? 'Sincronizado' : 'Pendiente'}>
                        {r.sync ? '☁️' : '⏳'}
                      </td>
                      <td className="actions">
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
    </div>
  );
};
