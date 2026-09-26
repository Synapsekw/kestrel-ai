import type { ReactNode } from "react";
import { EmptyState, type IconName } from "@/ui";

/** A section page whose screen has not landed yet. */
export function SectionPlaceholder({
  title,
  icon,
  children,
}: {
  title: string;
  icon: IconName;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">{title}</h1>
      <EmptyState icon={icon} title={`${title} will appear here`}>
        {children}
      </EmptyState>
    </section>
  );
}
