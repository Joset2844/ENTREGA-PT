import React, { useState, useEffect, useRef } from 'react';
import * as XLSX from 'xlsx';
import {
  CatalogoOp,
  GridRow,
  PlanDespacho,
  PlanOp,
  Registro,
  ConfirmRow,
  Candidate,
} from '../types';
import {
  acumulado,
  avisoCant,
  avisoFecha,
  confirmarAvisos,
  esEntero,
  esStock,
  fcorta,
  LIM,
  pedidoDe,
  pedidoPlanOp,
  pedidoPlanSap,
  recalcularEstados,
  stockDe,
  ultimoPedido,
  agrupar,
} from '../utils/helpers';
import {
  archivoOk,
  colStock,
  hayTercera,
  opsDeSap,
  buscarSap,
  valStock,
} from '../services/excel';
import { ConfirmarListaModal } from './ConfirmarListaModal';
import { EditarStockModal } from './EditarStockModal';
import { K_GRID, ld, sv } from '../services/storage';

interface RegistrarTabProps {
  fdesp: string;
  onFdespChange: (val: string) => void;
  fecha: string;
  nombre: string;
  turno: string;
  registros: Registro[];
  onRegistrosChange: (newRegs: Registro[], toSend?: Registro[]) => void;
  catalogo: CatalogoOp[];
  planes: Record<string, PlanDespacho>;
  planesOp: Record<string, PlanOp>;
  onPlanesChange: (p: Record<string, PlanDespacho>) => void;
  onPlanesOpChange: (p: Record<string, PlanOp>) => void;
  modoReg: 'tabla' | 'form';
  onModoRegChange: (m: 'tabla' | 'form') => void;
  onToast: (t: 'ok' | 'error', m: string) => void;
}

