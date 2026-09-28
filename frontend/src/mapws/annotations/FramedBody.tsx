import { Children, isValidElement, type ReactNode } from "react";
import { stagger } from "@/ui";

/**
 * A framed inspector's layout: a header, sections that rise in with F's stagger (as `InspectorPane`
 * does), a footer. W1's framed host brings the 318 px float glass, its `p-3.5` and its `aria-label`
 * (R-W1-11), so this adds no glass, no horizontal padding and no label of its own (M-W3 P13/A20).
 */
export function FramedBody(props: { header?: ReactNode; footer?: ReactNode; children: ReactNode }) {
  const { header, footer, children } = props;
  const sections = Children.toArray(children).filter(isValidElement);
  return (
    <div className="flex min-h-0 flex-col">
      {header && (
        <div className="flex items-center justify-between gap-2 border-b border-line pb-3">{header}</div>
      )}
      <div className="flex flex-col gap-3.5 py-3.5">
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
      {footer && <div className="border-t border-line pt-3">{footer}</div>}
    </div>
  );
}
