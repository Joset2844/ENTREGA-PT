import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { onAuthStateChanged, signOut, User } from 'firebase/auth';
import {
  collection,
  doc,
  onSnapshot,
  query,
  where,
} from 'firebase/firestore';
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
  idbGet,
  idbSet,
  ld,
  requestStoragePersistence,
  sv,
} from './services/storage';
import {
  ADMIN_EMAIL,
  auth,
  db,
  handleFirestoreError,
  OperationType,
  WORKSPACE_DOC_ID,
} from './services/firebase';
import {
  COL_INGRESOS,
  COL_OP_EXTRAS,
  COL_PLANES,
  COL_REGISTROS,
  COL_WORKSPACES,
  deleteIngresoFs,
  deleteRegistroFs,
  DocMeta,
  migrateLegacyLocalDataFs,
  normFecha,
  opExtraDocId,
  propagateTeamEmailsFs,
  sanitizeDocId,
  saveIngresosBatchFs,
  saveOpExtraFs,
  savePlanFs,
  saveRegistrosBatchFs,
  saveWorkspaceConfigFs,
  setDocMetaCache,
} from './services/firestoreSync';
import { CAT_HORAS, leerCatalogoSb, normOpSb } from './services/supabase';
import { hoy, sanitizarStockDuplicados } from './utils/helpers';
import { AppTab, Header } from './components/Header';
import { Toasts } from './components/Toasts';
import { SyncBadge } from './components/SyncBadge';
import { AuthGate } from './components/AuthGate';
import { TableroTab } from './components/TableroTab';
import { RegistrarTab } from './components/RegistrarTab';
import { RegistrosTab } from './components/RegistrosTab';
import { IngresosTab } from './components/IngresosTab';
import { ConfigTab } from './components/ConfigTab';

function normalizeLegacyRegistros(raw: any[]): Registro[] {
  const mapped = (Array.isArray(raw) ? raw : []).map((r: any) => {
    const copy = { ...r };
    if (!copy.mov && copy.total === undefined) {
      const e = (copy.entTotal || 0) > 0;
      copy.mov = e ? 'Entregado' : 'Por entregar';
      copy.empaque = e ? copy.entTipo : copy.porTipo;
      copy.u = e ? copy.entU : copy.porU;
      copy.c = e ? copy.entC : copy.porC;
      copy.total = e ? copy.entTotal : copy.porTotal;
      copy.estado = copy.estado || '';
    }
    if (copy.pedido === undefined) {
      if (copy.mov === 'Por entregar') {
        copy.pedido = copy.total || 0;
        copy.total = 0;
        copy.u = 0;
        copy.c = 0;
      } else {
        copy.pedido = 0;
      }
    }
    if (!copy.fdesp) copy.fdesp = copy.fecha;
    return copy as Registro;
  });
  return sanitizarStockDuplicados(mapped).registrosLimpios;
}

