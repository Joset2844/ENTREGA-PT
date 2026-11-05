import React, { useState } from 'react';
import { fcorta } from '../utils/helpers';

interface EditarStockModalProps {
  op: string;
  fdesp: string;
  currentStock: number;
  pedido?: number;
  onSave: (newStock: number) => void;
  onClose: () => void;
}

export const EditarStockModal: React.FC<EditarStockModalProps> = ({
  op,
  fdesp,
  currentStock,
  pedido,
  onSave,
  onClose,
}) => {
  const [stockStr, setStockStr] = useState(String(currentStock || 0));

  const handleConfirm = () => {
    const val = parseInt(stockStr.trim(), 10);
    if (isNaN(val) || val < 0) {
      alert('Ingresa una cantidad entera válida (0 o mayor)');
      return;
    }
    onSave(val);
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
          maxWidth: '460px',
          width: '100%',
          background: 'var(--panel)',
          boxShadow: '0 12px 36px rgba(0,0,0,0.3)',
          borderRadius: '16px',
          padding: '20px 22px',
        }}
      >
        <div className="sec" style={{ fontSize: '1.15rem', marginBottom: '4px' }}>
          Editar Stock Inicial en Almacén
        </div>
        <div style={{ fontSize: '0.86rem', color: 'var(--muted)', marginBottom: '14px' }}>
          OP <strong className="mono" style={{ color: 'var(--text)' }}>{op}</strong> · Despacho{' '}
          <strong>{fcorta(fdesp)}</strong>
          {pedido ? ` · Pedido total: ${pedido} u` : ''}
        </div>

        <p className="info" style={{ fontSize: '0.82rem', margin: '0 0 14px', lineHeight: 1.4 }}>
          El stock inicial es la cantidad física que ya se encuentra en almacén para esta OP. Se
          suma a las entregas registradas para calcular si el pedido está completo. Si el valor
          inicial estaba errado o no se había registrado, cámbialo aquí:
        </p>

        <div className="field">
          <label htmlFor="inputStockEdit">Stock inicial en almacén (unidades):</label>
          <input
            id="inputStockEdit"
            type="number"
            min="0"
            className="mono"
            style={{ fontSize: '1.15rem', fontWeight: 700 }}
            value={stockStr}
            onChange={(e) => setStockStr(e.target.value)}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                handleConfirm();
              }
            }}
          />
        </div>

        <div style={{ display: 'flex', gap: '8px', marginBottom: '18px', flexWrap: 'wrap' }}>
          <button
            type="button"
            className="btn-s"
            style={{ padding: '4px 10px', fontSize: '0.75rem' }}
            onClick={() => setStockStr('0')}
          >
            0 (Sin stock)
          </button>
          <button
            type="button"
            className="btn-s"
            style={{ padding: '4px 10px', fontSize: '0.75rem' }}
            onClick={() => {
              const cur = parseInt(stockStr, 10) || 0;
              setStockStr(String(cur + 50));
            }}
          >
            +50 u
          </button>
          <button
            type="button"
            className="btn-s"
            style={{ padding: '4px 10px', fontSize: '0.75rem' }}
            onClick={() => {
              const cur = parseInt(stockStr, 10) || 0;
              setStockStr(String(cur + 100));
            }}
          >
            +100 u
          </button>
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
            Guardar stock
          </button>
        </div>
      </div>
    </div>
  );
};
