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
  OpExtra,
} from '../types';
import {
  acumulado,
  avisoCant,
  avisoFecha,
  compararSapConDespacho,
  confirmarAvisos,
  esEntero,
  esStock,
  extraerSaps,
  fcorta,
  LIM,
  pedidoDe,
  pedidoPlanOp,
  pedidoPlanSap,
  recalcularEstados,
  resumenSapsDespacho,
  sanitizarStockDuplicados,
  sapsDeCatalogoOp,
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
import { encolarDel } from '../services/sheets';
import { ConfirmarListaModal } from './ConfirmarListaModal';
import { EditarStockModal } from './EditarStockModal';
import { EditarPlantaModal } from './EditarPlantaModal';
import { EntregasOpModal } from './EntregasOpModal';
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
  opExtra: Record<string, OpExtra>;
  onUpdateOpExtra: (op: string, fdesp: string, changes: Partial<OpExtra>) => void;
  onBorrarRemoto?: (id: string) => void;
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
  opExtra,
  onUpdateOpExtra,
  onBorrarRemoto,
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
  const [pedidoManualForm, setPedidoManualForm] = useState(false);

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

  const [formEnProduccion, setFormEnProduccion] = useState(false);
  const [formPlanta, setFormPlanta] = useState('0');

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

  const handleBorrarRegistro = (r: Registro) => {
    if (
      !window.confirm(
        `¿Eliminar esta entrega de OP ${r.op} (${r.total || 0} u - ${r.nombre || 'habilitador'}) registrada el ${fcorta(r.fecha)}?`
      )
    ) {
      return;
    }
    const remaining = registros.filter((x) => x.id !== r.id);
    const cb = recalcularEstados(r.op, r.fdesp || r.fecha, remaining, planesOp, opExtra);
    encolarDel(r.id, 'registros');
    if (onBorrarRemoto) onBorrarRemoto(r.id);
    onRegistrosChange(remaining, cb);
    onToast('ok', `Entrega de OP ${r.op} (${r.total || 0} u) eliminada`);
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
      encolarDel(r.id, 'registros');
      if (onBorrarRemoto) onBorrarRemoto(r.id);
    });
    const toDeleteIds = new Set(toDelete.map((x) => x.id));
    const remaining = registros.filter((x) => !toDeleteIds.has(x.id));
    const cb = recalcularEstados(op, fd, remaining, planesOp, opExtra);
    onRegistrosChange(remaining, cb);
    setEntregasModalOp(null);
    onToast('ok', `Se eliminaron las ${toDelete.length} entregas de OP ${op}`);
  };

  const handleToggleEnProduccion = (op: string, fd: string, val: boolean) => {
    onUpdateOpExtra(op, fd, { enProduccion: val });
    const camb = recalcularEstados(op, fd, registros, planesOp, {
      ...opExtra,
      [op.trim().toLowerCase() + '|' + (fd || '')]: {
        ...(opExtra[op.trim().toLowerCase() + '|' + (fd || '')] || {}),
        enProduccion: val,
      },
    });
    if (camb.length > 0) {
      onRegistrosChange(registros, camb);
    }
    onToast('ok', `${op}: ${val ? 'Marcada EN PRODUCCIÓN' : 'Desmarcada de producción'}`);
  };

  const handleSavePlantaModal = (data: { enProduccion: boolean; cantPlanta: number }) => {
    if (!plantaEditModal) return;
    const { op, fdesp: modalFd } = plantaEditModal;
    onUpdateOpExtra(op, modalFd, data);
    const camb = recalcularEstados(op, modalFd, registros, planesOp, {
      ...opExtra,
      [op.trim().toLowerCase() + '|' + (modalFd || '')]: {
        ...(opExtra[op.trim().toLowerCase() + '|' + (modalFd || '')] || {}),
        ...data,
      },
    });
    if (camb.length > 0) {
      onRegistrosChange(registros, camb);
    }
    setPlantaEditModal(null);
    onToast(
      'ok',
      `${op}: Planta actualizada (${data.cantPlanta} u sin reg. · ${data.enProduccion ? 'En producción' : 'Sin prod.'})`
    );
  };

  const handleGuardarStockEdit = (newStock: number) => {
    if (!stockEditModal) return;
    const { op, fdesp: modalFd, pedido } = stockEditModal;
    const q = op.trim().toLowerCase();

    let updatedRegs = [...registros];
    const envio: Registro[] = [];

    // Find all stock records for this OP and dispatch
    const stockRecs = updatedRegs.filter(
      (x) => esStock(x) && x.op.trim().toLowerCase() === q && (x.fdesp || x.fecha || '') === modalFd
    );

    if (stockRecs.length > 0) {
      if (newStock > 0) {
        // Update first stock record
        const prim = stockRecs[0];
        prim.u = newStock;
        prim.total = newStock;
        prim.c = 1;
        prim.sync = false;
        envio.push(prim);
      } else {
        // newStock is 0: remove all stock records for this OP in this despacho
        updatedRegs = updatedRegs.filter((x) => !stockRecs.some((s) => s.id === x.id));
        stockRecs.forEach((s) => encolarDel(s.id, 'registros'));
      }

      // If duplicate stock records were present, delete them permanently
      if (stockRecs.length > 1) {
        const dups = stockRecs.slice(1);
        updatedRegs = updatedRegs.filter((x) => !dups.some((d) => d.id === x.id));
        dups.forEach((d) => encolarDel(d.id, 'registros'));
      }
    } else if (newStock > 0) {
      const ref = updatedRegs.find(
        (x) => x.op.trim().toLowerCase() === q && (x.fdesp || x.fecha || '') === modalFd
      );
      const catOp = buscarCatalogo(op);
      const anyRef = ref?.sap
        ? ref
        : updatedRegs.find((x) => x.op.trim().toLowerCase() === q && x.sap) || ref;
      const fallbackSap = ref?.sap || anyRef?.sap || sapsDeCatalogoOp(catOp).join(' + ') || '';
      const newRec: Registro = {
        id: Date.now() + '-' + Math.random().toString(36).slice(2, 6),
        fecha: ref?.fecha || fecha,
        fdesp: modalFd,
        turno: ref?.turno || turno,
        nombre: ref?.nombre || nombre || 'Almacén',
        op: ref?.op || catOp?.op || op,
        sap: fallbackSap,
        descripcion: ref?.descripcion || anyRef?.descripcion || catOp?.descripcion || '',
        cliente: ref?.cliente || anyRef?.cliente || catOp?.cliente || '',
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

    // Safety sanitizer
    const { registrosLimpios, duplicadosEliminados } = sanitizarStockDuplicados(updatedRegs);
    duplicadosEliminados.forEach((d) => encolarDel(d.id, 'registros'));
    updatedRegs = registrosLimpios;

    const camb = recalcularEstados(op, modalFd, updatedRegs, planesOp);
    camb.forEach((x) => {
      if (envio.indexOf(x) < 0) envio.push(x);
    });

    onRegistrosChange(updatedRegs, envio);
    setStockEditModal(null);
    onToast('ok', `Stock inicial de ${op} establecido en ${newStock} u`);
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

  // Sync Pedido on OP / SAP change in form
  useEffect(() => {
    const op = formOp.trim().toLowerCase();
    if (!op) return;
    if (op !== opPedidoVista) {
      setOpPedidoVista(op);
      setPedidoManualForm(false);
      const p = pedidoDe(op, fdesp, registros, catalogo, planesOp, planes, formSap);
      if (p) setFormPedido(String(p));
      else if (!pedidoManualForm) setFormPedido('');
    } else if (!pedidoManualForm && formSap.trim()) {
      const p = pedidoDe(op, fdesp, registros, catalogo, planesOp, planes, formSap);
      if (p) setFormPedido(String(p));
    }
  }, [formOp, formSap, fdesp, registros, catalogo, planesOp, planes, opPedidoVista, pedidoManualForm]);

  // Sync Planta and EnProduccion on formOp change
  useEffect(() => {
    if (!formOp.trim()) {
      setFormEnProduccion(false);
      setFormPlanta('0');
      return;
    }
    const k = formOp.trim().toLowerCase() + '|' + (fdesp || '');
    const extra = opExtra[k] || opExtra[formOp.trim().toLowerCase()];
    if (extra) {
      setFormEnProduccion(Boolean(extra.enProduccion));
      setFormPlanta(String(extra.cantPlanta || 0));
    } else {
      setFormEnProduccion(false);
      setFormPlanta('0');
    }
  }, [formOp, fdesp, opExtra]);

  // Handle OP selection in Form
  const aplicarOpForm = (m: CatalogoOp) => {
    setOpAplicada(m.op);
    setFormOp(m.op);
    setFormCliente(m.cliente || '');
    setShowSug(false);
    setPedidoManualForm(false);

    let selSap = '';
    if (m.modelos.length === 1) {
      setFormModeloSel(0);
      setFormDesc(m.modelos[0].descripcion);
      selSap = m.modelos[0].sap || m.sap || '';
      setFormSap(selSap);
    } else if (m.modelos.length > 1) {
      // Compare each model's SAP against dispatch SAPs; auto-select if exactly 1 matches
      const matchingIdxs = m.modelos
        .map((mo, idx) => ({
          idx,
          match: mo.sap ? compararSapConDespacho(mo.sap, fdesp, registros, planes, m.op)?.enDespacho : false,
        }))
        .filter((x) => x.match)
        .map((x) => x.idx);

      if (matchingIdxs.length === 1) {
        const idx = matchingIdxs[0];
        setFormModeloSel(idx);
        setFormDesc(m.modelos[idx].descripcion);
        selSap = m.modelos[idx].sap || '';
        setFormSap(selSap);
      } else {
        setFormModeloSel(-1);
        setFormDesc('');
        setFormSap('');
        selSap = sapsDeCatalogoOp(m).join(' + ');
      }
    } else {
      setFormModeloSel(-1);
      setFormDesc(m.descripcion || '');
      selSap = m.sap || '';
      setFormSap(selSap);
    }

    const ped = pedidoDe(m.op, fdesp, registros, catalogo, planesOp, planes, selSap);
    if (ped) setFormPedido(String(ped));
    else setFormPedido('');
  };

  const handleSelectModeloForm = (idx: number, m: CatalogoOp) => {
    setFormModeloSel(idx);
    setPedidoManualForm(false);
    let selSap = '';
    if (idx === -2) {
      // Todos juntos
      setFormDesc(m.modelos.map((x) => x.descripcion).join(' + '));
      selSap = m.modelos.map((x) => x.sap || '').filter(Boolean).join(' + ');
      setFormSap(selSap);
    } else if (idx >= 0 && m.modelos[idx]) {
      setFormDesc(m.modelos[idx].descripcion);
      selSap = m.modelos[idx].sap || '';
      setFormSap(selSap);
    }
    const ped = pedidoDe(m.op, fdesp, registros, catalogo, planesOp, planes, selSap);
    if (ped) setFormPedido(String(ped));
  };

  // Live SAP comparison for Form
  const formSapEf =
    formSap.trim() ||
    (formOp.trim() ? sapsDeCatalogoOp(buscarCatalogo(formOp)).join(' + ') : '');
  const formSapInfo =
    formOp.trim() && formSapEf
      ? compararSapConDespacho(formSapEf, fdesp, registros, planes, formOp)
      : null;

  // Form total calculation
  const formTotalCalc = (parseInt(formU, 10) || 0) * (parseInt(formC, 10) || 0);

  // Form submit
  const handleGuardarForm = () => {
    if (!fdesp) {
      onToast('error', 'Por favor ingresa la fecha de despacho');
      return;
    }
    if (!fecha) {
      onToast('error', 'Por favor ingresa la fecha de registro');
      return;
    }
    if (!nombre) {
      onToast('error', 'Por favor selecciona el habilitador');
      return;
    }
    if (!formOp.trim()) {
      onToast('error', 'Por favor ingresa el número de OP');
      return;
    }
    const mAct = buscarCatalogo(formOp);
    if (mAct && mAct.modelos.length > 1 && formModeloSel === -1) {
      onToast('error', 'Por favor selecciona el modelo correspondiente a la OP');
      return;
    }
    const pedNum = parseInt(formPedido, 10) || 0;
    if (!(pedNum > 0)) {
      onToast('error', 'Por favor ingresa la cantidad pedida de la OP');
      return;
    }
    if (!(formTotalCalc > 0)) {
      onToast('error', 'Por favor ingresa las unidades por empaque y la cantidad entregada');
      return;
    }
    if (!esEntero(formPedido) || !esEntero(formU) || !esEntero(formC)) {
      onToast('error', 'Pedido, unidades y cantidad deben ser números enteros mayores a cero');
      return;
    }

    // Warnings
    const w: string[] = [];
    w.push(avisoFecha(fecha, 'registro'), avisoFecha(fdesp, 'despacho'));
    avisoCant(parseInt(formU, 10) || 0, parseInt(formC, 10) || 0).forEach((a) => w.push(a));
    if (!mAct) {
      w.push(
        `La OP ${formOp.trim()} no se encuentra en el catálogo${!formDesc && !formCliente ? ' y se guardará sin descripción ni cliente vinculados' : ''}`
      );
    } else {
      if (!formDesc) w.push('La descripción del producto está vacía');
      if (!formCliente) w.push('El nombre del cliente está vacío');
    }

    // Compare against SAP codes to dispatch
    const hasSapPlan = Boolean(planes[fdesp]?.items?.length);
    if (hasSapPlan) {
      if (!formSap.trim()) {
        w.push(
          `Hay una lista de despacho por SAP cargada, pero esta OP no tiene código SAP ingresado para compararla`
        );
      } else if (!formSapInfo?.enPlanSap) {
        w.push(
          `El código SAP ${formSap.trim()} de esta OP NO figura en la lista de códigos SAP a despachar del ${fcorta(fdesp)}`
        );
      }
    }

    if (pedNum > LIM.pedido) w.push(`Cantidad de pedido inusualmente alta (${pedNum} u)`);
    if (pedNum > 0) {
      const ac = acumulado(formOp.trim(), fdesp, registros);
      if (ac + formTotalCalc > pedNum) {
        w.push(`Esta entrega excede el pedido de la OP en ${ac + formTotalCalc - pedNum} u (Pedido OP: ${pedNum} u · Acumulado previo: ${ac} u)`);
      }
      const prev = ultimoPedido(formOp.trim(), fdesp, registros);
      if (prev > 0 && prev !== pedNum) {
        w.push(`El pedido de ${formOp.trim()} se actualizará de ${prev} u a ${pedNum} u en todas sus entradas de este despacho`);
      }
    }
    if (
      formSapInfo &&
      formSapInfo.enDespacho &&
      formSapInfo.pedidoSap > 0 &&
      formSapInfo.otrasOps.length > 0 &&
      formSapInfo.acumuladoSap + formTotalCalc > formSapInfo.pedidoSap
    ) {
      const excSap = formSapInfo.acumuladoSap + formTotalCalc - formSapInfo.pedidoSap;
      w.push(
        `Sumando las otras OPs del SAP ${formSapInfo.sap} (${formSapInfo.otrasOps.map((x) => x.op).join(', ')}), esta entrega excede el despacho del SAP en ${excSap} u (Pedido SAP: ${formSapInfo.pedidoSap} u · Cubierto actual: ${formSapInfo.acumuladoSap} u)`
      );
    }
    const isDup = registros.some(
      (r) =>
        r.op.toLowerCase().trim() === formOp.trim().toLowerCase() &&
        (r.fdesp || r.fecha || '').trim() === fdesp.trim() &&
        r.u === (parseInt(formU, 10) || 0) &&
        r.c === (parseInt(formC, 10) || 0) &&
        r.total > 0 &&
        Date.now() - new Date(r.creado).getTime() < 9e5
    );
    if (isDup) w.push('Existe una entrega idéntica guardada hace menos de 15 minutos (posible duplicado)');

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

    if (formEnProduccion || parseInt(formPlanta, 10) > 0) {
      onUpdateOpExtra(r.op, r.fdesp, {
        enProduccion: formEnProduccion,
        cantPlanta: Math.max(0, parseInt(formPlanta, 10) || 0),
      });
    }

    const newRegs = [r, ...registros];
    const camb2 = recalcularEstados(r.op, r.fdesp, newRegs, planesOp, {
      ...opExtra,
      [r.op.toLowerCase() + '|' + (r.fdesp || '')]: {
        ...(opExtra[r.op.toLowerCase() + '|' + (r.fdesp || '')] || {}),
        enProduccion: formEnProduccion,
        cantPlanta: Math.max(0, parseInt(formPlanta, 10) || 0),
      },
    });
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
      setPedidoManualForm(false);
      onToast('ok', `Guardado. Elige el siguiente modelo de ${mAct.op}`);
    } else {
      setFormOp('');
      setFormDesc('');
      setFormSap('');
      setFormCliente('');
      setOpAplicada('');
      setOpPedidoVista('');
      setFormPedido('');
      setPedidoManualForm(false);
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
    const envio: Registro[] = [];
    const ops: Record<string, number> = {};
    let ordN = 0;
    let yaEx = 0;

    // Track initial stock strictly ONCE per OP for this dispatch
    const opStockMap: Record<
      string,
      { stock: number; candidate: Candidate; q: number; ord: number }
    > = {};

    let workingRegs = [...registros];

    // 1. Process rows & candidates
    processed.selectedRows.forEach((r) => {
      const q = r.pedido;
      const stock = r.stock;
      const firstCand = r.candidates[0];
      if (firstCand && stock > 0) {
        const opKey = firstCand.op.trim().toLowerCase();
        if (!opStockMap[opKey] || stock > opStockMap[opKey].stock) {
          opStockMap[opKey] = { stock, candidate: firstCand, q, ord: ordN + 1 };
        }
      }

      r.candidates.forEach((c) => {
        const ordL = ++ordN;
        ops[c.op] = q;

        const exists = workingRegs.find(
          (x) =>
            x.op.toLowerCase() === c.op.toLowerCase() &&
            (x.fdesp || '') === fdesp &&
            (x.sap || '') === (c.sap || '') &&
            !esStock(x)
        );

        if (exists) {
          yaEx++;
          if (exists.pedido !== q || exists.ord !== ordL) {
            exists.pedido = q;
            exists.ord = ordL;
            exists.sync = false;
            if (envio.indexOf(exists) < 0) envio.push(exists);
          }
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

        nuevos.push(newRec);
        envio.push(newRec);
      });
    });

    // 2. Handle initial stock strictly ONCE per OP (no duplicates allowed)
    Object.keys(opStockMap).forEach((opKey) => {
      const { stock, candidate, q, ord } = opStockMap[opKey];
      // Search for any existing stock record for this OP in this despacho
      const existingStockRecs = workingRegs.filter(
        (x) => esStock(x) && x.op.trim().toLowerCase() === opKey && (x.fdesp || '') === fdesp
      );

      if (existingStockRecs.length > 0) {
        // Update the primary stock record
        const prim = existingStockRecs[0];
        prim.u = stock;
        prim.total = stock;
        prim.c = 1;
        prim.pedido = q || prim.pedido;
        if (!prim.sap && candidate.sap) prim.sap = candidate.sap;
        if (!prim.descripcion && candidate.desc) prim.descripcion = candidate.desc;
        if (!prim.cliente && candidate.cliente) prim.cliente = candidate.cliente;
        prim.sync = false;
        if (envio.indexOf(prim) < 0) envio.push(prim);

        // Delete all redundant duplicate stock records if any
        if (existingStockRecs.length > 1) {
          const dups = existingStockRecs.slice(1);
          workingRegs = workingRegs.filter((x) => !dups.some((d) => d.id === x.id));
          dups.forEach((d) => encolarDel(d.id, 'registros'));
        }
      } else {
        // Check if there is an empty placeholder card without deliveries that can hold the stock
        const emptyCard = workingRegs.find(
          (x) =>
            x.op.trim().toLowerCase() === opKey &&
            (x.fdesp || '') === fdesp &&
            !esStock(x) &&
            !(x.total > 0) &&
            !nuevos.some((n) => n.id === x.id)
        );

        if (emptyCard) {
          emptyCard.empaque = 'stock';
          emptyCard.u = stock;
          emptyCard.c = 1;
          emptyCard.total = stock;
          emptyCard.pedido = q || emptyCard.pedido;
          emptyCard.sync = false;
          if (envio.indexOf(emptyCard) < 0) envio.push(emptyCard);
        } else {
          // Create exactly one single stock record for this OP
          const newStockRec: Registro = {
            id: Date.now() + '-' + Math.random().toString(36).slice(2, 6),
            fecha,
            fdesp,
            turno,
            nombre,
            op: candidate.op,
            sap: candidate.sap || '',
            descripcion: candidate.desc || '',
            cliente: candidate.cliente || '',
            pedido: q,
            empaque: 'stock',
            u: stock,
            c: 1,
            total: stock,
            estado: '',
            creado: new Date().toISOString(),
            sync: false,
            ord,
          };
          nuevos.unshift(newStockRec);
          envio.push(newStockRec);
        }
      }
    });

    let combinedRegs = [...nuevos, ...workingRegs];

    // Synchronize pedidos across all cards of the same OP
    Object.keys(ops).forEach((op) => {
      const ped = ops[op];
      combinedRegs.forEach((x) => {
        if (
          x.op.toLowerCase() === op.toLowerCase() &&
          (x.fdesp || '') === fdesp &&
          x.pedido !== ped
        ) {
          x.pedido = ped;
          x.sync = false;
          if (envio.indexOf(x) < 0) envio.push(x);
        }
      });
    });

    // Sanitizer guarantees 0 stock duplicates
    const { registrosLimpios, duplicadosEliminados } = sanitizarStockDuplicados(combinedRegs);
    duplicadosEliminados.forEach((d) => encolarDel(d.id, 'registros'));
    combinedRegs = registrosLimpios;

    // Recalculate status for all affected OPs
    Object.keys(ops).forEach((op) => {
      recalcularEstados(op, fdesp, combinedRegs, planesOp).forEach((x) => {
        if (envio.indexOf(x) < 0) envio.push(x);
      });
    });

    onRegistrosChange(combinedRegs, envio);
    setConfirmModalData(null);
    onToast(
      'ok',
      `${nuevos.length} registro(s) procesados para el ${fcorta(fdesp)}${
        duplicadosEliminados.length ? ` · ${duplicadosEliminados.length} stock duplicado eliminado` : ''
      }`
    );
  };

  // Grid calculation helpers
  const getGridInfo = (i: number) => {
    const r = grid[i];
    const o: any = { err: [], warn: [] };
    const vacia = !r.op && !r.u && !r.c && !(r.sap || '').trim();
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
        sap = o.m.sap || '';
        desc = o.m.descripcion || '';
      } else if (ms.length === 1) {
        sap = ms[0].sap || o.m.sap || '';
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
    } else {
      sap = (r.sap || '').trim();
      if (!sap && op) {
        const prevRec = registros.find((x) => x.op.trim().toLowerCase() === op.toLowerCase() && x.sap);
        if (prevRec) sap = prevRec.sap;
      }
      if (sap) {
        desc = buscarSap(sap, catalogo, registros);
      }
    }
    o.mo = { sap, desc };

    // Compare OP's SAP against SAPs scheduled for dispatch
    const sapInfo = sap ? compararSapConDespacho(sap, fdesp, registros, planes, op) : null;
    o.sapInfo = sapInfo;

    const rowSaps = extraerSaps(sap);
    let sapPrevGrid = 0;
    for (let j = 0; j < i; j++) {
      const g = grid[j];
      const gOp = g.op.trim();
      if (!gOp && !g.u && !g.c) continue;
      const gCat = buscarCatalogo(gOp);
      let gSap = (g.sap || '').trim();
      if (gCat) {
        const gms = gCat.modelos || [];
        if (gms.length === 1) gSap = gms[0].sap || gCat.sap || '';
        else if (g.mod === 'all') gSap = gms.map((x: any) => x.sap || '').filter(Boolean).join(' + ');
        else if (gms[parseInt(g.mod, 10)]) gSap = gms[parseInt(g.mod, 10)].sap || '';
      }
      const gSaps = extraerSaps(gSap);
      if (rowSaps.length && gSaps.some((s) => rowSaps.includes(s))) {
        sapPrevGrid += (parseInt(g.u, 10) || 0) * (parseInt(g.c, 10) || 0);
      }
    }
    o.sapPrevGrid = sapPrevGrid;

    const pedPlanOpVal = pedidoPlanOp(op, fdesp, planesOp);
    const ultPedVal = ultimoPedido(op, fdesp, registros);
    let pedAutoSap = 0;
    if (sapInfo && sapInfo.enDespacho && sapInfo.pedidoSap > 0) {
      const pendAntesDeFila = Math.max(
        sapInfo.pedidoSap - (sapInfo.cubiertoOtrasOps + sapPrevGrid),
        0
      );
      pedAutoSap = pendAntesDeFila > 0 ? pendAntesDeFila : sapInfo.pedidoSap;
    }

    o.ped =
      r.pedido !== ''
        ? parseInt(r.pedido, 10) || 0
        : pedPlanOpVal || ultPedVal || pedAutoSap || pedidoDe(op, fdesp, registros, catalogo, planesOp, planes, sap) || 0;
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

    // Check against loaded SAP plan
    const hasSapPlan = Boolean(planes[fdesp]?.items?.length);
    if (hasSapPlan) {
      if (!sap) {
        o.warn.push('Sin código SAP para comparar con despacho');
      } else if (!sapInfo?.enPlanSap) {
        o.warn.push(`SAP ${sap} no está en lista de despacho`);
      }
    }

    if (sapInfo?.enDespacho && sapInfo.pedidoSap > 0) {
      const finSap = sapInfo.acumuladoSap + sapPrevGrid + o.total;
      o.sapEnDespacho = true;
      o.sapCompleta = finSap >= sapInfo.pedidoSap;
      o.sapFalta = Math.max(sapInfo.pedidoSap - finSap, 0);
      if (finSap > sapInfo.pedidoSap && (sapInfo.otrasOps.length > 0 || sapPrevGrid > 0)) {
        o.warn.push(`Excede SAP ${sap} en ${finSap - sapInfo.pedidoSap} u`);
      }
    }

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
      updated[i].sap = '';
      if (m && m.modelos && m.modelos.length > 1) {
        const matchingIdxs = m.modelos
          .map((mo, idx) => ({
            idx,
            match: mo.sap ? compararSapConDespacho(mo.sap, fdesp, registros, planes, m.op)?.enDespacho : false,
          }))
          .filter((x) => x.match)
          .map((x) => x.idx);
        updated[i].mod = matchingIdxs.length === 1 ? String(matchingIdxs[0]) : 'all';
      } else {
        updated[i].mod = 'all';
      }
    }

    // Auto-append row if typing in last row
    if (i === updated.length - 1 && (updated[i].op || updated[i].u || updated[i].c || updated[i].sap)) {
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
      updated[rowIdx].sap = '';
      if (m && m.modelos && m.modelos.length > 1) {
        const matchingIdxs = m.modelos
          .map((mo, idx) => ({
            idx,
            match: mo.sap ? compararSapConDespacho(mo.sap, fdesp, registros, planes, m.op)?.enDespacho : false,
          }))
          .filter((x) => x.match)
          .map((x) => x.idx);
        updated[rowIdx].mod = matchingIdxs.length === 1 ? String(matchingIdxs[0]) : 'all';
      } else {
        updated[rowIdx].mod = 'all';
      }
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
    const sapsEnTabla = new Set<string>();
    const ops: string[] = [];
    grid.forEach((r) => {
      if (r.op) {
        vistos[r.op.toLowerCase()] = true;
        const m = buscarCatalogo(r.op);
        sapsDeCatalogoOp(m).forEach((s) => sapsEnTabla.add(s));
        if (r.sap) extraerSaps(r.sap).forEach((s) => sapsEnTabla.add(s));
      }
    });

    const add = (op: string) => {
      const k = String(op || '').trim().toLowerCase();
      if (!k || vistos[k]) return;
      vistos[k] = true;
      const p = pedidoDe(op, fdesp, registros, catalogo, planesOp, planes);
      if (p && acumulado(op, fdesp, registros) >= p) return;
      // If SAP dispatch plan is loaded and this OP's SAP is already 100% covered in fdesp, skip
      if (planes[fdesp]?.items?.length) {
        const m = buscarCatalogo(op);
        const opSaps = sapsDeCatalogoOp(m);
        if (opSaps.length) {
          const sapInfo = compararSapConDespacho(opSaps.join(' + '), fdesp, registros, planes);
          if (sapInfo && sapInfo.enPlanSap && sapInfo.pedidoSap > 0 && sapInfo.pendienteSap === 0) {
            return;
          }
        }
      }
      ops.push(String(op).trim());
    };

    if (planesOp[fdesp]) {
      planesOp[fdesp].items.forEach((x) => add(x.op));
    }
    registros
      .slice()
      .reverse()
      .forEach((x) => {
        if ((x.fdesp || '') === fdesp) {
          add(x.op);
          extraerSaps(x.sap).forEach((s) => sapsEnTabla.add(s));
        }
      });

    // Also include catalog OPs for pending SAP items from planes[fdesp] that don't have an OP yet
    if (planes[fdesp]?.items?.length) {
      planes[fdesp].items.forEach((it) => {
        const sapUpper = String(it.sap || '').trim().toUpperCase();
        if (!sapUpper || sapsEnTabla.has(sapUpper)) return;
        const info = compararSapConDespacho(sapUpper, fdesp, registros, planes);
        if (info && info.pedidoSap > 0 && info.pendienteSap === 0) return;
        const matches = opsDeSap(sapUpper, catalogo);
        if (matches.length) {
          add(matches[0].m.op);
          sapsEnTabla.add(sapUpper);
        }
      });
    }

    if (!ops.length) {
      onToast('error', `No hay OPs pendientes para el ${fcorta(fdesp)}`);
      return;
    }

    const clean = grid.filter((r) => r.op || r.u || r.c);
    ops.forEach((op) => {
      const m = buscarCatalogo(op);
      let mod = 'all';
      if (m && m.modelos && m.modelos.length > 1) {
        const matchingIdxs = m.modelos
          .map((mo, idx) => ({
            idx,
            match: mo.sap ? compararSapConDespacho(mo.sap, fdesp, registros, planes, m.op)?.enDespacho : false,
          }))
          .filter((x) => x.match)
          .map((x) => x.idx);
        if (matchingIdxs.length === 1) mod = String(matchingIdxs[0]);
      }
      clean.push({
        op: m ? m.op : op,
        mod,
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
      onToast('error', 'Por favor ingresa la fecha de despacho');
      return;
    }
    if (!fecha) {
      onToast('error', 'Por favor ingresa la fecha de registro');
      return;
    }
    if (!nombre) {
      onToast('error', 'Por favor selecciona el habilitador');
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
      onToast('error', 'Ninguna fila está lista para guardar. Por favor revisa las filas marcadas con errores en rojo');
      return;
    }

    if (avisos.length && !confirmarAvisos(avisos)) return;
    if (
      !window.confirm(
        `Se guardarán ${okList.length} registro(s) para el despacho del ${fcorta(fdesp)}${errs ? `\n(${errs} fila(s) con errores quedan pendientes en la tabla)` : ''}.\n¿Deseas confirmar y guardar?`
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
        sap: o.mo?.sap || (r.sap || '').trim(),
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


  // Sub-metrics for current despacho
  const sub = registros.filter((r) => (r.fdesp || r.fecha || '').trim() === fdesp);
  const totEntregado = sub.reduce(
    (a, r) => a + (esStock(r) ? 0 : r.total || 0),
    0
  );
  const totStock = sub.reduce(
    (a, r) => a + (esStock(r) ? r.total || 0 : 0),
    0
  );
  const groupedSub = agrupar(sub, registros, planesOp, opExtra);
  const sapSummary = resumenSapsDespacho(fdesp, registros, planes, opExtra, catalogo);

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
          {currentPlan ? ` · Lista SAP: ${currentPlan.items.length} items (${currentPlan.archivo || 'cargada'})` : ''}
          {currentPlanOp ? ` · Lista OP: ${currentPlanOp.items.length} items (${currentPlanOp.archivo || 'cargada'})` : ''}
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
                  <th className="th-op">OP</th>
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
                  const sapTag =
                    o.sapEnDespacho && !o.vacia
                      ? o.sapCompleta
                        ? 'Completa SAP'
                        : `Faltan ${o.sapFalta} u SAP`
                      : '';
                  const msg = o.vacia
                    ? ''
                    : o.err.length
                    ? o.err.join(' · ')
                    : o.warn.length
                    ? o.warn.join(' · ')
                    : o.cierra
                    ? `Listo · completa la OP${sapTag ? ` (${sapTag})` : ''}`
                    : 'Listo' +
                      (o.falta ? ` · faltan ${o.falta}` : '') +
                      (sapTag ? ` · ${sapTag}` : '');

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
                            <option value="all">Todos juntos</option>
                            {o.m.modelos.map((mo: any, k: number) => {
                              const moMatch = mo.sap
                                ? compararSapConDespacho(mo.sap, fdesp, registros, planes, o.m.op)?.enDespacho
                                : false;
                              return (
                                <option key={k} value={String(k)}>
                                  {moMatch ? '✓ ' : ''}
                                  {mo.modelo || mo.descripcion}
                                </option>
                              );
                            })}
                          </select>
                        ) : (
                          <span style={{ color: 'var(--muted)', fontSize: '0.72rem' }}>—</span>
                        )}
                      </td>
                      <td className="ro cli">{o.m?.cliente || ''}</td>
                      <td className="ro mono sap">
                        {o.m ? (
                          <div>
                            <div>{o.mo?.sap || ''}</div>
                            {!o.vacia && o.sapInfo?.enDespacho && (
                              <div
                                style={{
                                  fontSize: '0.66rem',
                                  color: 'var(--green)',
                                  fontWeight: 700,
                                  lineHeight: 1.1,
                                }}
                                title={
                                  o.sapInfo.otrasOps.length
                                    ? `Mismo SAP que: ${o.sapInfo.otrasOps.map((x: any) => x.op).join(', ')}`
                                    : 'SAP en despacho'
                                }
                              >
                                ✓ Despacho{o.sapInfo.otrasOps.length ? ' (comp.)' : ''}
                              </div>
                            )}
                          </div>
                        ) : (
                          <input
                            className="mono"
                            style={{ width: '92px', fontSize: '0.78rem' }}
                            placeholder="SAP"
                            value={r.sap || ''}
                            onChange={(e) => updateGridRow(i, 'sap', e.target.value)}
                            title="Ingresa el código SAP para compararlo con el despacho"
                          />
                        )}
                      </td>
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
                  {buscarCatalogo(formOp)?.modelos.map((mo, i) => {
                    const moEnDesp = mo.sap
                      ? compararSapConDespacho(mo.sap, fdesp, registros, planes, formOp)?.enDespacho
                      : false;
                    return (
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
                        {moEnDesp && (
                          <span
                            style={{
                              marginLeft: '6px',
                              fontSize: '0.7rem',
                              fontWeight: 700,
                              color: formModeloSel === i ? 'inherit' : 'var(--green)',
                            }}
                          >
                            ✓ SAP en despacho
                          </span>
                        )}
                      </button>
                    );
                  })}
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
                  placeholder="Según modelo o manual"
                  value={formSap}
                  onChange={(e) => {
                    const val = e.target.value;
                    setFormSap(val);
                    if (!opAplicada && !formDesc.trim() && val.trim()) {
                      const d = buscarSap(val, catalogo, registros);
                      if (d) setFormDesc(d);
                    }
                  }}
                />
              </div>
            </div>

            {/* SAP Dispatch Comparison Banner */}
            {formOp.trim() && formSapInfo && formSapInfo.enDespacho && (
              <div
                style={{
                  background: 'rgba(56, 161, 105, 0.1)',
                  border: '1px solid var(--green)',
                  borderRadius: '10px',
                  padding: '10px 14px',
                  marginTop: '4px',
                  fontSize: '0.82rem',
                  lineHeight: 1.45,
                }}
              >
                <div style={{ fontWeight: 700, color: 'var(--green)', marginBottom: '4px' }}>
                  🎯 SAP {formSapInfo.sap} tomado en cuenta para despacho ({fcorta(fdesp)})
                </div>
                <div>
                  Pedido SAP: <strong>{formSapInfo.pedidoSap} u</strong> · Ya cubierto:{' '}
                  <strong>{formSapInfo.acumuladoSap} u</strong> · Pendiente SAP:{' '}
                  <strong>{formSapInfo.pendienteSap} u</strong>
                  {formSapInfo.stockPlanSinReg > 0 && (
                    <span> · Stock en lista SAP (sin asignar): <strong>{formSapInfo.stockPlanSinReg} u</strong></span>
                  )}
                </div>
                {formSapInfo.otrasOps.length > 0 && (
                  <div style={{ marginTop: '3px', color: 'var(--muted2)' }}>
                    Mismo SAP ya en despacho con:{' '}
                    <strong>
                      {formSapInfo.otrasOps.map((x) => `${x.op} (${x.acum} u)`).join(', ')}
                    </strong>
                  </div>
                )}
                {formTotalCalc > 0 && formSapInfo.pedidoSap > 0 && (
                  <div style={{ marginTop: '4px', fontWeight: 600 }}>
                    Con esta entrega (+{formTotalCalc} u) → SAP quedará en{' '}
                    <strong>
                      {formSapInfo.acumuladoSap + formTotalCalc} / {formSapInfo.pedidoSap} u
                    </strong>{' '}
                    {formSapInfo.acumuladoSap + formTotalCalc === formSapInfo.pedidoSap ? (
                      <span style={{ color: 'var(--green)' }}>(✓ Completa el SAP)</span>
                    ) : formSapInfo.acumuladoSap + formTotalCalc > formSapInfo.pedidoSap ? (
                      <span style={{ color: 'var(--red)' }}>
                        (Excede en {formSapInfo.acumuladoSap + formTotalCalc - formSapInfo.pedidoSap} u)
                      </span>
                    ) : (
                      <span style={{ color: 'var(--muted)' }}>
                        (Faltarán {formSapInfo.pedidoSap - (formSapInfo.acumuladoSap + formTotalCalc)} u)
                      </span>
                    )}
                  </div>
                )}
              </div>
            )}

            {formOp.trim() && currentPlan && currentPlan.items.length > 0 && formSap.trim() && formSapInfo && !formSapInfo.enPlanSap && (
              <div
                style={{
                  background: 'rgba(229, 62, 62, 0.08)',
                  border: '1px solid var(--red)',
                  borderRadius: '10px',
                  padding: '10px 14px',
                  marginTop: '4px',
                  fontSize: '0.82rem',
                  color: 'var(--red)',
                  fontWeight: 600,
                }}
              >
                ⚠️ El código SAP <span className="mono">{formSap.trim()}</span> de esta OP no figura en la lista de SAP a despachar del {fcorta(fdesp)}.
              </div>
            )}

            {formOp.trim() && currentPlan && currentPlan.items.length > 0 && !formSap.trim() && (
              <div
                style={{
                  background: 'var(--alt)',
                  border: '1px solid var(--border)',
                  borderRadius: '10px',
                  padding: '8px 12px',
                  marginTop: '4px',
                  fontSize: '0.8rem',
                  color: 'var(--muted)',
                }}
              >
                ℹ️ Hay una lista de despacho por SAP cargada. Selecciona el modelo o ingresa el código SAP para compararlo con los SAP a despachar.
              </div>
            )}
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
                onChange={(e) => {
                  setPedidoManualForm(true);
                  setFormPedido(e.target.value);
                }}
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

            {formOp.trim() && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '12px',
                  flexWrap: 'wrap',
                  background: formEnProduccion ? 'rgba(66, 153, 225, 0.1)' : 'var(--alt)',
                  border: formEnProduccion ? '1px solid var(--blue)' : '1px solid var(--border)',
                  borderRadius: '10px',
                  padding: '10px 14px',
                  margin: '0 0 14px',
                  transition: 'all 0.15s ease',
                }}
              >
                <label
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '8px',
                    cursor: 'pointer',
                    fontWeight: 700,
                    fontSize: '0.88rem',
                    color: formEnProduccion ? 'var(--blue)' : 'var(--text)',
                    margin: 0,
                  }}
                >
                  <input
                    type="checkbox"
                    checked={formEnProduccion}
                    onChange={(e) => setFormEnProduccion(e.target.checked)}
                    style={{
                      width: '18px',
                      height: '18px',
                      minHeight: '18px',
                      accentColor: 'var(--blue)',
                      margin: 0,
                      cursor: 'pointer',
                    }}
                  />
                  <span>¿OP en producción?</span>
                </label>

                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ fontSize: '0.8rem', color: 'var(--muted)', fontWeight: 600 }}>
                    Queda en planta:
                  </span>
                  <input
                    type="number"
                    min="0"
                    className="mono"
                    placeholder="0"
                    value={formPlanta}
                    onChange={(e) => setFormPlanta(e.target.value)}
                    style={{
                      width: '85px',
                      minHeight: '34px',
                      padding: '4px 8px',
                      fontSize: '0.86rem',
                      fontWeight: 700,
                    }}
                    title="Cantidad que queda en planta sin registrarse"
                  />
                  <span style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>u</span>
                </div>
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
                {groupedSub.ops.map((o) => {
                  const pd = o.pedido - o.acum;
                  const ok = o.pedido > 0 && pd <= 0;
                  const enProd = Boolean(o.enProduccion);
                  const cantPlanta = o.cantPlanta || 0;
                  const sapsDeOp = Object.keys(o.lineas)
                    .map((k) => o.lineas[k].sap)
                    .filter(Boolean)
                    .join(' + ');
                  const sapCheck = sapsDeOp
                    ? compararSapConDespacho(sapsDeOp, o.fdesp, registros, planes, o.op)
                    : null;
                  const sapCompartido = Boolean(sapCheck && sapCheck.otrasOps.length > 0);
                  const sapCubiertoPorOtras = Boolean(
                    sapCompartido &&
                      sapCheck!.pedidoSap > 0 &&
                      sapCheck!.acumuladoSap >= sapCheck!.pedidoSap
                  );
                  return (
                    <tr key={o.op}>
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
                        {sapCompartido && (
                          <div style={{ fontSize: '0.7rem', color: 'var(--blue)', fontWeight: 600 }}>
                            SAP: {sapCheck!.acumuladoSap}/{sapCheck!.pedidoSap || o.pedido} u
                          </div>
                        )}
                      </td>
                      <td className="n mono">
                        {sapCubiertoPorOtras && pd > 0 ? (
                          <span style={{ color: 'var(--green)', fontWeight: 700 }} title="Cubierto entre OPs del mismo SAP">
                            0 (SAP)
                          </span>
                        ) : Math.max(pd, 0) > 0 ? (
                          `${Math.max(pd, 0)} u`
                        ) : (
                          '0'
                        )}
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
                            <span className={`badge ${ok || sapCubiertoPorOtras ? 'b-COMPLETO' : 'b-INCOMPLETO'}`}>
                              {ok
                                ? pd < 0
                                  ? `COMPLETO (+${-pd})`
                                  : 'COMPLETO'
                                : sapCubiertoPorOtras
                                ? 'COMPLETO (SAP)'
                                : `Faltan ${pd}`}
                            </span>
                            {cantPlanta > 0 && !ok && !sapCubiertoPorOtras && (
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
                            title="Ver y borrar entregas individuales de esta OP"
                            style={{
                              borderColor: 'var(--amber)',
                            }}
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
      )}

      {/* Comparativo de Códigos SAP a Despachar (unifica múltiples OPs del mismo SAP) */}
      {sapSummary.length > 0 && (
        <div id="despachoResSap" className="panel" style={{ padding: '16px', marginTop: '12px' }}>
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
            <span>🎯 Comparativo por Código SAP a Despachar ({sapSummary.length} SAPs)</span>
            <span style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>
              Agrupa todas las OPs con el mismo código SAP para controlar el avance real de almacén
            </span>
          </div>

          <div className="table-wrap">
            <table className="list-table">
              <thead>
                <tr>
                  <th>SAP</th>
                  <th>Descripción</th>
                  <th>OPs en despacho</th>
                  <th className="n">Pedido SAP</th>
                  <th className="n">Stock inicial</th>
                  <th className="n">Entregado</th>
                  <th className="n">Acumulado</th>
                  <th className="n">Pendiente</th>
                  <th className="n">Excedente</th>
                  <th className="k">Estado SAP</th>
                </tr>
              </thead>
              <tbody>
                {sapSummary.map((s) => (
                  <tr key={s.sap}>
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
                        {s.sap}
                      </span>
                      {s.enPlanSap && (
                        <div style={{ fontSize: '0.68rem', color: 'var(--muted)', marginTop: '2px' }}>
                          En lista SAP
                        </div>
                      )}
                    </td>
                    <td style={{ fontSize: '0.82rem' }}>{s.desc || '—'}</td>
                    <td style={{ fontSize: '0.82rem' }}>
                      {s.ops.length > 0 ? (
                        <div>
                          {s.ops.map((opItem) => (
                            <div key={opItem.op} style={{ marginBottom: '2px' }}>
                              <span className="mono" style={{ fontWeight: 700 }}>
                                {opItem.op}
                              </span>
                              : {opItem.ent} u
                              {opItem.stock > 0 ? ` + ${opItem.stock} stk` : ''}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <span style={{ color: 'var(--muted)', fontSize: '0.78rem' }}>
                          Sin entregas aún
                          {s.catalogoOps.length > 0 && ` (Catálogo: ${s.catalogoOps.join(', ')})`}
                        </span>
                      )}
                    </td>
                    <td className="n mono">{s.pedidoSap || 0}</td>
                    <td className="n mono">
                      {s.stockRegistrado > 0
                        ? `${s.stockRegistrado} u`
                        : s.stockPlanSinReg > 0
                        ? `${s.stockPlanSinReg} u (plan)`
                        : '—'}
                    </td>
                    <td className="n mono">
                      <strong>{s.entregado} u</strong>
                    </td>
                    <td className="n mono">
                      <strong>{s.acumulado} u</strong>
                    </td>
                    <td className="n mono">{s.pendiente > 0 ? `${s.pendiente} u` : '0'}</td>
                    <td className="n mono">
                      {s.excedente > 0 ? (
                        <span style={{ color: 'var(--red)', fontWeight: 700 }}>
                          {s.excedente} u
                        </span>
                      ) : (
                        '0'
                      )}
                    </td>
                    <td className="k">
                      {s.estado ? (
                        <span className={`badge b-${s.estado.replace(/\s+/g, '')}`}>
                          {s.estado === 'COMPLETO' && s.excedente > 0
                            ? `COMPLETO (+${s.excedente})`
                            : s.estado === 'INCOMPLETO' && s.pendiente > 0
                            ? `Faltan ${s.pendiente}`
                            : s.estado === 'EN PRODUCCION'
                            ? 'EN PRODUCCIÓN'
                            : s.estado}
                        </span>
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Lista de entregas individuales registradas para este despacho */}
      {sub.filter((r) => !esStock(r)).length > 0 && (
        <div id="entregasDespachoLista" className="panel" style={{ padding: '16px', marginTop: '14px' }}>
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
            <span>
              📋 Entregas registradas en este despacho ({sub.filter((r) => !esStock(r)).length} entrada{sub.filter((r) => !esStock(r)).length !== 1 ? 's' : ''})
            </span>
            <span style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>
              ¿Error de ingreso? Haz clic en 🗑️ Borrar para eliminar cualquier registro erróneo
            </span>
          </div>

          <div className="table-wrap">
            <table className="list-table">
              <thead>
                <tr>
                  <th className="k">#</th>
                  <th>Fecha reg.</th>
                  <th>Turno</th>
                  <th>Habilitador</th>
                  <th className="th-op">OP</th>
                  <th>Cliente</th>
                  <th>SAP / Descripción</th>
                  <th>Empaque & Detalle</th>
                  <th className="n">Total</th>
                  <th className="k">Sync</th>
                  <th style={{ textAlign: 'right' }}>Acción</th>
                </tr>
              </thead>
              <tbody>
                {sub
                  .filter((r) => !esStock(r))
                  .map((r, idx) => {
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
                        <td>{r.cliente || '—'}</td>
                        <td>
                          <div style={{ fontWeight: 500 }}>{r.descripcion || '—'}</div>
                          {r.sap && (
                            <div className="mono" style={{ fontSize: '0.74rem', color: 'var(--muted)' }}>
                              SAP {r.sap}
                            </div>
                          )}
                        </td>
                        <td style={{ fontSize: '0.82rem', color: 'var(--muted2)' }}>
                          {r.c} {n} × {r.u}
                        </td>
                        <td className="n mono">
                          <strong>{r.total || 0} u</strong>
                        </td>
                        <td className="k" title={r.sync ? 'Sincronizado' : 'Pendiente'}>
                          {r.sync ? '☁️' : '⏳'}
                        </td>
                        <td className="actions" style={{ textAlign: 'right' }}>
                          <button
                            type="button"
                            className="del-btn"
                            onClick={() => handleBorrarRegistro(r)}
                            title="Eliminar esta entrega por error de ingreso"
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
          onDeleteRegistro={handleBorrarRegistro}
          onDeleteAllForOp={() => handleBorrarTodasOp(entregasModalOp.op, entregasModalOp.fdesp)}
          onClose={() => setEntregasModalOp(null)}
        />
      )}
    </div>
  );
};
