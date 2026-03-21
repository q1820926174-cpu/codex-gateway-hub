import Link from "next/link";
import type { ReactNode } from "react";
import { ActionCardButton } from "@/components/ui/ActionCardButton";

export type ModuleSwitcherItem = {
  id: string;
  title: string;
  description: string;
  badge?: string;
  value?: string;
  icon?: ReactNode;
  active?: boolean;
  disabled?: boolean;
  href?: string;
  onSelect?: (id: string) => void;
  onClick?: () => void;
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
          item.href && !item.disabled ? (
            <Link
              key={item.id}
              href={item.href}
              className={`tc-module-card ${item.active ? "is-active" : ""}`}
              aria-current={item.active ? "page" : undefined}
              onClick={() => {
                item.onSelect?.(item.id);
                item.onClick?.();
              }}
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
            </Link>
          ) : (
            <ActionCardButton
              key={item.id}
              className={`tc-module-card ${item.active ? "is-active" : ""}`}
              disabled={item.disabled}
              onClick={() => {
                item.onSelect?.(item.id);
                item.onClick?.();
              }}
              aria-current={item.active ? "page" : undefined}
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
            </ActionCardButton>
          )
        ))}
      </div>
    </section>
  );
}
