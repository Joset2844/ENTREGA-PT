import React, { useState } from 'react';
import { Candidate, ConfirmRow } from '../types';
import { fcorta } from '../utils/helpers';

interface ConfirmarListaModalProps {
  fd: string;
  tipo: 'OP' | 'SAP';
  initialRows: ConfirmRow[];
  onConfirm: (processed: {
    selectedRows: {
      candidates: Candidate[];
      pedido: number;
      stock: number;
      selectionMode: string;
      originalIdx: number;
    }[];
  }) => void;
  onCancel: () => void;
}

export const ConfirmarListaModal: React.FC<ConfirmarListaModalProps> = ({
  fd,
  tipo,
  initialRows,
  onConfirm,
  onCancel,
}) => {
  const [rows, setRows] = useState(
    initialRows.map((r) => ({
      ...r,
      checked: r.ok,
      pedidoStr: String(r.cant),
      stockStr: r.stock > 0 ? String(r.stock) : '',
      selectionMode: tipo === 'OP' ? 'all' : '0',
    }))
  );

  const tdStyle: React.CSSProperties = {
    padding: '6px',
    borderBottom: '1px solid var(--line,#333)',
    verticalAlign: 'top',
    fontSize: '0.78rem',
  };

  const getCandidateForDisplay = (row: (typeof rows)[0]): Candidate => {
    const sel = row.selectionMode;
    if (sel === 'sep') {
      return {
        op: row.cands[0]?.op || '',
        cliente: row.cands[0]?.cliente || '',
        sap: row.cands.map((x) => x.sap).filter(Boolean).join(' + '),
        desc: row.cands.map((x) => x.desc).join(' | '),
      };
    }
    if (sel === 'all' && row.cands.length > 1) {
      return {
        op: row.cands[0]?.op || '',
        cliente: row.cands[0]?.cliente || '',
        sap: row.cands.map((x) => x.sap).filter(Boolean).join(' + '),
        desc: row.cands.map((x) => x.desc).join(' + '),
      };
    }
    const idx = parseInt(sel, 10) || 0;
    return row.cands[idx] || { op: '', cliente: '', sap: '', desc: '' };
  };

  const handleAccept = () => {
    const processed = rows
      .map((r, originalIdx) => {
        if (!r.checked) return null;
        const q = parseInt(r.pedidoStr, 10) || 0;
        const sraw = r.stockStr.trim();
        const stock = sraw === '' ? 0 : parseInt(sraw, 10);

        let candidatesToUse: Candidate[] = [];
        if (r.selectionMode === 'sep') {
          candidatesToUse = [...r.cands];
        } else if (r.selectionMode === 'all' && r.cands.length > 1) {
          candidatesToUse = [
            {
              op: r.cands[0].op,
              cliente: r.cands[0].cliente,
              sap: r.cands.map((x) => x.sap).filter(Boolean).join(' + '),
              desc: r.cands.map((x) => x.desc).join(' + '),
            },
          ];
        } else {
          const idx = parseInt(r.selectionMode, 10) || 0;
          candidatesToUse = [r.cands[idx] || r.cands[0]];
        }

        return {
          candidates: candidatesToUse,
          pedido: q,
          stock: isNaN(stock) ? 0 : stock,
          selectionMode: r.selectionMode,
          originalIdx,
        };
      })
      .filter(Boolean) as any;

    onConfirm({ selectedRows: processed });
  };

  return (
    <div
      id="confLista"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,.6)',
        zIndex: 999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '12px',
      }}
    >
      <div
        className="card"
        style={{
          maxWidth: '900px',
          width: '100%',
          maxHeight: '90vh',
          overflow: 'auto',
          background: 'var(--panel)',
        }}
      >
        <div className="sec">
          Confirmar despacho {fcorta(fd)} · {rows.length} fila(s)
        </div>
        <div style={{ fontSize: '0.72rem', color: 'var(--muted)', marginBottom: '6px' }}>
          Al aceptar se crean las tarjetas con la cantidad pedida y se envían a Sheets. Stock
          inicial = lo que almacén ya tiene de esa OP: cuenta como cubierto y solo se completa la
          diferencia. Si tu Excel trae una tercera columna con el stock, ya viene cargado aquí y
          puedes corregirlo. Luego registras las entregas como siempre.
        </div>

        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={{ width: '32px' }}></th>
              <th style={{ textAlign: 'left' }}>OP</th>
              <th style={{ textAlign: 'left' }}>SAP</th>
              <th style={{ textAlign: 'left' }}>CLIENTE</th>
              <th style={{ textAlign: 'left' }}>DESCRIPCIÓN</th>
              <th style={{ textAlign: 'left' }}>PEDIDO</th>
              <th style={{ textAlign: 'left' }}>STOCK INICIAL</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const c = getCandidateForDisplay(r);
              return (
                <tr key={i} style={{ opacity: r.ok ? 1 : 0.7 }}>
                  <td style={tdStyle}>
                    <input
                      type="checkbox"
                      checked={r.checked}
                      onChange={(e) => {
                        const updated = [...rows];
                        updated[i].checked = e.target.checked;
                        setRows(updated);
                      }}
                    />
                  </td>
                  <td style={tdStyle}>
                    {r.cands.length > 1 && tipo === 'SAP' ? (
                      <select
                        value={r.selectionMode}
                        onChange={(e) => {
                          const updated = [...rows];
                          updated[i].selectionMode = e.target.value;
                          setRows(updated);
                        }}
                      >
                        {r.cands.map((x, j) => (
                          <option key={j} value={String(j)}>
                            {x.op}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span className="mono">{c.op || '—'}</span>
                    )}
                  </td>
                  <td style={tdStyle}>
                    {r.cands.length > 1 && tipo === 'OP' ? (
                      <select
                        value={r.selectionMode}
                        onChange={(e) => {
                          const updated = [...rows];
                          updated[i].selectionMode = e.target.value;
                          setRows(updated);
                        }}
                      >
                        <option value="all">Todos juntos ({r.cands.length})</option>
                        <option value="sep">Separados ({r.cands.length} tarjetas)</option>
                        {r.cands.map((x, j) => (
                          <option key={j} value={String(j)}>
                            Solo {x.sap || x.desc}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span className="mono">{c.sap || '—'}</span>
                    )}
                  </td>
                  <td style={tdStyle}>{c.cliente}</td>
                  <td style={tdStyle}>
                    {r.ok ? (
                      c.desc
                    ) : (
                      <span style={{ color: 'var(--red)' }}>
                        {r.key} no está en el catálogo
                      </span>
                    )}
                  </td>
                  <td style={tdStyle}>
                    <input
                      type="number"
                      value={r.pedidoStr}
                      onChange={(e) => {
                        const updated = [...rows];
                        updated[i].pedidoStr = e.target.value;
                        setRows(updated);
                      }}
                      style={{ width: '120px' }}
                    />
                  </td>
                  <td style={tdStyle}>
                    <input
                      type="number"
                      min="0"
                      placeholder="0"
                      value={r.stockStr}
                      onChange={(e) => {
                        const updated = [...rows];
                        updated[i].stockStr = e.target.value;
                        setRows(updated);
                      }}
                      style={{ width: '120px' }}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <div
          style={{
            display: 'flex',
            gap: '8px',
            justifyContent: 'flex-end',
            marginTop: '10px',
          }}
        >
          <button className="btn-s" type="button" onClick={onCancel}>
            Cancelar
          </button>
          <button
            className="btn-s"
            type="button"
            style={{ background: 'var(--acc, #F2A93B)', color: '#12161F' }}
            onClick={handleAccept}
          >
            Aceptar y enviar
          </button>
        </div>
      </div>
    </div>
  );
};
