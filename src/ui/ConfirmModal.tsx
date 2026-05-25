import React from 'react';

interface Props {
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmModal({ message, onConfirm, onCancel }: Props) {
  return (
    <div
      onClick={onCancel}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(0,0,0,0.6)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--surface-raised)',
          border: '1px solid var(--border)',
          borderRadius: 12,
          padding: '28px 32px',
          maxWidth: 380,
          width: '90%',
          display: 'flex',
          flexDirection: 'column',
          gap: 20,
        }}
      >
        <p style={{ margin: 0, fontSize: 15, color: 'var(--text)', lineHeight: 1.5 }}>
          {message}
        </p>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button
            onClick={onCancel}
            style={{
              padding: '8px 18px', borderRadius: 8, border: '1px solid var(--border)',
              background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 14,
            }}
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            style={{
              padding: '8px 18px', borderRadius: 8, border: 'none',
              background: 'var(--accent)', color: '#0c0e14', fontWeight: 700,
              cursor: 'pointer', fontSize: 14,
            }}
          >
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
}
