import type { ReactNode } from "react";

type FilterSectionProps = {
  title: string;
  subtitle?: string;
  children: ReactNode;
};

export function FilterSection({ title, subtitle, children }: FilterSectionProps) {
  return (
    <section className="tc-filter-section">
      <div className="tc-filter-section-header">
        <div>
          <h4 className="tc-filter-section-title">{title}</h4>
          {subtitle ? <p className="tc-upstream-advice">{subtitle}</p> : null}
        </div>
      </div>
      {children}
    </section>
  );
}
