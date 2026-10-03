import { useState, type CSSProperties } from "react";
import { useApi, useBackend } from "@/api/client";
import {
  clearBrandLogo,
  logoIdOf,
  setBrandLogo,
  useBrandLogoSrc,
  type Brand,
  type BrandLogoSlot,
} from "@/api/brands";
import { messageOf } from "@/api/errors";
import { pushLog } from "@/app/diagnostics";
import { PRINT } from "@/reports/printTheme";
import { Button, Input } from "@/ui";

export interface BrandLogoFieldProps {
  brand: Brand;
  slot: BrandLogoSlot;
  label: string;
  hint: string;
  onChange: (brand: Brand) => void;
}

/**
 * One of a brand's three logos (spec 2026-10-02-asset-findings §5.8). Saved at once: a logo is a file
 * the backend copies beside catalogue.db, not a draft field. The chip shows the logo on the ground it
 * prints on: the brand navy for `on_dark`, paper white otherwise (data colours, through `--c`).
 */
export function BrandLogoField({ brand, slot, label, hint, onChange }: BrandLogoFieldProps) {
  const api = useApi();
  const { mode } = useBackend();
  const src = useBrandLogoSrc()(brand, slot);
  const hasLogo = logoIdOf(brand, slot) !== null;
  const [path, setPath] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [brokenSrc, setBrokenSrc] = useState<string | null>(null);
  const ground = slot === "on_dark" ? brand.colors.navy : PRINT.paper;

  async function add(file: string) {
    setBusy(true);
    setError(null);
    try {
      onChange(await setBrandLogo(api, brand.id, slot, file));
      setPath("");
    } catch (e) {
      pushLog(`brand logo import failed: ${messageOf(e, String(e))}`);
      setError(messageOf(e, "Could not add the logo; pick a PNG, JPEG or WebP under 20 MB."));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      onChange(await clearBrandLogo(api, brand.id, slot));
    } catch (e) {
      pushLog(`brand logo remove failed: ${messageOf(e, String(e))}`);
      setError(messageOf(e, "Could not remove the logo."));
    } finally {
      setBusy(false);
    }
  }

  async function pick() {
    setError(null);
    setBusy(true);
    let picked: unknown;
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      picked = await open({
        multiple: false,
        filters: [{ name: "Logo", extensions: ["png", "jpg", "jpeg", "webp"] }],
      });
    } catch (e) {
      pushLog(`brand logo dialog failed: ${messageOf(e, String(e))}`);
      setError("The file dialog did not open. Try again.");
      setBusy(false);
      return;
    }
    if (typeof picked === "string") await add(picked);
    else setBusy(false);
  }

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-muted">{label}</span>
      <div className="flex items-center gap-3">
        <span
          className="flex h-12 w-28 shrink-0 items-center justify-center overflow-hidden rounded-sm border border-line bg-[var(--c)] p-1"
          style={{ "--c": ground } as CSSProperties}
        >
          {src && src !== brokenSrc ? (
            <img
              src={src}
              alt={label}
              className="max-h-full max-w-full object-contain"
              onError={() => setBrokenSrc(src)}
            />
          ) : src ? (
            <span className="text-center text-2xs text-muted">Logo could not be loaded.</span>
          ) : (
            <span className="text-2xs text-muted">No logo</span>
          )}
        </span>
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          {mode === "tauri" ? (
            <Button size="sm" icon="import" loading={busy} onClick={() => void pick()}>
              {hasLogo ? "Replace logo" : "Choose logo"}
            </Button>
          ) : (
            <>
              <Input
                aria-label={`${label} file path`}
                dense
                value={path}
                placeholder={"C:\\logos\\brand.png"}
                onChange={(e) => setPath(e.target.value)}
                className="min-w-0 flex-1"
              />
              <Button size="sm" loading={busy} disabled={!path.trim()} onClick={() => void add(path.trim())}>
                Add logo
              </Button>
            </>
          )}
          {hasLogo && (
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => void remove()}>
              Remove logo
            </Button>
          )}
        </div>
      </div>
      <p className="text-2xs text-muted">{hint}</p>
      {error && (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
