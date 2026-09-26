import { Children, isValidElement, useId, type ReactNode } from "react";
import { GlassPanel } from "./GlassPanel";
import { stagger } from "./motion";
import { cx } from "./tokens";

export interface InspectorLayoutProps {
  children: ReactNode;
  /** The InspectorPane, or null when nothing is selected. */
  inspector?: ReactNode | null;
  className?: string;
}

/** Content and a 340 px inspector on the right; below 1100 px the inspector stacks under the content. */
export function InspectorLayout({ children, inspector, className }: InspectorLayoutProps) {
  const open = inspector !== null && inspector !== undefined && inspector !== false;
  return (
    <div
      data-inspector={open ? "open" : "closed"}
      className={cx(
        "grid min-h-0 flex-1 gap-3",
        open ? "grid-cols-1 min-[1100px]:grid-cols-[minmax(0,1fr)_340px]" : "grid-cols-1",
        className,
      )}
    >
      <div className="min-h-0 min-w-0">{children}</div>
      {open && inspector}
    </div>
  );
}

export interface InspectorPaneProps {
  label: string;
  header?: ReactNode;
  /** Stays visible below the scrolling sections (Save, Close finding). */
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
}

/** The inspector (ws-images .ins): a header, sections that rise in with the stagger, a footer. */
export function InspectorPane({ label, header, footer, children, className }: InspectorPaneProps) {
  const sections = Children.toArray(children).filter(isValidElement);
  return (
    <GlassPanel
      as="aside"
      aria-label={label}
      className={cx(
        "flex min-h-0 flex-col overflow-hidden animate-slide-in reduce-motion:animate-none",
        className,
      )}
    >
      {header && (
        <div className="flex items-center justify-between gap-2 border-b border-line px-3.5 py-3">
          {header}
        </div>
      )}
      <div data-part="sections" className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto p-3.5">
        {sections.map((section, i) => (
          <div
            key={section.key ?? i}
            style={stagger(i)}
            className="stagger animate-rise reduce-motion:animate-none"
          >
            {section}
          </div>
        ))}
      </div>
      {footer && (
        <div data-part="footer" className="border-t border-line bg-surface px-3.5 py-3">
          {footer}
        </div>
      )}
    </GlassPanel>
  );
}

export interface InspectorSectionProps {
  title: ReactNode;
  /** A small control at the right of the title (Add photo, Edit). */
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function InspectorSection({ title, action, children, className }: InspectorSectionProps) {
  const id = useId();
  return (
    <section aria-labelledby={id} className={className}>
      <div className="flex items-center justify-between gap-2">
        <h3 id={id} className="text-xs font-medium text-muted">
          {title}
        </h3>
        {action}
      </div>
      <div className="mt-1.5">{children}</div>
    </section>
  );
}
