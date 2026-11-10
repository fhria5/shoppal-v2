// End-to-end tests for ShopPal v2 — core user flows (headless Playwright).
//
// Run against the local server (default) or the live GitHub Pages site:
//   npx playwright test tests/e2e_shoppal.spec.js
//   SHOPPAL_BASE_URL=https://fhria5.github.io/shoppal-v2/ npx playwright test tests/e2e_shoppal.spec.js
//
// Prerequisites:
//   - For the local target, the ShopPal server must be running first:
//     `node server.js` in ~/workspace/shoppal-v2 (port 3000).
//   - @playwright/test must be installed: `npm install --save-dev @playwright/test`.
//     No browser download is needed in this sandbox: the script reuses the
//     Chromium binary from the Python Playwright install when it exists,
//     and otherwise falls back to Playwright's bundled Chromium.
//
// What is covered (one test, five steps, in order — later steps depend on
// the state built by earlier ones):
//   1. Load page: the chat interface and the Quick Demo chips bar render.
//   2. Quick Demo chips: clicking "headphones under $60" shows the skeleton
//      loader shimmer briefly, then renders the product cards.
//   3. Guardrail enforcement: an over-limit agent buy ("beli headphone p01",
//      total $65.57 > the $20 auto-approve limit) shows the Human Approval
//      Callout with Approve / Reject buttons; Approve creates the order.
//   4. Split + continuation: splitting p01 with Budi and Sari, then
//      "lanjut checkout bagian saya" checks out the user's own share
//      ($19.99) instead of a generic search.
//   5. Persistence & refresh: after page.reload(), the chat history and the
//      lastResults context are recovered from localStorage, with no
//      JavaScript console errors and no uncaught page errors.
//
// Notes on what the test deliberately does NOT assert:
//   - Failed network requests are not asserted: in this sandbox the
//     headless browser cannot reach external hosts (the PayPal SDK and the
//     Worker), so those requests fail for environmental reasons, not
//     product bugs. Console errors and uncaught page errors ARE asserted,
//     except for one expected entry: Chromium logs the guardrail's
//     intentional HTTP 403 (step 3, /api/agent) as a console error, which
//     the test filters out by design.
//   - The orders created here are PayPal Sandbox orders in CREATED state;
//     they are never captured, so no money moves.
const { test, expect } = require('@playwright/test');
const fs = require('fs');

const BASE_URL = process.env.SHOPPAL_BASE_URL || 'http://localhost:3000';

// Reuse the Chromium that ships with the Python Playwright install when it
// is present (this sandbox); otherwise let Playwright use its own bundle.
const CHROMIUM_PATH =
  process.env.PLAYWRIGHT_CHROMIUM_PATH ||
  '/home/hatch/.cache/ms-playwright/chromium-1254/chrome-linux64/chrome';

const launchOptions = {};
if (CHROMIUM_PATH && fs.existsSync(CHROMIUM_PATH)) {
  launchOptions.executablePath = CHROMIUM_PATH;
}

test.use({
  launchOptions,
  viewport: { width: 1280, height: 900 },
});
test.setTimeout(120000);

