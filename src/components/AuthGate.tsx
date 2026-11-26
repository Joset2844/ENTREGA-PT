import React, { useState } from 'react';
import { signInWithPopup } from 'firebase/auth';
import { auth, googleProvider } from '../services/firebase';

interface AuthGateProps {
  loading: boolean;
  localStats: {
    registros: number;
    ingresos: number;
  };
}

export const AuthGate: React.FC<AuthGateProps> = ({ loading, localStats }) => {
  const [signingIn, setSigningIn] = useState(false);
  const [errMsg, setErrMsg] = useState('');

  const handleGoogleSignIn = async () => {
    setSigningIn(true);
    setErrMsg('');
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err: any) {
      const code = String(err?.code || '');
      if (code === 'auth/popup-closed-by-user') {
        setErrMsg('Cerraste la ventana de inicio de sesión antes de completar el acceso.');
      } else if (code === 'auth/popup-blocked') {
        setErrMsg('El navegador bloqueó la ventana emergente. Permite ventanas emergentes e intenta de nuevo.');
      } else {
        setErrMsg(String(err?.message || 'No se pudo iniciar sesión con Google.'));
      }
    } finally {
      setSigningIn(false);
    }
  };

  if (loading) {
    return (
      <div className="auth-shell">
        <div className="panel auth-card" style={{ textAlign: 'center' }}>
          <div className="sec" style={{ marginBottom: '6px' }}>
            Control de Entregas
          </div>
          <p className="info" style={{ margin: 0 }}>
            Conectando con la nube de Firebase...
          </p>
        </div>
      </div>
    );
  }

  const hasLocalData = localStats.registros > 0 || localStats.ingresos > 0;

  return (
    <div className="auth-shell">
      <div className="panel auth-card">
        <div className="auth-brand">
          <span className="op">PLANTA · ALMACÉN</span>
          <h1 style={{ display: 'block', fontSize: '1.35rem', marginTop: '10px' }}>
            Control de Entregas y Despacho
          </h1>
          <p className="info" style={{ margin: '6px 0 0', lineHeight: 1.5 }}>
            Sincronización en tiempo real en la nube (Firebase Firestore), catálogo de OPs y trabajo sin conexión en planta.
          </p>
        </div>

        <div className="auth-highlights">
          <div>
            <strong>Tiempo real entre dispositivos</strong>
            <span>Registra en planta o almacén y mira el avance al instante sin depender de Google Sheets.</span>
          </div>
          <div>
            <strong>Modo sin conexión automático</strong>
            <span>Tus entregas se guardan localmente si falla el Wi‑Fi y suben automáticamente al reconectar.</span>
          </div>
          {hasLocalData && (
            <div className="auth-local-note">
              <strong>Datos locales detectados en este equipo</strong>
              <span>
                Tienes {localStats.registros} registro(s) y {localStats.ingresos} ingreso(s) guardados aquí. Al ingresar podrás subirlos a la nube con 1 clic.
              </span>
            </div>
          )}
        </div>

        {errMsg && (
          <div
            style={{
              marginBottom: '12px',
              padding: '10px 12px',
              borderRadius: '10px',
              border: '1px solid var(--red)',
              color: 'var(--err-tx)',
              fontSize: '0.84rem',
              fontWeight: 600,
            }}
          >
            {errMsg}
          </div>
        )}

        <button
          type="button"
          className="btn"
          disabled={signingIn}
          onClick={handleGoogleSignIn}
        >
          {signingIn ? 'Abriendo Google...' : 'Iniciar sesión con Google'}
        </button>

        <p className="info" style={{ margin: '12px 0 0', fontSize: '0.78rem', textAlign: 'center' }}>
          Usa tu cuenta Google autorizada para acceder al control compartido del equipo.
        </p>
      </div>
    </div>
  );
};
