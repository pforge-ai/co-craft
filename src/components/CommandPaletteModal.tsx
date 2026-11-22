import React from 'react';
import { ArrowUpRight, Plus, Search } from 'lucide-react';
import { Modal } from './ui';

export interface CommandPaletteItem {
  id: string;
  name: string;
  detail: string;
  key: string;
  run: () => void;
}

export interface CommandPaletteModalProps {
  query: string;
  activeIndex: number;
  items: CommandPaletteItem[];
  onQueryChange: (next: string) => void;
  onActiveIndexChange: (next: number) => void;
  onClose: () => void;
}

export function CommandPaletteModal({
  query,
  activeIndex,
  items,
  onQueryChange,
  onActiveIndexChange,
  onClose,
}: CommandPaletteModalProps) {
  return (
    <Modal title="你想做什么？" onClose={onClose}>
      <div className="command-input">
        <Search size={17} />
        <input
          autoFocus
          aria-label="搜索命令"
          placeholder="搜索命令、布局、素材或成片…"
          value={query}
          onChange={(e) => {
            onQueryChange(e.target.value);
            onActiveIndexChange(0);
          }}
          onKeyDown={(e) => {
            if (!items.length) return;
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              onActiveIndexChange((activeIndex + 1) % items.length);
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              onActiveIndexChange((activeIndex - 1 + items.length) % items.length);
            } else if (e.key === 'Enter') {
              e.preventDefault();
              const picked = items[Math.min(activeIndex, items.length - 1)];
              if (picked) {
                onClose();
                picked.run();
              }
            }
          }}
        />
        <kbd>ESC</kbd>
      </div>
      <div className="command-results" role="listbox">
        {items.length === 0 ? (
          <div className="command-empty">
            没有匹配「{query}」的命令。可尝试搜索：布局、导出、分支、字幕、设置、素材、时间线或切换画布。
          </div>
        ) : (
          items.map((item, idx) => (
            <button
              key={item.id}
              role="option"
              aria-selected={idx === activeIndex}
              className={idx === activeIndex ? 'active' : ''}
              onMouseEnter={() => onActiveIndexChange(idx)}
              onClick={() => {
                onClose();
                item.run();
              }}
            >
              <span>
                {item.name}
                <small>{item.detail}</small>
              </span>
              <kbd>{item.key === '+' ? <Plus size={14} /> : item.key || <ArrowUpRight size={13} />}</kbd>
            </button>
          ))
        )}
      </div>
    </Modal>
  );
}
