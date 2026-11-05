import React from 'react';
import { ToastItem } from '../types';

interface ToastsProps {
  toasts: ToastItem[];
}

export const Toasts: React.FC<ToastsProps> = ({ toasts }) => {
  return (
    <div id="toasts">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.tipo}`}>
          {t.mensaje}
        </div>
      ))}
    </div>
  );
};
