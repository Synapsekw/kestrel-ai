import { useEffect, useRef, type KeyboardEvent, type RefObject } from "react";

export const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * While `active`: focus moves inside `ref` (`initialFocus`, else the first focusable, else the
 * container), the returned keydown handler keeps Tab inside it, and focus returns to the element that
 * had it once `active` ends or the component unmounts, unless that element has left the page.
 * Shared by Dialog, Popover and CommandPalette.
 */
export function useFocusTrap(
  ref: RefObject<HTMLElement>,
  active: boolean,
  initialFocus?: RefObject<HTMLElement>,
): (e: KeyboardEvent<HTMLElement>) => void {
  const opener = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!active) return;
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const root = ref.current;
    const target = initialFocus?.current ?? root?.querySelector<HTMLElement>(FOCUSABLE) ?? root;
    target?.focus();
    return () => {
      const back = opener.current;
      opener.current = null;
      if (back && back.isConnected) back.focus();
    };
  }, [active, ref, initialFocus]);

  return (e) => {
    if (e.key !== "Tab" || !ref.current) return;
    const items = Array.from(ref.current.querySelectorAll<HTMLElement>(FOCUSABLE));
    if (items.length === 0) {
      e.preventDefault();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };
}
