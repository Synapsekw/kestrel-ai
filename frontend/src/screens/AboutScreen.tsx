import { useEffect, useState } from "react";
import { NOTICES, appVersion } from "@/about/notices";
import pkg from "../../package.json";
import { Disclosure } from "@/ui";

/**
 * About Kestrel AI: the app version and the licence notices of the components it ships (spec
 * 2026-09-23-point-clouds section 12). Lazy-loaded from routes.tsx. Foundation F0 landed it empty;
 * S1 unit A1 fills it from `src/about/notices.json`.
 */
export function AboutScreen() {
  const [version, setVersion] = useState(pkg.version);
  useEffect(() => {
    let live = true;
    void appVersion(pkg.version).then((v) => live && setVersion(v));
    return () => {
      live = false;
    };
  }, []);

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-4xl flex-col gap-6 p-6">
        <header className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">About Kestrel AI</h1>
          <p className="text-sm text-muted">Version {version}</p>
        </header>
        <table aria-label="Open-source components" className="w-full border-collapse text-sm">
          <caption className="pb-3 text-left text-base font-semibold text-ink">
            Open-source components
          </caption>
          <thead>
            <tr className="border-b border-line text-left text-xs text-muted">
              <th className="py-2 pr-4 font-medium">Component</th>
              <th className="py-2 pr-4 font-medium">Version</th>
              <th className="py-2 pr-4 font-medium">Licence</th>
              <th className="py-2 font-medium">Used for</th>
            </tr>
          </thead>
          <tbody>
            {NOTICES.map((n) => (
              <tr key={n.id} className="border-b border-line align-top">
                <td className="py-3 pr-4">
                  <div className="flex flex-col gap-2">
                    <span className="font-medium text-ink">{n.name}</span>
                    {n.note && <span className="text-xs text-muted">{n.note}</span>}
                    <Disclosure label={`Licence text: ${n.name}`}>
                      <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-md bg-well p-3 font-mono text-xs text-ink">
                        {n.text}
                      </pre>
                    </Disclosure>
                  </div>
                </td>
                <td className="py-3 pr-4 tabular-nums text-muted">{n.version}</td>
                <td className="py-3 pr-4 text-ink">{n.licence}</td>
                <td className="py-3 text-muted">{n.usedFor}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
