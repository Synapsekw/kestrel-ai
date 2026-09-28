export const KEYS_NOTICE_KEY = "kestrel.images.keysNotice";
export const KEYS_NOTICE =
  "Keys changed: digits set severity, X rejects, T picks the type. Press ? for every key.";
let shownThisSession = false;

/** §21 risk 5 (Ruling 14): once per browser profile; once per session when storage is blocked. */
export function showKeysNoticeOnce(show: () => void): void {
  if (shownThisSession) return;
  let seen = false;
  try {
    seen = localStorage.getItem(KEYS_NOTICE_KEY) === "1";
  } catch {
    // storage blocked: fall back to once per session
  }
  if (seen) return;
  shownThisSession = true;
  show();
  try {
    localStorage.setItem(KEYS_NOTICE_KEY, "1");
  } catch {
    // storage blocked
  }
}

/** Tests only. */
export function resetKeysNoticeSession(): void {
  shownThisSession = false;
}
