import type { ReactNode } from "react";

export type ModuleSwitcherItem = {
  id: string;
  title: string;
  description: string;
  badge?: string;
  value?: string;
  icon?: ReactNode;
  active?: boolean;
  disabled?: boolean;
  onSelect: (id: string) => void;
};

type ModuleSwitcherCardsProps = {
  title: string;
  items: ModuleSwitcherItem[];
};

export function ModuleSwitcherCards({ title, items }: ModuleSwitcherCardsProps) {
  return (
    <section className="tc-module-cards">
      <div className="tc-module-cards-head">
        <h3>{title}</h3>
      </div>

      <div className="tc-module-cards-grid">
        {items.map((item) => (
          <button
            type="button"
            key={item.id}
            className={`tc-module-card ${item.active ? "is-active" : ""}`}
            disabled={item.disabled}
            onClick={() => item.onSelect(item.id)}
            aria-pressed={Boolean(item.active)}
          >
            <div className="tc-module-card-top">
              <div className="tc-module-card-title">
                {item.icon ? <span className="tc-module-card-icon">{item.icon}</span> : null}
                <strong>{item.title}</strong>
              </div>
              {item.badge ? <span className="tc-module-card-badge">{item.badge}</span> : null}
            </div>
            <p>{item.description}</p>
            {item.value ? <span className="tc-module-card-value">{item.value}</span> : null}
          </button>
        ))}
      </div>
    </section>
  );
}
