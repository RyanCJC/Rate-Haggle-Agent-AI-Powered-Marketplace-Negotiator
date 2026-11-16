import { useCallback, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import styles from "./tabs.module.css";

export interface TabItem {
  id: string;
  label: string;
  panel: ReactNode;
}

export interface TabsProps {
  items: TabItem[];
  activeId?: string;
  defaultId?: string;
  onChange?: (id: string) => void;
}

export function Tabs({ items, activeId: activeIdProp, defaultId, onChange }: TabsProps) {
  const [activeId, setActiveId] = useState(defaultId ?? items[0]?.id ?? "");
  const id = useId();
  const tabRefs = useRef<HTMLButtonElement[]>([]);

  const controlled = activeIdProp !== undefined;
  const current = controlled ? activeIdProp : activeId;

  const handleChange = useCallback(
    (next: string) => {
      if (!controlled) setActiveId(next);
      onChange?.(next);
    },
    [controlled, onChange]
  );

  const focusTab = useCallback((index: number) => {
    const el = tabRefs.current[index];
    if (el) el.focus();
  }, []);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent, index: number) => {
      switch (event.key) {
        case "ArrowRight":
        case "ArrowDown":
          event.preventDefault();
          focusTab((index + 1) % items.length);
          break;
        case "ArrowLeft":
        case "ArrowUp":
          event.preventDefault();
          focusTab((index - 1 + items.length) % items.length);
          break;
        case "Home":
          event.preventDefault();
          focusTab(0);
          break;
        case "End":
          event.preventDefault();
          focusTab(items.length - 1);
          break;
        default:
          break;
      }
    },
    [focusTab, items.length]
  );

  return (
    <div className={styles.tabs}>
      <div className={styles.tablist} role="tablist" aria-orientation="horizontal">
        {items.map((item, index) => {
          const active = item.id === current;
          return (
            <button
              key={item.id}
              ref={(el) => (tabRefs.current[index] = el!)}
              id={`${id}-tab-${item.id}`}
              role="tab"
              aria-controls={`${id}-panel-${item.id}`}
              aria-selected={active}
              className={[styles.tab, active && styles.tabActive].filter(Boolean).join(" ")}
              onClick={() => handleChange(item.id)}
              onKeyDown={(e) => handleKeyDown(e, index)}
              type="button"
            >
              {item.label}
            </button>
          );
        })}
      </div>
      {items.map((item) => {
        const active = item.id === current;
        return (
          <div
            key={item.id}
            id={`${id}-panel-${item.id}`}
            role="tabpanel"
            aria-labelledby={`${id}-tab-${item.id}`}
            hidden={!active}
            className={styles.panel}
          >
            {item.panel}
          </div>
        );
      })}
    </div>
  );
}
