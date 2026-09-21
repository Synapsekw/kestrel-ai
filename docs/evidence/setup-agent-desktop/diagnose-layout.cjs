// Installed WebView2 verification, with real bundled backend and a disposable project.
// node <this-file> <installed-exe> <scratch-folder> <three-image-sample-folder> [cdp-port]
// Tokens stay in memory. No paid provider calls, API stubs or existing-project edits.
const { chromium, expect } = require('../../../frontend/node_modules/@playwright/test');
const { spawn, execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const [exe, scratch, sample, port = '9337'] = process.argv.slice(2);
if (!exe || !scratch || !sample || !/^\d+$/.test(port)) throw Error('Pass exe, scratch, sample and optional numeric port');
fs.mkdirSync(scratch, { recursive: true });
const result = { exe, source: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), launches: [], checks: [] };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ps = script => execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8' }).trim();
const check = (name, detail = '') => { result.checks.push({ name, detail }); console.log('PASS ' + name + (detail ? ': ' + detail : '')); };
let active, projectId;
async function api(method, route, body) {
  const response = await fetch(active.info.base_url + '/api/v1' + route, {
    method, headers: { Authorization: 'Bearer ' + active.info.token, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  assert(response.ok, method + ' ' + route + ' status ' + response.status);
  return response.status === 204 ? null : response.json();
}
async function launch(label) {
  assert(!ps("(Get-Process kestrel-ai -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id) -join ','"), 'Close existing Kestrel before testing');
  const start = Date.now();
  const child = spawn(exe, [], { detached: true, stdio: 'ignore', env: {
    ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: '--remote-debugging-port=' + port,
    WEBVIEW2_USER_DATA_FOLDER: path.join(scratch, 'webview'),
  }});
  child.unref();
  active = { child };
  for (let i = 0; i < 120; i++) {
    try {
      const browser = await chromium.connectOverCDP('http://127.0.0.1:' + port, { timeout: 1500 });
      const page = browser.contexts().flatMap(c => c.pages()).find(p => /tauri\.localhost/.test(p.url()));
      if (page) { Object.assign(active, { browser, page }); break; }
      await browser.close();
    } catch {}
    await sleep(250);
  }
  assert(active.page, 'Installed WebView2 available');
  active.page.setDefaultTimeout(20000);
  active.errors = [];
  active.page.on('pageerror', () => active.errors.push('JavaScript page error'));
  await active.page.getByRole('heading', { name: 'Projects', exact: true }).waitFor({ timeout: 60000 });
  const projectsMs = Date.now() - start;
  active.info = await active.page.evaluate(() => window.__TAURI_INTERNALS__.invoke('backend_info'));
  const firstHealth = await api('GET', '/health');
  const healthyMs = Date.now() - start;
  let health = firstHealth;
  for (let i = 0; i < 120; i++) { health = await api('GET', '/health'); if (health.gpu) break; await sleep(500); }
  assert.equal(health.status, 'ok');
  assert.equal(health.gpu?.available, true);
  active.sidecars = ps(`Get-CimInstance Win32_Process -Filter "Name='kestrel-backend.exe' AND ParentProcessId=${child.pid}" | Select-Object -ExpandProperty ProcessId`).split(/\s+/).filter(Boolean).map(Number);
  assert(active.sidecars.length > 0, 'Installed app owns the sidecar');
  result.launches.push({ label, projects_ms: projectsMs, healthy_ms: healthyMs, gpu_ms: Date.now() - start, gpu: health.gpu, app_pid: child.pid, sidecar_pids: active.sidecars });
  assert(projectsMs < 15000, 'Projects within 15 seconds');
  check(label + ' launch, healthy owned sidecar and CUDA', projectsMs + ' ms to Projects');
  return active.page;
}
async function close() {
  if (!active) return;
  if (active.browser) await active.browser.close();
  ps(`Get-Process -Id ${active.child.pid} -ErrorAction SilentlyContinue | ForEach-Object { $_.CloseMainWindow() | Out-Null }`);
  const ids = [active.child.pid, ...(active.sidecars || [])];
  let left;
  for (let i = 0; i < 60; i++) {
    left = ps(`(Get-Process -Id ${ids.join(',')} -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id) -join ','`);
    if (!left) break;
    await sleep(250);
  }
  assert(!left, 'App and owned sidecar exit after closing');
  check('Window close stops app and owned sidecar');
  active = null;
}
async function shot(name) {
  await active.page.evaluate(() => document.fonts.ready);
  await active.page.evaluate(() => Promise.all([...document.images].map(i => i.decode().catch(() => {}))));
  await active.page.screenshot({ path: path.join(__dirname, name + '.png'), animations: 'disabled' });
}
async function forgetDisposableProject() {
  if (!projectId || !active?.info) return;
  const jobs = (await api('GET', `/projects/${projectId}/jobs?limit=20`)).items;
  for (const job of jobs) {
    if (!['queued', 'running'].includes(job.state)) continue;
    await api('POST', `/projects/${projectId}/jobs/${job.id}/cancel`);
    await expect.poll(async () => (await api('GET', `/projects/${projectId}/jobs/${job.id}`)).state,
      { timeout: 30000 }).not.toMatch(/^(queued|running)$/);
  }
  await api('DELETE', '/projects/' + projectId);
  projectId = null;
}
(async () => {
  const page = await launch('Layout investigation');
  await page.getByRole('button', { name: 'Setup agent', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: 'Setup agent', exact: true });
  await drawer.getByLabel('Message', { exact: true }).fill('Layout check only');
  await page.setViewportSize({ width: 1024, height: 768 });
  async function measure() {
    return drawer.evaluate(e => {
      const r = e.getBoundingClientRect();
      return { viewport: innerWidth, left: r.left, right: r.right, width: r.width,
        transform: getComputedStyle(e).transform, animation: getComputedStyle(e).animationName };
    });
  }
  result.before = await measure();
  await drawer.evaluate(e => Promise.all(e.getAnimations().map(a => a.finished.catch(() => {}))));
  result.after = await measure();
  console.log(JSON.stringify({ before: result.before, after: result.after }));
})().catch(error => { result.error = error.message; console.error(error.message); process.exitCode = 1; })
.finally(async () => {
  if (active) await close();
  fs.writeFileSync(path.join(__dirname, 'layout-investigation.json'), JSON.stringify(result, null, 2) + '\n');
});