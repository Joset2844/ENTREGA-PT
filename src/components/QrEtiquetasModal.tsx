import React, { useEffect, useMemo, useState } from 'react';
import QRCode from 'qrcode';
import * as XLSX from 'xlsx';
import { CatalogoOp } from '../types';
import { hoy } from '../utils/helpers';
import {
  buildQrString,
  buildZplLabel,
  LABEL_SIZES,
  LabelSizeId,
  QrOpPayload,
} from '../utils/qr';

interface QrEtiquetasModalProps {
  catalogo: CatalogoOp[];
  onClose: () => void;
  onToast: (t: 'ok' | 'error', m: string) => void;
}

interface CatalogFlatRow {
  key: string;
  op: string;
  sap: string;
  modelo: string;
  desc: string;
  cliente: string;
  ped: number;
}

export const QrEtiquetasModal: React.FC<QrEtiquetasModalProps> = ({
  catalogo,
  onClose,
  onToast,
}) => {
  const [busqueda, setBusqueda] = useState('');
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [activeKey, setActiveKey] = useState<string>('');
  const [sizeId, setSizeId] = useState<LabelSizeId>('100x50');
  const [customW, setCustomW] = useState('100');
  const [customH, setCustomH] = useState('50');
  const [copies, setCopies] = useState('1');
  const [unidEmp, setUnidEmp] = useState('');
  const [empaque, setEmpaque] = useState<'caja' | 'paquete'>('caja');
  const [incluirPed, setIncluirPed] = useState(true);
  const [previewUrl, setPreviewUrl] = useState('');
  const [showGuide, setShowGuide] = useState(false);

  const resolvedDims = useMemo(() => {
    if (sizeId === 'custom') {
      const w = Math.min(200, Math.max(25, Number(customW) || 100));
      const h = Math.min(200, Math.max(20, Number(customH) || 50));
      return { widthMm: w, heightMm: h };
    }
    const sz = LABEL_SIZES[sizeId] || LABEL_SIZES['100x50'];
    return { widthMm: sz.widthMm, heightMm: sz.heightMm };
  }, [sizeId, customW, customH]);

  const flatRows: CatalogFlatRow[] = useMemo(() => {
    const out: CatalogFlatRow[] = [];
    catalogo.forEach((c) => {
      const ms = c.modelos && c.modelos.length ? c.modelos : [];
      if (ms.length > 1) {
        ms.forEach((m, idx) => {
          const p = parseInt(String(m.cantidadTotal || ''), 10);
          out.push({
            key: `${c.op}__${idx}`,
            op: c.op,
            sap: m.sap || c.sap || '',
            modelo: m.modelo || '',
            desc: m.descripcion || c.descripcionBase || c.descripcion || '',
            cliente: c.cliente || '',
            ped: !isNaN(p) && p > 0 ? p : c.cantidadTotal || 0,
          });
        });
      } else {
        const m0 = ms[0];
        out.push({
          key: `${c.op}__0`,
          op: c.op,
          sap: (m0?.sap || c.sap || '').trim(),
          modelo: m0?.modelo || '',
          desc: (m0?.descripcion || c.descripcion || '').trim(),
          cliente: c.cliente || '',
          ped: c.cantidadTotal || 0,
        });
      }
    });
    return out;
  }, [catalogo]);

  const filtradas = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    if (!q) return flatRows.slice(0, 120);
    return flatRows
      .filter((r) =>
        `${r.op} ${r.sap} ${r.modelo} ${r.desc} ${r.cliente}`.toLowerCase().includes(q)
      )
      .slice(0, 120);
  }, [flatRows, busqueda]);

  useEffect(() => {
    if (!activeKey && flatRows.length > 0) {
      setActiveKey(flatRows[0].key);
      setSelectedKeys([flatRows[0].key]);
    }
  }, [flatRows, activeKey]);

  const activeRow =
    flatRows.find((r) => r.key === activeKey) ||
    filtradas[0] ||
    flatRows[0] ||
    null;

  const buildPayloadForRow = (r: CatalogFlatRow): QrOpPayload => ({
    op: r.op,
    sap: r.sap || undefined,
    desc: r.desc || undefined,
    cli: r.cliente || undefined,
    ped: incluirPed && r.ped > 0 ? r.ped : undefined,
    u: parseInt(unidEmp, 10) > 0 ? parseInt(unidEmp, 10) : undefined,
    emp: parseInt(unidEmp, 10) > 0 ? empaque : undefined,
  });

  const activeQrData = activeRow ? buildQrString(buildPayloadForRow(activeRow)) : '';

  useEffect(() => {
    let cancelled = false;
    if (!activeQrData) {
      setPreviewUrl('');
      return;
    }
    QRCode.toDataURL(activeQrData, {
      width: 240,
      margin: 1,
      errorCorrectionLevel: 'M',
    })
      .then((url) => {
        if (!cancelled) setPreviewUrl(url);
      })
      .catch(() => {
        if (!cancelled) setPreviewUrl('');
      });
    return () => {
      cancelled = true;
    };
  }, [activeQrData]);

  const toggleSelect = (k: string) => {
    setActiveKey(k);
    setSelectedKeys((prev) =>
      prev.includes(k) ? prev.filter((x) => x !== k) : [...prev, k]
    );
  };

  const rowsToOutput = useMemo(() => {
    if (selectedKeys.length > 0) {
      const set = new Set(selectedKeys);
      const list = flatRows.filter((r) => set.has(r.key));
      if (list.length > 0) return list;
    }
    return activeRow ? [activeRow] : [];
  }, [selectedKeys, flatRows, activeRow]);

  const handlePrintLabels = async () => {
    if (!rowsToOutput.length) {
      onToast('error', 'Selecciona al menos una OP del catálogo');
      return;
    }

    const { widthMm, heightMm } = resolvedDims;
    const numCopies = Math.min(50, Math.max(1, parseInt(copies, 10) || 1));

    const escapeHtml = (s: string) =>
      String(s || '').replace(/[&<>"']/g, (c) =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] || c)
      );

    const rendered = await Promise.all(
      rowsToOutput.map(async (row) => {
        const payload = buildPayloadForRow(row);
        const qrText = buildQrString(payload);
        const dataUrl = await QRCode.toDataURL(qrText, {
          width: 320,
          margin: 1,
          errorCorrectionLevel: 'M',
        });
        return { row, payload, dataUrl };
      })
    );

    const labelsHtml: string[] = [];
    rendered.forEach(({ row, payload, dataUrl }) => {
      for (let cp = 0; cp < numCopies; cp++) {
        labelsHtml.push(`
          <div class="lbl">
            <div class="qr"><img src="${dataUrl}" alt="QR" /></div>
            <div class="txt">
              <div class="op">OP ${escapeHtml(row.op)}</div>
              ${row.sap ? `<div class="sap">SAP: ${escapeHtml(row.sap)}</div>` : ''}
              ${row.cliente ? `<div class="cli">${escapeHtml(row.cliente)}</div>` : ''}
              ${row.desc ? `<div class="desc">${escapeHtml(row.desc)}</div>` : ''}
              <div class="foot">
                ${payload.u ? `<span><b>${payload.u}</b> u/${payload.emp || 'caja'}</span>` : ''}
                ${row.ped > 0 ? `<span>Ped: ${row.ped}</span>` : ''}
              </div>
            </div>
          </div>
        `);
      }
    });

    const isSmall = widthMm <= 55 || heightMm <= 34;
    const isMedium = !isSmall && (widthMm <= 75 || heightMm <= 44);
    const isSquareLarge = widthMm >= 80 && heightMm >= 80;
    const qrMm = isSmall
      ? Math.max(16, Math.min(24, heightMm - 7))
      : isMedium
      ? Math.max(22, Math.min(30, heightMm - 10))
      : isSquareLarge
      ? Math.min(48, Math.round(heightMm * 0.46))
      : Math.max(26, Math.min(40, heightMm - 11));

    const html = `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><title>Etiquetas QR</title>
      <style>
        @page { size: ${widthMm}mm ${heightMm}mm; margin: 1.5mm; }
        * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        body { margin: 0; font-family: Arial, sans-serif; color: #000; }
        .lbl {
          width: ${widthMm - 3}mm;
          height: ${heightMm - 3}mm;
          display: flex;
          flex-direction: ${isSquareLarge ? 'column' : 'row'};
          align-items: center;
          gap: ${isSmall ? '2mm' : '3mm'};
          padding: ${isSmall ? '1.5mm' : '2.5mm'};
          page-break-after: always;
          overflow: hidden;
        }
        .lbl:last-child { page-break-after: auto; }
        .qr { flex: none; }
        .qr img { width: ${qrMm}mm; height: ${qrMm}mm; display: block; }
        .txt { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 0.8mm; }
        .op { font-size: ${isSmall ? '10pt' : '14pt'}; font-weight: 800; letter-spacing: 0.2px; }
        .sap { font-size: ${isSmall ? '8pt' : '10.5pt'}; font-weight: 700; font-family: monospace; }
        .cli { font-size: ${isSmall ? '6.5pt' : '8.5pt'}; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .desc { font-size: ${isSmall ? '6pt' : '8pt'}; line-height: 1.2; max-height: ${isSmall ? '16pt' : '30pt'}; overflow: hidden; }
        .foot { display: flex; gap: 6px; font-size: ${isSmall ? '6.5pt' : '8.5pt'}; margin-top: 1mm; }
      </style>
    </head><body>${labelsHtml.join('')}</body></html>`;

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
        setTimeout(() => fr.remove(), 2500);
      }, 300);
    }
  };

  const handleExportZDesignExcel = (exportAll: boolean) => {
    const source = exportAll ? flatRows : rowsToOutput;
    if (!source.length) {
      onToast('error', 'No hay datos del catálogo para exportar');
      return;
    }

    const data = source.map((row) => {
      const payload = buildPayloadForRow(row);
      return {
        OP: row.op,
        SAP: row.sap,
        MODELO: row.modelo,
        DESCRIPCION: row.desc,
        CLIENTE: row.cliente,
        PEDIDO: row.ped || 0,
        UNID_EMPAQUE: payload.u || '',
        EMPAQUE: payload.emp || '',
        QR_DATA: buildQrString(payload),
      };
    });

    const ws = XLSX.utils.json_to_sheet(data);
    ws['!cols'] = [
      { wch: 14 },
      { wch: 14 },
      { wch: 18 },
      { wch: 36 },
      { wch: 24 },
      { wch: 10 },
      { wch: 12 },
      { wch: 10 },
      { wch: 40 },
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Catalogo_QR');
    XLSX.writeFile(wb, `catalogo_qr_zdesign_${hoy()}.xlsx`);
    onToast(
      'ok',
      `Excel para ZebraDesigner exportado (${data.length} fila${data.length !== 1 ? 's' : ''})`
    );
  };

  const handleDownloadZpl = () => {
    if (!rowsToOutput.length) {
      onToast('error', 'Selecciona al menos una OP');
      return;
    }
    const numCopies = Math.min(50, Math.max(1, parseInt(copies, 10) || 1));
    const zpl = rowsToOutput
      .map((row) => {
        const payload = buildPayloadForRow(row);
        return buildZplLabel(payload, buildQrString(payload), sizeId, numCopies, resolvedDims);
      })
      .join('\n\n');

    const blob = new Blob([zpl], { type: 'text/plain;charset=utf-8' });
    const u = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = u;
    a.download = `etiquetas_zebra_${hoy()}.zpl`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(u), 3000);
    onToast('ok', `Archivo .zpl descargado (${rowsToOutput.length} etiqueta(s))`);
  };

  const handleCopyQrText = async () => {
    if (!activeQrData) {
      onToast('error', 'Selecciona una OP del catálogo');
      return;
    }
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(activeQrData);
      } else {
        const ta = document.createElement('textarea');
        ta.value = activeQrData;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
      }
      onToast('ok', `Texto QR copiado (${activeRow?.op || ''}) — pégalo en zDesign`);
    } catch {
      onToast('error', 'No se pudo copiar automáticamente; selecciona el texto azul "QR:"');
    }
  };

  const handleDownloadQrPng = async () => {
    if (!activeRow || !activeQrData) {
      onToast('error', 'Selecciona una OP del catálogo');
      return;
    }
    try {
      const url = await QRCode.toDataURL(activeQrData, {
        width: 480,
        margin: 2,
        errorCorrectionLevel: 'M',
      });
      const safeOp = activeRow.op.replace(/[^a-zA-Z0-9_-]/g, '_');
      const a = document.createElement('a');
      a.href = url;
      a.download = `QR_OP_${safeOp}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      onToast('ok', `Imagen QR_OP_${safeOp}.png descargada`);
    } catch {
      onToast('error', 'No se pudo generar la imagen PNG del QR');
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.7)',
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '12px',
      }}
    >
      <div
        className="card"
        style={{
          maxWidth: '940px',
          width: '100%',
          maxHeight: '92vh',
          overflowY: 'auto',
          background: 'var(--panel)',
          borderRadius: '16px',
          padding: '18px 20px',
          margin: 0,
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: '8px',
            flexWrap: 'wrap',
            marginBottom: '12px',
          }}
        >
          <div>
            <div className="sec" style={{ margin: 0, fontSize: '1.1rem' }}>
              🏷️ Etiquetas QR desde el Catálogo (Zebra / zDesign)
            </div>
            <div className="info" style={{ fontSize: '0.8rem', marginTop: '2px' }}>
              Genera QRs con OP, SAP y pedido para imprimir directo o conectar a ZebraDesigner (zDesign).
            </div>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              type="button"
              className="btn-s"
              onClick={() => setShowGuide((v) => !v)}
              style={{
                minHeight: '34px',
                padding: '4px 10px',
                borderColor: showGuide ? 'var(--blue)' : undefined,
                color: showGuide ? 'var(--blue)' : undefined,
              }}
            >
              {showGuide ? 'Ocultar guía zDesign' : '📘 Guía zDesign Básico'}
            </button>
            <button
              type="button"
              className="btn-s"
              onClick={onClose}
              style={{ minHeight: '34px', padding: '4px 12px' }}
            >
              Cerrar
            </button>
          </div>
        </div>

        {showGuide && (
          <div
            style={{
              background: 'var(--alt)',
              border: '1px solid var(--blue)',
              borderRadius: '12px',
              padding: '12px 14px',
              marginBottom: '14px',
              fontSize: '0.83rem',
              lineHeight: 1.5,
            }}
          >
            <div style={{ fontWeight: 700, color: 'var(--blue)', marginBottom: '6px' }}>
              Cómo imprimir desde el Catálogo usando ZebraDesigner Básico (sin base de datos):
            </div>
            <p style={{ margin: '0 0 8px', color: 'var(--muted)' }}>
              ZebraDesigner Básico (Essentials) no incluye conexión a Excel. Puedes imprimir sin pagar licencia usando cualquiera de estas 3 formas:
            </p>
            <ol style={{ margin: 0, paddingLeft: '18px' }}>
              <li>
                <strong>Opción 1 — Imprimir directo desde aquí (más rápida):</strong> Marca las OPs, elige la medida de tu rollo (o pon <em>Medida personalizada</em>) y pulsa <strong>Imprimir etiqueta(s)</strong>. En la ventana de Windows selecciona tu impresora <strong>Zebra</strong>.
              </li>
              <li>
                <strong>Opción 2 — Usar tu plantilla en ZebraDesigner Básico:</strong> Selecciona la OP y pulsa <strong>📋 Copiar texto QR</strong> para pegarlo en un objeto <em>Código QR → Datos fijos</em> dentro de zDesign, o pulsa <strong>🖼️ Descargar PNG</strong> para insertar la imagen del QR directo en tu etiqueta.
              </li>
              <li>
                <strong>Opción 3 — Archivo .ZPL (máxima nitidez):</strong> Pulsa <strong>⚡ .ZPL</strong> y envíalo a la impresora con la herramienta gratuita <em>Zebra Setup Utilities → Open Communication / Send File</em>.
              </li>
            </ol>
          </div>
        )}

        {!flatRows.length ? (
          <div className="empty">
            No hay OPs en el catálogo todavía. Actualiza desde Supabase o importa el Excel del catálogo primero.
          </div>
        ) : (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 340px), 1fr))',
              gap: '14px',
              alignItems: 'start',
            }}
          >
            {/* Left column: Search & Catalog list */}
            <div>
              <div className="field" style={{ marginBottom: '8px' }}>
                <label>Buscar en catálogo ({flatRows.length} items)</label>
                <input
                  type="text"
                  placeholder="OP, SAP, cliente o descripción..."
                  value={busqueda}
                  onChange={(e) => setBusqueda(e.target.value)}
                  style={{ minHeight: '40px' }}
                />
              </div>

              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  fontSize: '0.78rem',
                  color: 'var(--muted)',
                  marginBottom: '6px',
                }}
              >
                <span>Seleccionados: <b>{selectedKeys.length}</b></span>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button
                    type="button"
                    className="btn-s"
                    style={{ minHeight: '26px', padding: '2px 8px', fontSize: '0.74rem' }}
                    onClick={() => setSelectedKeys(filtradas.map((r) => r.key))}
                  >
                    Marcar visibles
                  </button>
                  <button
                    type="button"
                    className="btn-s"
                    style={{ minHeight: '26px', padding: '2px 8px', fontSize: '0.74rem' }}
                    onClick={() => setSelectedKeys([])}
                  >
                    Limpiar
                  </button>
                </div>
              </div>

              <div
                style={{
                  border: '1px solid var(--border)',
                  borderRadius: '10px',
                  maxHeight: '300px',
                  overflowY: 'auto',
                  background: 'var(--field)',
                }}
              >
                {filtradas.map((r) => {
                  const checked = selectedKeys.includes(r.key);
                  const isActive = activeRow?.key === r.key;
                  return (
                    <div
                      key={r.key}
                      onClick={() => setActiveKey(r.key)}
                      style={{
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: '8px',
                        padding: '8px 10px',
                        borderBottom: '1px solid var(--border)',
                        cursor: 'pointer',
                        background: isActive ? 'var(--amber-soft)' : undefined,
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleSelect(r.key)}
                        onClick={(e) => e.stopPropagation()}
                        style={{
                          width: '18px',
                          height: '18px',
                          minHeight: '18px',
                          marginTop: '2px',
                          accentColor: 'var(--amber)',
                        }}
                      />
                      <div style={{ flex: 1, minWidth: 0, fontSize: '0.82rem' }}>
                        <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
                          <span className="mono" style={{ fontWeight: 700, color: 'var(--op-tx)' }}>
                            {r.op}
                          </span>
                          {r.sap && (
                            <span className="mono" style={{ fontSize: '0.74rem', color: 'var(--muted)' }}>
                              SAP {r.sap}
                            </span>
                          )}
                          {r.ped > 0 && (
                            <span className="mono" style={{ fontSize: '0.72rem', color: 'var(--green)' }}>
                              {r.ped} u
                            </span>
                          )}
                        </div>
                        <div style={{ color: 'var(--text)', fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {r.desc || '—'}
                        </div>
                        <div style={{ fontSize: '0.74rem', color: 'var(--muted)' }}>
                          {r.cliente}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Right column: Label options + Live QR Preview */}
            <div>
              <div className="row2" style={{ gap: '8px' }}>
                <div className="field" style={{ marginBottom: '8px' }}>
                  <label>Tamaño etiqueta</label>
                  <select
                    value={sizeId}
                    onChange={(e) => setSizeId(e.target.value as LabelSizeId)}
                    style={{ minHeight: '40px', fontSize: '0.85rem' }}
                  >
                    {Object.values(LABEL_SIZES).map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field" style={{ marginBottom: '8px' }}>
                  <label>Copias por etiqueta</label>
                  <input
                    type="number"
                    min="1"
                    max="50"
                    className="mono"
                    value={copies}
                    onChange={(e) => setCopies(e.target.value)}
                    style={{ minHeight: '40px' }}
                  />
                </div>
              </div>

              {sizeId === 'custom' && (
                <div className="row2" style={{ gap: '8px' }}>
                  <div className="field" style={{ marginBottom: '8px' }}>
                    <label>Ancho etiqueta (mm)</label>
                    <input
                      type="number"
                      min="25"
                      max="200"
                      className="mono"
                      value={customW}
                      onChange={(e) => setCustomW(e.target.value)}
                      style={{ minHeight: '38px' }}
                    />
                  </div>
                  <div className="field" style={{ marginBottom: '8px' }}>
                    <label>Alto etiqueta (mm)</label>
                    <input
                      type="number"
                      min="20"
                      max="200"
                      className="mono"
                      value={customH}
                      onChange={(e) => setCustomH(e.target.value)}
                      style={{ minHeight: '38px' }}
                    />
                  </div>
                </div>
              )}

              <div className="row2" style={{ gap: '8px' }}>
                <div className="field" style={{ marginBottom: '8px' }}>
                  <label>Unid. x empaque en QR (opcional)</label>
                  <input
                    type="number"
                    min="0"
                    className="mono"
                    placeholder="Ej. 500"
                    value={unidEmp}
                    onChange={(e) => setUnidEmp(e.target.value)}
                    style={{ minHeight: '40px' }}
                  />
                </div>
                <div className="field" style={{ marginBottom: '8px' }}>
                  <label>Empaque</label>
                  <select
                    value={empaque}
                    onChange={(e) => setEmpaque(e.target.value as 'caja' | 'paquete')}
                    style={{ minHeight: '40px', fontSize: '0.85rem' }}
                  >
                    <option value="caja">Caja</option>
                    <option value="paquete">Paquete</option>
                  </select>
                </div>
              </div>

              <label
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  fontSize: '0.82rem',
                  cursor: 'pointer',
                  marginBottom: '10px',
                }}
              >
                <input
                  type="checkbox"
                  checked={incluirPed}
                  onChange={(e) => setIncluirPed(e.target.checked)}
                  style={{ width: '16px', height: '16px', minHeight: '16px', accentColor: 'var(--amber)' }}
                />
                <span>Incluir cantidad pedida dentro del código QR</span>
              </label>

              {/* Preview Box */}
              {activeRow && (
                <div
                  style={{
                    background: '#FFFFFF',
                    color: '#111111',
                    border: '2px dashed #CBD5E0',
                    borderRadius: '10px',
                    padding: '12px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px',
                    marginBottom: '10px',
                  }}
                >
                  {previewUrl && (
                    <img
                      src={previewUrl}
                      alt="Vista previa QR"
                      style={{ width: '105px', height: '105px', flex: 'none', display: 'block' }}
                    />
                  )}
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div className="mono" style={{ fontSize: '1.05rem', fontWeight: 800 }}>
                      OP {activeRow.op}
                    </div>
                    {activeRow.sap && (
                      <div className="mono" style={{ fontSize: '0.85rem', fontWeight: 700, color: '#2D3748' }}>
                        SAP: {activeRow.sap}
                      </div>
                    )}
                    <div style={{ fontSize: '0.78rem', fontWeight: 700, color: '#2D3748', marginTop: '2px' }}>
                      {activeRow.cliente}
                    </div>
                    <div style={{ fontSize: '0.74rem', color: '#4A5568', lineHeight: 1.25 }}>
                      {activeRow.desc}
                    </div>
                    <div
                      className="mono"
                      style={{
                        fontSize: '0.68rem',
                        color: '#2B6CB0',
                        marginTop: '4px',
                        wordBreak: 'break-all',
                      }}
                    >
                      QR: {activeQrData}
                    </div>
                  </div>
                </div>
              )}

              {/* Actions */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <button
                  type="button"
                  className="btn"
                  style={{ minHeight: '42px', fontSize: '0.92rem' }}
                  onClick={handlePrintLabels}
                >
                  🖨️ Imprimir {rowsToOutput.length} etiqueta(s) en Zebra / impresora ({resolvedDims.widthMm}×{resolvedDims.heightMm}mm)
                </button>
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    className="btn-s"
                    style={{ flex: 1 }}
                    onClick={handleCopyQrText}
                    title="Copia el texto del QR para pegarlo como Datos fijos en ZebraDesigner Básico"
                  >
                    📋 Copiar texto QR
                  </button>
                  <button
                    type="button"
                    className="btn-s"
                    style={{ flex: 1 }}
                    onClick={handleDownloadQrPng}
                    title="Descarga la imagen PNG del QR para insertarla en tu diseño de ZebraDesigner Básico"
                  >
                    🖼️ Descargar PNG
                  </button>
                  <button
                    type="button"
                    className="btn-s"
                    onClick={handleDownloadZpl}
                    title="Archivo .ZPL directo para enviar con Zebra Setup Utilities"
                  >
                    ⚡ .ZPL
                  </button>
                </div>
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    className="btn-s"
                    style={{ flex: 1, fontSize: '0.78rem' }}
                    onClick={() => handleExportZDesignExcel(false)}
                    title="Excel con columna QR_DATA (solo seleccionado)"
                  >
                    📊 Excel (Selec.)
                  </button>
                  <button
                    type="button"
                    className="btn-s"
                    style={{ flex: 1, fontSize: '0.78rem' }}
                    onClick={() => handleExportZDesignExcel(true)}
                    title="Excel con todo el catálogo y columna QR_DATA"
                  >
                    📚 Excel (Todo)
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
