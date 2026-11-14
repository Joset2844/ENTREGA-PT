export interface ModeloItem {
  modelo?: string;
  descripcion: string;
  sap: string;
  cantidadTotal?: string | number;
}

export interface CatalogoOp {
  op: string;
  cliente: string;
  descripcion: string;
  sap: string;
  descripcionBase?: string;
  cantidadTotal: number;
  modelos: ModeloItem[];
}

export interface Registro {
  id: string;
  fecha: string;
  fdesp: string;
  turno: string;
  nombre: string;
  op: string;
  sap: string;
  descripcion: string;
  cliente: string;
  pedido: number;
  empaque: string;
  u: number;
  c: number;
  total: number;
  estado: string;
  creado: string;
  sync?: boolean;
  ord?: number;
}

export interface Ingreso {
  id: string;
  fecha: string;
  turno: string;
  nombre: string;
  op: string;
  sap: string;
  descripcion: string;
  cliente: string;
  empaque: string;
  u: number;
  c: number;
  total: number;
  creado: string;
  sync?: boolean;
}

export interface GridRow {
  op: string;
  mod: string;
  sap?: string;
  pedido: string;
  emp: string;
  u: string;
  c: string;
}

export interface IngresoGridRow {
  op: string;
  mod: string;
  emp: string;
  u: string;
  c: string;
}

export interface PlanItem {
  sap: string;
  cant: number;
  stock: number;
}

export interface PlanDespacho {
  archivo?: string;
  items: PlanItem[];
}

export interface PlanOpItem {
  op: string;
  cant: number;
  stock: number;
}

export interface PlanOp {
  archivo?: string;
  items: PlanOpItem[];
}

export interface Candidate {
  op: string;
  cliente: string;
  sap: string;
  desc: string;
}

export interface ConfirmRow {
  cands: Candidate[];
  cant: number;
  stock: number;
  ok: boolean;
  key: string;
}

export interface ToastItem {
  id: number;
  tipo: 'ok' | 'error';
  mensaje: string;
}

export interface OpExtra {
  enProduccion?: boolean;
  cantPlanta?: number;
}
