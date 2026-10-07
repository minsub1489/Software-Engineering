// Exercise the popup with Chrome API fakes; actual activeTab activation still needs toolbar testing.
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require('playwright');
async function run() {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_EXECUTABLE || undefined });
  try {
    const context = await browser.newContext({ acceptDownloads: true });
    await context.addInitScript(() => {
      window.fixture = { records: {}, writes: 0, scripts: [], rejectWrite: false, failCapture: false, tabUrl: 'https://example.org/report?token=secret#private' };
      window.chrome = {
        storage: {
          local: {
            async get(key) { return { [key]: fixture.records[key] }; },
            async set(value) { if (fixture.rejectWrite) throw new Error('quota fixture'); fixture.writes++; Object.assign(fixture.records, structuredClone(value)); },
            async setAccessLevel(value) { fixture.accessLevel = value.accessLevel; }
          }, onChanged: { addListener() {} }
        },
        tabs: { async query() { return [{ id: 1, url: fixture.tabUrl }]; } },
        scripting: { async executeScript(spec) {
          if (fixture.failCapture) throw new Error('restricted fixture'); fixture.scripts.push(spec.args);
          return [{ result: { title: '<script>bad()</script>', url: fixture.tabUrl, selectedText: spec.args[0] ? '選択한 근거' : '' } }];
        } }
      };
    });
    const page = await context.newPage(), errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto('file:///' + path.resolve('extension/popup.html').replaceAll('\\', '/')); await page.waitForFunction(() => ready);
    assert.equal(await page.evaluate(() => fixture.accessLevel), 'TRUSTED_CONTEXTS');
    await page.click('#capture'); await page.waitForFunction(() => !busy);
    assert.equal(await page.inputValue('#sourceUrl'), 'https://example.org/report'); assert.equal(await page.inputValue('#selectedText'), '');
    await page.check('#includeSelection'); await page.click('#capture'); await page.waitForFunction(() => !busy); assert.equal(await page.inputValue('#selectedText'), '選択한 근거');
    await page.fill('#note', '<img src=x onerror="window.bad=true">근거 확인'); await page.click('button[type=submit]'); await page.waitForFunction(() => !busy);
    assert.equal(await page.textContent('#count'), '1'); assert.equal(await page.evaluate(() => window.bad), undefined); assert.equal(await page.locator('#records img').count(), 0);
    const downloadPromise = page.waitForEvent('download'); await page.click('#export'); const download = await downloadPromise; assert.equal(download.suggestedFilename(), 'humanproof-contributions.json');
    const exported = JSON.parse(require('node:fs').readFileSync(await download.path(), 'utf8')); assert.equal(exported.records.length, 1); assert.equal(exported.format, 'humanproof-contributions');
    await page.evaluate(() => fixture.rejectWrite = true); await page.fill('#note', '저장 실패 입력'); await page.click('button[type=submit]'); await page.waitForFunction(() => !busy);
    assert.equal(await page.textContent('#count'), '1'); assert.ok((await page.textContent('#status')).includes('quota')); assert.equal(await page.inputValue('#note'), '저장 실패 입력');
    await page.evaluate(() => { fixture.rejectWrite = false; fixture.tabUrl = 'chrome://settings'; }); await page.click('#capture'); await page.waitForFunction(() => !busy); assert.ok((await page.textContent('#status')).includes('HTTP(S)'));
    await page.evaluate(() => { fixture.tabUrl = 'https://example.org/'; fixture.failCapture = true; }); await page.click('#capture'); await page.waitForFunction(() => !busy); assert.ok((await page.textContent('#status')).includes('접근'));
    assert.equal(await page.locator('#clear').isDisabled(), true); await page.check('#confirmDelete'); await page.click('#clear'); await page.waitForFunction(() => !busy); assert.equal(await page.textContent('#count'), '0');
    assert.deepEqual(errors, []);
    console.log('PASS: popup capture opt-in, sanitized URL, trusted storage access, text-only rendering, JSON export, quota rollback, restricted pages, API rejection and explicit deletion. Chrome APIs are mocked.');
  } finally { await browser.close(); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
