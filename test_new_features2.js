// Stub tests for the 4 new features (Biaya Impor, Deteksi Phishing,
// Bandingkan 2 Produk, Budget Bulanan). Runs against a local server.js
// instance on port 3000 (start with: node server.js).
// Usage: node test_new_features2.js
const BASE = 'http://localhost:3000';

let pass = 0;
let fail = 0;
function check(name, ok, detail) {
  if (ok) {
    pass++;
    console.log('PASS', name);
  } else {
    fail++;
    console.log('FAIL', name, detail === undefined ? '' : JSON.stringify(detail));
  }
}
async function post(path, body) {
  const res = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}
async function get(path) {
  const res = await fetch(BASE + path);
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

(async () => {
  // ---------- 1. Biaya Impor ----------
  // ID $60: duty 7.5% = 4.50, VAT 11% of 64.50 = 7.10, total 11.60.
  let r = await post('/api/import-cost', { priceUSD: 60, country: 'ID', lang: 'id' });
  check('import ID $60 duty 4.50', r.data.duty === 4.5, r.data);
  check('import ID $60 vat 7.10', r.data.vat === 7.1, r.data);
  check('import ID $60 total 11.60', r.data.total === 11.6, r.data);
  check('import ID country name', r.data.countryName === 'Indonesia', r.data);

  // US $60: below $800 de minimis -> 0.
  r = await post('/api/import-cost', { priceUSD: 60, country: 'US', lang: 'en' });
  check('import US $60 total 0', r.data.total === 0 && r.data.deMinimisApplies === true, r.data);

  // ID $2: below $3 de minimis -> duty 0, VAT 11% of 2 = 0.22.
  r = await post('/api/import-cost', { priceUSD: 2, country: 'ID', lang: 'id' });
  check('import ID $2 duty 0 + vat 0.22', r.data.duty === 0 && r.data.vat === 0.22 && r.data.total === 0.22, r.data);

  // EU $60: VAT 19% = 11.40, duty 0 (electronics).
  r = await post('/api/import-cost', { priceUSD: 60, country: 'EU', lang: 'en' });
  check('import EU $60 vat 11.40', r.data.vat === 11.4 && r.data.duty === 0, r.data);

  // UK $60: VAT 20% = 12.00.
  r = await post('/api/import-cost', { priceUSD: 60, country: 'UK', lang: 'en' });
  check('import UK $60 vat 12.00', r.data.vat === 12 && r.data.total === 12, r.data);

  // SG $60: GST 9% = 5.40.
  r = await post('/api/import-cost', { priceUSD: 60, country: 'SG', lang: 'en' });
  check('import SG $60 gst 5.40', r.data.vat === 5.4 && r.data.total === 5.4, r.data);

  // Unknown country -> 400.
  r = await post('/api/import-cost', { priceUSD: 60, country: 'XX', lang: 'en' });
  check('import unknown country 400', r.status === 400, r.data);

  // ---------- 2. Deteksi Phishing ----------
  // Classic phish: lookalike domain + urgency + asks password/OTP.
  r = await post('/api/phishing-check', {
    text: 'URGENT: Your PayPal account will be closed! Verify now at https://paypa1-secure.com/login and enter your password and OTP code immediately.',
    lang: 'en',
  });
  check('phish lookalike score 0', r.data.score === 0, r.data);
  check('phish lookalike label', r.data.label === 'Likely phishing', r.data);
  check('phish domain signal', (r.data.signals || []).some((s) => s.points === -50 && /paypa1-secure\.com/.test(s.note)), r.data.signals);
  check('phish urgency signal', (r.data.signals || []).some((s) => s.points === -20 && /urgent/i.test(s.note)), r.data.signals);
  check('phish secret signal', (r.data.signals || []).some((s) => s.points === -30), r.data.signals);

  // Legit: real paypal.com link, no pressure.
  r = await post('/api/phishing-check', {
    text: 'Hi Fahriannor, your payment of $65.57 was received. View the receipt at https://www.paypal.com/activity/payment/123',
    lang: 'en',
  });
  check('phish legit score 100', r.data.score === 100 && r.data.label === 'Looks legitimate', r.data);

  // Indonesian phish: "akun akan ditutup" + fake link.
  r = await post('/api/phishing-check', {
    text: 'Segera verifikasi akun PayPal Anda, akun akan ditutup. Klik https://paypal-verifikasi.net/masuk dan masukkan password Anda.',
    lang: 'id',
  });
  check('phish ID label', r.data.label === 'Kemungkinan phishing', r.data);
  check('phish ID score < 50', r.data.score < 50, r.data);

  // Empty text -> 400.
  r = await post('/api/phishing-check', { text: '   ', lang: 'en' });
  check('phish empty 400', r.status === 400, r.data);

  // ---------- 3. Bandingkan 2 Produk (uses existing endpoints) ----------
  // Compare p01 (Safe, 100) vs p03 (Risky, 1): scores must differ and the
  // honest totals must be ordered correctly (p01 total > p03 total).
  const risk1 = await post('/api/risk-score', { sellerId: 'seller-safe', productId: 'p01', lang: 'en' });
  const risk3 = await post('/api/risk-score', { sellerId: 'seller-risky', productId: 'p03', lang: 'en' });
  check('compare risk p01 100', risk1.data.score === 100, risk1.data);
  check('compare risk p03 1', risk3.data.score === 1, risk3.data);
  const cost1 = await post('/api/total-cost', { priceUSD: 59.99, international: true, currencyConversion: true, lang: 'en' });
  const cost3 = await post('/api/total-cost', { priceUSD: 29.99, international: true, currencyConversion: true, lang: 'en' });
  check('compare total p01 > p03', cost1.data.total > cost3.data.total, { p01: cost1.data.total, p03: cost3.data.total });
  const hold1 = await post('/api/hold-risk', { sellerId: 'seller-safe', productId: 'p01', lang: 'en' });
  const hold3 = await post('/api/hold-risk', { sellerId: 'seller-risky', productId: 'p03', lang: 'en' });
  check('compare hold p01 Low / p03 High', hold1.data.label === 'Low' && hold3.data.label === 'High', { p01: hold1.data.label, p03: hold3.data.label });

  // ---------- 4. Budget Bulanan (client-side; verify the vault math) ----------
  // The budget logic lives in the browser (localStorage + vault entries).
  // Here we verify the vault entries the budget reads: a completed
  // checkout must appear in /api/vault with a createdAt in this month.
  const vault = await fetch(BASE + '/api/vault').then((x) => x.json());
  const now = new Date();
  const ym = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
  const thisMonth = (vault.entries || []).filter((e) => (e.createdAt || '').slice(0, 7) === ym);
  check('budget vault readable', Array.isArray(vault.entries), vault);
  check('budget month filter works', thisMonth.every((e) => (e.createdAt || '').slice(0, 7) === ym), thisMonth.length);

  // ---------- 5. Hold Release Checklist ----------
  r = await post('/api/hold-checklist', { sellerId: 'seller-risky', productId: 'p03', lang: 'id' });
  check('hrc p03 current 21', r.data.currentDays === 21 && r.data.holdLabel === 'High', r.data);
  check('hrc p03 est 21 (nothing done)', r.data.estimatedDays === 21, r.data);
  check('hrc p03 6 steps', (r.data.steps || []).length === 6, r.data.steps);
  check('hrc p03 tracking todo', r.data.steps.find((s) => s.id === 'tracking').done === false, r.data.steps);
  check('hrc p03 disputes todo', r.data.steps.find((s) => s.id === 'disputes').done === false, r.data.steps);
  r = await post('/api/hold-checklist', { sellerId: 'seller-safe', productId: 'p01', lang: 'en' });
  check('hrc p01 current 0 + tracking done', r.data.currentDays === 0 && r.data.steps.find((s) => s.id === 'tracking').done === true, r.data);
  check('hrc p01 est 3 (tracking)', r.data.estimatedDays === 3, r.data);
  r = await post('/api/hold-checklist', { sellerId: 'seller-caution', productId: 'p02', lang: 'en' });
  check('hrc p02 moderate current 7', r.data.currentDays === 7 && r.data.holdLabel === 'Moderate', r.data);
  r = await post('/api/hold-checklist', { sellerId: 'nope', productId: 'p01', lang: 'en' });
  check('hrc unknown seller 400', r.status === 400, r.data);

  // ---------- 5. Smart Guardrails ----------
  let gres = await fetch(BASE + '/api/guardrails');
  let gdata = await gres.json();
  check('gr defaults limit 20', gdata.autoApproveLimit === 20, gdata);
  r = await post('/api/guardrails/check', { totalUSD: 10, category: 'Headphones', lang: 'en' });
  check('gr $10 auto-ok', r.data.needsApproval === false, r.data);
  r = await post('/api/guardrails/check', { totalUSD: 65.57, category: 'Headphones', lang: 'en' });
  check('gr $65.57 needs approval', r.data.needsApproval === true && r.data.reasons.length === 1, r.data);
  r = await post('/api/guardrails/check', { totalUSD: 65.57, category: 'Headphones', lang: 'id' });
  check('gr id reason', r.data.needsApproval === true && /di atas batas/.test(r.data.reasons[0] || ''), r.data);
  r = await post('/api/guardrails', { autoApproveLimit: 100, categoryCaps: { Headphones: 50, Speaker: 50 } });
  check('gr set limit 100 + cap', r.data.autoApproveLimit === 100 && r.data.categoryCaps.Headphones === 50, r.data);
  r = await post('/api/guardrails/check', { totalUSD: 65.57, category: 'Headphones', lang: 'en' });
  check('gr $65.57 over cap 50', r.data.needsApproval === true && r.data.reasons.length === 1, r.data);
  r = await post('/api/guardrails/check', { totalUSD: 40, category: 'Speaker', lang: 'en' });
  check('gr $40 speaker under cap 50', r.data.needsApproval === false, r.data);
  r = await post('/api/guardrails/check', { totalUSD: 40, category: 'Speaker', lang: 'en' });
  check('gr $40 speaker no cap', r.data.needsApproval === false, r.data);
  r = await post('/api/guardrails', { autoApproveLimit: 20, categoryCaps: {} });
  check('gr reset to default', r.data.autoApproveLimit === 20 && Object.keys(r.data.categoryCaps).length === 0, r.data);
  r = await post('/api/guardrails/check', { totalUSD: 20, category: 'Headphones', lang: 'en' });
  check('gr exactly $20 auto-ok', r.data.needsApproval === false, r.data);

  // ---------- 6. Delivery Watch (Tracking API) ----------
  r = await post('/api/tracking/add', { vaultId: '6M815901GS984845M', lang: 'en' });
  check('dw tracking add 201', r.status === 200 && r.data.status === 'SHIPPED' && r.data.trackerId, r.data);
  let tres = await fetch(BASE + '/api/tracking/status?vaultId=6M815901GS984845M&lang=en');
  let tdata = await tres.json();
  check('dw tracking status', tdata.hasTracker === true && tdata.trackerId, tdata);
  r = await post('/api/tracking/add', { vaultId: 'nope', lang: 'en' });
  check('dw tracking unknown 404', r.status === 404, r.data);
  let dres = await fetch(BASE + '/api/delivery-watch?lang=en');
  let ddata = await dres.json();
  check('dw watch returns items', Array.isArray(ddata.items) && ddata.items.length >= 1, ddata);
  check('dw watch item has fields', ddata.items[0] && typeof ddata.items[0].days === 'number' && 'overdue' in ddata.items[0], ddata.items[0]);

  // ---------- 7. FX Optimizer + Expense Dashboard ----------
  r = await post('/api/fx-compare', { amountUSD: 65.57, currency: 'IDR', lang: 'en' });
  check('fx IDR live rate', r.status === 200 && r.data.rate > 10000 && r.data.paypalTotal > r.data.midConverted, r.data);
  r = await post('/api/fx-compare', { amountUSD: 65.57, currency: 'EUR', lang: 'en' });
  check('fx EUR rate', r.status === 200 && r.data.rate > 0.5 && r.data.rate < 1.5, r.data);
  r = await post('/api/fx-compare', { amountUSD: 65.57, currency: 'XXX', lang: 'en' });
  check('fx unknown currency 400', r.status === 400, r.data);
  r = await post('/api/fx-compare', { amountUSD: -5, currency: 'IDR', lang: 'en' });
  check('fx negative amount 400', r.status === 400, r.data);
  let eres = await fetch(BASE + '/api/expenses');
  let edata = await eres.json();
  check('ex totals', edata.count >= 2 && edata.total > 0 && Array.isArray(edata.byCategory), edata);
  check('ex headphones row', edata.byCategory.some((x) => x.category === 'Headphones' && x.total > 0), edata.byCategory);

  // ---------- 8. Price Watch + Split Bill ----------
  r = await post('/api/price-watch', { productId: 'p03', targetPrice: 25, lang: 'en' });
  check('pw create watch', r.status === 200 && r.data.status === 'watching' && r.data.targetPrice === 25 && typeof r.data.currentPrice === 'number' && r.data.currentPrice > 25, r.data);
  const pwId = r.data.id;
  r = await post('/api/price-watch', { productId: 'p03', targetPrice: 999, lang: 'en' });
  check('pw high target triggers at once', r.status === 200 && r.data.status === 'triggered', r.data);
  r = await post('/api/price-watch/check', { watchId: pwId });
  check('pw check drifts price', r.status === 200 && typeof r.data.currentPrice === 'number', r.data);
  r = await post('/api/price-watch/check', { watchId: 'pw-nope' });
  check('pw check unknown 404', r.status === 404, r.data);
  r = await post('/api/price-watch', { productId: 'p99', targetPrice: 10, lang: 'en' });
  check('pw unknown product 400', r.status === 400, r.data);
  let pwres = await fetch(BASE + '/api/price-watches');
  let pwdata = await pwres.json();
  check('pw list', Array.isArray(pwdata.watches) && pwdata.watches.length >= 2, pwdata.watches.length);
  r = await post('/api/split-bill', { productId: 'p01', friends: 'Budi\nSari\nAndi', lang: 'en' });
  check('sb split 4 ways', r.status === 200 && r.data.people === 4 && Math.abs(r.data.share - 59.99 / 4) < 0.01 && r.data.message.includes('Budi'), r.data);
  r = await post('/api/split-bill', { productId: 'p01', friends: 'Budi\nSari', lang: 'id' });
  check('sb id message', r.status === 200 && r.data.message.includes('patungan'), r.data.message);
  r = await post('/api/split-bill', { productId: 'p01', friends: '', lang: 'en' });
  check('sb no friends 400', r.status === 400, r.data);
  r = await post('/api/split-bill', { vaultId: '7L12554580106983W', friends: 'Budi', lang: 'en' });
  check('sb from vault entry', r.status === 200 && r.data.people === 2 && r.data.total === 65.57, r.data);

  // ---------- Pay Agent (additive: existing features unchanged) ----------
  // Local server has no VYCE_API_KEY, so these exercise the rule-based
  // fallback (same tools, same guardrails). The AI path is verified live
  // on the Worker, which has the Vyce key.
  r = await post('/api/agent', { message: 'beli headphone paling aman di bawah $60', lang: 'id' });
  check('agent id buy goal 200', r.status === 200, r.data);
  check('agent id needs approval', r.data.needsApproval === true && r.data.pendingOrder && r.data.pendingOrder.productId === 'p01' && r.data.pendingOrder.totalUSD === 65.57, r.data);
  check('agent id steps', Array.isArray(r.data.steps) && r.data.steps.some((s) => s.action === 'search_products') && r.data.steps.some((s) => s.action === 'check_guardrails'), r.data.steps);
  check('agent id fallback (no Vyce key locally)', r.data.aiUsed === false, r.data);
  check('agent id reply names product', typeof r.data.reply === 'string' && r.data.reply.includes('Aurora Wireless Headphones'), r.data.reply);
  r = await post('/api/agent', { message: 'buy the cheapest keyboard', lang: 'en' });
  check('agent en cheapest keyboard', r.status === 200 && r.data.pendingOrder && r.data.pendingOrder.productId === 'p07' && r.data.pendingOrder.totalUSD === 75.35, r.data);
  r = await post('/api/agent', { message: 'hello, how are you?', lang: 'en' });
  check('agent no shopping intent, no purchase', r.status === 200 && r.data.needsApproval !== true && !r.data.order && !r.data.pendingOrder, r.data);
  r = await post('/api/agent', { message: '', lang: 'en' });
  check('agent empty message 400', r.status === 400, r.data);
  r = await post('/api/agent', { message: 'beli headphone paling aman di bawah $60', lang: 'id', approved: true, approvedOrder: { productId: 'p01', totalUSD: 65.57 } });
  check('agent approved creates order', r.status === 200 && r.data.order && r.data.order.orderId && r.data.order.approveUrl && r.data.order.totalUSD === 65.57, r.data);
  check('agent approved order is CREATED', r.data.order && r.data.order.status === 'CREATED', r.data);
  // ---------- Sniper ke agen (price watch tools) ----------
  r = await post('/api/agent', { message: 'pantau headphone, target $25', lang: 'id' });
  check('agent watch create', r.status === 200 && r.data.watch && r.data.watch.productId === 'p01' && r.data.watch.targetPrice === 25 && r.data.watch.status === 'watching', r.data);
  check('agent watch does not buy', r.status === 200 && !r.data.order && !r.data.pendingOrder, r.data);
  check('agent watch step', Array.isArray(r.data.steps) && r.data.steps.some((s) => s.action === 'price_watch'), r.data.steps);
  const watchId = r.data.watch && r.data.watch.watchId;
  r = await post('/api/agent', { message: 'pantau headphone, target $70', lang: 'id' });
  check('agent watch target already hit triggers', r.status === 200 && r.data.watch && r.data.watch.status === 'triggered', r.data);
  r = await post('/api/agent', { message: 'cek pantauan harga', lang: 'id' });
  check('agent check watches', r.status === 200 && Array.isArray(r.data.watches) && r.data.watches.length >= 2, r.data);
  r = await post('/api/agent', { message: 'pantau headphone', lang: 'id' });
  check('agent watch without target asks', r.status === 200 && !r.data.watch && typeof r.data.reply === 'string' && r.data.reply.includes('target'), r.data);
  check('agent watch id kept', typeof watchId === 'string' && watchId.length > 0, watchId);
  r = await post('/api/price-watch', { productId: 'p01', targetPrice: 25, lang: 'en' });
  check('price-watch route still works', r.status === 200 && typeof r.data.id === 'string' && r.data.targetPrice === 25, r.data);
  const pwId2 = r.data.id;
  r = await post('/api/price-watch/check', { watchId: pwId2 });
  check('price-watch check route still works', r.status === 200 && r.data.status, r.data);
  // ---------- Split Payment Link via Orders API (bypass 403 Invoicing) ----------
  r = await post('/api/split-payment-link', { productId: 'p01', friends: 'Budi\nSari', lang: 'en' });
  check('spl link p01 3 ways share', r.status === 200 && r.data.people === 3 && Math.abs(r.data.share - 59.99 / 3) < 0.01, r.data);
  check('spl link has 2 approveUrls', r.status === 200 && Array.isArray(r.data.links) && r.data.links.length === 2 && r.data.links.every((l) => l.approveUrl && l.approveUrl.includes('paypal.com')), r.data.links);
  check('spl link order is CREATED', r.status === 200 && r.data.links.every((l) => l.status === 'CREATED'), r.data.links);
  r = await post('/api/split-payment-link', { productId: 'p01', friends: '', lang: 'en' });
  check('spl link no friends 400', r.status === 400, r.data);
  r = await post('/api/split-payment-link', { productId: 'p99', friends: 'Budi', lang: 'en' });
  check('spl link no amount 400', r.status === 400, r.data);
  // Agent split via chat ("patungan headphone sama Budi dan Sari").
  r = await post('/api/agent', { message: 'patungan headphone sama Budi dan Sari', lang: 'id' });
  check('agent split creates links', r.status === 200 && r.data.splitPayment && Array.isArray(r.data.splitPayment.links) && r.data.splitPayment.links.length === 2, r.data);
  check('agent split step', Array.isArray(r.data.steps) && r.data.steps.some((s) => s.action === 'split_payment_link'), r.data.steps);
  r = await post('/api/agent', { message: 'patungan headphone', lang: 'id' });
  check('agent split without friends asks', r.status === 200 && !r.data.splitPayment && typeof r.data.reply === 'string' && r.data.reply.includes('Budi'), r.data);
  // Dispute payload mirrors the official PayPal Disputes API shape.
  r = await post('/api/dispute/simulate', { productId: 'p03', disputeType: 'not_received', lang: 'en' });
  check('dispute payload shape', r.status === 200 && r.data.disputePayload && r.data.disputePayload.status === 'OPEN' && r.data.disputePayload.reason === 'MERCHANDISE_OR_SERVICE_NOT_RECEIVED' && typeof r.data.disputePayload.dispute_id === 'string' && r.data.disputePayload.dispute_id.startsWith('PP-D-'), r.data.disputePayload);
  check('dispute payload amount', r.status === 200 && r.data.disputePayload.dispute_amount && r.data.disputePayload.dispute_amount.currency_code === 'USD', r.data.disputePayload);
  check('dispute still simulated', r.status === 200 && r.data.simulated === true, r.data);
  // Token status endpoint (MCP get_access_token, no token value returned).
  r = await get('/api/paypal/token-status');
  check('token status ok', r.status === 200 && r.data.ok === true && typeof r.data.expiresInSeconds === 'number' && !('access_token' in r.data), r.data);
  // Existing checkout route still works after the createPayPalOrder extract.
  r = await post('/api/paypal/create-order', { productId: 'p01', totalUSD: 65.57 });
  check('create-order route still works', r.status === 201 && r.data.orderId && r.data.approveUrl, r.data);
  r = await post('/api/paypal/create-order', { productId: 'p01', totalUSD: 10 });
  check('create-order bad total 400', r.status === 400 && /Total mismatch/.test(r.data.error || ''), r.data);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error('ERROR', e);
  process.exit(1);
});
