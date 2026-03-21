import Link from "next/link";
import type { ReactNode } from "react";
import { ActionCardButton } from "@/components/ui/ActionCardButton";

export type WorkspaceHeroTone = "default" | "accent" | "success" | "warning";

export type WorkspaceHeroStat = {
  id: string;
  label: string;
  value: string;
  note?: string;
  tone?: WorkspaceHeroTone;
};

export type WorkspaceHeroAction = {
  id: string;
  label: string;
  note: string;
  href?: string;
  onClick?: () => void;
  disabled?: boolean;
};

type WorkspaceHeroProps = {
  title: string;
  subtitle: string;
  stats: WorkspaceHeroStat[];
  actions: WorkspaceHeroAction[];
  rightSlot?: ReactNode;
};

function resolveToneClassName(tone: WorkspaceHeroTone | undefined) {
  if (tone === "accent") {
    return "tc-workspace-hero-metric-accent";
  }
  if (tone === "success") {
    return "tc-workspace-hero-metric-success";
  }
  if (tone === "warning") {
    return "tc-workspace-hero-metric-warning";
  }
  return "tc-workspace-hero-metric-default";
}

export function WorkspaceHero({ title, subtitle, stats, actions, rightSlot }: WorkspaceHeroProps) {
  return (
    <section className="tc-workspace-hero">
      <div className="tc-workspace-hero-head">
        <div>
          <h2>{title}</h2>
          <p>{subtitle}</p>
        </div>
        {rightSlot ? <div className="tc-workspace-hero-right">{rightSlot}</div> : null}
      </div>

      <div className="tc-workspace-hero-metrics">
        {stats.map((item) => (
          <article
            key={item.id}
            className={`tc-workspace-hero-metric ${resolveToneClassName(item.tone)}`}
          >
            <span>{item.label}</span>
            <strong>{item.value}</strong>
            {item.note ? <small>{item.note}</small> : null}
          </article>
        ))}
      </div>

      <div className="tc-workspace-hero-actions">
        {actions.map((action) => (
          action.href && !action.disabled ? (
            <Link
              href={action.href}
              key={action.id}
              className="tc-workspace-hero-action"
              onClick={() => {
                action.onClick?.();
              }}
            >
              <strong>{action.label}</strong>
              <span>{action.note}</span>
            </Link>
          ) : (
            <ActionCardButton
              key={action.id}
              className="tc-workspace-hero-action"
              onClick={action.onClick}
              disabled={action.disabled}
            >
              <strong>{action.label}</strong>
              <span>{action.note}</span>
            </ActionCardButton>
          )
        ))}
      </div>
    </section>
  );
}
