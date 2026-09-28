import { beforeEach, expect, it, vi } from "vitest";
import { KEYS_NOTICE_KEY, resetKeysNoticeSession, showKeysNoticeOnce } from "./keysNotice";

beforeEach(() => {
  localStorage.clear();
  resetKeysNoticeSession();
});

it("shows once per profile", () => {
  const show = vi.fn();
  showKeysNoticeOnce(show);
  resetKeysNoticeSession();
  showKeysNoticeOnce(show);
  expect(show).toHaveBeenCalledOnce();
  expect(localStorage.getItem(KEYS_NOTICE_KEY)).toBe("1");
});

it("shows once per session when storage throws", () => {
  const get = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new Error("blocked");
  });
  const show = vi.fn();
  showKeysNoticeOnce(show);
  showKeysNoticeOnce(show);
  expect(show).toHaveBeenCalledOnce();
  get.mockRestore();
});
