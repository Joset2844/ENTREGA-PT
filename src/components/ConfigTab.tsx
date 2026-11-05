import React, { useState, useRef, useEffect } from 'react';
import * as XLSX from 'xlsx';
import { CatalogoOp, Ingreso, Registro } from '../types';
import { catTs, leerCatalogoSb, normOpSb } from '../services/supabase';
import { K_CAT, K_CATTS, K_RES, ld, sv } from '../services/storage';
import { archivoOk } from '../services/excel';
import { hoy, norm } from '../utils/helpers';
import { validoRec } from '../services/sheets';

interface ConfigTabProps {
  nombres: string[];
  onNombresChange: (newNombres: string[]) => void;
  catalogo: CatalogoOp[];
  onCatalogoChange: (newCat: CatalogoOp[]) => void;
  registros: Registro[];
  onRegistrosChange: (newRegs: Registro[]) => void;
  ingresos: Ingreso[];
  onIngresosChange: (newIngs: Ingreso[]) => void;
  catErr: string;
  onCatErrChange: (err: string) => void;
  onToast: (t: 'ok' | 'error', m: string) => void;
}

export const ConfigTab: React.FC<ConfigTabProps> = ({
  nombres,
  onNombresChange,
  catalogo,
  onCatalogoChange,
  registros,
  onRegistrosChange,
  ingresos,
  onIngresosChange,
  catErr,
  onCatErrChange,
  onToast,
}) => {
  const [nombresTxt, setNombresTxt] = useState('');
  const [pwaItems, setPwaItems] = useState<{ ok: boolean | null; text: string }[]>([]);
  const [ultimoRespaldo, setUltimoRespaldo] = useState<string | null>(() =>
    ld<string | null>(K_RES, null)
  );

  const fileInputRef = useRef<HTMLInputElement>(null);
  const resFileInputRef = useRef<HTMLInputElement>(null);

  // Run PWA diagnostics
  const runPwaDiag = () => {
    const list: { ok: boolean | null; text: string }[] = [];
    const ua = navigator.userAgent;
    const seguro =
      location.protocol === 'https:' ||
      location.hostname === 'localhost' ||
      location.hostname === '127.0.0.1';

    list.push({
      ok: seguro,
      text: seguro
        ? `Conexión segura (${location.protocol}//${location.host})`
        : `La página NO está en HTTPS (${location.protocol}//${location.host}). Sin HTTPS no se puede instalar.`,
    });

    if (/FBAN|FBAV|Instagram|WhatsApp|Line\/|; wv\)/.test(ua)) {
      list.push({
        ok: false,
        text: 'Estás en un navegador interno (WhatsApp, Facebook, etc.). Abre el link en Chrome (Android) o Safari (iPhone).',
      });
    }

    const nav = navigator as any;
    const standalone =
      window.matchMedia('(display-mode: standalone)').matches || nav.standalone;
    list.push({
      ok: null,
      text: standalone
        ? 'Ya estás usando la app instalada.'
        : 'Se está usando en el navegador (no instalada).',
    });

    const link = document.querySelector('link[rel="manifest"]') as HTMLLinkElement;
    if (!link) {
      list.push({ ok: false, text: 'Falta el enlace al manifest en index.html' });
    } else {
      fetch(link.href, { cache: 'no-store' })
        .then((r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return r.json().then((m) => ({ m, ct: r.headers.get('content-type') || '' }));
        })
        .then(({ m, ct }) => {
          list.push({ ok: true, text: `manifest.json cargado (${ct || 'sin tipo'})` });
          list.push({
            ok: !!(m.name || m.short_name) && !!m.start_url && /standalone|fullscreen|minimal-ui/.test(m.display || ''),
            text: 'Manifest con nombre, start_url y display standalone',
          });
          const tiene = (n: number) =>
            (m.icons || []).some((ic: any) => String(ic.sizes || '').indexOf(`${n}x${n}`) !== -1);
          if (!tiene(192) || !tiene(512)) {
            list.push({ ok: false, text: 'El manifest necesita íconos de 192x192 y 512x512' });
          }
          setPwaItems([...list]);
        })
        .catch((e) => {
          list.push({ ok: false, text: `No se pudo leer manifest.json: ${e.message}` });
          setPwaItems([...list]);
        });
    }

    if (!('serviceWorker' in navigator)) {
      list.push({ ok: false, text: 'Este navegador no soporta service worker' });
    } else {
      navigator.serviceWorker.getRegistration().then((reg) => {
        if (reg) {
          list.push({
            ok: true,
            text: `Service worker registrado (${reg.active ? 'activo' : 'instalando'}), alcance: ${reg.scope}`,
          });
        } else {
          list.push({ ok: false, text: 'Service worker NO registrado' });
        }
        setPwaItems([...list]);
      });
    }

    const win = window as any;
    list.push({
      ok: null,
      text: win.__ip
        ? 'El navegador permite instalar: usa el botón «Instalar app» de arriba.'
        : 'El navegador todavía no ofrece instalar. Si ya la instalaste, no aparece.',
    });

    if (/iPhone|iPad|iPod/.test(ua)) {
      list.push({
        ok: null,
        text: 'iPhone/iPad: en Safari toca Compartir → «Agregar a pantalla de inicio». No hay botón de instalar.',
      });
    }

    setPwaItems(list);
  };

  useEffect(() => {
    runPwaDiag();
  }, []);

  // Add Habilitadores
  const handleAddNombres = () => {
    const list = nombresTxt
      .split(/[\n,]+/)
      .map((x) => x.trim())
      .filter(Boolean);
    if (!list.length) {
      onToast('error', 'Escribe al menos un nombre');
      return;
    }
    const updated = [...nombres];
    list.forEach((x) => {
      if (updated.indexOf(x) === -1) updated.push(x);
    });
    updated.sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }));
    onNombresChange(updated);
    setNombresTxt('');
    onToast('ok', `${list.length} nombre(s) procesados`);
  };

  const handleRemoveNombre = (n: string) => {
    const updated = nombres.filter((x) => x !== n);
    onNombresChange(updated);
  };

  // Supabase update
  const handleActualizarSupabase = async () => {
    try {
      const rows = await leerCatalogoSb();
      const mp: Record<string, CatalogoOp> = {};
      const ord: string[] = [];
      rows.forEach((r) => {
        const it = normOpSb(r);
        if (!it) return;
        const k = it.op.toLowerCase();
        if (!(k in mp)) ord.push(k);
        mp[k] = it;
      });
      const nuevo = ord.map((k) => mp[k]);
      if (!nuevo.length) {
        throw new Error('Supabase devolvió 0 OP');
      }
      if (catalogo.length >= 10 && nuevo.length < catalogo.length * 0.5) {
        if (
          !window.confirm(
            `El catálogo nuevo trae ${nuevo.length} OP y tienes ${catalogo.length}.\n¿Reemplazar de todas formas?`
          )
        ) {
          return;
        }
      }
      onCatalogoChange(nuevo);
      sv(K_CAT, nuevo);
      localStorage.setItem(K_CATTS, String(Date.now()));
      onCatErrChange('');
      onToast('ok', `Catálogo actualizado: ${nuevo.length} OP`);
    } catch (err: any) {
      const msg = String(err?.message || err).slice(0, 100);
      onCatErrChange(msg);
      onToast('error', `No se pudo leer el catálogo de Supabase: ${msg.slice(0, 70)}`);
    }
  };

  // Excel Catalog Import
  const handleExcelCatalogChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f || !archivoOk(f, onToast)) return;

    const rd = new FileReader();
    rd.onload = (ev) => {
      try {
        const wb = XLSX.read(new Uint8Array(ev.target?.result as ArrayBuffer), { type: 'array' });
        const s1 = wb.Sheets[wb.SheetNames[0]];
        const s2 = wb.SheetNames.length > 1 ? wb.Sheets[wb.SheetNames[1]] : null;

        const rows1 = XLSX.utils.sheet_to_json<any[]>(s1, { header: 1, defval: '' });
        if (rows1.length < 2) {
          onToast('error', 'El catálogo viene vacío');
          return;
        }

        const h1 = rows1[0].map(norm);
        const colOp = (h: string[]) => {
          const i = h.findIndex((x) => x === 'op');
          return i !== -1 ? i : h.findIndex((x) => x.indexOf('op') === 0);
        };
        const colDe = (h: string[], t: string) => h.findIndex((x) => x.indexOf(t) !== -1);

        const iOp = colOp(h1);
        const iD = colDe(h1, 'descripcion');
        const iC = colDe(h1, 'cliente');
        const iS = colDe(h1, 'sap');
        const iQ = h1.findIndex((x) => x.indexOf('cantidad') !== -1 || x.indexOf('total') !== -1);

        if (iOp === -1 || iD === -1 || iC === -1) {
          onToast('error', 'Debe tener columnas OP, Descripción y Cliente');
          return;
        }

        const mapa: Record<string, CatalogoOp> = {};
        const orden: string[] = [];

        rows1.slice(1).forEach((r) => {
          const op = String(r[iOp] || '').trim();
          if (!op) return;
          const mo = {
            descripcion: String(r[iD] || '').trim(),
            sap: iS !== -1 ? String(r[iS] || '').trim() : '',
          };
          if (!mapa[op]) {
            mapa[op] = {
              op,
              cliente: String(r[iC] || '').trim(),
              modelos: [],
              cantidadTotal: 0,
              descripcion: '',
              sap: '',
            };
            orden.push(op);
          }
          if (iQ !== -1) {
            const nq = parseInt(String(r[iQ] || '').trim(), 10);
            if (!isNaN(nq)) mapa[op].cantidadTotal += nq;
          }
          if (!mapa[op].modelos.some((x) => x.descripcion === mo.descripcion && x.sap === mo.sap)) {
            mapa[op].modelos.push(mo);
          }
        });

        // Parse optional Sheet 2 (Modelos)
        if (s2) {
          const rows2 = XLSX.utils.sheet_to_json<any[]>(s2, { header: 1, defval: '' });
          if (rows2.length >= 2) {
            const h2 = rows2[0].map(norm);
            const iOp2 = colOp(h2);
            const iM2 = colDe(h2, 'modelo');
            const iS2 = colDe(h2, 'sap');
            const iQ2 = h2.findIndex(
              (x) => x.indexOf('cantidad') !== -1 || x.indexOf('total') !== -1
            );

            if (iOp2 !== -1 && iM2 !== -1) {
              const mapa2: Record<string, CatalogoOp> = {};
              const orden2: string[] = [];

              rows2.slice(1).forEach((r) => {
                const op = String(r[iOp2] || '').trim();
                if (!op) return;
                const mt = String(r[iM2] || '').trim();
                const b = mapa[op] || Object.values(mapa).find((x) => x.op.toLowerCase() === op.toLowerCase());
                const key = b ? b.op : op;
                const db = b && b.modelos[0] ? b.modelos[0].descripcion : '';
                const mo = {
                  modelo: mt,
                  descripcion: db ? `${db} - ${mt}` : mt,
                  sap: iS2 !== -1 ? String(r[iS2] || '').trim() : '',
                };
                if (!mapa2[key]) {
                  mapa2[key] = {
                    op: key,
                    cliente: b ? b.cliente : '',
                    modelos: [],
                    descripcionBase: db,
                    cantidadTotal: 0,
                    descripcion: '',
                    sap: '',
                  };
                  orden2.push(key);
                }
                if (iQ2 !== -1) {
                  const nq2 = parseInt(String(r[iQ2] || '').trim(), 10);
                  if (!isNaN(nq2)) mapa2[key].cantidadTotal += nq2;
                }
                if (!mapa2[key].modelos.some((x) => x.modelo === mo.modelo && x.sap === mo.sap)) {
                  mapa2[key].modelos.push(mo);
                }
              });

              orden2.forEach((op) => {
                if (!mapa[op]) orden.push(op);
                mapa[op] = mapa2[op];
              });
            }
          }
        }

        const nuevoCat = orden.map((op) => {
          const it = mapa[op];
          if (it.modelos.length > 1) {
            it.descripcion = `Varios modelos (${it.modelos.length})`;
            it.sap = '';
            if (!it.descripcionBase) it.descripcionBase = it.modelos[0].descripcion;
          } else if (it.modelos.length === 1) {
            it.descripcion = it.modelos[0].descripcion;
            it.sap = it.modelos[0].sap;
            it.descripcionBase = it.descripcion;
          }
          return it;
        });

        if (!nuevoCat.length) {
          onToast('error', 'El catálogo viene vacío');
          return;
        }

        onCatalogoChange(nuevoCat);
        sv(K_CAT, nuevoCat);
        onToast('ok', `Catálogo: ${nuevoCat.length} OP${s2 ? ' (con modelos)' : ''}`);
      } catch {
        onToast('error', 'No se pudo leer el archivo');
      }
    };
    rd.readAsArrayBuffer(f);
  };

  // Download Backup
  const handleDescargarRespaldo = () => {
    const o = {
      version: 1,
      fecha: new Date().toISOString(),
      registros,
      ingresos,
      habilitadores: nombres,
    };
    try {
      const blob = new Blob([JSON.stringify(o)], { type: 'application/json' });
      const u = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = u;
      a.download = `respaldo_entregas_${hoy()}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(u), 4000);

      const stamp = `${hoy()} ${new Date().toTimeString().slice(0, 5)}`;
      sv(K_RES, stamp);
      setUltimoRespaldo(stamp);
      onToast('ok', `Respaldo descargado: ${registros.length} registros y ${ingresos.length} ingresos`);
    } catch {
      onToast('error', 'No se pudo generar el respaldo');
    }
  };

  // Restore Backup
  const handleRestaurarRespaldo = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    if (!/\.json$/i.test(f.name) || f.size === 0 || f.size > 2e7) {
      onToast('error', 'Elige un respaldo .json válido');
      return;
    }

    const rd = new FileReader();
    rd.onload = (ev) => {
      let o: any;
      try {
        o = JSON.parse(ev.target?.result as string);
      } catch {
        onToast('error', 'El archivo no es un respaldo válido');
        return;
      }

      if (!o || typeof o !== 'object' || (!Array.isArray(o.registros) && !Array.isArray(o.ingresos))) {
        onToast('error', 'El archivo no tiene registros ni ingresos');
        return;
      }

      const prep = (arr: any[]) => {
        const cleanArr = Array.isArray(arr) ? arr : [];
        const ok = cleanArr.filter(validoRec);
        return { ok, mal: cleanArr.length - ok.length };
      };

      const R = prep(o.registros);
      const I = prep(o.ingresos);
      const idsR: Record<string, boolean> = {};
      const idsI: Record<string, boolean> = {};
      registros.forEach((r) => {
        idsR[r.id] = true;
      });
      ingresos.forEach((r) => {
        idsI[r.id] = true;
      });

      const nR = R.ok.filter((r) => !idsR[r.id]);
      const nI = I.ok.filter((r) => !idsI[r.id]);
      const mal = R.mal + I.mal;

      if (!nR.length && !nI.length) {
        onToast('ok', `No hay nada nuevo que restaurar${mal ? ` (${mal} con datos incompletos omitidos)` : ''}`);
        return;
      }

      if (
        !window.confirm(
          `Respaldo del ${String(o.fecha || '').slice(0, 10)}:\n• ${nR.length} registro(s) y ${nI.length} ingreso(s) que no existen aquí se agregarán\n• ${(R.ok.length - nR.length) + (I.ok.length - nI.length)} ya existen y no se tocan${mal ? `\n• ${mal} con datos incompletos se omiten` : ''}\n\n¿Restaurar?`
        )
      ) {
        return;
      }

      nR.forEach((r) => {
        r.sync = false;
      });
      nI.forEach((r) => {
        r.sync = false;
      });

      const newCombinedRegs = [...registros, ...nR];
      const newCombinedIngs = [...ingresos, ...nI];

      const newNombres = [...nombres];
      (Array.isArray(o.habilitadores) ? o.habilitadores : [])
        .concat([...nR, ...nI].map((r) => r.nombre))
        .forEach((n: any) => {
          const str = String(n || '').trim();
          if (str && newNombres.indexOf(str) === -1) newNombres.push(str);
        });
      newNombres.sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }));

      onNombresChange(newNombres);
      onRegistrosChange(newCombinedRegs);
      onIngresosChange(newCombinedIngs);

      onToast('ok', `Restaurado: ${nR.length} registro(s) y ${nI.length} ingreso(s)`);
    };
    rd.readAsText(f);
  };

  return (
    <div id="t-cfg">
      {/* Habilitadores panel */}
      <div className="panel">
        <div className="sec">Habilitadores</div>
        <textarea
          id="nombresTxt"
          rows={2}
          placeholder="Uno por línea o separados por coma"
          value={nombresTxt}
          onChange={(e) => setNombresTxt(e.target.value)}
        />
        <button
          className="btn sec2"
          id="addNombres"
          type="button"
          style={{ marginTop: '8px' }}
          onClick={handleAddNombres}
        >
          Agregar habilitadores
        </button>

        <div id="nombresLista" style={{ marginTop: '10px' }}>
          {!nombres.length ? (
            <div className="empty">Sin nombres todavía.</div>
          ) : (
            nombres.map((n) => (
              <div
                key={n}
                className="card"
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '8px 12px',
                }}
              >
                <span>{n}</span>
                <button
                  className="del"
                  type="button"
                  onClick={() => handleRemoveNombre(n)}
                >
                  Quitar
                </button>
              </div>
            ))
          )}
        </div>
      </div>

      {/* PWA Panel */}
      <div className="panel">
        <div className="sec">Instalación de la app (PWA)</div>
        <div id="pwaDiag" style={{ fontSize: '0.85rem', color: 'var(--muted2)', lineHeight: 1.4 }}>
          {pwaItems.map((it, idx) => (
            <div key={idx} style={{ margin: '3px 0' }}>
              {it.ok === null ? 'ℹ️' : it.ok ? '✅' : '❌'} {it.text}
            </div>
          ))}
        </div>
        <button
          className="btn-s"
          id="pwaRevisar"
          type="button"
          style={{ marginTop: '8px' }}
          onClick={runPwaDiag}
        >
          Revisar de nuevo
        </button>
      </div>

      {/* Catálogo de OP */}
      <div className="panel">
        <div className="sec">Catálogo de OP</div>
        <p id="catInfo" className="info" style={{ margin: '0 0 10px' }}>
          {catalogo.length} OP en catálogo
          {catTs()
            ? ` · Supabase actualizado ${new Date(catTs()).toLocaleString('es-PE', {
                day: '2-digit',
                month: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
              })}`
            : ''}
          {catErr ? ` · ⚠️ ${catErr}` : ''}
        </p>
        <div className="tools">
          <button
            className="btn-s"
            id="actCat"
            type="button"
            onClick={handleActualizarSupabase}
          >
            Actualizar desde Supabase
          </button>
          <button
            className="btn-s"
            id="impCat"
            type="button"
            onClick={() => fileInputRef.current?.click()}
          >
            Importar Excel (solo este equipo)
          </button>
          <input
            type="file"
            ref={fileInputRef}
            accept=".xlsx,.xls,.csv"
            className="hidden"
            onChange={handleExcelCatalogChange}
          />
        </div>
        <p className="info" style={{ margin: 0, fontSize: '0.78rem' }}>
          El catálogo se lee de la tabla <b>catalogo_op</b> de Supabase (la misma de las otras apps)
          y se actualiza solo cada 4 horas al abrir la app. Si cargaron OP nuevas, toca «Actualizar».
          «Importar Excel» solo sirve en este equipo y se reemplaza al actualizar.
        </p>
      </div>

      {/* Respaldo de datos */}
      <div className="panel">
        <div className="sec">Respaldo de datos</div>
        <p className="info" style={{ margin: '0 0 10px' }}>
          Descarga una copia de tus registros e ingresos. Al restaurar solo se agregan los que no
          existen; nunca se borra ni se pisa nada.
        </p>
        <div className="tools">
          <button
            className="btn-s"
            id="resBaj"
            type="button"
            onClick={handleDescargarRespaldo}
          >
            Descargar respaldo
          </button>
          <button
            className="btn-s"
            id="resSub"
            type="button"
            onClick={() => resFileInputRef.current?.click()}
          >
            Restaurar respaldo
          </button>
          <input
            type="file"
            ref={resFileInputRef}
            accept=".json,application/json"
            className="hidden"
            onChange={handleRestaurarRespaldo}
          />
        </div>
        <div id="resInfo" className="info">
          {ultimoRespaldo
            ? `Último respaldo descargado: ${ultimoRespaldo}`
            : 'Aún no has descargado ningún respaldo en este equipo'}
        </div>
      </div>
    </div>
  );
};
