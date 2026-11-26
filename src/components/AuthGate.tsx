import React, { useState } from 'react';
import {
  createUserWithEmailAndPassword,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  User,
} from 'firebase/auth';
import { auth, googleProvider } from '../services/firebase';

interface AuthGateProps {
  loading: boolean;
  unverifiedUser?: User | null;
  onRefreshVerification?: () => Promise<boolean>;
  localStats: {
    registros: number;
    ingresos: number;
  };
}

function mapAuthError(err: any): string {
  const code = String(err?.code || '');
  if (code === 'auth/popup-closed-by-user') {
    return 'Cerraste la ventana de inicio de sesión antes de completar el acceso.';
  }
  if (code === 'auth/popup-blocked') {
    return 'El navegador bloqueó la ventana emergente. Permite ventanas emergentes o usa tu correo y contraseña.';
  }
  if (code === 'auth/unauthorized-domain') {
    const host = typeof window !== 'undefined' ? window.location.hostname : '';
    return `El dominio (${host}) no está autorizado para el botón de Google. Usa tu correo y contraseña arriba o agrega el dominio en Firebase Console → Authentication → Settings → Authorized domains.`;
  }
  if (code === 'auth/operation-not-allowed') {
    return 'El método Correo y contraseña aún no está activado en Firebase. Actívalo en Firebase Console → Authentication → Sign-in method → Email/Password.';
  }
  if (
    code === 'auth/invalid-credential' ||
    code === 'auth/wrong-password' ||
    code === 'auth/user-not-found'
  ) {
    return 'Correo o contraseña incorrectos.';
  }
  if (code === 'auth/invalid-email') {
    return 'Ingresa un correo electrónico válido.';
  }
  if (code === 'auth/email-already-in-use') {
    return 'Ese correo ya está registrado. Cambia a «Iniciar sesión» para ingresar.';
  }
  if (code === 'auth/weak-password') {
    return 'La contraseña debe tener al menos 6 caracteres.';
  }
  if (code === 'auth/too-many-requests') {
    return 'Demasiados intentos seguidos. Espera unos minutos e intenta de nuevo.';
  }
  return String(err?.message || 'No se pudo completar el acceso.');
}