test.describe('ShopPal v2 — core user flows', () => {
  test('load, chips + skeleton, guardrail callout, split + continuation, persistence across reload', async ({ page }) => {
    const consoleErrors = [];
    const pageErrors = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => pageErrors.push(String(err)));

    // Skeleton probe: the shimmer bubble only lives for a few hundred ms
    // while /api/ask is in flight, so a plain waitForSelector can miss it.
    // A MutationObserver installed before any navigation records every
    // time a skeleton bubble appears, so the test can assert it afterwards.
    await page.addInitScript(() => {
      window.__skeletonSeen = 0;
      window.__skeletonLog = [];
      const obs = new MutationObserver((muts) => {
        for (const m of muts) {
          for (const n of m.addedNodes) {
            if (n.nodeType !== 1) continue;
            if (n.classList.contains('skeleton-msg') || n.querySelector('.skeleton-msg')) {
              window.__skeletonSeen += 1;
              window.__skeletonLog.push(Date.now());
            }
          }
        }
      });
      const start = () => obs.observe(document.documentElement, { childList: true, subtree: true });
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
      else start();
    });

    // Fresh state: clear any previous chat history, then reload so the
    // page starts from a clean greeting + catalog.
    await page.goto(BASE_URL, { waitUntil: 'networkidle' });
    await page.evaluate(() => localStorage.clear());
    await page.reload({ waitUntil: 'networkidle' });

    await test.step('1. Load page — chat interface and Quick Demo chips render', async () => {
      await expect(page.locator('#chat')).toBeVisible();
      await expect(page.locator('#ask')).toBeVisible();
      await expect(page.locator('#ask-btn')).toBeVisible();
      await expect(page.locator('.quick-demo')).toBeVisible();
      const chips = page.locator('.quick-demo .chip');
      await expect(chips).toHaveCount(8);
      await expect(chips.first()).toHaveAttribute('data-prompt', 'headphones under $60');
      await expect(page.locator('#chat .msg.agent[data-step="greeting"]')).toHaveCount(1);
      await expect(page.locator('#chat .msg.agent[data-step="greeting"]')).toContainText('Find noise-cancelling headphones under $50');
      // Catalog starts collapsed behind a toggle: no cards rendered yet.
      await expect(page.locator('#catalog-toggle')).toBeVisible();
      await expect(page.locator('#catalog-toggle .cat-label')).toContainText('Browse catalog (20)');
      await expect(page.locator('#chat .msg.agent[data-step="catalog"]')).toHaveClass(/hidden/);
      await expect(page.locator('#chat .msg.agent[data-step="catalog"] .product-card')).toHaveCount(0);
      await page.locator('#catalog-toggle').click();
      await expect(page.locator('#chat .msg.agent[data-step="catalog"]')).not.toHaveClass(/hidden/);
      await expect(page.locator('#chat .msg.agent[data-step="catalog"] .product-card')).toHaveCount(20);
      await expect(page.locator('#catalog-toggle .cat-label')).toContainText('Hide catalog (20)');
      await page.locator('#catalog-toggle').click();
      await expect(page.locator('#chat .msg.agent[data-step="catalog"]')).toHaveClass(/hidden/);
      // The last three chips in the single Demo row are the contrast
      // scenarios (auto-approve, guardrail intercept, risky seller shield).
      await expect(chips.nth(5)).toHaveAttribute('data-prompt', 'buy p11');
      await expect(chips.nth(6)).toHaveAttribute('data-prompt', 'buy p12');
      await expect(chips.nth(7)).toHaveAttribute('data-prompt', 'buy p14');
      // Health badge shows the live latency once /api/health returns.
      await expect(page.locator('#health-badge')).toContainText('Latency:', { timeout: 15000 });
    });

    await test.step('2. Quick Demo chip — skeleton shimmer, then product cards', async () => {
      await page.locator('.quick-demo .chip').first().click();
      // The results bubble is the agent bubble with no data-step (greeting,
      // catalog and vault all carry one). Its cards are the Ask results —
      // not the greeting catalog (20 cards) and not the price-watch "Buy
      // now" buttons in the vault bubble, which also carry data-product.
      const resultsBubble = page.locator('#chat .msg.agent:not([data-step])').last();
      const resultCards = resultsBubble.locator('.product-card');
      await expect(resultCards.first()).toBeVisible({ timeout: 30000 });
      await expect(resultCards).toHaveCount(3, { timeout: 30000 });
      await expect(resultsBubble.locator('.product-card[data-product="p01"]')).toBeVisible();
      await expect(resultsBubble.locator('.product-card[data-product="p02"]')).toBeVisible();
      await expect(resultsBubble.locator('.product-card[data-product="p03"]')).toBeVisible();
      // The skeleton appeared at least once while fetching, and is gone now.
      expect(await page.evaluate(() => window.__skeletonSeen)).toBeGreaterThanOrEqual(1);
      await expect(page.locator('.skeleton-msg')).toHaveCount(0);
      // The chip query itself is in the chat as a user message.
      await expect(page.locator('#chat .msg.user', { hasText: 'headphones under $60' })).toHaveCount(1);
    });

    await test.step('3. Guardrail enforcement — over-limit buy shows the approval callout', async () => {
      await page.fill('#ask', 'beli headphone p01');
      await page.click('#ask-btn');
      const callout = page.locator('#chat .callout');
      await expect(callout).toBeVisible({ timeout: 30000 });
      await expect(callout).toContainText('Pending Human Approval (Guardrail Triggered)');
      await expect(callout.locator('[data-act="approve"]')).toBeVisible();
      await expect(callout.locator('[data-act="reject"]')).toBeVisible();
      // The 403 must NOT surface as a bare error bubble.
      const bare403 = await page.locator('#chat .msg.agent').evaluateAll((els) =>
        els.filter((el) => /^\s*403\b/.test(el.textContent || '')).length
      );
      expect(bare403).toBe(0);
      // Approve: the order is created and a PayPal approve link appears.
      // (The agent also opens the PayPal URL in a new tab; that tab is
      // left alone — the assertion below only looks at this page.)
      await callout.locator('[data-act="approve"]').click();
      await expect(page.locator('#chat a[href*="paypal.com"]')).toBeVisible({ timeout: 60000 });
    });

    await test.step('4. Split + continuation — "lanjut checkout bagian saya" checks out the share', async () => {
      await page.fill('#ask', 'patungan headphone p01 sama Budi dan Sari');
      await page.click('#ask-btn');
      const splitCard = page.locator('#chat .split-card');
      await expect(splitCard).toBeVisible({ timeout: 60000 });
      await expect(splitCard).toContainText('$20.00');
      await expect(splitCard.locator('.split-link-row')).toHaveCount(2);
      // The continuation names no product — it must resolve to the split
      // product (p01) and create an order for the user's own share
      // ($19.99), not a generic search. The share order adds exactly one
      // more PayPal link to the chat.
      const linksBefore = await page.locator('#chat a[href*="paypal.com"]').count();
      await page.fill('#ask', 'lanjut checkout bagian saya');
      await page.click('#ask-btn');
      await expect(page.locator('#chat')).toContainText('Your share of Aurora Wireless Headphones is ready: $19.99', { timeout: 60000 });
      const linksAfter = await page.locator('#chat a[href*="paypal.com"]').count();
      expect(linksAfter).toBe(linksBefore + 1);
    });

    await test.step('5. Persistence — reload restores history and lastResults context', async () => {
      const before = await page.evaluate(() => ({
        history: localStorage.getItem('shoppal-chat-v1'),
        context: localStorage.getItem('shoppal-chat-v1-context'),
      }));
      expect(before.history).toBeTruthy();
      const contextIds = JSON.parse(before.context || '[]');
      expect(Array.isArray(contextIds)).toBe(true);
      expect(contextIds.length).toBeGreaterThan(0);
      expect(contextIds).toEqual(expect.arrayContaining(['p01', 'p02', 'p03']));

      await page.reload({ waitUntil: 'networkidle' });
      await expect(page.locator('#chat .msg.agent[data-step="greeting"]')).toHaveCount(1);
      // The chip query and its result cards come back from localStorage.
      await expect(page.locator('#chat .msg.user', { hasText: 'headphones under $60' })).toHaveCount(1);
      const restoredCards = page.locator('#chat .msg.agent:not([data-step]) .product-card');
      await expect(restoredCards).toHaveCount(3, { timeout: 15000 });
      // The guardrail callout survives the reload as a record.
      await expect(page.locator('#chat .callout')).toContainText('Pending Human Approval (Guardrail Triggered)');
      // No JavaScript console errors and no uncaught page errors, before
      // or after the reload. One exception is expected: Chromium logs the
      // guardrail's intentional HTTP 403 (step 3, /api/agent) as a console
      // error — "Failed to load resource: ... 403 (Forbidden)". That is
      // the contract working as designed, not a product bug, so it is
      // filtered out; anything else still fails the test.
      const unexpectedConsoleErrors = consoleErrors.filter(
        (msg) => !/^Failed to load resource: the server responded with a status of 403/.test(msg)
      );
      expect(pageErrors).toEqual([]);
      expect(unexpectedConsoleErrors).toEqual([]);
    });
  });

  test('settings modal: gear opens it, language/budget/guardrails save, clear chat works', async ({ page }) => {
    const consoleErrors = [];
    const pageErrors = [];
    page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
    page.on('pageerror', (err) => pageErrors.push(String(err)));
    await page.goto(BASE_URL, { waitUntil: 'networkidle' });
    await page.evaluate(() => localStorage.clear());
    await page.reload({ waitUntil: 'networkidle' });
    await expect(page.locator('#chat .msg.agent[data-step="greeting"]')).toHaveCount(1);

    // Gear button: visible, 44px tap target.
    const gear = page.locator('#settings-btn');
    await expect(gear).toBeVisible();
    const gearBox = await gear.boundingBox();
    expect(gearBox.height).toBeGreaterThanOrEqual(44);
    expect(gearBox.width).toBeGreaterThanOrEqual(44);
    // Quick Demo chips carry SVG icons, not emoji.
    expect(await page.locator('.quick-chip svg').count()).toBe(8);

    // Open the modal: four sections, English active by default (the demo
    // is English-only; only Auto and English are offered, no Indonesian).
    await gear.click();
    await expect(page.locator('#settings-overlay')).not.toHaveClass(/hidden/);
    const sections = await page.locator('#settings-body h3').allInnerTexts();
    expect(sections).toEqual(['Language', 'Monthly budget', 'Smart Guardrails', 'Chat data']);
    await expect(page.locator('.seg-btn[data-lang-choice="en"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.seg-btn')).toHaveCount(2);
    await expect(page.locator('.seg-btn[data-lang-choice="id"]')).toHaveCount(0);

    // Budget + guardrails save to localStorage; vault summary follows.
    await page.fill('#set-budget-input', '60');
    await page.locator('#set-budget-save').click();
    await page.fill('#set-gr-limit', '25');
    await page.locator('#set-gr-save').click();
    await expect(page.locator('#set-budget-status')).toHaveText('Budget saved.');
    await expect(page.locator('#set-gr-status')).toHaveText('Guardrails saved.');
    expect(await page.evaluate(() => localStorage.getItem('shoppal-budget-usd'))).toBe('60');
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('shoppal-guardrails')).autoApproveLimit)).toBe(25);
    // The vault lives in its own modal now, not in the chat: close
    // Settings first (its overlay covers the header), then open the vault
    // via the header button and check the summary + sample proof there.
    await page.keyboard.press('Escape');
    await expect(page.locator('#settings-overlay')).toHaveClass(/hidden/);
    await page.locator('#vault-btn').click();
    await expect(page.locator('#vault-overlay')).not.toHaveClass(/hidden/);
    await expect(page.locator('#vault-body')).toContainText('$25');
    await expect(page.locator('#chat [data-step="vault"]')).toHaveCount(0);
    await page.locator('#sample-proof-btn').click();
    await expect(page.locator('#sample-proof-body')).toContainText('7L12554580106983W');
    await expect(page.locator('#sample-proof-body')).toContainText('4DA71960H4899750Y');

    // The vault summary button reopens Settings (vault closes first).
    await page.locator('#vault-settings').click();
    await expect(page.locator('#settings-overlay')).not.toHaveClass(/hidden/);
    await expect(page.locator('#vault-overlay')).toHaveClass(/hidden/);

    // Clear chat history: fresh greeting, no saved user history.
    await page.locator('#set-clear-chat').click();
    await expect(page.locator('#set-clear-status')).toHaveText('Chat history cleared.');
    await expect(page.locator('#chat .msg.agent[data-step="greeting"]')).toHaveCount(1);
    const saved = await page.evaluate(() => localStorage.getItem('shoppal-chat-v1') || '');
    expect(saved).toBe('');

    // Restore the server guardrail to the $20 default so other tests
    // (and the demo) keep the documented limit.
    await page.evaluate(async () => {
      await fetch('/api/guardrails', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ autoApproveLimit: 20 }),
      });
    });
    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
  });
  test('marketplace is eBay only: no source toggle, real eBay listings', async ({ page }) => {
    const pageErrors = [];
    page.on('pageerror', (err) => pageErrors.push(String(err)));

    await page.goto(BASE_URL, { waitUntil: 'networkidle' });
    // Run a product Ask so the marketplace bubble appears. eBay sandbox
    // keys are configured, so the bubble shows real sandbox listings.
    await page.fill('#ask', 'headphones under $60');
    await page.click('#ask-btn');
    const mpBubble = page.locator('#chat .msg.agent[data-step="marketplace"]');
    await expect(mpBubble.first()).toBeVisible({ timeout: 30000 });
    // Etsy is gone (app banned): no source toggle anywhere, and no Etsy
    // pill or note in the bubble.
    await expect(page.locator('.mp-source-toggle')).toHaveCount(0);
    await expect(mpBubble.first().locator('.mp-note')).not.toContainText('Etsy');
    const cards = mpBubble.first().locator('.cards .product-card[data-marketplace="eBay"]');
    await expect(cards.first()).toBeVisible({ timeout: 30000 });
    expect(await cards.count()).toBeGreaterThan(0);
    expect(pageErrors).toEqual([]);
  });

  test('XSS: a chat message carrying HTML/JS renders as text, never executes', async ({ page }) => {
    const pageErrors = [];
    page.on('pageerror', (err) => pageErrors.push(String(err)));

    await page.goto(BASE_URL, { waitUntil: 'networkidle' });
    // The payload must not run even if it reaches the page: userBubble
    // escapes its text, so the <img> is inert text, not an element.
    await page.fill('#ask', '<img src=x onerror=window.__xss=1> test');
    await page.click('#ask-btn');
    await expect(page.locator('#chat .msg.user').last()).toBeVisible({ timeout: 15000 });
    const fired = await page.evaluate(() => window.__xss);
    expect(fired).toBeUndefined();
    const bubbleHtml = await page.locator('#chat .msg.user').last().evaluate((el) => el.innerHTML);
    expect(bubbleHtml).toContain('&lt;img');
    expect(bubbleHtml).not.toContain('<img');
    const liveImg = await page.locator('#chat .msg.user img').count();
    expect(liveImg).toBe(0);
    expect(pageErrors).toEqual([]);
  });

  test('deals: best deal verdict + compare + wishlist save/list', async ({ page }) => {
    const pageErrors = [];
    page.on('pageerror', (err) => pageErrors.push(String(err)));

    await page.goto(BASE_URL, { waitUntil: 'networkidle' });
    // Best Deal: a verdict bubble with a Buy button.
    await page.fill('#ask', 'best deal headphones under $60');
    await page.click('#ask-btn');
    await expect(page.locator('#bestdeal-buy')).toBeVisible({ timeout: 20000 });
    const verdict = await page.locator('#chat').innerText();
    expect(verdict).toContain('Best deal');
    // Compare: a per-source bubble with a Best overall marker.
    await page.fill('#ask', 'compare headphones');
    await page.click('#ask-btn');
    await expect(page.locator('#chat')).toContainText('Compare sources', { timeout: 20000 });
    expect(await page.locator('#chat').innerText()).toContain('Best overall');
    // Wishlist: open a catalog product, save it, list it from chat.
    await page.click('#catalog-toggle');
    await page.locator('.product-card').first().click();
    await expect(page.locator('#save-wishlist-btn')).toBeVisible({ timeout: 15000 });
    await page.click('#save-wishlist-btn');
    await expect(page.locator('#chat')).toContainText('wishlist', { timeout: 15000 });
    await page.fill('#ask', 'my wishlist');
    await page.click('#ask-btn');
    await expect(page.locator('#chat')).toContainText('Your wishlist', { timeout: 15000 });
    expect(pageErrors).toEqual([]);
  });
});

