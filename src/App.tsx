import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  CatalogoOp,
  Ingreso,
  OpExtra,
  PlanDespacho,
  PlanOp,
  Registro,
  ToastItem,
} from './types';
import {
  K_CAT,
  K_CATTS,
  K_ING,
  K_MODO_ING,
  K_MODO_REG,
  K_NOM,
  K_OP_EXTRA,
  K_PLAN,
  K_PLANOP,
  K_REG,
  K_SES_ING,
  K_SESION,
  ld,
  requestStoragePersistence,
  sv,
} from './services/storage';
import {
  colaDel,
  encolarDel,
  huella,
  llamar,
  normFecha,
  procesarDel,
  recRemotoOk,
  soloValidos,
} from './services/sheets';
import { CAT_HORAS, leerCatalogoSb, normOpSb } from './services/supabase';
import { hoy, recalcularEstados, sanitizarStockDuplicados } from './utils/helpers';
import { Header } from './components/Header';
import { Toasts } from './components/Toasts';
import { SyncBadge } from './components/SyncBadge';
import { RegistrarTab } from './components/RegistrarTab';
import { RegistrosTab } from './components/RegistrosTab';
import { IngresosTab } from './components/IngresosTab';
import { ConfigTab } from './components/ConfigTab';

export const App: React.FC = () => {
  // Navigation
  const [activeTab, setActiveTab] = useState<'reg' | 'lista' | 'ing' | 'cfg'>('reg');

  // Shared Data
  const [nombres, setNombres] = useState<string[]>(() => ld<string[]>(K_NOM, []));
  const [catalogo, setCatalogo] = useState<CatalogoOp[]>(() => {
    const raw = ld<CatalogoOp[]>(K_CAT, []);
    return raw.map((c) => {
      if (!c.modelos) c.modelos = [{ descripcion: c.descripcion || '', sap: c.sap || '' }];
      return c;
    });
  });
  const [catErr, setCatErr] = useState('');

  const [registros, setRegistros] = useState<Registro[]>(() => {
    const raw = ld<Registro[]>(K_REG, []);
    const mapped = raw.map((r: any) => {
      if (!r.mov && r.total === undefined) {
        const e = (r.entTotal || 0) > 0;
        r.mov = e ? 'Entregado' : 'Por entregar';
        r.empaque = e ? r.entTipo : r.porTipo;
        r.u = e ? r.entU : r.porU;
        r.c = e ? r.entC : r.porC;
        r.total = e ? r.entTotal : r.porTotal;
        r.estado = r.estado || '';
      }
      if (r.pedido === undefined) {
        if (r.mov === 'Por entregar') {
          r.pedido = r.total || 0;
          r.total = 0;
          r.u = 0;
          r.c = 0;
        } else {
          r.pedido = 0;
        }
      }
      if (!r.fdesp) r.fdesp = r.fecha;
      return r;
    });

    const { registrosLimpios, duplicadosEliminados } = sanitizarStockDuplicados(mapped);
    if (duplicadosEliminados.length > 0) {
      duplicadosEliminados.forEach((d) => encolarDel(d.id, 'registros'));
      sv(K_REG, registrosLimpios);
    }
    return registrosLimpios;
  });

  const [ingresos, setIngresos] = useState<Ingreso[]>(() => ld<Ingreso[]>(K_ING, []));
  const [planes, setPlanes] = useState<Record<string, PlanDespacho>>(() =>
    ld<Record<string, PlanDespacho>>(K_PLAN, {})
  );
  const [planesOp, setPlanesOp] = useState<Record<string, PlanOp>>(() =>
    ld<Record<string, PlanOp>>(K_PLANOP, {})
  );
  const [opExtra, setOpExtra] = useState<Record<string, OpExtra>>(() =>
    ld<Record<string, OpExtra>>(K_OP_EXTRA, {})
  );

  const handleUpdateOpExtra = useCallback((op: string, fd: string, changes: Partial<OpExtra>) => {
    const k = op.trim().toLowerCase() + '|' + (fd || '');
    setOpExtra((prev) => {
      const cur = prev[k] || prev[op.trim().toLowerCase()] || {};
      const nextVal = { ...cur, ...changes };
      const updated = { ...prev, [k]: nextVal };
      if (!fd) {
        updated[op.trim().toLowerCase()] = nextVal;
      }
      sv(K_OP_EXTRA, updated);
      return updated;
    });
  }, []);

  // Reg Context
  const [fecha, setFecha] = useState(() => {
    const s0 = ld<any>(K_SESION, null);
    return s0?.dia === hoy() && s0?.fecha ? s0.fecha : hoy();
  });
  const [fdesp, setFdesp] = useState(() => {
    const s0 = ld<any>(K_SESION, null);
    return s0?.fdesp || hoy();
  });
  const [turno, setTurno] = useState(() => {
    const s0 = ld<any>(K_SESION, null);
    return s0?.turno || 'Día';
  });
  const [nombre, setNombre] = useState(() => {
    const s0 = ld<any>(K_SESION, null);
    return s0?.nombre || '';
  });

  // Ing Context
  const [iFecha, setIFecha] = useState(() => {
    const s0 = ld<any>(K_SES_ING, null);
    return s0?.dia === hoy() && s0?.fecha ? s0.fecha : hoy();
  });
  const [iTurno, setITurno] = useState(() => {
    const s0 = ld<any>(K_SES_ING, null);
    return s0?.turno || 'Día';
  });
  const [iNombre, setINombre] = useState(() => {
    const s0 = ld<any>(K_SES_ING, null);
    return s0?.nombre || '';
  });

  // Modes
  const [modoReg, setModoReg] = useState<'tabla' | 'form'>(() =>
    ld<'tabla' | 'form'>(K_MODO_REG, 'tabla')
  );
  const [modoIng, setModoIng] = useState<'tabla' | 'form'>(() =>
    ld<'tabla' | 'form'>(K_MODO_ING, 'tabla')
  );

  // Sync state
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [syncOk, setSyncOk] = useState(true);
  const [lastSyncTime, setLastSyncTime] = useState<Date | null>(new Date());
  const syncBusyRef = useRef(false);
  const syncStartRef = useRef(0);
  const lastKeyTimeRef = useRef(0);
  const firmaRef = useRef<{ reg?: string; ing?: string }>({});

  // Toasts
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const toast = useCallback((tipo: 'ok' | 'error', mensaje: string) => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, tipo, mensaje }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 2600);
  }, []);

  // PWA Prompt
  const [canInstall, setCanInstall] = useState(false);
  const installEventRef = useRef<any>(null);

  useEffect(() => {
    requestStoragePersistence();

    const isStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      Boolean((navigator as any).standalone);

    if (!isStandalone && (window as any).__ip) {
      installEventRef.current = (window as any).__ip;
      setCanInstall(true);
    }

    const handleBeforeInstall = (e: any) => {
      e.preventDefault();
      installEventRef.current = e;
      (window as any).__ip = e;
      setCanInstall(true);
    };

    const handleCanInstallCustom = () => {
      if ((window as any).__ip && !isStandalone) {
        installEventRef.current = (window as any).__ip;
        setCanInstall(true);
      }
    };

    const handleAppInstalled = () => {
      installEventRef.current = null;
      (window as any).__ip = null;
      setCanInstall(false);
      toast('ok', 'App instalada en el dispositivo');
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstall);
    window.addEventListener('appinstalled', handleAppInstalled);
    window.addEventListener('pwa-can-install', handleCanInstallCustom);
    window.addEventListener('pwa-installed', handleAppInstalled);

    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    const handleKeyActivity = () => {
      lastKeyTimeRef.current = Date.now();
    };
    document.addEventListener('input', handleKeyActivity, true);
    document.addEventListener('focusin', handleKeyActivity, true);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
      window.removeEventListener('appinstalled', handleAppInstalled);
      window.removeEventListener('pwa-can-install', handleCanInstallCustom);
      window.removeEventListener('pwa-installed', handleAppInstalled);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      document.removeEventListener('input', handleKeyActivity, true);
      document.removeEventListener('focusin', handleKeyActivity, true);
    };
  }, [toast]);

  // Save session states
  useEffect(() => {
    sv(K_SESION, { fdesp, fecha, turno, nombre, dia: hoy() });
  }, [fdesp, fecha, turno, nombre]);

  useEffect(() => {
    sv(K_SES_ING, { fecha: iFecha, turno: iTurno, nombre: iNombre, dia: hoy() });
  }, [iFecha, iTurno, iNombre]);

  useEffect(() => {
    sv(K_MODO_REG, modoReg);
  }, [modoReg]);

  useEffect(() => {
    sv(K_MODO_ING, modoIng);
  }, [modoIng]);

  // References to latest state for async functions
  const registrosRef = useRef(registros);
  registrosRef.current = registros;
  const ingresosRef = useRef(ingresos);
  ingresosRef.current = ingresos;
  const nombresRef = useRef(nombres);
  nombresRef.current = nombres;

  // Sheets sync methods
  const enviarRegistros = useCallback(
    async (rs: Registro[], showToast = false) => {
      const validos = soloValidos(rs, showToast, toast);
      if (!validos.length) return;
      try {
        await llamar({ action: 'upsert', records: validos });
        const validIds = new Set(validos.map((x) => x.id));
        const updated = registrosRef.current.map((r) =>
          validIds.has(r.id) ? { ...r, sync: true } : r
        );
        setRegistros(updated);
        sv(K_REG, updated);
        if (showToast) toast('ok', `Enviado a Sheets (${validos.length})`);
      } catch (err: any) {
        if (showToast || navigator.onLine) {
          toast('error', `Sheets: ${String(err.message || err).slice(0, 120)}`);
        }
      }
    },
    [toast]
  );

  const enviarIngresos = useCallback(
    async (rs: Ingreso[], showToast = false) => {
      const validos = soloValidos(rs, showToast, toast);
      if (!validos.length) return;
      try {
        await llamar({ action: 'upsert', tabla: 'ingresos', records: validos });
        const validIds = new Set(validos.map((x) => x.id));
        const updated = ingresosRef.current.map((r) =>
          validIds.has(r.id) ? { ...r, sync: true } : r
        );
        setIngresos(updated);
        sv(K_ING, updated);
        if (showToast) toast('ok', `Enviado a Sheets (${validos.length})`);
      } catch (err: any) {
        if (showToast || navigator.onLine) {
          toast('error', `Sheets: ${String(err.message || err).slice(0, 120)}`);
        }
      }
    },
    [toast]
  );

  const traerRegistros = useCallback(
    async (quiet = true) => {
      try {
        const j = await llamar({ action: 'list' });
        if (!Array.isArray(j.records)) throw new Error('Respuesta sin lista de registros');

        const fh = huella(j.records);
        if (quiet && firmaRef.current.reg === fh) return;
        firmaRef.current.reg = fh;

        const pend = colaDel();
        let curr = [...registrosRef.current];
        const ids: Record<string, boolean> = {};
        j.records.forEach((x: any) => {
          ids[String(x.id).trim()] = true;
        });

        if (quiet) {
          curr = curr.filter((r) => !r.sync || ids[r.id]);
        }

        const idxMap: Record<string, number> = {};
        curr.forEach((r, idx) => {
          idxMap[r.id] = idx;
        });

        let n = 0;
        let omit = 0;
        const newNombres = [...nombresRef.current];

        j.records.forEach((x: any) => {
          if (!recRemotoOk(x, pend, 'registros')) {
            omit++;
            return;
          }
          ['pedido', 'u', 'c', 'total', 'ord'].forEach((k) => {
            x[k] = parseInt(x[k], 10) || 0;
          });
          x.sync = true;
          ['id', 'fecha', 'fdesp', 'turno', 'nombre', 'op', 'sap', 'descripcion', 'cliente', 'empaque', 'estado', 'creado'].forEach((k) => {
            x[k] = x[k] == null ? '' : String(x[k]).trim();
          });
          x.fecha = normFecha(x.fecha);
          x.fdesp = normFecha(x.fdesp);
          if (!x.fdesp) x.fdesp = x.fecha;

          const i = idxMap[x.id];
          if (i === undefined) {
            curr.push(x);
            idxMap[x.id] = curr.length - 1;
            n++;
          } else if (curr[i].sync) {
            if (!(x.ord > 0) && curr[i].ord && curr[i].ord! > 0) {
              x.ord = curr[i].ord;
            }
            curr[i] = x;
          }

          if (x.nombre && newNombres.indexOf(x.nombre) === -1) {
            newNombres.push(x.nombre);
          }
        });

        newNombres.sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }));
        setNombres(newNombres);
        sv(K_NOM, newNombres);

        const { registrosLimpios, duplicadosEliminados } = sanitizarStockDuplicados(curr);
        if (duplicadosEliminados.length > 0) {
          duplicadosEliminados.forEach((d) => encolarDel(d.id, 'registros'));
          curr = registrosLimpios;
        }

        setRegistros(curr);
        sv(K_REG, curr);

        if (!quiet) {
          toast('ok', `${n} registro(s) nuevos traídos${omit ? ` · ${omit} omitidos por datos incompletos` : ''}`);
        }
      } catch (err: any) {
        if (!quiet) toast('error', `No se pudo traer: ${String(err.message || err).slice(0, 60)}`);
        throw err;
      }
    },
    [toast]
  );

  const traerIngresos = useCallback(
    async (quiet = true) => {
      try {
        const j = await llamar({ action: 'list', tabla: 'ingresos' });
        if (!Array.isArray(j.records)) throw new Error('Respuesta sin lista de ingresos');

        const fh = huella(j.records);
        if (quiet && firmaRef.current.ing === fh) return;
        firmaRef.current.ing = fh;

        const pend = colaDel();
        let curr = [...ingresosRef.current];
        const ids: Record<string, boolean> = {};
        j.records.forEach((x: any) => {
          ids[String(x.id).trim()] = true;
        });

        if (quiet) {
          curr = curr.filter((r) => !r.sync || ids[r.id]);
        }

        const idxMap: Record<string, number> = {};
        curr.forEach((r, idx) => {
          idxMap[r.id] = idx;
        });

        let n = 0;
        let omit = 0;
        const newNombres = [...nombresRef.current];

        j.records.forEach((x: any) => {
          if (!recRemotoOk(x, pend, 'ingresos')) {
            omit++;
            return;
          }
          ['u', 'c', 'total'].forEach((k) => {
            x[k] = parseInt(x[k], 10) || 0;
          });
          ['id', 'fecha', 'turno', 'nombre', 'op', 'sap', 'descripcion', 'cliente', 'empaque', 'creado'].forEach((k) => {
            x[k] = x[k] == null ? '' : String(x[k]).trim();
          });
          x.fecha = normFecha(x.fecha);
          x.sync = true;

          const i = idxMap[x.id];
          if (i === undefined) {
            curr.push(x);
            idxMap[x.id] = curr.length - 1;
            n++;
          } else if (curr[i].sync) {
            curr[i] = x;
          }

          if (x.nombre && newNombres.indexOf(x.nombre) === -1) {
            newNombres.push(x.nombre);
          }
        });

        newNombres.sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }));
        setNombres(newNombres);
        sv(K_NOM, newNombres);

        setIngresos(curr);
        sv(K_ING, curr);

        if (!quiet) {
          toast('ok', `${n} ingreso(s) nuevos traídos${omit ? ` · ${omit} omitidos por datos incompletos` : ''}`);
        }
      } catch (err: any) {
        if (!quiet) toast('error', `No se pudo traer: ${String(err.message || err).slice(0, 60)}`);
        throw err;
      }
    },
    [toast]
  );

  // AutoSync cycle
  const runAutoSync = useCallback(async () => {
    const isTyping = Date.now() - lastKeyTimeRef.current < 4000;
    if (isTyping) return;
    if (syncBusyRef.current && Date.now() - syncStartRef.current < 30000) return;
    if (!navigator.onLine) return;

    syncBusyRef.current = true;
    syncStartRef.current = Date.now();

    try {
      await procesarDel();
      const pr = registrosRef.current.filter((r) => !r.sync);
      const pi = ingresosRef.current.filter((r) => !r.sync);
      if (pr.length) await enviarRegistros(pr, false);
      if (pi.length) await enviarIngresos(pi, false);
      await traerRegistros(true);
      await traerIngresos(true);
      setSyncOk(true);
      setLastSyncTime(new Date());
    } catch {
      setSyncOk(false);
      setLastSyncTime(new Date());
    } finally {
      syncBusyRef.current = false;
    }
  }, [enviarRegistros, enviarIngresos, traerRegistros, traerIngresos]);

  // AutoSync timer
  useEffect(() => {
    const t = setTimeout(runAutoSync, 1000);
    const interval = setInterval(() => {
      if (!document.hidden) runAutoSync();
    }, 5000);

    const handleFocus = () => runAutoSync();
    const handleVisibility = () => {
      if (!document.hidden) runAutoSync();
    };

    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      clearTimeout(t);
      clearInterval(interval);
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [runAutoSync]);

  // Initial Supabase Catalog Auto-Refresh (once every 4 hours)
  useEffect(() => {
    const lastCatTs = parseInt(localStorage.getItem(K_CATTS) || '0', 10) || 0;
    if (!catalogo.length || Date.now() - lastCatTs >= CAT_HORAS * 3600 * 1000) {
      leerCatalogoSb()
        .then((rows) => {
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
          if (nuevo.length) {
            setCatalogo(nuevo);
            sv(K_CAT, nuevo);
            localStorage.setItem(K_CATTS, String(Date.now()));
            setCatErr('');
          }
        })
        .catch((e) => {
          setCatErr(String(e?.message || e).slice(0, 100));
        });
    }
  }, []); // Run once on mount

  // Handle Updates
  const handleRegistrosChange = (newRegs: Registro[], toSend?: Registro[]) => {
    setRegistros(newRegs);
    sv(K_REG, newRegs);
    if (toSend && toSend.length) {
      enviarRegistros(toSend, false);
    }
  };

  const handleIngresosChange = (newIngs: Ingreso[], toSend?: Ingreso[]) => {
    setIngresos(newIngs);
    sv(K_ING, newIngs);
    if (toSend && toSend.length) {
      enviarIngresos(toSend, false);
    }
  };

  const handlePlanesChange = (p: Record<string, PlanDespacho>) => {
    setPlanes(p);
    sv(K_PLAN, p);
  };

  const handlePlanesOpChange = (p: Record<string, PlanOp>) => {
    setPlanesOp(p);
    sv(K_PLANOP, p);
  };

  const handleNombresChange = (newN: string[]) => {
    setNombres(newN);
    sv(K_NOM, newN);
  };

  const handleCatalogoChange = (newC: CatalogoOp[]) => {
    setCatalogo(newC);
    sv(K_CAT, newC);
  };

  const handleBorrarRemotoRegistro = (id: string) => {
    const a = colaDel();
    if (!a.some((x) => x.id === id && x.tabla === 'registros')) {
      a.push({ id, tabla: 'registros' });
    }
    sv('ctrl_borrados', a);
    procesarDel();
  };

  const handleBorrarRemotoIngreso = (id: string) => {
    const a = colaDel();
    if (!a.some((x) => x.id === id && x.tabla === 'ingresos')) {
      a.push({ id, tabla: 'ingresos' });
    }
    sv('ctrl_borrados', a);
    procesarDel();
  };

  const handleInstallClick = () => {
    if (installEventRef.current) {
      installEventRef.current.prompt();
      installEventRef.current.userChoice.then((choice: any) => {
        if (choice && choice.outcome === 'accepted') {
          toast('ok', 'Instalando aplicación...');
        }
        installEventRef.current = null;
        (window as any).__ip = null;
        setCanInstall(false);
      });
    } else {
      toast('ok', 'Para instalar en Android: abre el menú de Chrome (⋮) y elige "Instalar aplicación" o "Agregar a la pantalla principal".');
    }
  };

  const pendingCount =
    registros.filter((r) => !r.sync).length +
    ingresos.filter((r) => !r.sync).length +
    colaDel().length;

  return (
    <div>
      <Header
        activeTab={activeTab}
        onTabChange={setActiveTab}
        canInstall={canInstall}
        onInstall={handleInstallClick}
        fecha={fecha}
        onFechaChange={setFecha}
        nombre={nombre}
        onNombreChange={setNombre}
        turno={turno}
        onTurnoChange={setTurno}
        iFecha={iFecha}
        onIFechaChange={setIFecha}
        iNombre={iNombre}
        onINombreChange={setINombre}
        iTurno={iTurno}
        onITurnoChange={setITurno}
        nombres={nombres}
      />

      <main className="wrap">
        {activeTab === 'reg' && (
          <RegistrarTab
            fdesp={fdesp}
            onFdespChange={setFdesp}
            fecha={fecha}
            nombre={nombre}
            turno={turno}
            registros={registros}
            onRegistrosChange={handleRegistrosChange}
            catalogo={catalogo}
            planes={planes}
            planesOp={planesOp}
            onPlanesChange={handlePlanesChange}
            onPlanesOpChange={handlePlanesOpChange}
            modoReg={modoReg}
            onModoRegChange={setModoReg}
            opExtra={opExtra}
            onUpdateOpExtra={handleUpdateOpExtra}
            onToast={toast}
          />
        )}

        {activeTab === 'lista' && (
          <RegistrosTab
            registros={registros}
            onRegistrosChange={handleRegistrosChange}
            nombres={nombres}
            planesOp={planesOp}
            opExtra={opExtra}
            onUpdateOpExtra={handleUpdateOpExtra}
            onEnviarSheets={() => {
              const p = registros.filter((r) => !r.sync);
              if (!p.length) {
                toast('ok', 'Todo está sincronizado');
                return;
              }
              enviarRegistros(p, true);
            }}
            onTraerSheets={() => traerRegistros(false)}
            onBorrarRemoto={handleBorrarRemotoRegistro}
            onToast={toast}
          />
        )}

        {activeTab === 'ing' && (
          <IngresosTab
            iFecha={iFecha}
            iNombre={iNombre}
            iTurno={iTurno}
            ingresos={ingresos}
            onIngresosChange={handleIngresosChange}
            catalogo={catalogo}
            nombres={nombres}
            modoIng={modoIng}
            onModoIngChange={setModoIng}
            onEnviarSheets={() => {
              const p = ingresos.filter((r) => !r.sync);
              if (!p.length) {
                toast('ok', 'Todo está sincronizado');
                return;
              }
              enviarIngresos(p, true);
            }}
            onTraerSheets={() => traerIngresos(false)}
            onBorrarRemoto={handleBorrarRemotoIngreso}
            onToast={toast}
          />
        )}

        {activeTab === 'cfg' && (
          <ConfigTab
            nombres={nombres}
            onNombresChange={handleNombresChange}
            catalogo={catalogo}
            onCatalogoChange={handleCatalogoChange}
            registros={registros}
            onRegistrosChange={handleRegistrosChange}
            ingresos={ingresos}
            onIngresosChange={handleIngresosChange}
            catErr={catErr}
            onCatErrChange={setCatErr}
            onToast={toast}
          />
        )}
      </main>

      <Toasts toasts={toasts} />

      <SyncBadge
        lastSyncTime={lastSyncTime}
        isOnline={isOnline}
        syncOk={syncOk}
        pendingCount={pendingCount}
        onSyncNow={() => {
          syncBusyRef.current = false;
          runAutoSync();
        }}
      />
    </div>
  );
};