export const RegistrarTab: React.FC<RegistrarTabProps> = ({
  fdesp,
  onFdespChange,
  fecha,
  nombre,
  turno,
  registros,
  onRegistrosChange,
  catalogo,
  planes,
  planesOp,
  onPlanesChange,
  onPlanesOpChange,
  modoReg,
  onModoRegChange,
  onToast,
}) => {
  // Form State
  const [formOp, setFormOp] = useState('');
  const [formDesc, setFormDesc] = useState('');
  const [formSap, setFormSap] = useState('');
  const [formCliente, setFormCliente] = useState('');
  const [formPedido, setFormPedido] = useState('');
  const [formEmp, setFormEmp] = useState('caja');
  const [formU, setFormU] = useState('');
  const [formC, setFormC] = useState('');
  const [formModeloSel, setFormModeloSel] = useState<number>(-1);
  const [showSug, setShowSug] = useState(false);
  const [opAplicada, setOpAplicada] = useState('');
  const [opPedidoVista, setOpPedidoVista] = useState('');

  // Grid State
  const [grid, setGrid] = useState<GridRow[]>(() => {
    const saved = ld<GridRow[]>(K_GRID + (fdesp || 'x'), []);
    return saved.length ? saved : [{ op: '', mod: 'all', pedido: '', emp: 'caja', u: '', c: '' }];
  });
  const [gridSavePending, setGridSavePending] = useState(false);

  // File Inputs
  const planFileInputRef = useRef<HTMLInputElement>(null);
  const planOpFileInputRef = useRef<HTMLInputElement>(null);

  const [confirmModalData, setConfirmModalData] = useState<{
    fd: string;
    tipo: 'OP' | 'SAP';
    rows: ConfirmRow[];
  } | null>(null);

  const [stockEditModal, setStockEditModal] = useState<{
    op: string;
    fdesp: string;
    currentStock: number;
    pedido?: number;
  } | null>(null);

  const handleGuardarStockEdit = (newStock: number) => {
    if (!stockEditModal) return;
    const { op, fdesp: modalFd, pedido } = stockEditModal;
    const q = op.toLowerCase();

    let updatedRegs = [...registros];
    const envio: Registro[] = [];

    const stockRec = updatedRegs.find(
      (x) => esStock(x) && x.op.toLowerCase() === q && (x.fdesp || '') === modalFd
    );

    if (stockRec) {
      stockRec.u = newStock;
      stockRec.total = newStock;
      stockRec.c = 1;
      stockRec.sync = false;
      envio.push(stockRec);
    } else if (newStock > 0) {
      const ref = updatedRegs.find(
        (x) => x.op.toLowerCase() === q && (x.fdesp || '') === modalFd
      );
      const newRec: Registro = {
        id: Date.now() + '-' + Math.random().toString(36).slice(2, 6),
        fecha: ref?.fecha || fecha,
        fdesp: modalFd,
        turno: ref?.turno || turno,
        nombre: ref?.nombre || nombre || 'Almacén',
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

    const camb = recalcularEstados(op, modalFd, updatedRegs, planesOp);
    camb.forEach((x) => {
      if (envio.indexOf(x) < 0) envio.push(x);
    });

    onRegistrosChange(updatedRegs, envio);
    setStockEditModal(null);
    onToast('ok', `Stock inicial de ${op} actualizado a ${newStock} u`);
  };

  // Load grid draft on fdesp change
  useEffect(() => {
    const saved = ld<GridRow[]>(K_GRID + (fdesp || 'x'), []);
    if (saved.length) {
      setGrid([...saved, { op: '', mod: 'all', pedido: '', emp: 'caja', u: '', c: '' }]);
    } else {
      setGrid([{ op: '', mod: 'all', pedido: '', emp: 'caja', u: '', c: '' }]);
    }
  }, [fdesp]);

  // Save grid draft
  const saveGridDraft = (newGrid: GridRow[]) => {
    const clean = newGrid.filter((r) => r.op || r.u || r.c);
    sv(K_GRID + (fdesp || 'x'), clean);
  };

  // Autocomplete catalog helper
  const buscarCatalogo = (op: string) => {
    const q = (op || '').trim().toLowerCase();
    if (!q) return null;
    return catalogo.find((c) => c.op.toLowerCase() === q) || null;
  };

  // Sync Pedido on OP change in form
  useEffect(() => {
    const op = formOp.trim().toLowerCase();
    if (!op || op === opPedidoVista) return;
    setOpPedidoVista(op);
    const p = pedidoDe(op, fdesp, registros, catalogo, planesOp, planes);
    if (p) setFormPedido(String(p));
  }, [formOp, fdesp, registros, catalogo, planesOp, planes, opPedidoVista]);

  // Handle OP selection in Form
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

    const ped =
      pedidoPlanOp(m.op, fdesp, planesOp) ||
      ultimoPedido(m.op, fdesp, registros) ||
      m.cantidadTotal ||
      0;
    if (ped) setFormPedido(String(ped));
  };

  const handleSelectModeloForm = (idx: number, m: CatalogoOp) => {
    setFormModeloSel(idx);
    if (idx === -2) {
      // Todos juntos
      setFormDesc(m.modelos.map((x) => x.descripcion).join(' + '));
      setFormSap(m.modelos.map((x) => x.sap || '').filter(Boolean).join(' + '));
    } else if (idx >= 0 && m.modelos[idx]) {
      setFormDesc(m.modelos[idx].descripcion);
      setFormSap(m.modelos[idx].sap || '');
      // Check if SAP has special quantity in plan
      const sapPlanQ = pedidoPlanSap(m.modelos[idx].sap, fdesp, planes);
      if (sapPlanQ && !pedidoPlanOp(m.op, fdesp, planesOp)) {
        setFormPedido(String(sapPlanQ));
      }
    }
  };

  // Form total calculation
  const formTotalCalc = (parseInt(formU, 10) || 0) * (parseInt(formC, 10) || 0);

  // Form submit
  const handleGuardarForm = () => {
    if (!fdesp) {
      onToast('error', 'Pon la fecha de despacho');
      return;
    }
    if (!fecha) {
      onToast('error', 'Pon la fecha de registro');
      return;
    }
    if (!nombre) {
      onToast('error', 'Selecciona el habilitador');
      return;
    }
    if (!formOp.trim()) {
      onToast('error', 'Ingresa la OP');
      return;
    }
    const mAct = buscarCatalogo(formOp);
    if (mAct && mAct.modelos.length > 1 && formModeloSel === -1) {
      onToast('error', 'Elige el modelo de la OP');
      return;
    }
    const pedNum = parseInt(formPedido, 10) || 0;
    if (!(pedNum > 0)) {
      onToast('error', 'Ingresa la cantidad pedida de la OP');
      return;
    }
    if (!(formTotalCalc > 0)) {
      onToast('error', 'Ingresa unidades y cantidad entregada');
      return;
    }
    if (!esEntero(formPedido) || !esEntero(formU) || !esEntero(formC)) {
      onToast('error', 'Pedido, unidades y cantidad deben ser números enteros (sin decimales ni negativos)');
      return;
    }

    // Warnings
    const w: string[] = [];
    w.push(avisoFecha(fecha, 'registro'), avisoFecha(fdesp, 'despacho'));
    avisoCant(parseInt(formU, 10) || 0, parseInt(formC, 10) || 0).forEach((a) => w.push(a));
    if (!mAct) {
      w.push(
        `La OP ${formOp.trim()} no está en el catálogo de OP${!formDesc && !formCliente ? ' y se guardará sin descripción ni cliente' : ''}`
      );
    } else {
      if (!formDesc) w.push('La descripción está vacía');
      if (!formCliente) w.push('El cliente está vacío');
    }
    if (pedNum > LIM.pedido) w.push(`Pedido muy alto (${pedNum})`);
    if (pedNum > 0) {
      const ac = acumulado(formOp.trim(), fdesp, registros);
      if (ac + formTotalCalc > pedNum) {
        w.push(`Se excede el pedido en ${ac + formTotalCalc - pedNum} u (pedido ${pedNum}, entregado + stock ${ac})`);
      }
      const prev = ultimoPedido(formOp.trim(), fdesp, registros);
      if (prev > 0 && prev !== pedNum) {
        w.push(`El pedido de ${formOp.trim()} cambia de ${prev} a ${pedNum} en todas sus entradas de ese despacho`);
      }
    }
    const isDup = registros.some(
      (r) =>
        r.op.toLowerCase() === formOp.trim().toLowerCase() &&
        (r.fdesp || '') === fdesp &&
        r.u === (parseInt(formU, 10) || 0) &&
        r.c === (parseInt(formC, 10) || 0) &&
        r.total > 0 &&
        Date.now() - new Date(r.creado).getTime() < 9e5
    );
    if (isDup) w.push('Igual a una entrada guardada hace menos de 15 min');

    if (!confirmarAvisos(w)) return;

    const r: Registro = {
      id: Date.now() + '-' + Math.random().toString(36).slice(2, 6),
      fecha,
      fdesp,
      turno,
      nombre,
      op: formOp.trim(),
      sap: formSap.trim(),
      descripcion: formDesc.trim(),
      cliente: formCliente.trim(),
      pedido: pedNum,
      empaque: formEmp,
      u: parseInt(formU, 10) || 0,
      c: parseInt(formC, 10) || 0,
      total: formTotalCalc,
      estado: '',
      creado: new Date().toISOString(),
      sync: false,
    };

    const cambiados: Registro[] = [];
    registros.forEach((x) => {
      if (
        x.op.toLowerCase() === r.op.toLowerCase() &&
        (x.fdesp || '') === r.fdesp &&
        x.pedido !== r.pedido
      ) {
        x.pedido = r.pedido;
        x.sync = false;
        cambiados.push(x);
      }
    });

    const newRegs = [r, ...registros];
    const camb2 = recalcularEstados(r.op, r.fdesp, newRegs, planesOp);
    const toSend = [r, ...cambiados, ...camb2].filter(
      (item, pos, arr) => arr.indexOf(item) === pos
    );

    onRegistrosChange(newRegs, toSend);

    setFormU('');
    setFormC('');

    if (mAct && mAct.modelos.length > 1 && formModeloSel !== -2) {
      setFormModeloSel(-1);
      setFormDesc('');
      setFormSap('');
      onToast('ok', `Guardado. Elige el siguiente modelo de ${mAct.op}`);
    } else {
      setFormOp('');
      setFormDesc('');
      setFormSap('');
      setFormCliente('');
      setOpAplicada('');
      setOpPedidoVista('');
      setFormPedido('');
      setFormModeloSel(-1);
      onToast('ok', 'Entrada guardada');
    }
  };

  // Plan Excel reading (SAP / CANT / STOCK)
  const handlePlanFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f || !archivoOk(f, onToast)) return;
    if (!fdesp) {
      onToast('error', 'Primero elige la fecha de despacho');
      return;
    }

    const rd = new FileReader();
    rd.onload = (ev) => {
      try {
        const wb = XLSX.read(new Uint8Array(ev.target?.result as ArrayBuffer), { type: 'array' });
        let best: any[][] = [];
        let bestCols = 999;
        wb.SheetNames.forEach((n) => {
          const a = XLSX.utils.sheet_to_json<any[]>(wb.Sheets[n], { header: 1, defval: '' });
          let m = 0;
          a.forEach((r) => {
            const count = r.filter((v) => String(v).trim() !== '').length;
            if (count > m) m = count;
          });
          if (a.length && (m <= 3 || bestCols > 3)) {
            best = a;
            bestCols = m;
          }
        });

        let hi = -1;
        let cs = -1;
        let cc = -1;
        let cst = -1;
        for (let i = 0; i < Math.min(best.length, 15) && hi < 0; i++) {
          const r = best[i].map(String).map((s) => s.toLowerCase().trim());
          const x = r.findIndex(
            (h) => h === 'sap' || h === 'codigo sap' || h === 'cod sap'
          );
          const y = r.findIndex(
            (h) => h === 'cant' || h === 'cantidad' || h === 'cant.'
          );
          if (x >= 0 && y >= 0) {
            hi = i;
            cs = x;
            cc = y;
            cst = colStock(r, [x, y], true);
          }
        }

        if (hi < 0) {
          if (best.length) {
            cs = 0;
            cc = 1;
            cst = hayTercera(best);
          } else {
            onToast('error', 'El Excel debe tener columnas SAP y CANT');
            return;
          }
        }

        const mp: Record<string, { sap: string; cant: number; stock: number }> = {};
        const orden: string[] = [];
        for (let k = hi + 1; k < best.length; k++) {
          const sp = String(best[k][cs] || '').trim();
          const qs = String(best[k][cc] || '').replace(/,/g, '').trim();
          if (!sp || qs === '' || !isFinite(Number(qs))) continue;
          const q = parseFloat(String(best[k][cc]).replace(/,/g, '')) || 0;
          const key = sp.toUpperCase();
          if (!mp[key]) {
            mp[key] = { sap: sp, cant: 0, stock: 0 };
            orden.push(key);
          }
          mp[key].cant += q;
          mp[key].stock += valStock(best[k], cst);
        }

        if (!orden.length) {
          onToast('error', 'No hay filas con SAP');
          return;
        }

        const confirmRows: ConfirmRow[] = orden.map((k) => {
          const it = mp[k];
          const o = opsDeSap(it.sap, catalogo);
          const csList: Candidate[] = o.length
            ? o.map((x) => {
                const mo = x.m.modelos[x.i];
                return {
                  op: x.m.op,
                  cliente: x.m.cliente || '',
                  sap: mo?.sap || it.sap,
                  desc: mo?.descripcion || '',
                };
              })
            : [
                {
                  op: '',
                  cliente: '',
                  sap: it.sap,
                  desc: buscarSap(it.sap, catalogo, registros),
                },
              ];
          return {
            cands: csList,
            cant: it.cant,
            stock: it.stock,
            ok: !!o.length,
            key: it.sap,
          };
        });

        // Store plan items
        const planItems = orden.map((k) => ({
          sap: mp[k].sap,
          cant: mp[k].cant,
          stock: mp[k].stock,
        }));
        onPlanesChange({ ...planes, [fdesp]: { archivo: f.name, items: planItems } });

        setConfirmModalData({ fd: fdesp, tipo: 'SAP', rows: confirmRows });
      } catch {
        onToast('error', 'No se pudo leer el archivo');
      }
    };
    rd.readAsArrayBuffer(f);
  };

  // Plan Excel reading by OP
  const handlePlanOpFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f || !archivoOk(f, onToast)) return;
    if (!fdesp) {
      onToast('error', 'Primero elige la fecha de despacho');
      return;
    }

    const rd = new FileReader();
    rd.onload = (ev) => {
      try {
        const wb = XLSX.read(new Uint8Array(ev.target?.result as ArrayBuffer), { type: 'array' });
        const hojas = wb.SheetNames.map((n) => {
          const a = XLSX.utils.sheet_to_json<any[]>(wb.Sheets[n], { header: 1, defval: '' });
          let m = 0;
          a.forEach((r) => {
            const count = r.filter((v) => String(v).trim() !== '').length;
            if (count > m) m = count;
          });
          return { a, c: m };
        }).filter((h) => h.a.length);

        hojas.sort((x, y) => (x.c <= 3 ? 0 : 1) - (y.c <= 3 ? 0 : 1));

        let ordenRes: { op: string; cant: number; stock: number }[] | null = null;
        for (let s = 0; s < hojas.length; s++) {
          const a = hojas[s].a;
          const c = hojas[s].c;
          let hi = -1;
          let co = -1;
          let cc = -1;
          let cf = -1;
          let cst = -1;

          for (let i = 0; i < Math.min(a.length, 15) && hi < 0; i++) {
            const r = a[i].map(String).map((x) => x.toLowerCase().trim());
            const x = r.findIndex(
              (h) =>
                h === 'op' ||
                h === 'orden' ||
                h === 'orden de produccion' ||
                h === 'o.p.'
            );
            const y = r.findIndex(
              (h) => h === 'cant' || h === 'cantidad' || h === 'cant.'
            );
            if (x >= 0 && y >= 0) {
              hi = i;
              co = x;
              cc = y;
              cf = r.findIndex((h) => h.indexOf('fecha') === 0);
              cst = colStock(r, [x, y, cf], c <= 3);
            }
          }

          if (hi < 0) {
            if (c > 3) continue;
            co = 0;
            cc = 1;
            cst = hayTercera(a);
          }
          if (c > 3 && cf < 0) continue;

          const mp: Record<string, { op: string; cant: number; stock: number }> = {};
          const orden: string[] = [];
          for (let k = hi + 1; k < a.length; k++) {
            const sp = String(a[k][co] || '').trim();
            const qraw = String(a[k][cc] || '').replace(/,/g, '').trim();
            if (!sp || qraw === '' || !isFinite(Number(qraw))) continue;

            if (c > 3) {
              const fv = a[k][cf];
              let iso = '';
              if (typeof fv === 'number') {
                const d = XLSX.SSF.parse_date_code(fv);
                if (d) {
                  iso = `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`;
                }
              } else {
                iso = String(fv).slice(0, 10);
              }
              if (iso !== fdesp) continue;
            }

            const q = parseFloat(String(a[k][cc]).replace(/,/g, '')) || 0;
            const key = sp.toUpperCase();
            if (!mp[key]) {
              mp[key] = { op: sp, cant: 0, stock: 0 };
              orden.push(key);
            }
            mp[key].cant += q;
            mp[key].stock += valStock(a[k], cst);
          }

          if (orden.length) {
            ordenRes = orden.map((k) => mp[k]);
            break;
          }
        }

        if (!ordenRes || !ordenRes.length) {
          onToast('error', 'No encontré una lista con OP y cantidad');
          return;
        }

        const confirmRows: ConfirmRow[] = ordenRes.map((it) => {
          const m = buscarCatalogo(it.op);
          const csList: Candidate[] = m && m.modelos.length
            ? m.modelos.map((mo) => ({
                op: m.op,
                cliente: m.cliente || '',
                sap: mo.sap || '',
                desc: mo.descripcion || '',
              }))
            : [{ op: it.op, cliente: '', sap: '', desc: '' }];
          return {
            cands: csList,
            cant: it.cant,
            stock: it.stock,
            ok: !!m,
            key: it.op,
          };
        });

        // Store plan items
        onPlanesOpChange({
          ...planesOp,
          [fdesp]: { archivo: f.name, items: ordenRes },
        });

        setConfirmModalData({ fd: fdesp, tipo: 'OP', rows: confirmRows });
      } catch {
        onToast('error', 'No se pudo leer el archivo');
      }
    };
    rd.readAsArrayBuffer(f);
  };

  // Confirm Excel modal accepted
  const handleConfirmModalAccept = (processed: {
    selectedRows: {
      candidates: Candidate[];
      pedido: number;
      stock: number;
      selectionMode: string;
      originalIdx: number;
    }[];
  }) => {
    if (!fecha) {
      onToast('error', 'Pon la fecha de registro');
      return;
    }
    if (!nombre) {
      onToast('error', 'Selecciona el habilitador');
      return;
    }

    const nuevos: Registro[] = [];
    const ops: Record<string, number> = {};
    let yaEx = 0;
    const act: any[] = [];
    let nS = 0;
    let sS = 0;
    const sMay: string[] = [];
    let ordN = 0;

    processed.selectedRows.forEach((r) => {
      const q = r.pedido;
      const stock = r.stock;
      if (stock > 0) {
        nS++;
        sS += stock;
      }
      if (stock > q) {
        sMay.push(r.candidates[0]?.op || '');
      }

      r.candidates.forEach((c, ci) => {
        const ordL = ++ordN;
        const exists = registros.some(
          (x) =>
            x.op.toLowerCase() === c.op.toLowerCase() &&
            (x.fdesp || '') === fdesp &&
            (x.sap || '') === (c.sap || '')
        );

        if (exists) {
          yaEx++;
          act.push({
            op: c.op,
            q,
            c,
            stock,
            hasS: stock > 0 && ci === 0,
            ord: ordL,
          });
          ops[c.op] = 1;
          return;
        }

        const newRec: Registro = {
          id: Date.now() + '-' + Math.random().toString(36).slice(2, 6),
          fecha,
          fdesp,
          turno,
          nombre,
          op: c.op,
          sap: c.sap,
          descripcion: c.desc,
          cliente: c.cliente,
          pedido: q,
          empaque: formEmp,
          u: 0,
          c: 0,
          total: 0,
          estado: '',
          creado: new Date().toISOString(),
          sync: false,
          ord: ordL,
        };

        if (ci === 0 && stock > 0) {
          newRec.empaque = 'stock';
          newRec.u = stock;
          newRec.c = 1;
          newRec.total = stock;
        }

        nuevos.push(newRec);
        ops[c.op] = 1;
      });
    });

    const envio: Registro[] = [...nuevos];

    act.forEach((a) => {
      registros.forEach((x) => {
        if (
          x.op.toLowerCase() === a.op.toLowerCase() &&
          (x.fdesp || '') === fdesp &&
          x.pedido !== a.q
        ) {
          x.pedido = a.q;
          x.sync = false;
          if (envio.indexOf(x) < 0) envio.push(x);
        }
      });
    });

    act.forEach((a) => {
      registros.forEach((x) => {
        if (
          x.op.toLowerCase() === a.op.toLowerCase() &&
          (x.fdesp || '') === fdesp &&
          (x.sap || '') === (a.c.sap || '') &&
          x.ord !== a.ord
        ) {
          x.ord = a.ord;
          x.sync = false;
          if (envio.indexOf(x) < 0) envio.push(x);
        }
      });
    });

    nuevos.forEach((nr) => {
      registros.forEach((x) => {
        if (
          nuevos.indexOf(x) < 0 &&
          x.op.toLowerCase() === nr.op.toLowerCase() &&
          (x.fdesp || '') === fdesp &&
          x.pedido !== nr.pedido
        ) {
          x.pedido = nr.pedido;
          x.sync = false;
          if (envio.indexOf(x) < 0) envio.push(x);
        }
      });
    });

    act.forEach((a) => {
      if (!a.hasS) return;
      const op = a.op.toLowerCase();
      const sap = a.c.sap || '';
      const mismo = (x: Registro) =>
        x.op.toLowerCase() === op && (x.fdesp || '') === fdesp && (x.sap || '') === sap;

      const t =
        registros.find((x) => mismo(x) && esStock(x)) ||
        (a.stock > 0
          ? registros.find((x) => mismo(x) && !esStock(x) && !(x.total > 0))
          : null);

      if (t) {
        if (a.stock > 0) {
          t.empaque = 'stock';
          t.u = a.stock;
          t.c = 1;
          t.total = a.stock;
        } else {
          t.empaque = formEmp;
          t.u = 0;
          t.c = 0;
          t.total = 0;
        }
        t.pedido = a.q;
        t.sync = false;
        if (envio.indexOf(t) < 0) envio.push(t);
      } else if (a.stock > 0) {
        const b = registros.find(mismo) || ({} as any);
        const n2: Registro = {
          id: Date.now() + '-' + Math.random().toString(36).slice(2, 6),
          fecha,
          fdesp,
          turno,
          nombre,
          op: a.c.op,
          sap,
          descripcion: a.c.desc || b.descripcion || '',
          cliente: a.c.cliente || b.cliente || '',
          pedido: a.q,
          empaque: 'stock',
          u: a.stock,
          c: 1,
          total: a.stock,
          estado: '',
          creado: new Date().toISOString(),
          sync: false,
          ord: a.ord,
        };
        registros.unshift(n2);
        envio.push(n2);
      }
    });

    const combinedRegs = [...nuevos, ...registros];
    Object.keys(ops).forEach((op) => {
      recalcularEstados(op, fdesp, combinedRegs, planesOp).forEach((x) => {
        if (envio.indexOf(x) < 0) envio.push(x);
      });
    });

    onRegistrosChange(combinedRegs, envio);
    setConfirmModalData(null);
    onToast('ok', `${nuevos.length} tarjeta(s) creadas para el ${fcorta(fdesp)}`);
  };

  // Grid calculation helpers
  const getGridInfo = (i: number) => {
    const r = grid[i];
    const o: any = { err: [], warn: [] };
    const vacia = !r.op && !r.u && !r.c;
    o.vacia = vacia;
    if (vacia) return o;

    const op = r.op.trim();
    o.m = buscarCatalogo(op);

    // modelo
    let sap = '';
    let desc = '';
    if (o.m) {
      const ms = o.m.modelos || [];
      if (!ms.length) {
        desc = o.m.descripcion || '';
      } else if (ms.length === 1) {
        sap = ms[0].sap || '';
        desc = ms[0].descripcion || '';
      } else if (r.mod === 'all') {
        sap = ms.map((x: any) => x.sap || '').filter(Boolean).join(' + ');
        desc = ms.map((x: any) => x.descripcion).join(' + ');
      } else {
        const x = ms[parseInt(r.mod, 10)];
        if (x) {
          sap = x.sap || '';
          desc = x.descripcion || '';
        }
      }
    }
    o.mo = { sap, desc };

    const pedPlan = sap ? pedidoPlanSap(sap, fdesp, planes) : 0;
    o.ped =
      r.pedido !== ''
        ? parseInt(r.pedido, 10) || 0
        : pedidoDe(op, fdesp, registros, catalogo, planesOp, planes) || pedPlan || 0;
    o.total = (parseInt(r.u, 10) || 0) * (parseInt(r.c, 10) || 0);

    let prev = acumulado(op, fdesp, registros);
    let dup = false;
    for (let j = 0; j < i; j++) {
      const g = grid[j];
      if (g.op.trim().toLowerCase() === op.toLowerCase() && op) {
        prev += (parseInt(g.u, 10) || 0) * (parseInt(g.c, 10) || 0);
        if (g.mod === r.mod) dup = true;
      }
    }
    o.prev = prev;

    if (!op) o.err.push('Falta OP');
    else if (!o.m) o.warn.push('OP no está en el catálogo');
    if (!(o.ped > 0)) o.err.push('Falta pedido');
    if (!(parseInt(r.u, 10) > 0)) o.err.push('Falta unid.');
    if (!(parseInt(r.c, 10) > 0)) o.err.push('Falta cant.');
    if (r.u !== '' && !esEntero(r.u)) o.err.push('Unid. no entera');
    if (r.c !== '' && !esEntero(r.c)) o.err.push('Cant. no entera');
    if (r.pedido !== '' && !esEntero(r.pedido)) o.err.push('Pedido no entero');

    avisoCant(parseInt(r.u, 10) || 0, parseInt(r.c, 10) || 0).forEach((a) => o.warn.push(a));

    const pp0 = ultimoPedido(op, fdesp, registros);
    if (r.pedido !== '' && pp0 > 0 && pp0 !== o.ped) {
      o.warn.push(`Pedido cambia de ${pp0} a ${o.ped}`);
    }

    if (o.ped > 0 && o.total > 0) {
      const fin = prev + o.total;
      if (fin > o.ped) o.warn.push(`Excede pedido en ${fin - o.ped}`);
      else if (fin === o.ped) o.cierra = true;
      else o.falta = o.ped - fin;
    }
    if (dup) o.warn.push('Repetida en la tabla');

    const rec = registros.find(
      (x) =>
        x.op.toLowerCase() === op.toLowerCase() &&
        (x.fdesp || '') === fdesp &&
        x.u === (parseInt(r.u, 10) || 0) &&
        x.c === (parseInt(r.c, 10) || 0) &&
        x.total > 0 &&
        Date.now() - new Date(x.creado).getTime() < 15 * 60000
    );
    if (rec) o.warn.push('Igual a un registro de hace poco');

    return o;
  };

  // Grid summary stats
  let gridListas = 0;
  let gridConErr = 0;
  let gridUds = 0;
  grid.forEach((_, i) => {
    const o = getGridInfo(i);
    if (o.vacia) return;
    if (o.err.length) gridConErr++;
    else {
      gridListas++;
      gridUds += o.total;
    }
  });

  // Grid row modifications
  const updateGridRow = (i: number, field: keyof GridRow, val: string) => {
    const updated = [...grid];
    updated[i] = { ...updated[i], [field]: val };

    if (field === 'op') {
      const m = buscarCatalogo(val);
      if (m && m.op !== val) {
        updated[i].op = m.op;
      }
      updated[i].pedido = '';
      updated[i].mod = 'all';
    }

    // Auto-append row if typing in last row
    if (i === updated.length - 1 && (updated[i].op || updated[i].u || updated[i].c)) {
      updated.push({ op: '', mod: 'all', pedido: '', emp: 'caja', u: '', c: '' });
    }

    setGrid(updated);
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
    const updated = [...grid];

    ls.forEach((l, k) => {
      const c = l.split('\t');
      const rowIdx = i + k;
      if (!updated[rowIdx]) {
        updated.push({ op: '', mod: 'all', pedido: '', emp: 'caja', u: '', c: '' });
      }
      const m = buscarCatalogo(c[0]);
      updated[rowIdx].op = m ? m.op : String(c[0] || '').trim();
      updated[rowIdx].pedido = '';
      updated[rowIdx].mod = 'all';
      if (c[1] != null && c[1] !== '') {
        updated[rowIdx].u = String(parseInt(c[1], 10) || '');
      }
      if (c[2] != null && c[2] !== '') {
        updated[rowIdx].c = String(parseInt(c[2], 10) || '');
      }
    });

    const last = updated[updated.length - 1];
    if (last && (last.op || last.u || last.c)) {
      updated.push({ op: '', mod: 'all', pedido: '', emp: 'caja', u: '', c: '' });
    }

    setGrid(updated);
    saveGridDraft(updated);
    onToast('ok', `${ls.length} fila(s) pegadas`);
  };

  // Traer OPs pendientes del día
  const handleTraerOpsPendientes = () => {
    if (!fdesp) {
      onToast('error', 'Primero elige la fecha de despacho');
      return;
    }
    const vistos: Record<string, boolean> = {};
    const ops: string[] = [];
    grid.forEach((r) => {
      if (r.op) vistos[r.op.toLowerCase()] = true;
    });

    const add = (op: string) => {
      const k = String(op || '').trim().toLowerCase();
      if (!k || vistos[k]) return;
      vistos[k] = true;
      const p = pedidoDe(op, fdesp, registros, catalogo, planesOp, planes);
      if (p && acumulado(op, fdesp, registros) >= p) return;
      ops.push(String(op).trim());
    };

    if (planesOp[fdesp]) {
      planesOp[fdesp].items.forEach((x) => add(x.op));
    }
    registros
      .slice()
      .reverse()
      .forEach((x) => {
        if ((x.fdesp || '') === fdesp) add(x.op);
      });

    if (!ops.length) {
      onToast('error', `No hay OPs pendientes para el ${fcorta(fdesp)}`);
      return;
    }

    const clean = grid.filter((r) => r.op || r.u || r.c);
    ops.forEach((op) => {
      const m = buscarCatalogo(op);
      clean.push({
        op: m ? m.op : op,
        mod: 'all',
        pedido: '',
        emp: 'caja',
        u: '',
        c: '',
      });
    });
    clean.push({ op: '', mod: 'all', pedido: '', emp: 'caja', u: '', c: '' });
    setGrid(clean);
    saveGridDraft(clean);
    onToast('ok', `${ops.length} OP(s) pendientes agregadas`);
  };

  // Guardar filas listas del Grid
  const handleGuardarGrid = () => {
    if (gridSavePending) return;
    if (!fdesp) {
      onToast('error', 'Pon la fecha de despacho');
      return;
    }
    if (!fecha) {
      onToast('error', 'Pon la fecha de registro');
      return;
    }
    if (!nombre) {
      onToast('error', 'Selecciona el habilitador');
      return;
    }

    const okList: { i: number; r: GridRow; o: any }[] = [];
    const avisos: string[] = [
      avisoFecha(fecha, 'registro'),
      avisoFecha(fdesp, 'despacho'),
    ].filter(Boolean);
    let errs = 0;

    grid.forEach((r, i) => {
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
      onToast('error', 'Ninguna fila está lista. Revisa las marcadas en rojo');
      return;
    }

    if (avisos.length && !confirmarAvisos(avisos)) return;
    if (
      !window.confirm(
        `Se guardarán ${okList.length} registro(s) para el despacho del ${fcorta(fdesp)}${errs ? `\n(${errs} fila(s) con errores quedan en la tabla)` : ''}.\n¿Confirmar?`
      )
    ) {
      return;
    }

    setGridSavePending(true);
    const nuevos: Registro[] = [];
    const envio: Registro[] = [];
    const ops: Record<string, number> = {};

    okList.forEach((x) => {
      const r = x.r;
      const o = x.o;
      const op = o.m ? o.m.op : r.op.trim();
      const n: Registro = {
        id: Date.now() + '-' + Math.random().toString(36).slice(2, 6),
        fecha,
        fdesp,
        turno,
        nombre,
        op,
        sap: o.mo ? o.mo.sap : '',
        descripcion: o.mo ? o.mo.desc : '',
        cliente: o.m ? o.m.cliente || '' : '',
        pedido: o.ped,
        empaque: r.emp || 'caja',
        u: parseInt(r.u, 10) || 0,
        c: parseInt(r.c, 10) || 0,
        total: (parseInt(r.u, 10) || 0) * (parseInt(r.c, 10) || 0),
        estado: '',
        creado: new Date().toISOString(),
        sync: false,
      };
      nuevos.push(n);
      ops[op] = n.pedido;
    });

    Object.keys(ops).forEach((op) => {
      registros.forEach((x) => {
        if (
          x.op.toLowerCase() === op.toLowerCase() &&
          (x.fdesp || '') === fdesp &&
          x.pedido !== ops[op]
        ) {
          x.pedido = ops[op];
          x.sync = false;
          envio.push(x);
        }
      });
    });

    const newCombined = [...nuevos.slice().reverse(), ...registros];
    const fullEnvio = [
      ...nuevos,
      ...envio.filter((x) => nuevos.indexOf(x) < 0),
    ];

    Object.keys(ops).forEach((op) => {
      recalcularEstados(op, fdesp, newCombined, planesOp).forEach((x) => {
        if (fullEnvio.indexOf(x) < 0) fullEnvio.push(x);
      });
    });

    onRegistrosChange(newCombined, fullEnvio);

    const savedIdx = okList.map((x) => x.i);
    const remaining = grid.filter((_, i) => savedIdx.indexOf(i) < 0 && (grid[i].op || grid[i].u || grid[i].c));
    remaining.push({ op: '', mod: 'all', pedido: '', emp: 'caja', u: '', c: '' });
    setGrid(remaining);
    saveGridDraft(remaining);
    setGridSavePending(false);
    onToast('ok', `${nuevos.length} registro(s) guardados${errs ? ` · ${errs} con errores pendientes` : ''}`);
  };

  // Quick autofill when clicking "Registrar" on plan table
  const handleQuickRegisterPlan = (op: string, sap: string) => {
    let m = op ? buscarCatalogo(op) : null;
    if (!m && sap) {
      const o = opsDeSap(sap, catalogo);
      if (o.length === 1) {
        m = o[0].m;
      }
    }
    if (m) {
      aplicarOpForm(m);
      if (sap) {
        const i = (m.modelos || []).findIndex(
          (mo) => String(mo.sap || '').trim().toUpperCase() === String(sap).trim().toUpperCase()
        );
        if (i >= 0) {
          handleSelectModeloForm(i, m);
        }
      }
    } else {
      setFormOp(op || '');
      setFormSap(sap || '');
      setFormDesc(sap ? buscarSap(sap, catalogo, registros) : '');
      setOpPedidoVista('');
    }

    onModoRegChange('form');
    onToast('ok', 'Datos listos, ingresa unidades y cantidad');
  };

  // Sub-metrics for current despacho
  const sub = registros.filter((r) => (r.fdesp || '') === fdesp);
  const totEntregado = sub.reduce(
    (a, r) => a + (esStock(r) ? 0 : r.total || 0),
    0
  );
  const totStock = sub.reduce(
    (a, r) => a + (esStock(r) ? r.total || 0 : 0),
    0
  );
  const groupedSub = agrupar(sub, registros, planesOp);

  // Suggestions list for OP input
  const sugList = formOp.trim()
    ? catalogo
        .filter((c) =>
          c.op.toLowerCase().includes(formOp.trim().toLowerCase())
        )
        .slice(0, 8)
    : [];

  const currentPlan = planes[fdesp];
  const currentPlanOp = planesOp[fdesp];

  return (
    <div id="t-reg">
      {/* Despacho Bar */}
      <div className="panel" id="despachoBar">
        <div className="sec">Despacho</div>
        <div className="despRow">
          <div className="field">
            <label htmlFor="fdesp">Fecha de despacho</label>
            <input
              type="date"
              id="fdesp"
              value={fdesp}
              onChange={(e) => onFdespChange(e.target.value)}
            />
          </div>
          <div className="tools" id="cargaDespacho">
            <button
              className="btn-s"
              id="planImp"
              type="button"
              onClick={() => planFileInputRef.current?.click()}
            >
              Cargar lista de despacho (Excel SAP, CANT, STOCK)
            </button>
            <button
              className="btn-s"
              id="planOpImp"
              type="button"
              onClick={() => planOpFileInputRef.current?.click()}
            >
              Cargar lista por OP (Excel OP, cantidad, stock)
            </button>
            {currentPlan && (
              <button
                className="btn-s"
                type="button"
                onClick={() => {
                  if (window.confirm(`¿Quitar la lista de despacho del ${fcorta(fdesp)}?`)) {
                    const next = { ...planes };
                    delete next[fdesp];
                    onPlanesChange(next);
                  }
                }}
              >
                Quitar lista
              </button>
            )}
            {currentPlanOp && (
              <button
                className="btn-s"
                type="button"
                onClick={() => {
                  if (window.confirm(`¿Quitar la lista por OP del ${fcorta(fdesp)}?`)) {
                    const next = { ...planesOp };
                    delete next[fdesp];
                    onPlanesOpChange(next);
                  }
                }}
              >
                Quitar lista OP
              </button>
            )}
            <input
              type="file"
              ref={planFileInputRef}
              accept=".xlsx,.xls,.csv"
              className="hidden"
              onChange={handlePlanFileChange}
            />
            <input
              type="file"
              ref={planOpFileInputRef}
              accept=".xlsx,.xls,.csv"
              className="hidden"
              onChange={handlePlanOpFileChange}
            />
          </div>
        </div>

        <div id="despachoInfo" className="info">
          Despacho {fcorta(fdesp)}: {sub.length} entrada(s) · {totEntregado} u entregadas
          {totStock ? ` · ${totStock} u de stock inicial` : ''}
        </div>

        {/* Plans Display */}
        <div className="plans">
          {currentPlan && currentPlan.items.length > 0 && (
            <div>
              <div className="sec">
                Lista de despacho {fcorta(fdesp)} ·{' '}
                {
                  currentPlan.items.filter((it) => {
                    const e = sub
                      .filter((r) => (r.sap || '').toUpperCase() === it.sap.toUpperCase())
                      .reduce((acc, curr) => acc + (curr.total || 0), 0);
                    return it.cant - e <= 0;
                  }).length
                }
                /{currentPlan.items.length} SAP completos
              </div>
              <div style={{ fontSize: '0.7rem', color: 'var(--muted)', marginBottom: '6px' }}>
                Archivo: {currentPlan.archivo || ''}
              </div>
              <table className="plan-t">
                <thead>
                  <tr>
                    <th>SAP</th>
                    <th className="n">Pedido</th>
                    <th className="n">Entregado</th>
                    <th className="n">Estado</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {currentPlan.items.map((it, idx) => {
                    const e = sub
                      .filter((r) => (r.sap || '').toUpperCase() === it.sap.toUpperCase())
                      .reduce((acc, curr) => acc + (curr.total || 0), 0);
                    const f = it.cant - e;
                    const cl = f > 0 ? 'plan-pend' : f < 0 ? 'plan-exc' : 'plan-ok';
                    const et = f > 0 ? `Falta ${f}` : f < 0 ? `Exceso ${-f}` : 'Completo';
                    return (
                      <tr key={idx}>
                        <td className="mono">{it.sap}</td>
                        <td className="n mono">{it.cant}</td>
                        <td className="n mono">{e}</td>
                        <td className={`n ${cl}`}>{et}</td>
                        <td>
                          <button
                            type="button"
                            className="btn-s"
                            style={{ padding: '4px 8px', fontSize: '0.72rem' }}
                            onClick={() => handleQuickRegisterPlan('', it.sap)}
                          >
                            Registrar
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {currentPlanOp && currentPlanOp.items.length > 0 && (
            <div>
              <div className="sec">
                Lista por OP {fcorta(fdesp)} ·{' '}
                {
                  currentPlanOp.items.filter((it) => {
                    const e = sub
                      .filter((r) => r.op.toUpperCase() === it.op.toUpperCase())
                      .reduce((acc, curr) => acc + (curr.total || 0), 0);
                    return it.cant - e <= 0;
                  }).length
                }
                /{currentPlanOp.items.length} OP completas
              </div>
              <div style={{ fontSize: '0.7rem', color: 'var(--muted)', marginBottom: '6px' }}>
                Archivo: {currentPlanOp.archivo || ''}
              </div>
              <table className="plan-t">
                <thead>
                  <tr>
                    <th>OP</th>
                    <th className="n">Pedido</th>
                    <th className="n">Entregado</th>
                    <th className="n">Estado</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {currentPlanOp.items.map((it, idx) => {
                    const e = sub
                      .filter((r) => r.op.toUpperCase() === it.op.toUpperCase())
                      .reduce((acc, curr) => acc + (curr.total || 0), 0);
                    const f = it.cant - e;
                    const cl = f > 0 ? 'plan-pend' : f < 0 ? 'plan-exc' : 'plan-ok';
                    const et = f > 0 ? `Falta ${f}` : f < 0 ? `Exceso ${-f}` : 'Completo';
                    return (
                      <tr key={idx}>
                        <td className="mono">{it.op}</td>
                        <td className="n mono">{it.cant}</td>
                        <td className="n mono">{e}</td>
                        <td className={`n ${cl}`}>{et}</td>
                        <td>
                          <button
                            type="button"
                            className="btn-s"
                            style={{ padding: '4px 8px', fontSize: '0.72rem' }}
                            onClick={() => handleQuickRegisterPlan(it.op, '')}
                          >
                            Registrar
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

      {/* Mode switcher */}
      <div className="chips modo" id="modoReg">
        <button
          className={`chip ${modoReg === 'tabla' ? 'active' : ''}`}
          type="button"
          onClick={() => onModoRegChange('tabla')}
        >
          Tabla rápida (tipo Excel)
        </button>
        <button
          className={`chip ${modoReg === 'form' ? 'active' : ''}`}
          type="button"
          onClick={() => onModoRegChange('form')}
        >
          Formulario
        </button>
      </div>

      {/* TABLA RÁPIDA (GRID) */}
      {modoReg === 'tabla' && (
        <div id="gridPanel" className="panel gpanel">
          <div className="sec">Registro rápido</div>
          <div className="resumen" id="gResumen">
            Filas listas: <b>{gridListas}</b> · Con errores: <b>{gridConErr}</b> · Unidades a
            guardar: <b>{gridUds}</b>
          </div>
          <div className="tools" style={{ marginBottom: 0 }}>
            <button
              className="btn-s"
              type="button"
              onClick={() => {
                const updated = [...grid, { op: '', mod: 'all', pedido: '', emp: 'caja', u: '', c: '' }];
                setGrid(updated);
                saveGridDraft(updated);
              }}
            >
              + Fila
            </button>
            <button
              className="btn-s"
              type="button"
              onClick={handleTraerOpsPendientes}
            >
              Traer OPs pendientes del día
            </button>
            <button
              className="btn-s"
              type="button"
              onClick={() => {
                if (
                  grid.some((r) => r.op || r.u || r.c) &&
                  !window.confirm('¿Vaciar toda la tabla?')
                ) {
                  return;
                }
                const cleared = [{ op: '', mod: 'all', pedido: '', emp: 'caja', u: '', c: '' }];
                setGrid(cleared);
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
                  <th>OP</th>
                  <th>Modelo</th>
                  <th>Cliente</th>
                  <th>SAP</th>
                  <th>Descripción</th>
                  <th className="n">Pedido</th>
                  <th className="n" title="Ya entregado más el stock inicial registrado">
                    Entreg. + stock
                  </th>
                  <th>Empaque</th>
                  <th className="n">Unid. x emp.</th>
                  <th className="n">Cant.</th>
                  <th className="n">Total</th>
                  <th>Estado</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {grid.map((r, i) => {
                  const o = getGridInfo(i);
                  const msg = o.vacia
                    ? ''
                    : o.err.length
                    ? o.err.join(' · ')
                    : o.warn.length
                    ? o.warn.join(' · ')
                    : o.cierra
                    ? 'Listo · completa la OP'
                    : 'Listo' + (o.falta ? ` · faltan ${o.falta}` : '');

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
                      <td>
                        <input
                          className="mono"
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
                            <option value="all">Todos juntos</option>
                            {o.m.modelos.map((mo: any, k: number) => (
                              <option key={k} value={String(k)}>
                                {mo.modelo || mo.descripcion}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <span style={{ color: 'var(--muted)', fontSize: '0.72rem' }}>—</span>
                        )}
                      </td>
                      <td className="ro cli">{o.m?.cliente || ''}</td>
                      <td className="ro mono sap">{o.mo?.sap || ''}</td>
                      <td className="ro desc" title={o.mo?.desc || ''}>
                        {o.mo?.desc || ''}
                      </td>
                      <td>
                        <input
                          className="n mono"
                          type="number"
                          min="0"
                          placeholder={o.ped ? String(o.ped) : '0'}
                          value={r.pedido}
                          onChange={(e) => updateGridRow(i, 'pedido', e.target.value)}
                        />
                      </td>
                      <td className="num prev">{o.vacia ? '' : o.prev}</td>
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
                            const updated = grid.filter((_, idx) => idx !== i);
                            if (!updated.length) {
                              updated.push({ op: '', mod: 'all', pedido: '', emp: 'caja', u: '', c: '' });
                            }
                            setGrid(updated);
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
            id="gGuardar"
            type="button"
            disabled={!gridListas || gridSavePending}
            style={{ opacity: gridListas ? 1 : 0.5 }}
            onClick={handleGuardarGrid}
          >
            {gridListas ? `Guardar ${gridListas} fila(s) lista(s)` : 'Guardar filas listas'}
          </button>
          <div className="ayuda">
            Enter o Tab: siguiente celda · Enter en la última celda: nueva fila · Flechas ↑ ↓:
            cambiar de fila · Ctrl+Enter: guardar · Puedes pegar desde Excel columnas OP, Unid.,
            Cant. en la celda OP. La tabla se guarda sola como borrador por fecha de despacho.
          </div>
        </div>
      )}

      {/* FORMULARIO */}
      {modoReg === 'form' && (
        <div id="regForm" className="panel">
          <div className="fcol">
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
                <div className="sug" id="sug">
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

            {/* Model Selector */}
            {buscarCatalogo(formOp) &&
              (buscarCatalogo(formOp)?.modelos || []).length > 1 && (
                <div id="modelos" className="chips" style={{ flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    className={`chip ${formModeloSel === -2 ? 'active' : ''}`}
                    style={{ flex: '0 0 auto' }}
                    onClick={() =>
                      handleSelectModeloForm(-2, buscarCatalogo(formOp)!)
                    }
                  >
                    Todos juntos
                  </button>
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
            <div className="sec">Pedido y entrega</div>
            <div className="field">
              <label>Cantidad pedida de la OP (unidades)</label>
              <input
                type="number"
                min="0"
                className="mono"
                placeholder="0"
                value={formPedido}
                onChange={(e) => setFormPedido(e.target.value)}
              />
            </div>

            {formOp.trim() && parseInt(formPedido, 10) > 0 && (
              <div id="opAcum" className="info" style={{ margin: '-6px 0 12px' }}>
                {(() => {
                  const p = parseInt(formPedido, 10) || 0;
                  const ac = acumulado(formOp.trim(), fdesp, registros);
                  const stk = stockDe(formOp.trim(), fdesp, registros);
                  const nu = formTotalCalc;
                  const pe = p - ac - nu;
                  return (
                    <>
                      Despacho {fcorta(fdesp)} · Ya entregado: {ac - stk} u
                      {stk ? ` + stock inicial ${stk} u` : ''}
                      {nu ? ` + esta entrada ${nu} u` : ''} ·{' '}
                      {pe >= 0 ? `Pendiente: ${pe} u` : `Excede en ${-pe} u`}
                    </>
                  );
                })()}
              </div>
            )}

            <label>Entregado</label>
            <div className="chips" id="emp-tipo">
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
              <span>Total entregado</span>
              <b className="mono">{formTotalCalc}</b>
            </div>
            <button className="btn" type="button" onClick={handleGuardarForm}>
              Guardar entrada
            </button>
          </div>
        </div>
      )}

      {/* Grouped summary list table of current despacho */}
      {groupedSub.ops.length > 0 && (
        <div id="despachoRes" className="panel" style={{ padding: '16px', marginTop: '12px' }}>
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
            <span>Resumen del Despacho {fcorta(fdesp)} por OP ({groupedSub.ops.length} OPs)</span>
            <span style={{ fontSize: '0.88rem', fontWeight: 600, color: 'var(--amber-ink)' }}>
              Entregado: {totEntregado} u{totStock ? ` · Stock inicial: ${totStock} u` : ''}
            </span>
          </div>

          <div className="table-wrap">
            <table className="list-table">
              <thead>
                <tr>
                  <th>OP</th>
                  <th>Cliente</th>
                  <th>Detalle / Líneas</th>
                  <th className="n">Pedido</th>
                  <th className="n">Stock inicial</th>
                  <th className="n">Entregado</th>
                  <th className="n">Acumulado</th>
                  <th className="n">Pendiente</th>
                  <th className="n">Excedente</th>
                  <th className="k">Estado</th>
                  <th style={{ textAlign: 'right' }}>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {groupedSub.ops.map((o) => {
                  const pd = o.pedido - o.acum;
                  const ok = o.pedido > 0 && pd <= 0;
                  return (
                    <tr key={o.op}>
                      <td>
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
                      <td className="k">
                        {o.pedido > 0 && (
                          <span className={`badge ${ok ? 'b-COMPLETO' : 'b-INCOMPLETO'}`}>
                            {ok
                              ? pd < 0
                                ? `COMPLETO (+${-pd})`
                                : 'COMPLETO'
                              : `Faltan ${pd}`}
                          </span>
                        )}
                      </td>
                      <td className="actions">
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
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Confirmation Modal for Excel import */}
      {confirmModalData && (
        <ConfirmarListaModal
          fd={confirmModalData.fd}
          tipo={confirmModalData.tipo}
          initialRows={confirmModalData.rows}
          onConfirm={handleConfirmModalAccept}
          onCancel={() => setConfirmModalData(null)}
        />
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
    </div>
  );
};
