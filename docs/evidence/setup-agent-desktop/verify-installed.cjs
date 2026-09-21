// Installed WebView2 verification, with real bundled backend and a disposable project.
// node <this-file> <installed-exe> <scratch-folder> <three-image-sample-folder> [cdp-port]
// Tokens stay in memory. No provider requests, routes, API stubs or existing-project edits.
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
(async () => {
  const page = await launch('First after install');
  const catalog = (await api('GET', '/starter-models')).items;
  assert.equal(catalog.length, 44);
  assert.equal(new Set(catalog.map(model => model.family)).size, 8);
  assert(catalog.every(model => model.task === 'detect'));
  check('Installed backend offers 44 detection starters across eight families');

  const providers = (await api('GET', '/providers')).items;
  const opener = page.getByRole('button', { name: 'Setup agent', exact: true });
  await opener.click();
  const drawer = page.getByRole('dialog', { name: 'Setup agent', exact: true });
  await drawer.waitFor();
  assert.equal(await drawer.getByLabel('Planning provider').locator('option').count(), 2);
  for (const name of ['openai', 'anthropic']) {
    const provider = providers.find(item => item.name === name);
    assert(provider, 'Configured provider metadata exists');
    await drawer.getByLabel('Planning provider').selectOption(name);
    await expect(drawer.getByRole('status')).toHaveText(
      provider.model_name + ' · ' + (provider.has_key ? 'Ready' : 'Key required'),
    );
  }
  result.provider_readiness = providers.map(({ name, has_key }) => ({ name, has_key }));
  check('Setup drawer reads existing GPT/Claude key readiness without exposing credentials');
  await expect(drawer.getByRole('button', { name: 'Send', exact: true })).toBeDisabled();
  const prompt = 'Plan a detector for excavators and dump trucks in aerial site photos.';
  await drawer.getByLabel('Message', { exact: true }).fill(prompt);
  await page.keyboard.press('Escape');
  await expect(drawer).toHaveCount(0);
  await expect(opener).toBeFocused();
  await opener.click();
  await expect(drawer.getByLabel('Message', { exact: true })).toHaveValue(prompt);
  await shot('01-setup-agent');
  check('Setup draft survives closing; Escape restores focus');
  await drawer.getByRole('button', { name: 'Close setup agent', exact: true }).click();

  // Validate that the new planner is in the frozen bundle without making a paid provider call.
  const invalidChat = await fetch(active.info.base_url + '/api/v1/agent/chat', {
    method: 'POST', headers: { Authorization: 'Bearer ' + active.info.token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider: 'openai', messages: [] }),
  });
  assert.equal(invalidChat.status, 422);
  check('Frozen setup endpoint is registered and validates requests');

  await page.fill('#project-name', 'Setup agent desktop verification');
  await page.fill('#project-folder', path.join(scratch, 'project'));
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  await page.waitForURL(/\/p\/[0-9a-f-]+$/);
  projectId = page.url().split('/p/')[1];
  check('Create disposable project from installed UI');
  const imported = await api('POST', `/projects/${projectId}/sources`, { folder: sample, site: 'Desktop verification' });
  await expect.poll(async () => (await api('GET', `/projects/${projectId}/jobs/${imported.job.id}`)).state,
    { timeout: 60000 }).toBe('succeeded');
  const images = (await api('GET', `/projects/${projectId}/images?limit=3&sort=path`)).items;
  assert.equal(images.length, 3);
  check('Installed bundled backend imports three photographs in a background job');

  await page.getByRole('navigation').getByRole('link', { name: 'Models', exact: true }).click();
  const familySelect = page.getByLabel('Model family', { exact: true });
  await expect(familySelect.locator('option')).toHaveCount(8);
  const familyNames = await familySelect.locator('option').allTextContents();
  let totalChoices = 0;
  for (const family of familyNames) {
    await familySelect.selectOption(family);
    totalChoices += await page.getByLabel('Starter model', { exact: true }).locator('option').count();
  }
  assert.equal(totalChoices, 44);
  check('Installed Models UI exposes all 44 choices through eight family selectors');

  const chosen = catalog.find(model => model.key === 'yolo26n');
  assert(chosen);
  await familySelect.selectOption(chosen.family);
  await page.getByLabel('Starter model', { exact: true }).selectOption(chosen.key);
  await shot('02-yolo-catalog');
  await page.getByRole('button', {
    name: (chosen.available ? 'Add ' : 'Download and add ') + chosen.name, exact: true,
  }).click();
  await expect(page.getByRole('cell', { name: 'yolo26n-coco', exact: true })).toBeVisible({ timeout: 180000 });
  const models = (await api('GET', `/projects/${projectId}/models`)).items;
  const model = models.find(item => item.name === 'yolo26n-coco');
  assert(model);
  assert.equal(model.class_names.length, 80);
  check('YOLO26 nano acquired and registered by the real installed background job',
    chosen.available ? 'Cached official weights' : 'Downloaded official weights');
  const prediction = await api('POST', `/projects/${projectId}/images/${images[0].id}/preannotate`,
    { model_id: model.id, imgsz: 640, conf: 0.05 });
  assert(Array.isArray(prediction.items));
  check('New YOLO26 model predicts through the bundled inference engine', prediction.items.length + ' proposals');
  await shot('03-registered-model');
  await opener.click();
  await expect(drawer.getByLabel('Message', { exact: true })).toHaveValue(prompt);
  await page.setViewportSize({ width: 1024, height: 768 });
  const bounds = await drawer.boundingBox();
  assert(bounds.x >= 0 && bounds.x + bounds.width <= 1024);
  await shot('04-setup-compact');
  check('Drawer survives navigation and fits the 1024px viewport');
  assert.deepEqual(active.errors, []);
  check('No JavaScript page errors');
  await api('DELETE', '/projects/' + projectId); projectId = null;
  check('Disposable project forgotten; source photographs and operator projects untouched');
  await close();
  await sleep(1000);
  await launch('Warm');
  await close();
  result.passed = true;
})().catch(error => {
  result.passed = false; result.error = error.message; console.error(error.message); process.exitCode = 1;
}).finally(async () => {
  if (projectId && active?.info) await api('DELETE', '/projects/' + projectId).catch(() => {});
  if (active) await close().catch(error => { result.cleanup_error = error.message; process.exitCode = 1; });
  fs.writeFileSync(path.join(__dirname, 'verification.json'), JSON.stringify(result, null, 2) + '\n');
});
