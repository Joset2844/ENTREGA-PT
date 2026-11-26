import React from 'react';
import { FirestoreErrorInfo } from '../services/firebase';

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
  detail: string;
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: '', detail: '' };
  }

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    const raw = error instanceof Error ? error.message : String(error);
    try {
      const parsed = JSON.parse(raw) as FirestoreErrorInfo;
      if (parsed && parsed.operationType) {
        const lower = (parsed.error || '').toLowerCase();
        if (lower.includes('quota exceeded')) {
          return {
            hasError: true,
            message: 'Se alcanzó el límite diario gratuito de lecturas/escrituras en Firebase.',
            detail: 'La cuota se restablece al día siguiente o al actualizar el plan en Firebase Console.',
          };
        }
        if (lower.includes('permission')) {
          return {
            hasError: true,
            message: 'Tu cuenta Google no tiene permiso sobre esta colección o registro.',
            detail: `Operación: ${parsed.operationType} · Ruta: ${parsed.path || '—'} · Usuario: ${parsed.authInfo?.email || 'sin correo'}. Pide al administrador que agregue tu correo en Config.`,
          };
        }
        return {
          hasError: true,
          message: 'Error de sincronización con Firebase Firestore.',
          detail: parsed.error,
        };
      }
    } catch {
      // Not JSON
    }
    return {
      hasError: true,
      message: 'Ocurrió un error inesperado en la aplicación.',
      detail: raw.slice(0, 240),
    };
  }

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <div className="auth-shell">
        <div className="panel auth-card" style={{ borderColor: 'var(--red)' }}>
          <div className="sec" style={{ color: 'var(--red)' }}>
            Atención · Error de datos en la nube
          </div>
          <p style={{ margin: '0 0 10px', fontWeight: 600 }}>{this.state.message}</p>
          {this.state.detail && (
            <p className="info" style={{ margin: '0 0 16px', wordBreak: 'break-word' }}>
              {this.state.detail}
            </p>
          )}
          <button
            type="button"
            className="btn"
            onClick={() => {
              this.setState({ hasError: false, message: '', detail: '' });
              window.location.reload();
            }}
          >
            Recargar aplicación
          </button>
        </div>
      </div>
    );
  }
}
