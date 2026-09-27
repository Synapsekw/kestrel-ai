import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppEvent } from "@contract/client";
import { useChangesStore } from "./changes";
import {
  consumeEcho,
  EMPTY_LEDGER,
  expectEchoes,
  FINDING_ECHO_MAX_IDS,
  FINDING_ECHO_TTL_MS,
  releaseEchoes,
} from "./changesEcho";
import { ownFindingsWrite } from "./changesOwnWrite";

const findingsChanged = (payload: Record<string, unknown>, project_id = "P"): AppEvent => ({
  type: "findings.changed",
  project_id,
  job_id: null,
  progress: null,
  message: "",
  payload,
});

describe("echo ledger (pure)", () => {
  it("consumes an echo whose ids were all expected, once per expected write", () => {
    let l = expectEchoes(EMPTY_LEDGER, ["a"], 0);
    l = expectEchoes(l, ["a", "b"], 0);
    const first = consumeEcho(l, { ids: ["a", "b"] }, 10);
    expect(first.skip).toBe(true);
    const second = consumeEcho(first.ledger, { ids: ["a"] }, 20);
    expect(second.skip).toBe(true);
    expect(consumeEcho(second.ledger, { ids: ["a"] }, 30).skip).toBe(false);
  });

  it("never consumes an echo with an unexpected id, and consumes nothing then", () => {
    const l = expectEchoes(EMPTY_LEDGER, ["a"], 0);
    const r = consumeEcho(l, { ids: ["a", "z"] }, 1);
    expect(r.skip).toBe(false);
    expect(consumeEcho(r.ledger, { ids: ["a"] }, 2).skip).toBe(true);
  });

  it("never consumes {all: true}, an empty list or a malformed payload", () => {
    const l = expectEchoes(EMPTY_LEDGER, ["a"], 0);
    expect(consumeEcho(l, { all: true }, 1).skip).toBe(false);
    expect(consumeEcho(l, { ids: [] }, 1).skip).toBe(false);
    expect(consumeEcho(l, { ids: [1] }, 1).skip).toBe(false);
    expect(consumeEcho(l, undefined, 1).skip).toBe(false);
  });

  it("drops an expectation after the TTL", () => {
    const l = expectEchoes(EMPTY_LEDGER, ["a"], 0);
    expect(consumeEcho(l, { ids: ["a"] }, FINDING_ECHO_TTL_MS).skip).toBe(true);
    expect(consumeEcho(l, { ids: ["a"] }, FINDING_ECHO_TTL_MS + 1).skip).toBe(false);
  });

  it("does not track writes of more ids than the backend lists", () => {
    const ids = Array.from({ length: FINDING_ECHO_MAX_IDS + 1 }, (_, i) => `f${i}`);
    expect(expectEchoes(EMPTY_LEDGER, ids, 0)).toBe(EMPTY_LEDGER);
  });

  it("release undoes one expectation per id", () => {
    let l = expectEchoes(EMPTY_LEDGER, ["a"], 0);
    l = expectEchoes(l, ["a"], 0);
    l = releaseEchoes(l, ["a"]);
    expect(l.a.n).toBe(1);
    expect(releaseEchoes(l, ["a"])).toEqual({});
  });
});

describe("changes store: own finding writes", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    useChangesStore.setState({ findingsRevision: 0, findingEchoes: EMPTY_LEDGER, openProjectId: null });
  });
  afterEach(() => vi.useRealTimers());

  it("bumps once for an own write and swallows its echo", async () => {
    await ownFindingsWrite(["a"], async () => "saved");
    expect(useChangesStore.getState().findingsRevision).toBe(1);
    useChangesStore.getState().applyEvent(findingsChanged({ ids: ["a"] }));
    expect(useChangesStore.getState().findingsRevision).toBe(1);
  });

  it("swallows an echo that arrives before the write resolves", async () => {
    const done = ownFindingsWrite(["a"], async () => {
      useChangesStore.getState().applyEvent(findingsChanged({ ids: ["a"] }));
      return "saved";
    });
    await done;
    expect(useChangesStore.getState().findingsRevision).toBe(1);
  });

  it("still bumps for a change nobody here made", () => {
    useChangesStore.getState().applyEvent(findingsChanged({ ids: ["a"] }));
    expect(useChangesStore.getState().findingsRevision).toBe(1);
  });

  it("an echo after the TTL bumps", async () => {
    await ownFindingsWrite(["a"], async () => "saved");
    vi.setSystemTime(1_000_000 + FINDING_ECHO_TTL_MS + 1);
    useChangesStore.getState().applyEvent(findingsChanged({ ids: ["a"] }));
    expect(useChangesStore.getState().findingsRevision).toBe(2);
  });

  it("a failed write releases its expectation and does not bump", async () => {
    await expect(
      ownFindingsWrite(["a"], async () => {
        throw new Error("refused");
      }),
    ).rejects.toThrow("refused");
    expect(useChangesStore.getState().findingsRevision).toBe(0);
    useChangesStore.getState().applyEvent(findingsChanged({ ids: ["a"] }));
    expect(useChangesStore.getState().findingsRevision).toBe(1);
  });

  it("bumpOnError bumps after a failed write (chunked bulk)", async () => {
    await expect(
      ownFindingsWrite(
        ["a"],
        async () => {
          throw new Error("chunk 2 failed");
        },
        { bumpOnError: true },
      ),
    ).rejects.toThrow();
    expect(useChangesStore.getState().findingsRevision).toBe(1);
  });

  it("onSaved sees the result and the revision the bump will produce, before it", async () => {
    const seen: Array<[string, number, number]> = [];
    await ownFindingsWrite(["a"], async () => "saved", {
      onSaved: (r, rev) => seen.push([r, rev, useChangesStore.getState().findingsRevision]),
    });
    expect(seen).toEqual([["saved", 1, 0]]);
  });

  it("an echo of another project while one is open changes nothing", () => {
    useChangesStore.getState().setOpenProject("P");
    useChangesStore.getState().applyEvent(findingsChanged({ ids: ["a"] }, "Q"));
    expect(useChangesStore.getState().findingsRevision).toBe(0);
  });
});
