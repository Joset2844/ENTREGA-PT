import React, { useState } from 'react';
import { PlanOp, Registro } from '../types';
import {
  agrupar,
  agruparReporte,
  entregasReales,
  esStock,
  estadoDe,
  estadoReg,
  fcorta,
  hoy,
  recalcularEstados,
} from '../utils/helpers';
import { descargarXml, xmlEntregas } from '../services/excel';

interface RegistrosTabProps {
  registros: Registro[];
  onRegistrosChange: (newRegs: Registro[], toSend?: Registro[]) => void;
  nombres: string[];
  planesOp: Record<string, PlanOp>;
  onEnviarSheets: () => void;
  onTraerSheets: () => void;
  onBorrarRemoto: (id: string) => void;
  onToast: (t: 'ok' | 'error', m: string) => void;
}

export const RegistrosTab: React.FC<RegistrosTabProps> = ({
  registros,
  onRegistrosChange,
  nombres,
  planesOp,
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
      if (fEstado && estadoReg(r, registros, planesOp) !== fEstado) return false;
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

  const handleBorrar = (r: Registro) => {
    if (!window.confirm('¿Borrar este registro?')) return;
    const remaining = registros.filter((x) => x.id !== r.id);
    const cb = recalcularEstados(r.op, r.fdesp, remaining, planesOp);
    onBorrarRemoto(r.id);
    onRegistrosChange(remaining, cb);
    onToast('ok', 'Registro eliminado');
  };

  const handleExportExcel = () => {
    if (!entregasReales(filtrados).length && !agruparReporte(filtrados, registros, fDesp, planesOp).ops.length) {
      onToast('error', 'Nada que exportar');
      return;
    }
    if (filtrados.length < registros.length) {
      onToast('ok', `Se exporta ${filtrados.length} de ${registros.length} por los filtros activos`);
    }
    const nombreArchivo = `entregas_${hoy()}.xls`;
    const xml = xmlEntregas(filtrados, registros, fDesp, planesOp);
    descargarXml(xml, nombreArchivo, onToast);
  };

  const handleImprimir = () => {
    const ents = entregasReales(filtrados);
    const g = agruparReporte(filtrados, registros, fDesp, planesOp);
    if (!ents.length && !g.ops.length) {
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

    const filas = ents.length
      ? ents
          .map((r) => {
            const st = estadoReg(r, registros, planesOp);
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

    const a =
      '<h2>Resumen por OP (lista completa, en el orden de la carga)</h2><table><thead><tr><th>Despacho</th><th>OP</th><th>Cliente</th><th>Descripción</th><th>Pedido</th><th>Stock inicial</th><th>Entregado</th><th>Acum. (stock + entreg.)</th><th>Faltante</th><th>Excedente</th><th>Estado</th></tr></thead><tbody>' +
      g.ops
        .map((o) => {
          const pd = o.pedido - o.acum;
          const es = estadoDe(o.op, o.fdesp, registros, planesOp);
          return `<tr><td class='k'>${fcorta(o.fdesp)}</td><td class='k'>${escapeHtml(o.op)}</td><td>${escapeHtml(o.cliente)}</td><td>${escapeHtml(o.desc)}</td><td class='n p'>${o.pedido}</td><td class='n s'>${o.stock || ''}</td><td class='n e'>${o.entF}</td><td class='n'>${o.acum}</td><td class='n'>${Math.max(pd, 0)}</td><td class='n${o.pedido > 0 && pd < 0 ? ' x' : ''}'>${o.pedido > 0 ? Math.max(-pd, 0) : 0}</td><td class='k${es ? ' s-' + es : ''}'>${es}</td></tr>`;
        })
        .join('') +
      '</tbody></table>';

    const b =
      '<h2>Resumen por SAP (lista completa, en el orden de la carga)</h2><table><thead><tr><th>Despacho</th><th>SAP</th><th>Descripción</th><th>Cliente</th><th>Pedido</th><th>Stock inicial</th><th>Entregado</th><th>Acum. (stock + entreg.)</th><th>Faltante</th><th>Excedente</th><th>Estado</th><th>OP</th></tr></thead><tbody>' +
      g.saps
        .map((x) => {
          return `<tr><td class='k'>${fcorta(x.fdesp)}</td><td class='k'>${escapeHtml(x.sap || '')}</td><td>${escapeHtml(x.desc)}</td><td>${escapeHtml(x.cliente)}</td><td class='n p'>${x.conj ? 'CONJUNTO OP' : x.pedido}</td><td class='n s'>${x.stock || ''}</td><td class='n e'>${x.entF}</td><td class='n'>${x.acum}</td><td class='n'>${x.conj ? '—' : x.falt}</td><td class='n${!x.conj && (x.exc ?? 0) > 0 ? ' x' : ''}'>${x.conj ? '—' : x.exc}</td><td class='k${x.estado ? ' s-' + x.estado : ''}'>${x.estado || ''}</td><td>${escapeHtml(Object.keys(x.ops).join(', '))}</td></tr>`;
        })
        .join('') +
      '</tbody></table>';

    const html = `<!DOCTYPE html><html lang='es'><head><meta charset='UTF-8'><title>Control de Entregas</title><style>@page{size:A4 landscape;margin:10mm}*{-webkit-print-color-adjust:exact;print-color-adjust:exact}body{font-family:Arial,sans-serif;font-size:10px;color:#111}h1{font-size:15px;margin:0 0 6px}h2{font-size:12px;margin:14px 0 4px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #888;padding:3px 5px;text-align:left}th{background:#F2A93B;text-align:center}.k{text-align:center}.n{text-align:right;font-weight:700;white-space:nowrap}.e{background:#E6F4EA}.p{background:#FDEBD0}.s{background:#E3F2FD}.x{background:#FADBD8;color:#C0392B}.s-COMPLETO{background:#38A169;color:#fff;font-weight:700}.s-ENPRODUCCION{background:#4299E1;color:#fff;font-weight:700}.s-INCOMPLETO{background:#E53E3E;color:#fff;font-weight:700}</style></head><body><h1>Control de Entregas</h1><h2>Entregas registradas por el habilitador</h2><table><thead><tr><th>Despacho</th><th>Registro</th><th>Turno</th><th>Habilitador</th><th>OP</th><th>SAP</th><th>Descripción</th><th>Cliente</th><th>Pedido</th><th>Entregado</th><th>Detalle</th><th>Estado</th></tr></thead><tbody>${filas}</tbody></table>${a + b}</body></html>`;

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

  const gSummary = agrupar(filtrados, registros, planesOp);
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
        <button className="btn-s" id="imp" type="button" onClick={handleImprimir}>
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
          id="limpiarFiltro"
          type="button"
          onClick={handleLimpiarFiltros}
        >
          Quitar filtros
        </button>
        <span id="cuenta">{filtrados.length} registro(s)</span>
      </div>

      {/* View 1: ENTRADAS LIST */}
      {vista === 'lista' && (
        <div id="lista">
          {!filtrados.length ? (
            <div className="empty">Sin registros.</div>
          ) : (
            filtrados.map((r) => {
              const est = estadoReg(r, registros, planesOp);
              const n =
                r.empaque === 'caja'
                  ? r.c === 1
                    ? 'caja'
                    : 'cajas'
                  : r.c === 1
                  ? 'paquete'
                  : 'paquetes';

              return (
                <div key={r.id} className="card">
                  <div className="top">
                    <div>
                      <span className="op mono">{r.op}</span>{' '}
                      <span style={{ fontSize: '0.72rem', color: 'var(--muted)' }}>
                        {r.cliente}
                      </span>
                    </div>
                    {est && <span className={`badge b-${est}`}>{est}</span>}
                  </div>
                  <div style={{ fontSize: '0.88rem', margin: '4px 0 2px' }}>
                    {r.descripcion}
                    {r.sap && (
                      <span
                        className="mono"
                        style={{ fontSize: '0.72rem', color: 'var(--muted)' }}
                      >
                        {' '}
                        SAP {r.sap}
                      </span>
                    )}
                  </div>
                  <div className="meta">
                    Despacho <strong>{fcorta(r.fdesp || r.fecha)}</strong> · Registro{' '}
                    {fcorta(r.fecha)} · {r.turno} · {r.nombre}
                    {r.sync ? ' · ☁️' : ' · ⏳'}
                  </div>
                  <div className="meta">
                    Pedido: <strong>{r.pedido || 0} u</strong>
                  </div>
                  {esStock(r) ? (
                    <div className="meta">
                      Stock inicial en almacén: <strong>{r.total} u</strong>
                    </div>
                  ) : (
                    <div className="meta">
                      Entregado:{' '}
                      {r.total ? (
                        <>
                          {r.c} {n} × {r.u} = <strong>{r.total} u</strong>
                        </>
                      ) : (
                        <strong>0 u</strong>
                      )}
                    </div>
                  )}

                  <div
                    style={{
                      display: 'flex',
                      gap: '8px',
                      marginTop: '8px',
                      alignItems: 'center',
                      justifyContent: 'flex-end',
                    }}
                  >
                    <button
                      className="del"
                      type="button"
                      onClick={() => handleBorrar(r)}
                    >
                      Borrar
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* View 2: RESUMEN POR OP / SAP */}
      {vista === 'resumen' && (
        <div id="lista">
          {!filtrados.length ? (
            <div className="empty">Sin registros.</div>
          ) : (
            <>
              <div className="sec" style={{ gridColumn: '1 / -1' }}>
                Por OP y despacho — {gSummary.ops.length} · {totEntregadasSummary} u entregadas
              </div>
              {gSummary.ops.map((o) => {
                const pd = o.pedido - o.acum;
                const ok = o.pedido > 0 && pd <= 0;
                return (
                  <div key={o.op + '|' + o.fdesp} className="card">
                    <div className="top">
                      <div>
                        <span className="op mono">{o.op}</span>{' '}
                        <span style={{ fontSize: '0.72rem', color: 'var(--muted)' }}>
                          {o.cliente}
                        </span>
                      </div>
                      {o.pedido > 0 && (
                        <span className={`badge ${ok ? 'b-COMPLETO' : 'b-INCOMPLETO'}`}>
                          {ok
                            ? `COMPLETO${pd < 0 ? ` (excede ${-pd})` : ''}`
                            : `INCOMPLETO · faltan ${pd}`}
                        </span>
                      )}
                    </div>
                    <div className="meta">
                      Despacho: <strong>{fcorta(o.fdesp)}</strong> · Pedido:{' '}
                      <strong>{o.pedido} u</strong>
                      {o.stock > 0 && (
                        <>
                          {' '}
                          · Stock inicial: <strong>{o.stock} u</strong>
                        </>
                      )}
                    </div>
                    <div className="meta">
                      Entregado en esta vista: <strong>{o.ent} u</strong> · Acumulado del despacho
                      {o.stock > 0 ? ' (con stock)' : ''}: <strong>{o.acum} u</strong> ·
                      Pendiente: <strong>{Math.max(pd, 0)} u</strong>
                      {pd < 0 && o.pedido > 0 && (
                        <>
                          {' '}
                          · Excedente:{' '}
                          <strong style={{ color: 'var(--red)' }}>{-pd} u</strong>
                        </>
                      )}
                    </div>
                    {Object.keys(o.lineas).map((k) => {
                      const L = o.lineas[k];
                      return (
                        <div key={k} className="meta">
                          · {L.sap ? <>SAP <span className="mono">{L.sap}</span> — </> : ''}
                          {L.desc}: <strong>{L.ent} u</strong>
                        </div>
                      );
                    })}
                  </div>
                );
              })}

              <div className="sec" style={{ gridColumn: '1 / -1', marginTop: '12px' }}>
                Por SAP y despacho (suma de las OP del mismo despacho)
              </div>
              {gSummary.saps.map((x) => (
                <div key={x.fdesp + '|' + x.sap} className="card">
                  <div className="top">
                    <div>
                      <span className="op mono">SAP {x.sap || '—'}</span>
                    </div>
                    <span className="badge">{x.ent} u</span>
                  </div>
                  <div style={{ fontSize: '0.88rem', margin: '4px 0 2px' }}>{x.desc}</div>
                  <div className="meta">
                    Despacho: <strong>{fcorta(x.fdesp)}</strong> · OP:{' '}
                    {Object.keys(x.ops).join(', ')}
                    {x.stock > 0 && (
                      <>
                        {' '}
                        · Stock inicial: <strong>{x.stock} u</strong>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
};
