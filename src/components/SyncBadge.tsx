import React from 'react';

interface SyncBadgeProps {
  lastSyncTime: Date | null;
  isOnline: boolean;
  syncOk: boolean;
  pendingCount: number;
}

export const SyncBadge: React.FC<SyncBadgeProps> = ({
  lastSyncTime,
  isOnline,
  syncOk,
  pendingCount,
}) => {
  const timeStr = lastSyncTime
    ? `${('0' + lastSyncTime.getHours()).slice(-2)}:${('0' + lastSyncTime.getMinutes()).slice(-2)}:${('0' + lastSyncTime.getSeconds()).slice(-2)}`
    : '--:--:--';

  const statusText = !isOnline
    ? 'Sin internet (modo local) '
    : !syncOk
    ? 'Reconectando nube '
    : pendingCount > 0
    ? 'Sincronizando nube '
    : 'Nube conectada ';
  const pendTxt = pendingCount > 0 ? ` · ${pendingCount} por subir` : '';

  return (
    <div
      id="syncMarca"
      style={{
        position: 'fixed',
        right: '10px',
        bottom: '10px',
        font: '600 12px "IBM Plex Mono", monospace',
        padding: '5px 10px',
        borderRadius: '8px',
        background: !isOnline ? 'rgba(180,35,35,0.9)' : 'rgba(27,36,51,0.84)',
        color: '#fff',
        zIndex: 9999,
      }}
    >
      {statusText}
      {timeStr}
      {pendTxt}
    </div>
  );
};
