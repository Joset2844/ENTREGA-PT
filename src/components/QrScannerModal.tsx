import React, { useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';
import { CatalogoOp } from '../types';
import { parseQrString, QrParsedResult } from '../utils/qr';

interface QrScannerModalProps {
  catalogo: CatalogoOp[];
  onScan: (result: QrParsedResult) => void;
  onClose: () => void;
}

export const QrScannerModal: React.FC<QrScannerModalProps> = ({
  catalogo,
  onScan,
  onClose,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const scannedOnceRef = useRef(false);

  const [camStatus, setCamStatus] = useState<'starting' | 'active' | 'error'>('starting');
  const [camError, setCamError] = useState('');
  const [manualText, setManualText] = useState('');
  const [scanError, setScanError] = useState('');

  const handleDecodedRaw = (raw: string) => {
    const trimmed = String(raw || '').trim();
    if (!trimmed) return;
    const parsed = parseQrString(trimmed, catalogo);
    if (!parsed.op && !parsed.sap) {
      setScanError(`QR leído ("${trimmed.slice(0, 40)}"), pero no contiene una OP ni SAP válido.`);
      scannedOnceRef.current = false;
      return;
    }
    onScan(parsed);
  };

  useEffect(() => {
    let cancelled = false;

    const stopCamera = () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
    };

    const startCamera = async () => {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setCamStatus('error');
        setCamError('Tu navegador no permite acceso directo a cámara. Usa el campo de lector USB o toma una foto.');
        return;
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: false,
        });

        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        streamRef.current = stream;
        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          await video.play();
        }
        setCamStatus('active');

        const win = window as any;
        const detector =
          typeof win.BarcodeDetector === 'function'
            ? new win.BarcodeDetector({ formats: ['qr_code'] })
            : null;

        let lastTick = 0;
        const scanFrame = async (ts: number) => {
          if (cancelled || scannedOnceRef.current) return;
          const v = videoRef.current;
          if (v && v.readyState >= 2 && v.videoWidth > 0 && ts - lastTick > 130) {
            lastTick = ts;
            try {
              if (detector) {
                const codes = await detector.detect(v);
                if (codes && codes.length > 0 && codes[0].rawValue) {
                  scannedOnceRef.current = true;
                  handleDecodedRaw(codes[0].rawValue);
                  return;
                }
              }
            } catch {
              // Fallback to jsQR
            }

            const canvas = canvasRef.current;
            if (canvas) {
              const w = Math.min(v.videoWidth, 800);
              const h = Math.round((v.videoHeight / v.videoWidth) * w);
              if (canvas.width !== w || canvas.height !== h) {
                canvas.width = w;
                canvas.height = h;
              }
              const ctx = canvas.getContext('2d', { willReadFrequently: true });
              if (ctx) {
                ctx.drawImage(v, 0, 0, w, h);
                const imgData = ctx.getImageData(0, 0, w, h);
                const code = jsQR(imgData.data, w, h, {
                  inversionAttempts: 'dontInvert',
                });
                if (code && code.data) {
                  scannedOnceRef.current = true;
                  handleDecodedRaw(code.data);
                  return;
                }
              }
            }
          }
          rafRef.current = requestAnimationFrame(scanFrame);
        };

        rafRef.current = requestAnimationFrame(scanFrame);
      } catch (err: any) {
        if (cancelled) return;
        setCamStatus('error');
        const msg = String(err?.name || err?.message || '');
        if (msg.includes('NotAllowed') || msg.includes('Permission')) {
          setCamError('Permiso de cámara denegado. Puedes otorgar permiso, usar una foto o escanear con lector USB/Bluetooth.');
        } else if (msg.includes('NotFound') || msg.includes('DevicesNotFound')) {
          setCamError('No se detectó cámara en este equipo. Usa un lector USB/Bluetooth o sube una imagen del QR.');
        } else {
          setCamError('No se pudo iniciar la cámara en vivo. Puedes tomar/subir una foto o usar el lector USB.');
        }
      }
    };

    startCamera();

    return () => {
      cancelled = true;
      stopCamera();
    };
  }, []);

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    setScanError('');

    const img = new Image();
    const url = URL.createObjectURL(f);
    img.onload = () => {
      try {
        const maxDim = 1200;
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0, w, h);
          const imgData = ctx.getImageData(0, 0, w, h);
          const code = jsQR(imgData.data, w, h, { inversionAttempts: 'attemptBoth' });
          if (code && code.data) {
            handleDecodedRaw(code.data);
          } else {
            setScanError('No se detectó ningún código QR claro en la imagen. Intenta acercarte más y enfocar.');
          }
        }
      } finally {
        URL.revokeObjectURL(url);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      setScanError('No se pudo leer el archivo de imagen.');
    };
    img.src = url;
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
        padding: '14px',
      }}
    >
      <div
        className="card"
        style={{
          maxWidth: '520px',
          width: '100%',
          maxHeight: '92vh',
          overflowY: 'auto',
          background: 'var(--panel)',
          borderRadius: '16px',
          padding: '18px',
          margin: 0,
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: '8px',
            marginBottom: '10px',
          }}
        >
          <div className="sec" style={{ margin: 0, fontSize: '1.08rem' }}>
            📷 Escanear QR de OP
          </div>
          <button
            type="button"
            className="btn-s"
            onClick={onClose}
            style={{ minHeight: '34px', padding: '4px 12px' }}
          >
            Cerrar
          </button>
        </div>

        {/* Camera viewfinder */}
        <div
          style={{
            position: 'relative',
            width: '100%',
            aspectRatio: '4 / 3',
            background: '#0D1117',
            borderRadius: '12px',
            overflow: 'hidden',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: '12px',
            border: '1px solid var(--border)',
          }}
        >
          <video
            ref={videoRef}
            playsInline
            muted
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              display: camStatus === 'active' ? 'block' : 'none',
            }}
          />
          <canvas ref={canvasRef} className="hidden" />

          {camStatus === 'active' && (
            <div
              style={{
                position: 'absolute',
                width: '62%',
                aspectRatio: '1 / 1',
                maxWidth: '220px',
                border: '3px solid var(--amber)',
                borderRadius: '14px',
                boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.35)',
                pointerEvents: 'none',
              }}
            />
          )}

          {camStatus === 'starting' && (
            <div style={{ color: '#CBD5E0', fontSize: '0.88rem', padding: '16px', textAlign: 'center' }}>
              Iniciando cámara...
            </div>
          )}

          {camStatus === 'error' && (
            <div style={{ color: '#FC8181', fontSize: '0.84rem', padding: '18px', textAlign: 'center', lineHeight: 1.45 }}>
              {camError}
            </div>
          )}
        </div>

        {scanError && (
          <div
            style={{
              background: 'rgba(229, 62, 62, 0.1)',
              border: '1px solid var(--red)',
              color: 'var(--err-tx)',
              borderRadius: '10px',
              padding: '8px 12px',
              fontSize: '0.82rem',
              fontWeight: 600,
              marginBottom: '10px',
            }}
          >
            {scanError}
          </div>
        )}

        {/* Photo fallback + Handheld USB/BT scanner input */}
        <div style={{ display: 'flex', gap: '8px', marginBottom: '12px', flexWrap: 'wrap' }}>
          <button
            type="button"
            className="btn-s"
            onClick={() => fileInputRef.current?.click()}
            style={{ flex: '1 1 auto' }}
          >
            📸 Tomar foto / Subir imagen QR
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={handleImageUpload}
          />
        </div>

        <div
          style={{
            background: 'var(--alt)',
            border: '1px solid var(--border)',
            borderRadius: '10px',
            padding: '10px 12px',
          }}
        >
          <label htmlFor="qrManualInput" style={{ fontSize: '0.8rem', marginBottom: '4px' }}>
            Lector QR USB / Bluetooth o código manual (presiona Enter)
          </label>
          <div style={{ display: 'flex', gap: '8px' }}>
            <input
              id="qrManualInput"
              type="text"
              className="mono"
              placeholder="Ej. OP:260001|SAP:100234 o solo 260001"
              value={manualText}
              onChange={(e) => {
                setManualText(e.target.value);
                if (scanError) setScanError('');
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleDecodedRaw(manualText);
                }
              }}
              style={{ minHeight: '40px', fontSize: '0.88rem' }}
            />
            <button
              type="button"
              className="btn-s"
              onClick={() => handleDecodedRaw(manualText)}
              style={{
                background: 'var(--amber)',
                color: 'var(--on-amber)',
                borderColor: 'var(--amber)',
                fontWeight: 700,
                whiteSpace: 'nowrap',
              }}
            >
              Aplicar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
