import React, { useState } from 'react';
import {
  CatalogoOp,
  Ingreso,
  OpExtra,
  PlanDespacho,
  PlanOp,
  Registro,
} from '../types';
import {
  agruparReporte,
  consolidarOpsPorSap,
  esStock,
  fcorta,
  hoy,
  recalcularEstados,
} from '../utils/helpers';
import { EditarPlantaModal } from './EditarPlantaModal';

interface TableroTabProps {
  fdesp: string;
  onFdespChange: (fd: string) => void;
  registros: Registro[];
  onRegistrosChange: (newRegs: Registro[], toSend?: Registro[]) => void;
  ingresos: Ingreso[];
  catalogo: CatalogoOp[];
  planes: Record<string, PlanDespacho>;
  planesOp: Record<string, PlanOp>;
  opExtra: Record<string, OpExtra>;
  onUpdateOpExtra: (op: string, fdesp: string, changes: Partial<OpExtra>) => void;
  onIrARegistrar: (op?: string, targetFdesp?: string) => void;
  onIrAIngresos: () => void;
  onToast: (t: 'ok' | 'error', m: string) => void;
}

function offsetDate(iso: string, delta: number): string {
  const base = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(`${iso}T12:00:00`) : new Date();
  base.setDate(base.getDate() + delta);
  return `${base.getFullYear()}-${String(base.getMonth() + 1).padStart(2, '0')}-${String(
    base.getDate()
  ).padStart(2, '0')}`;
}

