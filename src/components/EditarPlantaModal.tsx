import React, { useState } from 'react';
import { fcorta } from '../utils/helpers';

interface EditarPlantaModalProps {
  op: string;
  fdesp: string;
  currentPlanta: number;
  currentEnProduccion: boolean;
  pedido?: number;
  entregado?: number;
  stock?: number;
  onSave: (data: { enProduccion: boolean; cantPlanta: number }) => void;
  onClose: () => void;
}

export const EditarPlantaModal: React.FC<EditarPlantaModalProps> = ({
  op,
  fdesp,
  currentPlanta,
  currentEnProduccion,
  pedido = 0,
  entregado = 0,
  stock = 0,
  onSave,
  onClose,
}) => {
  const [enProduccion, setEnProduccion] = useState<boolean>(Boolean(currentEnProduccion));
  const [plantaStr, setPlantaStr] = useState<string>(String(currentPlanta || 0));

  const almacenTotal = (entregado || 0) + (stock || 0);
  const faltanteDespacho = pedido > 0 ? Math.max(0, pedido - almacenTotal) : 0;
  const plantaNum = Math.max(0, parseInt(plantaStr.trim(), 10) || 0);
  const avanceTotal = almacenTotal + plantaNum;
  const faltanteNeto = pedido > 0 ? Math.max(0, pedido - avanceTotal) : 0;

  const handleConfirm = () => {
    const val = parseInt(plantaStr.trim(), 10);
    if (isNaN(val) || val < 0) {
      alert('Ingresa una cantidad entera válida (0 o mayor) para las unidades en planta');
      return;
    }
    onSave({
      enProduccion,
      cantPlanta: val,
    });
  };

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
          maxWidth: '480px',
          width: '100%',
          background: 'var(--panel)',
          boxShadow: '0 12px 36px rgba(0,0,0,0.3)',
          borderRadius: '16px',
          padding: '20px 22px',
        }}
      >
        <div className="sec" style={{ fontSize: '1.15rem', marginBottom: '4px' }}>
          Estado en Planta y Producción
        </div>
        <div style={{ fontSize: '0.86rem', color: 'var(--muted)', marginBottom: '14px' }}>
          OP <strong className="mono" style={{ color: 'var(--text)' }}>{op}</strong> · Despacho{' '}
          <strong>{fcorta(fdesp)}</strong>
          {pedido ? ` · Pedido: ${pedido} u` : ''}
        </div>

        {/* Resumen de avance */}
        <div
          style={{
            background: 'var(--alt)',
            borderRadius: '10px',
            padding: '10px 14px',
            marginBottom: '14px',
            fontSize: '0.82rem',
            lineHeight: 1.5,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: 'var(--muted2)' }}>Pedido:</span>
            <strong className="mono">{pedido ? `${pedido} u` : '—'}</strong>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: 'var(--muted2)' }}>En almacén (entregado + stock):</span>
            <strong className="mono">{almacenTotal} u</strong>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: 'var(--muted2)' }}>Faltante por entregar al despacho:</span>
            <strong className="mono" style={{ color: faltanteDespacho > 0 ? 'var(--amber-ink)' : 'var(--green)' }}>
              {faltanteDespacho} u
            </strong>
          </div>
        </div>

        {/* 1. Check: En producción */}
        <div
          style={{
            border: enProduccion ? '1px solid var(--blue)' : '1px solid var(--border)',
            background: enProduccion ? 'rgba(43, 107, 203, 0.08)' : 'var(--field)',
            borderRadius: '10px',
            padding: '12px 14px',
            marginBottom: '14px',
            cursor: 'pointer',
            transition: 'all 0.15s ease',
          }}
          onClick={() => setEnProduccion(!enProduccion)}
        >
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              cursor: 'pointer',
              fontWeight: 700,
              fontSize: '0.92rem',
              color: enProduccion ? 'var(--blue)' : 'var(--text)',
              margin: 0,
            }}
          >
            <input
              type="checkbox"
              checked={enProduccion}
              onChange={(e) => setEnProduccion(e.target.checked)}
              onClick={(e) => e.stopPropagation()}
              style={{
                width: '20px',
                height: '20px',
                minHeight: '20px',
                accentColor: 'var(--blue)',
                cursor: 'pointer',
                margin: 0,
              }}
            />
            <span>Esta OP se encuentra en producción</span>
          </label>
          <div style={{ fontSize: '0.76rem', color: 'var(--muted)', marginTop: '4px', marginLeft: '30px' }}>
            Al activar este check, la OP se reflejará con estado <strong>EN PRODUCCIÓN</strong> en los resúmenes y reportes.
          </div>
        </div>

        {/* 2. Cantidad en planta sin registrar */}
        <div className="field">
          <label htmlFor="inputPlantaEdit" style={{ fontWeight: 600 }}>
            Cantidad que queda en planta sin registrarse (unidades):
          </label>
          <input
            id="inputPlantaEdit"
            type="number"
            min="0"
            className="mono"
            style={{ fontSize: '1.15rem', fontWeight: 700 }}
            value={plantaStr}
            onChange={(e) => setPlantaStr(e.target.value)}
            placeholder="0"
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                handleConfirm();
              }
            }}
          />
          <div style={{ fontSize: '0.76rem', color: 'var(--muted)', marginTop: '4px' }}>
            Unidades físicas ya fabricadas o en línea que aún no se han remitido ni registrado en el despacho.
          </div>
        </div>

        {/* Botones de ajuste rápido */}
        <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap' }}>
          <button
            type="button"
            className="btn-s"
            style={{ padding: '4px 10px', fontSize: '0.75rem' }}
            onClick={() => setPlantaStr('0')}
          >
            0 (Ninguna)
          </button>
          <button
            type="button"
            className="btn-s"
            style={{ padding: '4px 10px', fontSize: '0.75rem' }}
            onClick={() => {
              const cur = parseInt(plantaStr, 10) || 0;
              setPlantaStr(String(cur + 50));
            }}
          >
            +50 u
          </button>
          <button
            type="button"
            className="btn-s"
            style={{ padding: '4px 10px', fontSize: '0.75rem' }}
            onClick={() => {
              const cur = parseInt(plantaStr, 10) || 0;
              setPlantaStr(String(cur + 100));
            }}
          >
            +100 u
          </button>
          {faltanteDespacho > 0 && (
            <button
              type="button"
              className="btn-s"
              style={{
                padding: '4px 10px',
                fontSize: '0.75rem',
                borderColor: 'var(--blue)',
                color: 'var(--blue)',
              }}
              onClick={() => setPlantaStr(String(faltanteDespacho))}
            >
              Cubrir faltante ({faltanteDespacho} u)
            </button>
          )}
        </div>

        {/* Resumen neto en tiempo real */}
        <div
          style={{
            background: 'var(--amber-soft)',
            borderRadius: '10px',
            padding: '10px 14px',
            marginBottom: '18px',
            fontSize: '0.84rem',
            color: 'var(--amber-ink)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <span>Avance real (Almacén + Planta):</span>
          <b className="mono" style={{ fontSize: '1.05rem' }}>
            {avanceTotal} u {pedido > 0 ? `(faltan netas: ${faltanteNeto} u)` : ''}
          </b>
        </div>

        <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
          <button className="btn-s" type="button" onClick={onClose}>
            Cancelar
          </button>
          <button
            className="btn-s"
            type="button"
            style={{
              background: 'var(--amber)',
              color: 'var(--on-amber)',
              fontWeight: 700,
            }}
            onClick={handleConfirm}
          >
            Guardar cambios
          </button>
        </div>
      </div>
    </div>
  );
};
