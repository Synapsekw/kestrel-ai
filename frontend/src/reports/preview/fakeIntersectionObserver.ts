/** Test helper: a controllable IntersectionObserver (jsdom has none). Call `restore()` after each test. */
export interface FakeIntersection {
  /** Reports every observed element that `match`es as intersecting (or not). Wrap in `act`. */
  show: (match: (el: Element) => boolean, visible?: boolean) => void;
  observed: () => Element[];
  restore: () => void;
}

export function installFakeIntersectionObserver(): FakeIntersection {
  const live = new Set<FakeObserver>();

  class FakeObserver {
    readonly targets = new Set<Element>();
    readonly callback: IntersectionObserverCallback;
    constructor(callback: IntersectionObserverCallback) {
      this.callback = callback;
      live.add(this);
    }
    observe(el: Element) {
      this.targets.add(el);
    }
    unobserve(el: Element) {
      this.targets.delete(el);
    }
    disconnect() {
      this.targets.clear();
      live.delete(this);
    }
    takeRecords(): IntersectionObserverEntry[] {
      return [];
    }
    fire(match: (el: Element) => boolean, visible: boolean) {
      const hits = [...this.targets].filter(match);
      if (hits.length === 0) return;
      const entries = hits.map(
        (target) =>
          ({
            target,
            isIntersecting: visible,
            intersectionRatio: visible ? 1 : 0,
          }) as unknown as IntersectionObserverEntry,
      );
      this.callback(entries, this as unknown as IntersectionObserver);
    }
  }

  const g = globalThis as { IntersectionObserver?: typeof IntersectionObserver };
  const original = g.IntersectionObserver;
  g.IntersectionObserver = FakeObserver as unknown as typeof IntersectionObserver;
  return {
    show: (match, visible = true) => {
      for (const o of [...live]) o.fire(match, visible);
    },
    observed: () => [...live].flatMap((o) => [...o.targets]),
    restore: () => {
      if (original) g.IntersectionObserver = original;
      else delete g.IntersectionObserver;
    },
  };
}
