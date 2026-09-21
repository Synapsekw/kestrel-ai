// Installed WebView2 verification, with real bundled backend and a disposable project.
// node <this-file> <installed-exe> <scratch-folder> <three-image-sample-folder> [cdp-port]
// Tokens stay in memory. No provider requests, routes, API stubs or existing-project edits.
const { chromium, expect } = require('../../../../frontend/node_modules/@playwright/test');
const { spawn, execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const [exe, scratch, sample, port = '9337'] = process.argv.slice(2);
if (!exe || !scratch || !sample || !/^\d+$/.test(port)) throw Error('Pass exe, scratch, sample and optional numeric port');
fs.mkdirSync(scratch, { recursive: true });
const result = { exe, source: '54b5e299df2ba89b9c813ce0aef1d66fe7c40773', launches: [], checks: [] };
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
(async () => {
  const page = await launch('First after install');
  await page.fill('#project-name', 'Contour desktop verification');
  await page.fill('#project-folder', path.join(scratch, 'project'));
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  await page.waitForURL(/\/p\/[0-9a-f-]+$/);
  projectId = page.url().split('/p/')[1];
  const project = await api('GET', '/projects/' + projectId);
  assert.equal(project.classes.length, 8);
  check('Create project from installed UI', '8 default classes');
  const imported = await api('POST', `/projects/${projectId}/sources`, { folder: sample, site: 'Contour verification' });
  let job;
  for (let i = 0; i < 120; i++) { job = await api('GET', `/projects/${projectId}/jobs/${imported.job.id}`); if (['succeeded', 'failed', 'cancelled'].includes(job.state)) break; await sleep(500); }
  assert.equal(job.state, 'succeeded');
  const images = await api('GET', `/projects/${projectId}/images?limit=3&sort=path`);
  assert.equal(images.items.length, 3);
  check('Bundled backend imports three real photographs as a background job');
  await page.reload();
  const hero = page.getByTestId('home-next-step');
  await hero.getByRole('img').waitFor();
  await expect.poll(() => hero.getByRole('img').evaluate(i => i.naturalWidth)).toBe(1024);
  const primary = hero.getByRole('link');
  assert.equal(await primary.evaluate(e => getComputedStyle(e).transitionDuration), '0.14s');
  await primary.hover();
  await expect.poll(() => primary.evaluate(e => getComputedStyle(e).backgroundColor)).toBe('rgb(239, 191, 123)');
  await page.keyboard.press('Tab'); await primary.focus();
  assert.equal(await primary.evaluate(e => e.matches(':focus-visible')), true);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  assert.equal(await primary.evaluate(e => getComputedStyle(e).transitionProperty), 'none');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  check('Contour 1024px hero, hover, keyboard focus and reduced motion');
  await shot('01-home');
  const nav = page.getByRole('navigation');
  assert.equal((await nav.boundingBox()).width, 82);
  await page.getByRole('button', { name: 'Expand navigation', exact: true }).click();
  await nav.getByRole('link', { name: /^Images/ }).click();
  await page.getByTestId('image-grid').getByRole('listitem').first().waitFor();
  await shot('02-images-expanded');
  await page.getByRole('button', { name: 'Collapse navigation', exact: true }).click();
  check('Expandable navigation and real image grid');
  const image = images.items[0];
  await page.goto(new URL(`/p/${projectId}/edit/${image.id}`, page.url()).href);
  const canvas = page.getByTestId('editor-canvas');
  await expect(canvas).toHaveAttribute('data-image', `${image.width}x${image.height}`);
  await expect.poll(() => canvas.getAttribute('data-view-scale')).not.toBe('1.0000');
  const inspector = page.getByRole('region', { name: 'Image inspector', exact: true });
  await inspector.waitFor();
  await page.locator('body').click({ position: { x: 88, y: 5 } });
  await page.keyboard.press('4');
  await expect(inspector.getByLabel('Drawing class', { exact: true })).toHaveValue(project.classes[3].id);
  const bounds = await canvas.boundingBox();
  const view = await canvas.evaluate(e => ({ s: +e.dataset.viewScale, x: +e.dataset.viewX, y: +e.dataset.viewY }));
  const point = (x,y) => ({ x: bounds.x + view.x + image.width*x*view.s, y: bounds.y + view.y + image.height*y*view.s });
  const a = point(.35,.35), b = point(.48,.48);
  await page.mouse.move(a.x,a.y); await page.mouse.down(); await page.mouse.move(b.x,b.y,{ steps:8 }); await page.mouse.up();
  await expect.poll(async () => (await api('GET', `/projects/${projectId}/images/${image.id}/boxes`)).items.length).toBe(1);
  const boxes = await api('GET', `/projects/${projectId}/images/${image.id}/boxes`);
  assert.equal(boxes.items[0].class_id, project.classes[3].id);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect.poll(async () => (await api('GET', `/projects/${projectId}/images/${image.id}/boxes`)).items.length).toBe(0);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect.poll(async () => (await api('GET', `/projects/${projectId}/images/${image.id}/boxes`)).items.length).toBe(1);
  await page.reload();
  await inspector.getByRole('list', { name: 'Regions', exact: true }).getByRole('listitem').waitFor();
  await shot('03-label');
  check('Class shortcut, canvas drawing, persistent save, undo and redo');
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.getByRole('button', { name: 'Fit', exact: true }).click();
  const compact = await canvas.boundingBox();
  assert(compact.width > 550 && compact.height > 400);
  await page.getByRole('button', { name: 'Keyboard shortcuts', exact: true }).click();
  const help = page.getByRole('dialog', { name: 'Keyboard shortcuts', exact: true });
  await help.waitFor();
  const helpBounds = await help.boundingBox();
  assert(helpBounds.x >= compact.x && helpBounds.x + helpBounds.width <= compact.x + compact.width);
  await shot('04-laptop-shortcuts');
  check('1024px layout and unclipped shortcuts', JSON.stringify(compact));
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.getByRole('button', { name: /active jobs?$/ }).click();
  await page.getByRole('dialog', { name: 'Jobs', exact: true }).waitFor();
  await shot('05-jobs');
  await page.getByRole('button', { name: 'Close jobs', exact: true }).click();
  await nav.getByRole('link', { name: 'Project settings', exact: true }).click();
  await page.getByRole('heading', { name: 'Project settings', exact: true }).waitFor();
  await shot('06-project-settings');
  check('Jobs drawer and project settings');
  assert.deepEqual(active.errors, []);
  check('No JavaScript page errors');
  await api('DELETE', '/projects/' + projectId); projectId = null;
  check('Disposable project removed from recent projects; files retained in scratch');
  await close();
  await sleep(1000);
  await launch('Warm');
  await close();
  result.passed = true;
})().catch(error => { result.passed = false; result.error = error.message; console.error(error.message); process.exitCode = 1; }).finally(async () => {
  if (projectId && active?.info) { await api('DELETE', '/projects/' + projectId).catch(() => {}); }
  if (active) await close().catch(error => { result.cleanup_error = error.message; process.exitCode = 1; });
  fs.writeFileSync(path.join(__dirname, 'verification.json'), JSON.stringify(result, null, 2) + '\n');
});
