import React from 'react';
import { Registro } from '../types';
import { esStock, fcorta } from '../utils/helpers';

interface EntregasOpModalProps {
  op: string;
  fdesp: string;
  cliente: string;
  pedido: number;
  stock: number;
  entregas: Registro[];
  onDeleteRegistro: (registro: Registro) => void;
  onDeleteAllForOp?: () => void;
  onClose: () => void;
}

export const EntregasOpModal: React.FC<EntregasOpModalProps> = ({
  op,
  fdesp,
  cliente,
  pedido,
  stock,
  entregas,
  onDeleteRegistro,
  onDeleteAllForOp,
  onClose,
}) => {
  const entregasReales = entregas.filter((r) => !esStock(r));
  const totEntregado = entregasReales.reduce((acc, r) => acc + (r.total || 0), 0);

  return (
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
          maxWidth: '750px',
          width: '100%',
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--panel)',
          boxShadow: '0 12px 36px rgba(0,0,0,0.3)',
          borderRadius: '16px',
          padding: '20px 22px',
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            gap: '12px',
            marginBottom: '12px',
            borderBottom: '1px solid var(--border)',
            paddingBottom: '10px',
          }}
        >
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span className="mono" style={{ fontSize: '1.2rem', fontWeight: 800 }}>
                OP {op}
              </span>
              <span
                style={{
                  fontSize: '0.8rem',
                  background: 'var(--amber-soft)',
                  color: 'var(--amber-ink)',
                  padding: '2px 8px',
                  borderRadius: '6px',
                  fontWeight: 600,
                }}
              >
                Despacho: {fcorta(fdesp)}
              </span>
            </div>
            <div style={{ fontSize: '0.85rem', color: 'var(--muted)', marginTop: '2px' }}>
              Cliente: <strong>{cliente || '—'}</strong> · Pedido:{' '}
              <strong className="mono">{pedido || 0} u</strong>
              {stock > 0 && (
                <span>
                  {' '}
                  · Stock inicial: <strong className="mono">{stock} u</strong>
                </span>
              )}
            </div>
          </div>
          <button
            type="button"
            className="btn-s"
            onClick={onClose}
            style={{
              padding: '4px 10px',
              fontSize: '1rem',
              minHeight: '32px',
              fontWeight: 700,
            }}
            title="Cerrar ventana"
          >
            ✕
          </button>
        </div>

        {/* Resumen de entregas */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '12px',
            fontSize: '0.88rem',
            color: 'var(--muted2)',
          }}
        >
          <span>
            Total entregado acumulado:{' '}
            <strong className="mono" style={{ color: 'var(--text)', fontSize: '1rem' }}>
              {totEntregado} u
            </strong>{' '}
            ({entregasReales.length} entrada{entregasReales.length !== 1 ? 's' : ''})
          </span>

          {entregasReales.length > 1 && onDeleteAllForOp && (
            <button
              type="button"
              className="btn-s"
              onClick={onDeleteAllForOp}
              style={{
                color: 'var(--red)',
                borderColor: 'var(--red)',
                fontSize: '0.78rem',
                padding: '3px 8px',
                minHeight: '28px',
              }}
              title="Eliminar todas las entregas registradas para esta OP en este despacho"
            >
              🗑️ Borrar todas ({entregasReales.length})
            </button>
          )}
        </div>

        {/* List of deliveries */}
        <div style={{ overflowY: 'auto', flex: 1, marginBottom: '14px' }}>
          {entregasReales.length === 0 ? (
            <div
              className="empty"
              style={{
                textAlign: 'center',
                padding: '24px 12px',
                color: 'var(--muted)',
                background: 'var(--alt)',
                borderRadius: '8px',
              }}
            >
              No hay entregas registradas para esta OP en este despacho.
            </div>
          ) : (
            <div className="table-wrap">
              <table className="list-table" style={{ fontSize: '0.84rem' }}>
                <thead>
                  <tr>
                    <th className="k">#</th>
                    <th>Registro</th>
                    <th>Turno</th>
                    <th>Habilitador</th>
                    <th>SAP / Descripción</th>
                    <th>Empaque</th>
                    <th className="n">Total</th>
                    <th className="k">Sync</th>
                    <th style={{ textAlign: 'right' }}>Acción</th>
                  </tr>
                </thead>
                <tbody>
                  {entregasReales.map((r, idx) => {
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
                        <td className="k" style={{ color: 'var(--muted)', fontSize: '0.76rem' }}>
                          {idx + 1}
                        </td>
                        <td className="mono">{fcorta(r.fecha)}</td>
                        <td>{r.turno}</td>
                        <td>{r.nombre}</td>
                        <td>
                          <div>{r.descripcion || '—'}</div>
                          {r.sap && (
                            <div className="mono" style={{ fontSize: '0.74rem', color: 'var(--muted)' }}>
                              SAP {r.sap}
                            </div>
                          )}
                        </td>
                        <td style={{ color: 'var(--muted2)' }}>
                          {r.c} {n} × {r.u}
                        </td>
                        <td className="n mono" style={{ fontWeight: 700 }}>
                          {r.total || 0} u
                        </td>
                        <td className="k" title={r.sync ? 'Sincronizado' : 'Pendiente'}>
                          {r.sync ? '☁️' : '⏳'}
                        </td>
                        <td className="actions" style={{ textAlign: 'right' }}>
                          <button
                            type="button"
                            className="del-btn"
                            onClick={() => onDeleteRegistro(r)}
                            title="Eliminar esta entrega por error de ingreso"
                            style={{
                              padding: '3px 8px',
                              fontSize: '0.8rem',
                              background: '#FFF5F5',
                              color: '#C53030',
                              border: '1px solid #FEB2B2',
                              borderRadius: '6px',
                              cursor: 'pointer',
                              fontWeight: 600,
                            }}
                          >
                            🗑️ Borrar
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

        {/* Footer */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
          <button
            type="button"
            className="btn-s"
            onClick={onClose}
            style={{ minHeight: '38px', padding: '0 18px', fontWeight: 600 }}
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
};