export const TableroTab: React.FC<TableroTabProps> = ({
  fdesp,
  onFdespChange,
  registros,
  onRegistrosChange,
  ingresos,
  planes,
  planesOp,
  opExtra,
  onUpdateOpExtra,
  onIrARegistrar,
  onIrAIngresos,
  onToast,
}) => {
  const [filtroEstado, setFiltroEstado] = useState<'pend' | 'all' | 'done'>('pend');
  const [busqueda, setBusqueda] = useState('');
  const [plantaModal, setPlantaModal] = useState<{
    op: string;
    fdesp: string;
    currentPlanta: number;
    currentEnProduccion: boolean;
    pedido?: number;
    entregado?: number;
    stock?: number;
  } | null>(null);

  const fechaHoy = hoy();
  const fechaManana = offsetDate(fechaHoy, 1);
  const fechaAyer = offsetDate(fechaHoy, -1);

  const regDespacho = registros.filter(
    (r) => (r.fdesp || r.fecha || '').trim() === fdesp.trim()
  );
  const reporte = agruparReporte(regDespacho, registros, fdesp, planesOp, opExtra, planes);
  const opsConsolidadas = consolidarOpsPorSap(reporte.ops, planes);

  const totalPedido = opsConsolidadas.reduce((acc, o) => acc + (o.pedido || 0), 0);
  const totalAcumulado = opsConsolidadas.reduce((acc, o) => acc + (o.acum || 0), 0);
  const totalEntregado = opsConsolidadas.reduce((acc, o) => acc + (o.ent || 0), 0);
  const totalStock = opsConsolidadas.reduce((acc, o) => acc + (o.stock || 0), 0);
  const totalFaltante = opsConsolidadas.reduce((acc, o) => acc + (o.falt || 0), 0);
  const avancePct =
    totalPedido > 0 ? Math.min(100, Math.round((totalAcumulado / totalPedido) * 100)) : 0;

  const completas = opsConsolidadas.filter((o) => o.estado === 'COMPLETO').length;
  const enProduccionCount = opsConsolidadas.filter((o) => o.enProduccion).length;
  const pendientesCount = opsConsolidadas.filter(
    (o) => o.estado !== 'COMPLETO'
  ).length;

  const totalPlanta = opsConsolidadas.reduce((acc, o) => acc + (o.cantPlanta || 0), 0);
  const opsConPlanta = opsConsolidadas.filter((o) => (o.cantPlanta || 0) > 0).length;

  const ingresosHoy = ingresos.filter((x) => x.fecha === fechaHoy);
  const ingresosHoyTotal = ingresosHoy.reduce((acc, x) => acc + (x.total || 0), 0);

  const q = busqueda.trim().toLowerCase();
  const opsFiltradas = opsConsolidadas
    .filter((o) => {
      if (filtroEstado === 'pend' && o.estado === 'COMPLETO') return false;
      if (filtroEstado === 'done' && o.estado !== 'COMPLETO') return false;
      if (
        q &&
        `${o.op} ${o.sap} ${o.cliente} ${o.desc}`.toLowerCase().indexOf(q) === -1
      ) {
        return false;
      }
      return true;
    })
    .slice()
    .sort((a, b) => {
      // Pending / in-production first, then lowest completion %
      const rank = (s: string, ep: boolean) =>
        ep ? 0 : s === 'INCOMPLETO' ? 1 : s === '' ? 2 : 3;
      const ra = rank(a.estado, a.enProduccion);
      const rb = rank(b.estado, b.enProduccion);
      if (ra !== rb) return ra - rb;
      const pa = a.pedido > 0 ? a.acum / a.pedido : 1;
      const pb = b.pedido > 0 ? b.acum / b.pedido : 1;
      return pa - pb;
    });

  const actividadReciente = [
    ...registros
      .filter((r) => !esStock(r) && (r.total || 0) > 0)
      .map((r) => ({
        id: `reg_${r.id}`,
        tipo: 'Entrega' as const,
        op: r.op,
        sap: r.sap,
        cliente: r.cliente,
        nombre: r.nombre,
        turno: r.turno,
        fecha: r.fecha,
        fdesp: r.fdesp,
        total: r.total,
        creado: r.creado,
        sync: r.sync,
      })),
    ...ingresos.map((r) => ({
      id: `ing_${r.id}`,
      tipo: 'Ingreso' as const,
      op: r.op,
      sap: r.sap,
      cliente: r.cliente,
      nombre: r.nombre,
      turno: r.turno,
      fecha: r.fecha,
      fdesp: '',
      total: r.total,
      creado: r.creado,
      sync: r.sync,
    })),
  ]
    .sort((a, b) => String(b.creado).localeCompare(String(a.creado)))
    .slice(0, 10);

  const handleToggleProd = (op: string, fd: string, val: boolean) => {
    onUpdateOpExtra(op, fd, { enProduccion: val });
    const k = `${op.trim().toLowerCase()}|${fd}`;
    const nextExtra = {
      ...opExtra,
      [k]: { ...(opExtra[k] || {}), enProduccion: val },
    };
    const camb = recalcularEstados(op, fd, registros, planesOp, nextExtra);
    if (camb.length > 0) {
      onRegistrosChange(registros, camb);
    }
    onToast('ok', `${op}: ${val ? 'En producción' : 'Sin producción activa'}`);
  };

  const handleSavePlanta = (data: { enProduccion: boolean; cantPlanta: number }) => {
    if (!plantaModal) return;
    const { op, fdesp: modalFd } = plantaModal;
    onUpdateOpExtra(op, modalFd, data);
    const k = `${op.trim().toLowerCase()}|${modalFd}`;
    const nextExtra = {
      ...opExtra,
      [k]: { ...(opExtra[k] || {}), ...data },
    };
    const camb = recalcularEstados(op, modalFd, registros, planesOp, nextExtra);
    if (camb.length > 0) {
      onRegistrosChange(registros, camb);
    }
    setPlantaModal(null);
    onToast('ok', `Saldo en planta actualizado para OP ${op}`);
  };

  return (
    <div id="t-dash">
      {/* Operational Header Strip */}
      <div className="panel dash-toolbar">
        <div>
          <div className="sec" style={{ marginBottom: '2px' }}>
            Tablero operativo de despacho · {fcorta(fdesp)}
          </div>
          <div className="info" style={{ fontSize: '0.82rem' }}>
            Resumen en vivo de entregas, stock inicial, saldo en planta e ingresos a almacén.
          </div>
        </div>

        <div className="dash-date-actions">
          <div className="quick-dates">
            <button
              type="button"
              className={`btn-s ${fdesp === fechaAyer ? 'btn-s-active' : ''}`}
              onClick={() => onFdespChange(fechaAyer)}
            >
              Ayer
            </button>
            <button
              type="button"
              className={`btn-s ${fdesp === fechaHoy ? 'btn-s-active' : ''}`}
              onClick={() => onFdespChange(fechaHoy)}
            >
              Hoy
            </button>
            <button
              type="button"
              className={`btn-s ${fdesp === fechaManana ? 'btn-s-active' : ''}`}
              onClick={() => onFdespChange(fechaManana)}
            >
              Mañana
            </button>
          </div>
          <input
            type="date"
            value={fdesp}
            onChange={(e) => onFdespChange(e.target.value)}
            style={{ width: 'auto', minWidth: '155px', minHeight: '40px' }}
          />
          <button
            type="button"
            className="btn"
            style={{ width: 'auto', minHeight: '40px', padding: '8px 16px', fontSize: '0.88rem' }}
            onClick={() => onIrARegistrar(undefined, fdesp)}
          >
            + Registrar entrega
          </button>
        </div>
      </div>

      {/* 4 KPI Cards */}
      <div className="kpi-grid">
        <div className="panel kpi-card">
          <div className="kpi-label">Avance del despacho</div>
          <div className="kpi-value mono">
            {totalAcumulado.toLocaleString('es-PE')}
            <span className="kpi-sub"> / {totalPedido.toLocaleString('es-PE')} u</span>
          </div>
          <div className="kpi-bar">
            <div className="kpi-bar-fill" style={{ width: `${avancePct}%` }} />
          </div>
          <div className="kpi-meta mono">
            {avancePct}% · Entregado {totalEntregado.toLocaleString('es-PE')} u · Stock {totalStock.toLocaleString('es-PE')} u
          </div>
        </div>

        <div className="panel kpi-card">
          <div className="kpi-label">Órdenes del despacho</div>
          <div className="kpi-value mono">
            {completas}
            <span className="kpi-sub"> / {opsConsolidadas.length} completas</span>
          </div>
          <div className="kpi-meta">
            Pendientes: <b>{pendientesCount}</b> · En producción: <b>{enProduccionCount}</b> · Faltante: <b className="mono">{totalFaltante.toLocaleString('es-PE')} u</b>
          </div>
        </div>

        <div className="panel kpi-card">
          <div className="kpi-label">Saldo en planta (sin reg.)</div>
          <div className="kpi-value mono">
            {totalPlanta.toLocaleString('es-PE')}
            <span className="kpi-sub"> u</span>
          </div>
          <div className="kpi-meta">
            Distribuidas en <b>{opsConPlanta}</b> OP(s) con producción o saldo pendiente en máquina
          </div>
        </div>

        <div className="panel kpi-card">
          <div className="kpi-label">Ingresos almacén hoy</div>
          <div className="kpi-value mono">
            {ingresosHoyTotal.toLocaleString('es-PE')}
            <span className="kpi-sub"> u</span>
          </div>
          <div className="kpi-meta" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
            <span>{ingresosHoy.length} movimiento(s) hoy</span>
            <button
              type="button"
              className="link-btn"
              onClick={onIrAIngresos}
            >
              Ir a ingresos →
            </button>
          </div>
        </div>
      </div>

      {/* Main Split: Operational Queue + Activity Feed */}
      <div className="dash-split">
        <div className="panel" style={{ marginBottom: 0 }}>
          <div className="dash-queue-head">
            <div className="sec" style={{ margin: 0 }}>
              Prioridades de despacho ({opsFiltradas.length})
            </div>
            <div className="dash-queue-controls">
              <div className="chips seg" style={{ margin: 0 }}>
                <button
                  type="button"
                  className={`chip ${filtroEstado === 'pend' ? 'active' : ''}`}
                  onClick={() => setFiltroEstado('pend')}
                >
                  Pendientes ({pendientesCount})
                </button>
                <button
                  type="button"
                  className={`chip ${filtroEstado === 'done' ? 'active' : ''}`}
                  onClick={() => setFiltroEstado('done')}
                >
                  Completas ({completas})
                </button>
                <button
                  type="button"
                  className={`chip ${filtroEstado === 'all' ? 'active' : ''}`}
                  onClick={() => setFiltroEstado('all')}
                >
                  Todas
                </button>
              </div>
              <input
                type="text"
                placeholder="Buscar OP, SAP, cliente..."
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
                style={{ minHeight: '38px', maxWidth: '240px', fontSize: '0.88rem' }}
              />
            </div>
          </div>

          {!opsFiltradas.length ? (
            <div className="empty" style={{ marginTop: '12px' }}>
              {opsConsolidadas.length === 0
                ? `No hay OPs programadas ni entregas registradas para el ${fcorta(fdesp)}.`
                : 'No hay OPs que coincidan con el filtro seleccionado.'}
            </div>
          ) : (
            <div className="dash-op-list">
              {opsFiltradas.map((o) => {
                const pct =
                  o.pedido > 0
                    ? Math.min(100, Math.round((o.acum / o.pedido) * 100))
                    : 0;
                const primaryMember = o.opsMiembros[0];
                const isDone = o.estado === 'COMPLETO';

                return (
                  <div key={o.key} className="dash-op-row">
                    <div className="dash-op-main">
                      <div className="dash-op-top">
                        <span className="op">{o.op}</span>
                        {o.estado && (
                          <span className={`badge b-${o.estado.replace(/\s+/g, '')}`}>
                            {o.estado === 'EN PRODUCCION' ? 'EN PRODUCCIÓN' : o.estado}
                          </span>
                        )}
                        {o.esGrupoSap && (
                          <span className="info" style={{ fontSize: '0.76rem', fontWeight: 700, color: 'var(--blue)' }}>
                            {o.opsMiembros.length} OPs · mismo SAP
                          </span>
                        )}
                      </div>
                      <div className="dash-op-desc">
                        {o.cliente || 'Sin cliente'}
                        {o.sap ? ` · SAP ${o.sap}` : ''}
                        {o.desc ? ` · ${o.desc}` : ''}
                      </div>
                      <div className="dash-op-progress-wrap">
                        <div className="kpi-bar" style={{ margin: 0, flex: 1 }}>
                          <div
                            className="kpi-bar-fill"
                            style={{
                              width: `${pct}%`,
                              background: isDone ? 'var(--green)' : o.enProduccion ? 'var(--blue)' : 'var(--amber)',
                            }}
                          />
                        </div>
                        <span className="mono" style={{ fontSize: '0.8rem', fontWeight: 700 }}>
                          {o.acum.toLocaleString('es-PE')}/{o.pedido.toLocaleString('es-PE')} u ({pct}%)
                        </span>
                      </div>
                      <div className="info" style={{ fontSize: '0.78rem', marginTop: '3px' }}>
                        Entregado: <strong className="mono">{o.ent} u</strong>
                        {o.stock > 0 ? ` · Stock: ${o.stock} u` : ''}
                        {o.falt > 0 ? ` · Faltante: ${o.falt} u` : ''}
                        {o.cantPlanta > 0 ? ` · En planta: ${o.cantPlanta} u` : ''}
                      </div>
                    </div>

                    <div className="dash-op-actions">
                      <label className="dash-check" title="Marcar OP en producción">
                        <input
                          type="checkbox"
                          checked={o.enProduccion}
                          onChange={(e) =>
                            handleToggleProd(primaryMember.op, primaryMember.fdesp, e.target.checked)
                          }
                        />
                        <span>En prod.</span>
                      </label>
                      <button
                        type="button"
                        className="btn-s"
                        style={{ minHeight: '34px', padding: '4px 10px', fontSize: '0.8rem' }}
                        onClick={() =>
                          setPlantaModal({
                            op: primaryMember.op,
                            fdesp: primaryMember.fdesp,
                            currentPlanta: primaryMember.cantPlanta,
                            currentEnProduccion: primaryMember.enProduccion,
                            pedido: o.pedido,
                            entregado: o.ent,
                            stock: o.stock,
                          })
                        }
                      >
                        Planta ({o.cantPlanta})
                      </button>
                      <button
                        type="button"
                        className="btn"
                        style={{
                          width: 'auto',
                          minHeight: '34px',
                          padding: '4px 12px',
                          fontSize: '0.82rem',
                          borderRadius: '8px',
                        }}
                        onClick={() => onIrARegistrar(primaryMember.op, fdesp)}
                      >
                        + Registrar
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Team Activity Feed */}
        <div className="panel" style={{ marginBottom: 0 }}>
          <div className="sec">Actividad reciente del equipo</div>
          {!actividadReciente.length ? (
            <div className="empty">Aún no hay movimientos registrados.</div>
          ) : (
            <div className="dash-feed">
              {actividadReciente.map((a) => {
                const hora = a.creado
                  ? new Date(a.creado).toLocaleTimeString('es-PE', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })
                  : '';
                return (
                  <div key={a.id} className="dash-feed-item">
                    <div className="dash-feed-top">
                      <span className="op">{a.op}</span>
                      <span className="mono" style={{ fontWeight: 700, fontSize: '0.9rem' }}>
                        +{a.total.toLocaleString('es-PE')} u
                      </span>
                    </div>
                    <div className="info" style={{ fontSize: '0.8rem', marginTop: '4px' }}>
                      <strong>{a.tipo}</strong> · {a.nombre || 'Sin nombre'} · {a.turno} · {fcorta(a.fecha)}
                      {hora ? ` · ${hora}` : ''}
                      {a.sync === false ? ' · Pendiente subir' : ''}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {plantaModal && (
        <EditarPlantaModal
          op={plantaModal.op}
          fdesp={plantaModal.fdesp}
          currentPlanta={plantaModal.currentPlanta}
          currentEnProduccion={plantaModal.currentEnProduccion}
          pedido={plantaModal.pedido}
          entregado={plantaModal.entregado}
          stock={plantaModal.stock}
          onClose={() => setPlantaModal(null)}
          onSave={handleSavePlanta}
        />
      )}
    </div>
  );
};
