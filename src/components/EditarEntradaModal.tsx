import React, { useState } from 'react';
import { Ingreso, Registro } from '../types';

interface EditarEntradaModalProps {
  tipo: 'registro' | 'ingreso';
  item: Registro | Ingreso;
  nombres: string[];
  onClose: () => void;
  onSave: (updated: any) => void;
}

export const EditarEntradaModal: React.FC<EditarEntradaModalProps> = ({
  tipo,
  item,
  nombres,
  onClose,
  onSave,
}) => {
  const isReg = tipo === 'registro';
  const regItem = item as Registro;

  const [fecha, setFecha] = useState(item.fecha || '');
  const [fdesp, setFdesp] = useState(isReg ? regItem.fdesp || item.fecha || '' : '');
  const [turno, setTurno] = useState(item.turno === 'Noche' ? 'Noche' : 'Día');
  const [nombre, setNombre] = useState(item.nombre || '');
  const [empaque, setEmpaque] = useState(item.empaque === 'paquete' ? 'paquete' : 'caja');
  const [u, setU] = useState(String(item.u || 0));
  const [c, setC] = useState(String(item.c || 0));
  const [pedido, setPedido] = useState(isReg ? String(regItem.pedido || 0) : '0');
  const [err, setErr] = useState('');

  const total = (parseInt(u, 10) || 0) * (parseInt(c, 10) || 0);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const uNum = parseInt(u, 10);
    const cNum = parseInt(c, 10);
    const pedNum = parseInt(pedido, 10);

    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
      setErr('Ingresa una fecha de registro válida');
      return;
    }
    if (isReg && !/^\d{4}-\d{2}-\d{2}$/.test(fdesp)) {
      setErr('Ingresa una fecha de despacho válida');
      return;
    }
    if (!nombre.trim()) {
      setErr('Selecciona el habilitador');
      return;
    }
    if (!Number.isInteger(uNum) || uNum <= 0 || !Number.isInteger(cNum) || cNum <= 0) {
      setErr('Unidades y cantidad deben ser enteros mayores a cero');
      return;
    }
    if (isReg && (!Number.isInteger(pedNum) || pedNum < 0)) {
      setErr('El pedido debe ser un entero mayor o igual a cero');
      return;
    }

    if (isReg) {
      onSave({
        ...regItem,
        fecha,
        fdesp,
        turno,
        nombre: nombre.trim(),
        empaque,
        u: uNum,
        c: cNum,
        total: uNum * cNum,
        pedido: pedNum,
        sync: false,
      });
    } else {
      onSave({
        ...item,
        fecha,
        turno,
        nombre: nombre.trim(),
        empaque,
        u: uNum,
        c: cNum,
        total: uNum * cNum,
        sync: false,
      });
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.5)',
        zIndex: 90,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '16px',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="panel"
        style={{
          width: '100%',
          maxWidth: '540px',
          margin: 0,
          maxHeight: '92vh',
          overflowY: 'auto',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: '8px',
            marginBottom: '10px',
          }}
        >
          <div className="sec" style={{ margin: 0 }}>
            Editar {isReg ? 'entrega' : 'ingreso'} · <span className="op">{item.op}</span>
          </div>
          <button
            type="button"
            className="btn-s"
            style={{ minHeight: '34px', padding: '4px 10px' }}
            onClick={onClose}
          >
            ✕
          </button>
        </div>

        <p className="info" style={{ margin: '0 0 12px', fontSize: '0.82rem' }}>
          {item.descripcion || 'Sin descripción'} · {item.cliente || 'Sin cliente'}
          {item.sap ? ` · SAP ${item.sap}` : ''}
        </p>

        <form onSubmit={handleSubmit}>
          <div className="row2">
            <div className="field">
              <label>{isReg ? 'Fecha registro' : 'Fecha ingreso'}</label>
              <input
                type="date"
                value={fecha}
                onChange={(e) => setFecha(e.target.value)}
              />
            </div>
            {isReg ? (
              <div className="field">
                <label>Fecha despacho</label>
                <input
                  type="date"
                  value={fdesp}
                  onChange={(e) => setFdesp(e.target.value)}
                />
              </div>
            ) : (
              <div className="field">
                <label>Turno</label>
                <select value={turno} onChange={(e) => setTurno(e.target.value)}>
                  <option value="Día">Día</option>
                  <option value="Noche">Noche</option>
                </select>
              </div>
            )}
          </div>

          <div className="row2">
            {isReg && (
              <div className="field">
                <label>Turno</label>
                <select value={turno} onChange={(e) => setTurno(e.target.value)}>
                  <option value="Día">Día</option>
                  <option value="Noche">Noche</option>
                </select>
              </div>
            )}
            <div className="field">
              <label>Habilitador</label>
              <select value={nombre} onChange={(e) => setNombre(e.target.value)}>
                <option value="">Selecciona…</option>
                {nombre && !nombres.includes(nombre) && (
                  <option value={nombre}>{nombre}</option>
                )}
                {nombres.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Empaque</label>
              <select value={empaque} onChange={(e) => setEmpaque(e.target.value)}>
                <option value="caja">Caja</option>
                <option value="paquete">Paquete</option>
              </select>
            </div>
          </div>

          <div className="row2">
            <div className="field">
              <label>Unid. x {empaque}</label>
              <input
                type="number"
                min="1"
                className="mono"
                value={u}
                onChange={(e) => setU(e.target.value)}
              />
            </div>
            <div className="field">
              <label>Cant. {empaque === 'caja' ? 'cajas' : 'paquetes'}</label>
              <input
                type="number"
                min="1"
                className="mono"
                value={c}
                onChange={(e) => setC(e.target.value)}
              />
            </div>
          </div>

          {isReg && (
            <div className="field">
              <label>Pedido de la OP (u)</label>
              <input
                type="number"
                min="0"
                className="mono"
                value={pedido}
                onChange={(e) => setPedido(e.target.value)}
              />
            </div>
          )}

          <div className="total">
            <span>Nuevo total</span>
            <b className="mono">{total} u</b>
          </div>

          {err && (
            <div
              style={{
                color: 'var(--err-tx)',
                fontSize: '0.84rem',
                fontWeight: 600,
                marginBottom: '10px',
              }}
            >
              {err}
            </div>
          )}

          <div className="tools" style={{ marginBottom: 0, justifyContent: 'flex-end' }}>
            <button type="button" className="btn-s" onClick={onClose}>
              Cancelar
            </button>
            <button
              type="submit"
              className="btn"
              style={{ width: 'auto', minWidth: '180px', minHeight: '42px', padding: '8px 18px' }}
            >
              Guardar cambios
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