export const AuthGate: React.FC<AuthGateProps> = ({
  loading,
  unverifiedUser,
  onRefreshVerification,
  localStats,
}) => {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [errMsg, setErrMsg] = useState('');
  const [infoMsg, setInfoMsg] = useState('');

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

  // Pending email verification gate for Email/Password users
  if (unverifiedUser) {
    const handleCheckVerified = async () => {
      setBusy(true);
      setErrMsg('');
      setInfoMsg('');
      try {
        const ok = onRefreshVerification ? await onRefreshVerification() : false;
        if (!ok) {
          setErrMsg(
            'Tu correo aún figura sin verificar. Revisa tu bandeja (o carpeta Spam), abre el enlace de verificación y vuelve a pulsar este botón.'
          );
        }
      } catch (err: any) {
        setErrMsg(mapAuthError(err));
      } finally {
        setBusy(false);
      }
    };

    const handleResend = async () => {
      setBusy(true);
      setErrMsg('');
      setInfoMsg('');
      try {
        await sendEmailVerification(unverifiedUser);
        setInfoMsg(`Se envió un nuevo enlace de verificación a ${unverifiedUser.email}.`);
      } catch (err: any) {
        setErrMsg(mapAuthError(err));
      } finally {
        setBusy(false);
      }
    };

    return (
      <div className="auth-shell">
        <div className="panel auth-card">
          <div className="auth-brand">
            <span className="op">VERIFICACIÓN PENDIENTE</span>
            <h1 style={{ display: 'block', fontSize: '1.3rem', marginTop: '10px' }}>
              Confirma tu correo electrónico
            </h1>
            <p className="info" style={{ margin: '6px 0 0', lineHeight: 1.5 }}>
              Enviamos un enlace de activación a{' '}
              <strong className="mono">{unverifiedUser.email}</strong>. Ábrelo una sola vez para habilitar la sincronización segura en Firestore.
            </p>
          </div>

          {errMsg && (
            <div className="auth-alert auth-alert-err">{errMsg}</div>
          )}
          {infoMsg && (
            <div className="auth-alert auth-alert-ok">{infoMsg}</div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={handleCheckVerified}
            >
              {busy ? 'Comprobando...' : 'Ya verifiqué mi correo'}
            </button>
            <button
              type="button"
              className="btn sec2"
              disabled={busy}
              onClick={handleResend}
            >
              Reenviar enlace de verificación
            </button>
            <button
              type="button"
              className="btn-s"
              disabled={busy}
              onClick={() => signOut(auth)}
            >
              Cambiar de usuario / Salir
            </button>
          </div>
        </div>
      </div>
    );
  }

  const hasLocalData = localStats.registros > 0 || localStats.ingresos > 0;

  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanEmail = email.trim().toLowerCase();
    setErrMsg('');
    setInfoMsg('');

    if (!cleanEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      setErrMsg('Ingresa un correo electrónico válido.');
      return;
    }
    if (password.length < 6) {
      setErrMsg('La contraseña debe tener al menos 6 caracteres.');
      return;
    }
    if (mode === 'register' && password !== confirmPassword) {
      setErrMsg('Las contraseñas no coinciden.');
      return;
    }

    setBusy(true);
    try {
      if (mode === 'login') {
        await signInWithEmailAndPassword(auth, cleanEmail, password);
      } else {
        const cred = await createUserWithEmailAndPassword(auth, cleanEmail, password);
        try {
          await sendEmailVerification(cred.user);
        } catch {
          // User still lands on the unverified screen where they can resend
        }
      }
    } catch (err: any) {
      setErrMsg(mapAuthError(err));
    } finally {
      setBusy(false);
    }
  };

  const handleForgotPassword = async () => {
    const cleanEmail = email.trim().toLowerCase();
    setErrMsg('');
    setInfoMsg('');
    if (!cleanEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      setErrMsg('Escribe primero tu correo arriba para enviarte el enlace de recuperación.');
      return;
    }
    setBusy(true);
    try {
      await sendPasswordResetEmail(auth, cleanEmail);
      setInfoMsg(`Te enviamos un enlace para restablecer tu contraseña a ${cleanEmail}.`);
    } catch (err: any) {
      setErrMsg(mapAuthError(err));
    } finally {
      setBusy(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setBusy(true);
    setErrMsg('');
    setInfoMsg('');
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err: any) {
      setErrMsg(mapAuthError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-shell">
      <div className="panel auth-card">
        <div className="auth-brand">
          <span className="op">PLANTA · ALMACÉN</span>
          <h1 style={{ display: 'block', fontSize: '1.35rem', marginTop: '10px' }}>
            Control de Entregas y Despacho
          </h1>
          <p className="info" style={{ margin: '6px 0 0', lineHeight: 1.5 }}>
            Inicia sesión con tu usuario (correo y contraseña) para sincronizar entregas e ingresos en tiempo real.
          </p>
        </div>

        {hasLocalData && (
          <div className="auth-highlights" style={{ marginBottom: '14px' }}>
            <div className="auth-local-note">
              <strong>Datos locales detectados en este equipo</strong>
              <span>
                Tienes {localStats.registros} registro(s) y {localStats.ingresos} ingreso(s) guardados aquí. Al ingresar podrás subirlos a la nube en 1 clic.
              </span>
            </div>
          </div>
        )}

        <div className="chips seg" style={{ marginBottom: '14px' }}>
          <button
            type="button"
            className={`chip ${mode === 'login' ? 'active' : ''}`}
            onClick={() => {
              setMode('login');
              setErrMsg('');
              setInfoMsg('');
            }}
          >
            Iniciar sesión
          </button>
          <button
            type="button"
            className={`chip ${mode === 'register' ? 'active' : ''}`}
            onClick={() => {
              setMode('register');
              setErrMsg('');
              setInfoMsg('');
            }}
          >
            Crear cuenta
          </button>
        </div>

        <form onSubmit={handleEmailSubmit}>
          <div className="field">
            <label htmlFor="authEmail">Correo del usuario</label>
            <input
              id="authEmail"
              type="email"
              autoComplete="email"
              placeholder="usuario@correo.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>

          <div className="field">
            <label htmlFor="authPass">Contraseña</label>
            <input
              id="authPass"
              type="password"
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              placeholder="Mínimo 6 caracteres"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          {mode === 'register' && (
            <div className="field">
              <label htmlFor="authPassConfirm">Confirmar contraseña</label>
              <input
                id="authPassConfirm"
                type="password"
                autoComplete="new-password"
                placeholder="Repite la contraseña"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
              />
            </div>
          )}

          {errMsg && <div className="auth-alert auth-alert-err">{errMsg}</div>}
          {infoMsg && <div className="auth-alert auth-alert-ok">{infoMsg}</div>}

          <button type="submit" className="btn" disabled={busy}>
            {busy
              ? 'Procesando...'
              : mode === 'login'
              ? 'Ingresar'
              : 'Crear usuario'}
          </button>
        </form>

        {mode === 'login' && (
          <div style={{ textAlign: 'right', marginTop: '8px' }}>
            <button
              type="button"
              className="link-btn"
              disabled={busy}
              onClick={handleForgotPassword}
            >
              ¿Olvidaste tu contraseña?
            </button>
          </div>
        )}

        <div className="auth-divider">
          <span>o</span>
        </div>

        <button
          type="button"
          className="btn sec2"
          disabled={busy}
          onClick={handleGoogleSignIn}
        >
          Continuar con Google
        </button>

        <p className="info" style={{ margin: '12px 0 0', fontSize: '0.78rem', textAlign: 'center' }}>
          ¿Trabajas en equipo? El administrador autoriza tu correo en Config → Usuarios del equipo.
        </p>
      </div>
    </div>
  );
};
