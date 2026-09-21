// Capture the actual Vite application against Prism with a supplied local photograph.
// Run from the repository root:
// node docs/evidence/ui/2026-09-21-contour/capture.cjs <local-image.jpg> <prepared-fixture-directory>
// Start Vite on 1421 and Prism on 4011 first. These fixtures are not production data.
const { chromium } = require('../../../../frontend/node_modules/@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const P = '7f1c2e3a-1111-4000-8000-000000000001';
const IMG = '10000000-5555-4000-8000-000000000001';
const photoPath = process.argv[2];
if (!photoPath || !fs.existsSync(photoPath)) throw new Error('Pass one local image path');
const photo = fs.readFileSync(photoPath);
const fixtureDir = process.argv[3];
if (!fixtureDir) throw new Error('Run prepare-fixtures.py and pass its output directory');
const variants = new Map([256, 1024].map(side => [side, fs.readFileSync(path.join(fixtureDir, side + '.jpg'))]));
const output = __dirname;
const evidence = [];
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  const runtimeErrors = [];
  page.on('pageerror', error => runtimeErrors.push(error.message));
  await page.route('**/api/v1/**', async route => {
    const url = new URL(route.request().url());
    if (/\/images\/[^/]+\/(file|thumbnail)$/.test(url.pathname)) {
      const size = url.pathname.endsWith('/thumbnail') ? 256 : Number(url.searchParams.get('max_side'));
      return route.fulfill({ contentType: 'image/jpeg', headers: { 'Access-Control-Allow-Origin': '*' }, body: variants.get(size) ?? photo });
    }
    if (/\/images\/[^/]+\/boxes$/.test(url.pathname) && route.request().method() === 'GET') {
      const response = await route.fetch();
      const body = await response.json();
      Object.assign(body.items[0], { x: 2500, y: 195, w: 228, h: 208, angle: 0 });
      Object.assign(body.items[1], { x: 1472, y: 1072, w: 296, h: 136, angle: 0 });
      return route.fulfill({ response, json: body });
    }
    return route.continue();
  });
  async function capture(name, route, ready, settle) {
    await page.goto('http://127.0.0.1:1421' + route);
    await page.getByRole('heading', { name: ready, exact: true }).first().waitFor({ timeout: 15000 });
    if (route.startsWith('/p/')) await page.getByRole('banner').getByText('Ahmadia', { exact: true }).waitFor();
    if (settle) await settle();
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(() => Promise.all([...document.images].map(img => img.decode().catch(() => {}))));
    await page.evaluate(() => Promise.all(document.getAnimations()
      .filter(animation => animation.effect?.getComputedTiming().iterations !== Infinity)
      .map(animation => animation.finished.catch(() => {}))));
    await page.screenshot({ path: path.join(output, name + '.png'), fullPage: true, animations: "disabled" });
    evidence.push(name + ': rendered');
  }
  await capture('01-projects', '/', 'Projects');
  await capture('02-home', '/p/' + P, 'Ahmadia');
  assert.equal(await page.getByTestId('home-next-step').getByRole('img').evaluate(img => img.naturalWidth), 1024);
  const primary = page.getByTestId('home-next-step').getByRole('link');
  const restingFill = await primary.evaluate(el => getComputedStyle(el).backgroundColor);
  assert.equal(await primary.evaluate(el => getComputedStyle(el).transitionDuration), '0.14s');
  await primary.hover();
  await page.waitForFunction(() => {
    const link = document.querySelector('[data-testid=home-next-step] a');
    return link && getComputedStyle(link).backgroundColor === 'rgb(239, 191, 123)';
  });
  assert.notEqual(await primary.evaluate(el => getComputedStyle(el).backgroundColor), restingFill);
  assert.equal(await primary.evaluate(el => getComputedStyle(el).color), 'rgb(41, 36, 27)');
  await page.keyboard.press('Tab');
  await primary.focus();
  assert.equal(await primary.evaluate(el => el.matches(':focus-visible')), true);
  assert.notEqual(await primary.evaluate(el => getComputedStyle(el).boxShadow), 'none');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  assert.equal(await primary.evaluate(el => getComputedStyle(el).transitionProperty), 'none');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  evidence.push('Primary action: 140ms hover, dark foreground, keyboard focus ring and reduced-motion override verified');
  await page.getByRole('button', { name: 'Expand navigation', exact: true }).click();
  await page.screenshot({ path: path.join(output, '03-expanded-navigation.png'), fullPage: true, animations: "disabled" });
  await page.getByRole('button', { name: 'Collapse navigation', exact: true }).click();
  await capture('04-images', '/p/' + P + '/data', 'Images', async () => {
    await page.getByTestId('image-grid').getByRole('listitem').first().waitFor();
  });
  await page.goto('http://127.0.0.1:1421/p/' + P + '/edit/' + IMG);
  const canvas = page.getByTestId('editor-canvas');
  await canvas.waitFor({ timeout: 15000 });
  await page.waitForFunction(() => {
    const c = document.querySelector('[data-testid=editor-canvas]');
    return c?.getAttribute('data-image') === '4000x2667' && c.getAttribute('data-view-scale') !== '1.0000';
  });
  // Allow the already-requested photo to decode and the Konva layer to draw.
  await page.waitForFunction(() => document.querySelectorAll('canvas').length > 0);
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(output, '05-label.png'), fullPage: true, animations: "disabled" });
  evidence.push('05-label: rendered; desktop canvas ' + JSON.stringify(await canvas.boundingBox()));
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.getByRole('region', { name: 'Image inspector' }).waitFor();
  await page.getByRole('button', { name: 'Fit', exact: true }).click();
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(output, '06-label-laptop.png'), fullPage: true, animations: "disabled" });
  const laptopCanvas = await canvas.boundingBox();
  assert(laptopCanvas.width > 550 && laptopCanvas.height > 400, 'Laptop canvas remains useful');
  evidence.push('06-label-laptop: ' + JSON.stringify(laptopCanvas));
  await page.getByRole('button', { name: 'Keyboard shortcuts', exact: true }).click();
  await page.getByRole('dialog', { name: 'Keyboard shortcuts', exact: true }).waitFor();
  await page.screenshot({ path: path.join(output, '12-shortcuts-laptop.png'), fullPage: true, animations: "disabled" });
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.setViewportSize({ width: 1440, height: 960 });
  await capture('07-train', '/p/' + P + '/train', 'Train', async () => {
    await page.getByTestId('train-advice').waitFor();
    await page.waitForFunction(() => {
      const advice = document.querySelector('[data-testid=train-advice]');
      return advice && getComputedStyle(advice).opacity === '1';
    });
  });
  await capture('08-review', '/p/' + P + '/review', 'Review');
  await page.getByRole('button', { name: /active jobs?$/ }).click();
  const jobs = page.getByRole('dialog', { name: 'Jobs', exact: true });
  await jobs.waitFor();
  assert.equal(await jobs.evaluate(el => getComputedStyle(el).animationDuration), '0.22s');
  await page.screenshot({ path: path.join(output, '09-jobs.png'), fullPage: true, animations: "disabled" });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  assert.equal(await jobs.evaluate(el => getComputedStyle(el).animationName), 'none');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  evidence.push('Jobs drawer: 220ms entry and reduced-motion override verified');
  await page.getByRole('button', { name: 'Close jobs', exact: true }).click();
  await capture('10-settings', '/p/' + P + '/settings', 'Project settings');
  await capture('11-app-settings', '/settings', 'App settings');
  await page.route(url => url.pathname === '/api/v1/projects/' + P + '/datasets', route => route.fulfill({
    contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ items: [] })
  }));
  await page.goto('http://127.0.0.1:1421/p/' + P);
  await page.getByTestId('home-next-step').waitFor();
  await page.evaluate(() => Promise.all([...document.images].map(img => img.decode().catch(() => {}))));
  const lockedTrain = page.getByRole('navigation').getByRole('link', { name: /^Train/ });
  await page.waitForFunction(() => document.querySelector('nav a[href$="/train"]')?.getAttribute('aria-disabled') === 'true');
  await lockedTrain.focus();
  await page.getByRole('tooltip').waitFor();
  await page.screenshot({ path: path.join(output, '13-locked-step.png'), fullPage: true, animations: "disabled" });
  assert.deepEqual(runtimeErrors, []);
  evidence.push('No JavaScript page errors');
  evidence.push('Photograph and box coordinates supplied by capture fixtures: 256px thumbnails, 1024px Home hero; the 4000px editor image fits its existing 4096px cap. Other API responses come from Prism.');
  fs.writeFileSync(path.join(output, 'capture-results.txt'), evidence.join('\n') + '\n');
  console.log(evidence.join('\n'));
  await browser.close();
})().catch(error => { console.error(error); process.exit(1); });
