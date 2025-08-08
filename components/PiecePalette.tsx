import React from 'react';

type Props = {
  selected: string | null; // e.g., 'wP', 'bK'
  onSelect: (p: string | null) => void;
};

const pieces = ['wK','wQ','wR','wB','wN','wP','bK','bQ','bR','bB','bN','bP'];

export default function PiecePalette({ selected, onSelect }: Props) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 40px)', gap: 6 }}>
      {pieces.map(p => (
        <button
          key={p}
          onClick={() => onSelect(selected === p ? null : p)}
          title={p}
          style={{
            width: 40,
            height: 40,
            borderRadius: 6,
            border: selected === p ? '2px solid #0ea5e9' : '1px solid #ccc',
            background: '#fff'
          }}
        >
          {p}
        </button>
      ))}
      <button
        onClick={() => onSelect(null)}
        style={{ gridColumn: 'span 6', height: 32, border: '1px dashed #aaa', borderRadius: 6, background: '#fafafa' }}
        title="Erase"
      >
        Erase / Select none
      </button>
    </div>
  );
}