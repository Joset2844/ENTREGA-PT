import React from 'react';

interface SyncBadgeProps {
  lastSyncTime: Date | null;
  isOnline: boolean;
  syncOk: boolean;
  pendingCount: number;
  onSyncNow: () => void;
}

export const SyncBadge: React.FC<SyncBadgeProps> = ({
  lastSyncTime,
  isOnline,
  syncOk,
  pendingCount,
  onSyncNow,
}) => {
  const timeStr = lastSyncTime
    ? `${('0' + lastSyncTime.getHours()).slice(-2)}:${('0' + lastSyncTime.getMinutes()).slice(-2)}:${('0' + lastSyncTime.getSeconds()).slice(-2)}`
    : '--:--:--';

  const statusText = !isOnline || !syncOk ? 'Sin conexión con Sheets ' : 'Sincronizado ';
  const pendTxt = pendingCount > 0 ? ` · ${pendingCount} sin enviar` : '';

  return (
    <div
      id="syncMarca"
      style={{
        position: 'fixed',
        right: '8px',
        bottom: '8px',
        font: '12px sans-serif',
        padding: '4px 8px',
        borderRadius: '12px',
        background: 'rgba(0,0,0,.65)',
        color: '#fff',
        zIndex: 9999,
        cursor: 'pointer',
      }}
      title="Tocar para sincronizar ahora"
      onClick={onSyncNow}
    >
      {statusText}
      {timeStr}
      {pendTxt}
    </div>
  );
};