export const App: React.FC = () => {
  // Fatal async Firestore error (propagated to ErrorBoundary on render)
  const [fatalError, setFatalError] = useState<Error | null>(null);
  if (fatalError) {
    throw fatalError;
  }

  // Firebase Auth state
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);

  // Navigation & prefill
  const [activeTab, setActiveTab] = useState<AppTab>('dash');
  const [prefillOp, setPrefillOp] = useState<{
    op: string;
    fdesp?: string;
    nonce: number;
  } | null>(null);

  // Legacy local snapshots (preserved so existing data stays visible & 1-click migratable)
  const [legacyRegistros, setLegacyRegistros] = useState<Registro[]>(() =>
    normalizeLegacyRegistros(ld<any[]>(K_REG, []))
  );
  const [legacyIngresos, setLegacyIngresos] = useState<Ingreso[]>(() =>
    ld<Ingreso[]>(K_ING, [])
  );
  const [legacyPlanes, setLegacyPlanes] = useState<Record<string, PlanDespacho>>(() =>
    ld<Record<string, PlanDespacho>>(K_PLAN, {})
  );
  const [legacyPlanesOp, setLegacyPlanesOp] = useState<Record<string, PlanOp>>(() =>
    ld<Record<string, PlanOp>>(K_PLANOP, {})
  );
  const [legacyOpExtra, setLegacyOpExtra] = useState<Record<string, OpExtra>>(() =>
    ld<Record<string, OpExtra>>(K_OP_EXTRA, {})
  );
  const [legacyNombres, setLegacyNombres] = useState<string[]>(() =>
    ld<string[]>(K_NOM, [])
  );

  // Cloud Firestore snapshots
  const [cloudRegistros, setCloudRegistros] = useState<Registro[]>([]);
  const [cloudIngresos, setCloudIngresos] = useState<Ingreso[]>([]);
  const [cloudPlanes, setCloudPlanes] = useState<Record<string, PlanDespacho>>({});
  const [cloudPlanesOp, setCloudPlanesOp] = useState<Record<string, PlanOp>>({});
  const [cloudOpExtra, setCloudOpExtra] = useState<Record<string, OpExtra>>({});
  const [cloudNombres, setCloudNombres] = useState<string[]>([]);
  const [teamEmails, setTeamEmails] = useState<string[]>([ADMIN_EMAIL]);
  const [workspaceMeta, setWorkspaceMeta] = useState<DocMeta | undefined>(undefined);
  const [cloudReady, setCloudReady] = useState(false);
  const [migrating, setMigrating] = useState(false);

  // Catalog state (Supabase + IndexedDB)
  const [catalogo, setCatalogo] = useState<CatalogoOp[]>(() => {
    const raw = ld<CatalogoOp[]>(K_CAT, []);
    return raw.map((c) => {
      if (!c.modelos) c.modelos = [{ descripcion: c.descripcion || '', sap: c.sap || '' }];
      return c;
    });
  });
  const [catLoading, setCatLoading] = useState(false);
  const [catErr, setCatErr] = useState('');
  const catCountRef = useRef(catalogo.length);
  catCountRef.current = catalogo.length;

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

  // Sync status
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [syncOk, setSyncOk] = useState(true);
  const [lastSyncTime, setLastSyncTime] = useState<Date | null>(new Date());

  // Toasts
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const toast = useCallback((tipo: 'ok' | 'error', mensaje: string) => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, tipo, mensaje }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 2800);
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

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
      window.removeEventListener('appinstalled', handleAppInstalled);
      window.removeEventListener('pwa-can-install', handleCanInstallCustom);
      window.removeEventListener('pwa-installed', handleAppInstalled);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [toast]);

  // Auth listener
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setAuthReady(true);
      if (!u) {
        setCloudReady(false);
        setCloudRegistros([]);
        setCloudIngresos([]);
        setCloudPlanes({});
        setCloudPlanesOp({});
        setCloudOpExtra({});
        setCloudNombres([]);
        setWorkspaceMeta(undefined);
      }
    });
    return () => unsub();
  }, []);

  // Real-time Firestore listeners (only active when authenticated with verified email)
  useEffect(() => {
    if (!authReady || !user || !user.emailVerified || !user.email) return;

    const userEmail = user.email.toLowerCase();
    const isAdmin = userEmail === ADMIN_EMAIL;

    const wrapErr = (opType: OperationType, path: string) => (err: unknown) => {
      setSyncOk(false);
      try {
        handleFirestoreError(err, opType, path);
      } catch (wrapped) {
        setFatalError(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
      }
    };

    const qReg = isAdmin
      ? collection(db, COL_REGISTROS)
      : query(collection(db, COL_REGISTROS), where('allowedEmails', 'array-contains', userEmail));

    const qIng = isAdmin
      ? collection(db, COL_INGRESOS)
      : query(collection(db, COL_INGRESOS), where('allowedEmails', 'array-contains', userEmail));

    const qPlan = isAdmin
      ? collection(db, COL_PLANES)
      : query(collection(db, COL_PLANES), where('allowedEmails', 'array-contains', userEmail));

    const qExtra = isAdmin
      ? collection(db, COL_OP_EXTRAS)
      : query(collection(db, COL_OP_EXTRAS), where('allowedEmails', 'array-contains', userEmail));

    const unsubReg = onSnapshot(
      qReg,
      { includeMetadataChanges: true },
      (snap) => {
        const metaMap = new Map<string, DocMeta>();
        const list: Registro[] = [];
        snap.forEach((d) => {
          const data = d.data() as any;
          metaMap.set(d.id, {
            ownerUid: data.ownerUid,
            ownerEmail: data.ownerEmail,
            allowedEmails: data.allowedEmails || [],
            createdAt: data.createdAt,
          });
          list.push({
            id: data.id || d.id,
            fecha: data.fecha || '',
            fdesp: data.fdesp || data.fecha || '',
            turno: data.turno || 'Día',
            nombre: data.nombre || '',
            op: data.op || '',
            sap: data.sap || '',
            descripcion: data.descripcion || '',
            cliente: data.cliente || '',
            pedido: Number(data.pedido) || 0,
            empaque: data.empaque || 'caja',
            u: Number(data.u) || 0,
            c: Number(data.c) || 0,
            total: Number(data.total) || 0,
            estado: data.estado || '',
            creado: data.creado || '',
            ord: typeof data.ord === 'number' ? data.ord : undefined,
            sync: !d.metadata.hasPendingWrites,
          });
        });
        list.sort((a, b) => String(b.creado).localeCompare(String(a.creado)));
        setDocMetaCache('reg', metaMap);
        setCloudRegistros(list);
        setCloudReady(true);
        setSyncOk(true);
        setLastSyncTime(new Date());
      },
      wrapErr(OperationType.LIST, COL_REGISTROS)
    );

    const unsubIng = onSnapshot(
      qIng,
      { includeMetadataChanges: true },
      (snap) => {
        const metaMap = new Map<string, DocMeta>();
        const list: Ingreso[] = [];
        snap.forEach((d) => {
          const data = d.data() as any;
          metaMap.set(d.id, {
            ownerUid: data.ownerUid,
            ownerEmail: data.ownerEmail,
            allowedEmails: data.allowedEmails || [],
            createdAt: data.createdAt,
          });
          list.push({
            id: data.id || d.id,
            fecha: data.fecha || '',
            turno: data.turno || 'Día',
            nombre: data.nombre || '',
            op: data.op || '',
            sap: data.sap || '',
            descripcion: data.descripcion || '',
            cliente: data.cliente || '',
            empaque: data.empaque || 'caja',
            u: Number(data.u) || 0,
            c: Number(data.c) || 0,
            total: Number(data.total) || 0,
            creado: data.creado || '',
            sync: !d.metadata.hasPendingWrites,
          });
        });
        list.sort((a, b) => String(b.creado).localeCompare(String(a.creado)));
        setDocMetaCache('ing', metaMap);
        setCloudIngresos(list);
        setSyncOk(true);
        setLastSyncTime(new Date());
      },
      wrapErr(OperationType.LIST, COL_INGRESOS)
    );

    const unsubPlan = onSnapshot(
      qPlan,
      (snap) => {
        const metaMap = new Map<string, DocMeta>();
        const nextSap: Record<string, PlanDespacho> = {};
        const nextOp: Record<string, PlanOp> = {};
        snap.forEach((d) => {
          const data = d.data() as any;
          metaMap.set(d.id, {
            ownerUid: data.ownerUid,
            ownerEmail: data.ownerEmail,
            allowedEmails: data.allowedEmails || [],
            createdAt: data.createdAt,
          });
          if (data.tipo === 'sap' && data.fdesp) {
            nextSap[data.fdesp] = {
              archivo: data.archivo || '',
              items: Array.isArray(data.items) ? data.items : [],
            };
          } else if (data.tipo === 'op' && data.fdesp) {
            nextOp[data.fdesp] = {
              archivo: data.archivo || '',
              items: Array.isArray(data.items) ? data.items : [],
            };
          }
        });
        setDocMetaCache('plan', metaMap);
        setCloudPlanes(nextSap);
        setCloudPlanesOp(nextOp);
      },
      wrapErr(OperationType.LIST, COL_PLANES)
    );

    const unsubExtra = onSnapshot(
      qExtra,
      (snap) => {
        const metaMap = new Map<string, DocMeta>();
        const nextExtra: Record<string, OpExtra> = {};
        snap.forEach((d) => {
          const data = d.data() as any;
          metaMap.set(d.id, {
            ownerUid: data.ownerUid,
            ownerEmail: data.ownerEmail,
            allowedEmails: data.allowedEmails || [],
            createdAt: data.createdAt,
          });
          if (data.key) {
            nextExtra[data.key] = {
              enProduccion: Boolean(data.enProduccion),
              cantPlanta: Number(data.cantPlanta) || 0,
            };
          }
        });
        setDocMetaCache('extra', metaMap);
        setCloudOpExtra(nextExtra);
      },
      wrapErr(OperationType.LIST, COL_OP_EXTRAS)
    );

    const unsubWs = onSnapshot(
      doc(db, COL_WORKSPACES, WORKSPACE_DOC_ID),
      (snap) => {
        if (snap.exists()) {
          const data = snap.data() as any;
          setWorkspaceMeta({
            ownerUid: data.ownerUid,
            ownerEmail: data.ownerEmail,
            allowedEmails: data.allowedEmails || [],
            createdAt: data.createdAt,
          });
          setCloudNombres(Array.isArray(data.nombres) ? data.nombres : []);
          const emails = Array.isArray(data.teamEmails) && data.teamEmails.length
            ? data.teamEmails
            : [ADMIN_EMAIL];
          setTeamEmails(emails);
        } else {
          setWorkspaceMeta(undefined);
          setTeamEmails(
            Array.from(new Set([ADMIN_EMAIL, userEmail])).slice(0, 15)
          );
        }
      },
      wrapErr(OperationType.GET, `${COL_WORKSPACES}/${WORKSPACE_DOC_ID}`)
    );

    return () => {
      unsubReg();
      unsubIng();
      unsubPlan();
      unsubExtra();
      unsubWs();
    };
  }, [authReady, user]);

  // Save session context
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

  // Compute merged view (cloud truth + any unmigrated legacy localStorage items)
  const cloudRegIds = useMemo(
    () => new Set(cloudRegistros.map((r) => sanitizeDocId(r.id, 'reg'))),
    [cloudRegistros]
  );
  const cloudIngIds = useMemo(
    () => new Set(cloudIngresos.map((r) => sanitizeDocId(r.id, 'ing'))),
    [cloudIngresos]
  );

  const unmigratedRegistros = useMemo(
    () =>
      legacyRegistros
        .filter((r) => !cloudRegIds.has(sanitizeDocId(r.id, 'reg')))
        .map((r) => ({ ...r, sync: false })),
    [legacyRegistros, cloudRegIds]
  );
  const unmigratedIngresos = useMemo(
    () =>
      legacyIngresos
        .filter((r) => !cloudIngIds.has(sanitizeDocId(r.id, 'ing')))
        .map((r) => ({ ...r, sync: false })),
    [legacyIngresos, cloudIngIds]
  );

  const registros = useMemo(
    () => [...cloudRegistros, ...unmigratedRegistros],
    [cloudRegistros, unmigratedRegistros]
  );
  const ingresos = useMemo(
    () => [...cloudIngresos, ...unmigratedIngresos],
    [cloudIngresos, unmigratedIngresos]
  );
  const planes = useMemo(
    () => ({ ...legacyPlanes, ...cloudPlanes }),
    [legacyPlanes, cloudPlanes]
  );
  const planesOp = useMemo(
    () => ({ ...legacyPlanesOp, ...cloudPlanesOp }),
    [legacyPlanesOp, cloudPlanesOp]
  );
  const opExtra = useMemo(
    () => ({ ...legacyOpExtra, ...cloudOpExtra }),
    [legacyOpExtra, cloudOpExtra]
  );
  const nombres = useMemo(() => {
    const merged = Array.from(new Set([...cloudNombres, ...legacyNombres]))
      .map((x) => x.trim())
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }));
    return merged;
  }, [cloudNombres, legacyNombres]);

  const legacyPending = useMemo(() => {
    const cloudPlanKeys = new Set(Object.keys(cloudPlanes));
    const cloudPlanOpKeys = new Set(Object.keys(cloudPlanesOp));
    const cloudExtraKeys = new Set(Object.keys(cloudOpExtra));
    const pendPlanes =
      Object.keys(legacyPlanes).filter((k) => {
        const ck = normFecha(k);
        return ck && !cloudPlanKeys.has(ck) && legacyPlanes[k]?.items?.length;
      }).length +
      Object.keys(legacyPlanesOp).filter((k) => {
        const ck = normFecha(k);
        return ck && !cloudPlanOpKeys.has(ck) && legacyPlanesOp[k]?.items?.length;
      }).length;
    const pendExtras = Object.keys(legacyOpExtra).filter(
      (k) => k.includes('|') && !cloudExtraKeys.has(k)
    ).length;

    return {
      registros: unmigratedRegistros.length,
      ingresos: unmigratedIngresos.length,
      planes: pendPlanes,
      extras: pendExtras,
    };
  }, [
    unmigratedRegistros.length,
    unmigratedIngresos.length,
    legacyPlanes,
    legacyPlanesOp,
    legacyOpExtra,
    cloudPlanes,
    cloudPlanesOp,
    cloudOpExtra,
  ]);

  // Supabase catalog sync
  const cargarCatalogoSb = useCallback(
    async (showFeedback = false): Promise<boolean> => {
      setCatLoading(true);
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
        if (nuevo.length) {
          catCountRef.current = nuevo.length;
          setCatalogo(nuevo);
          idbSet(K_CAT, nuevo);
          sv(K_CAT, nuevo);
          try {
            localStorage.setItem(K_CATTS, String(Date.now()));
          } catch {}
          setCatErr('');
          if (showFeedback) toast('ok', `Catálogo cargado: ${nuevo.length} OP`);
          return true;
        }
        throw new Error('Supabase devolvió 0 OP');
      } catch (e: any) {
        const msg = String(e?.message || e).slice(0, 100);
        setCatErr(msg);
        if (showFeedback) toast('error', `No se pudo cargar catálogo: ${msg.slice(0, 70)}`);
        return false;
      } finally {
        setCatLoading(false);
      }
    },
    [toast]
  );

  // Initial Catalog Hydration (IndexedDB fallback + Supabase Auto-Refresh)
  useEffect(() => {
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const initCatalogo = async () => {
      let hasLocal = catCountRef.current > 0;
      if (!hasLocal) {
        const cachedIdb = await idbGet<CatalogoOp[]>(K_CAT);
        if (!cancelled && Array.isArray(cachedIdb) && cachedIdb.length > 0) {
          const normalized = cachedIdb.map((c) =>
            !c.modelos ? { ...c, modelos: [{ descripcion: c.descripcion || '', sap: c.sap || '' }] } : c
          );
          catCountRef.current = normalized.length;
          setCatalogo(normalized);
          sv(K_CAT, normalized);
          hasLocal = true;
        }
      } else {
        idbSet(K_CAT, catalogo);
      }

      const lastCatTs = parseInt(localStorage.getItem(K_CATTS) || '0', 10) || 0;
      if (!hasLocal || Date.now() - lastCatTs >= CAT_HORAS * 3600 * 1000) {
        const ok = await cargarCatalogoSb(false);
        if (!ok && !cancelled && catCountRef.current === 0) {
          retryTimer = setTimeout(() => {
            if (!cancelled && catCountRef.current === 0 && navigator.onLine) {
              cargarCatalogoSb(false);
            }
          }, 5000);
        }
      }
    };

    initCatalogo();

    const handleOnlineCat = () => {
      if (catCountRef.current === 0) {
        cargarCatalogoSb(false);
      }
    };
    window.addEventListener('online', handleOnlineCat);

    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
      window.removeEventListener('online', handleOnlineCat);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cargarCatalogoSb]);

  // Firestore mutation wrappers
  const runFs = useCallback(async (fn: () => Promise<void>) => {
    try {
      await fn();
      setSyncOk(true);
      setLastSyncTime(new Date());
    } catch (err) {
      setSyncOk(false);
      setFatalError(err instanceof Error ? err : new Error(String(err)));
    }
  }, []);

  const handleRegistrosChange = useCallback(
    (newRegs: Registro[], toSend?: Registro[]) => {
      sv(K_REG, newRegs);
      setLegacyRegistros((prev) =>
        prev.filter((p) => newRegs.some((n) => n.id === p.id))
      );
      if (user && toSend && toSend.length) {
        runFs(() => saveRegistrosBatchFs(toSend, user, teamEmails));
      }
    },
    [user, teamEmails, runFs]
  );

  const handleIngresosChange = useCallback(
    (newIngs: Ingreso[], toSend?: Ingreso[]) => {
      sv(K_ING, newIngs);
      setLegacyIngresos((prev) =>
        prev.filter((p) => newIngs.some((n) => n.id === p.id))
      );
      if (user && toSend && toSend.length) {
        runFs(() => saveIngresosBatchFs(toSend, user, teamEmails));
      }
    },
    [user, teamEmails, runFs]
  );

  const handleBorrarRemotoRegistro = useCallback(
    (id: string) => {
      setLegacyRegistros((prev) => {
        const next = prev.filter((x) => x.id !== id);
        sv(K_REG, next);
        return next;
      });
      if (user && cloudRegIds.has(sanitizeDocId(id, 'reg'))) {
        runFs(() => deleteRegistroFs(id));
      }
    },
    [user, cloudRegIds, runFs]
  );

  const handleBorrarRemotoIngreso = useCallback(
    (id: string) => {
      setLegacyIngresos((prev) => {
        const next = prev.filter((x) => x.id !== id);
        sv(K_ING, next);
        return next;
      });
      if (user && cloudIngIds.has(sanitizeDocId(id, 'ing'))) {
        runFs(() => deleteIngresoFs(id));
      }
    },
    [user, cloudIngIds, runFs]
  );

  const handlePlanesChange = useCallback(
    (p: Record<string, PlanDespacho>) => {
      setLegacyPlanes(p);
      sv(K_PLAN, p);
      if (user && p[fdesp]) {
        runFs(() => savePlanFs('sap', fdesp, p[fdesp], user, teamEmails));
      }
    },
    [user, fdesp, teamEmails, runFs]
  );

  const handlePlanesOpChange = useCallback(
    (p: Record<string, PlanOp>) => {
      setLegacyPlanesOp(p);
      sv(K_PLANOP, p);
      if (user && p[fdesp]) {
        runFs(() => savePlanFs('op', fdesp, p[fdesp], user, teamEmails));
      }
    },
    [user, fdesp, teamEmails, runFs]
  );

  const handleUpdateOpExtra = useCallback(
    (op: string, fd: string, changes: Partial<OpExtra>) => {
      const k = `${op.trim().toLowerCase()}|${fd || ''}`;
      const cur = opExtra[k] || opExtra[op.trim().toLowerCase()] || {};
      const nextVal: OpExtra = { ...cur, ...changes };
      setLegacyOpExtra((prev) => {
        const updated = { ...prev, [k]: nextVal };
        if (!fd) updated[op.trim().toLowerCase()] = nextVal;
        sv(K_OP_EXTRA, updated);
        return updated;
      });
      if (user) {
        const docKey = opExtraDocId(op, fd);
        void docKey;
        runFs(() => saveOpExtraFs(op, fd, nextVal, user, teamEmails));
      }
    },
    [opExtra, user, teamEmails, runFs]
  );

  const handleNombresChange = useCallback(
    (newN: string[]) => {
      setLegacyNombres(newN);
      sv(K_NOM, newN);
      if (user) {
        runFs(() => saveWorkspaceConfigFs(newN, teamEmails, workspaceMeta, user, false));
      }
    },
    [user, teamEmails, workspaceMeta, runFs]
  );

  const handleTeamEmailsChange = useCallback(
    async (emails: string[]) => {
      if (!user) return;
      setTeamEmails(emails);
      await runFs(async () => {
        await saveWorkspaceConfigFs(nombres, emails, workspaceMeta, user, true);
        await propagateTeamEmailsFs(user, emails);
      });
    },
    [user, nombres, workspaceMeta, runFs]
  );

  const handleMigrateLocal = useCallback(async () => {
    if (!user || migrating) return;
    setMigrating(true);
    try {
      const res = await migrateLegacyLocalDataFs({
        user,
        teamEmails,
        workspaceMeta,
        cloudRegistrosIds: cloudRegIds,
        cloudIngresosIds: cloudIngIds,
        cloudPlanesKeys: new Set(Object.keys(cloudPlanes)),
        cloudPlanesOpKeys: new Set(Object.keys(cloudPlanesOp)),
        cloudExtraKeys: new Set(Object.keys(cloudOpExtra)),
        localRegistros: legacyRegistros,
        localIngresos: legacyIngresos,
        localPlanes: legacyPlanes,
        localPlanesOp: legacyPlanesOp,
        localOpExtra: legacyOpExtra,
        localNombres: legacyNombres,
        cloudNombres,
      });
      toast(
        'ok',
        `Migrado a Firestore: ${res.regs} reg., ${res.ings} ing., ${res.planes} lista(s), ${res.extras} estado(s)`
      );
    } catch (err) {
      setFatalError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setMigrating(false);
    }
  }, [
    user,
    migrating,
    teamEmails,
    workspaceMeta,
    cloudRegIds,
    cloudIngIds,
    cloudPlanes,
    cloudPlanesOp,
    cloudOpExtra,
    legacyRegistros,
    legacyIngresos,
    legacyPlanes,
    legacyPlanesOp,
    legacyOpExtra,
    legacyNombres,
    cloudNombres,
    toast,
  ]);

  const handleCatalogoChange = (newC: CatalogoOp[]) => {
    catCountRef.current = newC.length;
    setCatalogo(newC);
    idbSet(K_CAT, newC);
    sv(K_CAT, newC);
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
      toast('ok', 'Para instalar en Android: abre el menú de Chrome (⋮) y elige "Instalar aplicación".');
    }
  };

  const handleSignOut = async () => {
    if (!window.confirm('¿Cerrar sesión en este equipo?')) return;
    await signOut(auth);
  };

  const handleIrARegistrar = (op?: string, targetFdesp?: string) => {
    if (targetFdesp) setFdesp(targetFdesp);
    if (op) {
      setPrefillOp({ op, fdesp: targetFdesp || fdesp, nonce: Date.now() });
    }
    setActiveTab('reg');
  };

  if (!authReady || !user) {
    return (
      <AuthGate
        loading={!authReady}
        localStats={{
          registros: legacyRegistros.length,
          ingresos: legacyIngresos.length,
        }}
      />
    );
  }

  const userEmail = (user.email || '').toLowerCase();
  const canManageTeam =
    !workspaceMeta ||
    workspaceMeta.ownerUid === user.uid ||
    userEmail === ADMIN_EMAIL;

  const pendingCount =
    registros.filter((r) => r.sync === false).length +
    ingresos.filter((r) => r.sync === false).length;

  const totalLegacyPend =
    legacyPending.registros +
    legacyPending.ingresos +
    legacyPending.planes +
    legacyPending.extras;

  return (
    <div>
      <Header
        activeTab={activeTab}
        onTabChange={setActiveTab}
        canInstall={canInstall}
        onInstall={handleInstallClick}
        userEmail={userEmail}
        onSignOut={handleSignOut}
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
        {cloudReady && totalLegacyPend > 0 && activeTab !== 'cfg' && (
          <div className="panel migration-banner">
            <div>
              <strong>Datos locales detectados en este dispositivo</strong>
              <div className="info" style={{ fontSize: '0.82rem' }}>
                Faltan subir a Firebase {legacyPending.registros} entrega(s), {legacyPending.ingresos} ingreso(s), {legacyPending.planes} lista(s) y {legacyPending.extras} estado(s) locales.
              </div>
            </div>
            <button
              type="button"
              className="btn"
              disabled={migrating}
              style={{ width: 'auto', minHeight: '38px', padding: '6px 16px', fontSize: '0.86rem' }}
              onClick={handleMigrateLocal}
            >
              {migrating ? 'Subiendo...' : 'Migrar datos locales a Firestore'}
            </button>
          </div>
        )}

        {activeTab === 'dash' && (
          <TableroTab
            fdesp={fdesp}
            onFdespChange={setFdesp}
            registros={registros}
            onRegistrosChange={handleRegistrosChange}
            ingresos={ingresos}
            catalogo={catalogo}
            planes={planes}
            planesOp={planesOp}
            opExtra={opExtra}
            onUpdateOpExtra={handleUpdateOpExtra}
            onIrARegistrar={handleIrARegistrar}
            onIrAIngresos={() => setActiveTab('ing')}
            onToast={toast}
          />
        )}

        {activeTab === 'reg' && (
          <RegistrarTab
            fdesp={fdesp}
            onFdespChange={setFdesp}
            fecha={fecha}
            nombre={nombre}
            turno={turno}
            registros={registros}
            ingresos={ingresos}
            onRegistrosChange={handleRegistrosChange}
            catalogo={catalogo}
            catLoading={catLoading}
            catErr={catErr}
            onRecargarCatalogo={() => cargarCatalogoSb(true)}
            planes={planes}
            planesOp={planesOp}
            onPlanesChange={handlePlanesChange}
            onPlanesOpChange={handlePlanesOpChange}
            modoReg={modoReg}
            onModoRegChange={setModoReg}
            opExtra={opExtra}
            onUpdateOpExtra={handleUpdateOpExtra}
            onBorrarRemoto={handleBorrarRemotoRegistro}
            prefillOp={prefillOp}
            onToast={toast}
          />
        )}

        {activeTab === 'lista' && (
          <RegistrosTab
            registros={registros}
            onRegistrosChange={handleRegistrosChange}
            nombres={nombres}
            planes={planes}
            planesOp={planesOp}
            opExtra={opExtra}
            onUpdateOpExtra={handleUpdateOpExtra}
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
            registros={registros}
            onIngresosChange={handleIngresosChange}
            catalogo={catalogo}
            catLoading={catLoading}
            catErr={catErr}
            onRecargarCatalogo={() => cargarCatalogoSb(true)}
            nombres={nombres}
            modoIng={modoIng}
            onModoIngChange={setModoIng}
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
            userEmail={userEmail}
            canManageTeam={canManageTeam}
            teamEmails={teamEmails}
            onTeamEmailsChange={handleTeamEmailsChange}
            legacyPending={legacyPending}
            migrating={migrating}
            onMigrateLocal={handleMigrateLocal}
            onBorrarRemoto={handleBorrarRemotoRegistro}
            onSignOut={handleSignOut}
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
      />
    </div>
  );
};
