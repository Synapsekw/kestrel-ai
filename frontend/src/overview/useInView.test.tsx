import { afterEach, describe, expect, it, vi } from "vitest";
import { act, render } from "@testing-library/react";
import { useState } from "react";
import { useInView } from "./useInView";

const observed: Element[] = [];
let fire: (v: boolean) => void = () => {};

class FakeIO {
  constructor(cb: (e: { isIntersecting: boolean }[]) => void) {
    fire = (v) => cb([{ isIntersecting: v }]);
  }
  observe(el: Element) {
    observed.push(el);
  }
  disconnect() {}
}

function Probe() {
  const [show, setShow] = useState(false);
  const [ref, inView] = useInView<HTMLDivElement>();
  return (
    <>
      <button onClick={() => setShow(true)}>mount</button>
      {show && <div ref={ref} data-testid="late" />}
      <span data-testid="v">{String(inView)}</span>
    </>
  );
}

describe("useInView", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    observed.length = 0;
  });

  it("observes an element that attaches after the first render", () => {
    vi.stubGlobal("IntersectionObserver", FakeIO);
    const { getByText, getByTestId } = render(<Probe />);
    expect(observed).toHaveLength(0);
    act(() => getByText("mount").click());
    expect(observed).toEqual([getByTestId("late")]);
    act(() => fire(true));
    expect(getByTestId("v")).toHaveTextContent("true");
  });
});
