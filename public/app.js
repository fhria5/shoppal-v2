// ShopPal v2 — 7-step demo flow, chat UI. No secrets here; the PayPal
// client ID comes from /api/config at runtime.
(function () {
  'use strict';

  var catalog = null;
  var selected = null; // { product, seller, risk, cost }
  var lastResults = null; // products the last Ask reply showed — follow-ups ("yang termurah") refer to these
  var lastVaultId = null;

  // Bilingual replies (Dwibahasa). The agent answers in the language the
  // buyer types: Indonesian when the message has Indonesian words, English
  // otherwise (English is the demo's default — Devpost requires English
  // materials). The greeting stays English (it renders before any input).
  // Risk/hold/cost reasons come from the server already translated; this
  // dictionary covers the UI chrome around them.
  var lang = 'en';
  function detectLang(text) {
    return /\b(di|yang|mau|aku|saya|murah|termurah|terbaik|paling|bawah|dari|ada|garansi|pertama|berapa|cari|beli|baru|dan|untuk|dengan|ini|itu|aja|saja|tolong|dong)\b/i.test(String(text || ''))
      ? 'id'
      : 'en';
  }
  function fmt(template, vars) {
    return String(template).replace(/\{(\w+)\}/g, (_, k) => (vars[k] !== undefined ? vars[k] : '{' + k + '}'));
  }
  function t(key) {
    const dict = STR[lang] || STR.en;
    return dict[key] !== undefined ? dict[key] : STR.en[key];
  }
  function labelText(label) { return t('label' + label); }
  function holdLabelText(label) { return t('hold' + label); }
  const STR = {
    en: {
      understood: 'Understood:', noCategory: 'no category or budget found',
      under: 'under $', fromSeller: 'from {seller} only', withReturns: 'with returns', withTracking: 'with tracking',
      cheapestFirst: 'cheapest first', bestFirst: 'best match first', parsedByAI: '(parsed by AI)',
      riskScore: 'Risk Score', labelSafe: 'Safe', labelCaution: 'Caution', labelRisky: 'Risky',
      recommendation: 'Recommendation:', watchOut: 'Watch out:', beforeYouPay: 'Before you pay:',
      holdTitle: 'Hold Predictor', holdLow: 'Low', holdModerate: 'Moderate', holdHigh: 'High',
      holdHint: 'Estimate from public hold patterns, not a PayPal decision.',
      honestTotal: 'Honest total (estimated)', itemPrice: 'Item price',
      paypalFee: 'PayPal Checkout fee (3.49% + $0.49)', intlFee: 'International fee (1.5%)',
      convSpread: 'Currency conversion spread (~3.5%, estimated)', totalEst: 'Total (estimated)',
      troubleTitle: 'If something goes wrong',
      chargeback: 'Chargeback: ${n} per case, on top of the lost sale.',
      disputeFee: 'Dispute through PayPal: ${a} (${b} for high-volume sellers).',
      refundLine: 'Refund: the original fee is not returned, so a refunded order still costs the fee.',
      instantLine: 'Instant transfer to your bank: {pct}% (min ${min}); standard transfer is free but takes 1–3 days.',
      microCheap: 'Micropayments rate (4.99% + $0.09) would be cheaper for this item than the standard Checkout rate.',
      microInfo: 'For items under $12, the Micropayments rate (4.99% + $0.09) is cheaper than the standard Checkout rate.',
      protectionLabel: 'Buyer Protection:',
      readyToPay: 'Ready to pay?', neverPay: 'I never pay without your approval.',
      approveLabel: 'I reviewed the risk score and total cost, and I approve this payment.',
      payButton: 'Pay with PayPal Sandbox', checkoutHint: 'Use a PayPal Sandbox buyer account to approve. No real money is involved.',
      simNote: 'Sandbox simulation: this creates a PayPal Sandbox order for the listing total. It does <strong>not</strong> buy the eBay item — it proves the total and saves the proof.',
      creatingOrder: 'Creating PayPal order…',
      orderFailed: 'Could not create the PayPal order: {msg}',
      orderCreated: 'Order created: <strong>{id}</strong> — total {total}. Approve it in PayPal Sandbox, then you will be sent back here to capture it.',
      approveLink: 'Approve this order in PayPal Sandbox (opens in a new tab)',
      approveHint: 'Use a PayPal sandbox buyer account to approve. No real money is involved.',
      vaultEmpty: 'No Proof Vault entries yet. Complete a successful checkout to save proof automatically.',
      subsTitle: 'Subscription Watcher',
      subsEmpty: 'No recurring purchases detected yet. Buy the same product twice and it shows up here with the total you have spent on it.',
      subsFound: 'recurring purchases found',
      subsLine: '{name} — bought {n}×, total spent {total}, last purchase {date}',
      subsUnavailable: 'Subscription Watcher unavailable.',
      refreshVault: 'Refresh Vault', disputeBtn: 'Simulate Dispute',
      disputeTitle: 'Simulated dispute draft', disputeReadiness: 'readiness {n}/100',
      disputeMissing: 'Still missing: {list}', disputeNone: 'No proof missing.',
      disputeFailed: 'Could not generate a dispute draft.',
      mpHeader: 'Real listings · eBay', mpNone: 'No eBay listings found for that search.',
      checkoutCancelled: 'Checkout was cancelled in PayPal. No payment was made.',
      approvedCapturing: 'PayPal approved order {id} — capturing…',
      captureFailed: 'Capture failed: {msg}',
      successTitle: 'Success — payment captured.',
      successProof: 'Proof was saved to the Proof Vault automatically.'
    },
    id: {
      understood: 'Mengerti:', noCategory: 'tidak ada kategori atau budget yang dikenali',
      under: 'di bawah $', fromSeller: 'dari {seller} saja', withReturns: 'ada garansi/retur', withTracking: 'ada tracking',
      cheapestFirst: 'termurah dulu', bestFirst: 'terbaik dulu', parsedByAI: '(dipahami AI)',
      riskScore: 'Skor Risiko', labelSafe: 'Aman', labelCaution: 'Hati-hati', labelRisky: 'Berisiko',
      recommendation: 'Rekomendasi:', watchOut: 'Perhatian:', beforeYouPay: 'Sebelum bayar:',
      holdTitle: 'Prediktor Hold', holdLow: 'Rendah', holdModerate: 'Sedang', holdHigh: 'Tinggi',
      holdHint: 'Perkiraan dari pola hold publik, bukan keputusan PayPal.',
      honestTotal: 'Total jujur (perkiraan)', itemPrice: 'Harga barang',
      paypalFee: 'Biaya PayPal Checkout (3.49% + $0.49)', intlFee: 'Biaya internasional (1.5%)',
      convSpread: 'Selisih kurs (~3.5%, perkiraan)', totalEst: 'Total (perkiraan)',
      troubleTitle: 'Kalau ada masalah',
      chargeback: 'Chargeback: ${n} per kasus, di luar penjualan yang hilang.',
      disputeFee: 'Sengketa lewat PayPal: ${a} (${b} untuk seller volume tinggi).',
      refundLine: 'Refund: biaya awal tidak dikembalikan, jadi order yang di-refund tetap dikenakan biaya.',
      instantLine: 'Transfer instan ke bank: {pct}% (min ${min}); transfer standar gratis tapi butuh 1–3 hari.',
      microCheap: 'Tarif Micropayments (4.99% + $0.09) lebih murah untuk barang ini daripada tarif Checkout standar.',
      microInfo: 'Untuk barang di bawah $12, tarif Micropayments (4.99% + $0.09) lebih murah daripada tarif Checkout standar.',
      protectionLabel: 'Perlindungan Pembeli:',
      readyToPay: 'Siap bayar?', neverPay: 'Saya tidak pernah bayar tanpa persetujuanmu.',
      approveLabel: 'Saya sudah memeriksa skor risiko dan total biaya, dan saya menyetujui pembayaran ini.',
      payButton: 'Bayar dengan PayPal Sandbox', checkoutHint: 'Pakai akun buyer PayPal Sandbox untuk menyetujui. Tidak ada uang asli yang terlibat.',
      simNote: 'Simulasi sandbox: ini membuat order PayPal Sandbox sebesar total listing. Ini <strong>tidak</strong> membeli barang eBay — hanya membuktikan total dan menyimpan bukti.',
      creatingOrder: 'Membuat order PayPal…',
      orderFailed: 'Tidak bisa membuat order PayPal: {msg}',
      orderCreated: 'Order dibuat: <strong>{id}</strong> — total {total}. Setujui di PayPal Sandbox, lalu kamu akan dikembalikan ke sini untuk capture.',
      approveLink: 'Setujui order ini di PayPal Sandbox (terbuka di tab baru)',
      approveHint: 'Pakai akun buyer sandbox PayPal untuk menyetujui. Tidak ada uang asli yang terlibat.',
      vaultEmpty: 'Belum ada entri Proof Vault. Selesaikan checkout yang berhasil untuk menyimpan bukti otomatis.',
      subsTitle: 'Pemantau Langganan',
      subsEmpty: 'Belum ada pembelian berulang. Beli produk yang sama dua kali dan akan muncul di sini beserta total yang sudah kamu belanjakan.',
      subsFound: 'pembelian berulang ditemukan',
      subsLine: '{name} — dibeli {n}×, total belanja {total}, pembelian terakhir {date}',
      subsUnavailable: 'Pemantau Langganan tidak tersedia.',
      refreshVault: 'Muat Ulang Vault', disputeBtn: 'Simulasikan Sengketa',
      disputeTitle: 'Draf sengketa simulasi', disputeReadiness: 'kesiapan {n}/100',
      disputeMissing: 'Masih kurang: {list}', disputeNone: 'Tidak ada bukti yang kurang.',
      disputeFailed: 'Tidak bisa membuat draf sengketa.',
      mpHeader: 'Listing asli · eBay', mpNone: 'Tidak ada listing eBay untuk pencarian itu.',
      checkoutCancelled: 'Checkout dibatalkan di PayPal. Tidak ada pembayaran.',
      approvedCapturing: 'PayPal menyetujui order {id} — meng-capture…',
      captureFailed: 'Capture gagal: {msg}',
      successTitle: 'Berhasil — pembayaran di-capture.',
      successProof: 'Bukti tersimpan otomatis ke Proof Vault.'
    }
  };

  var $ = function (id) { return document.getElementById(id); };
  var money = function (n) { return '$' + Number(n).toFixed(2); };
  var chatEl = null;

  async function loadConfig() {
    try {
      const res = await fetch('/api/config');
      const cfg = await res.json();
      if (!cfg.paypalClientId) {
        addBubble('agent', '<p class="hint">PayPal client ID is not configured yet. Add PAYPAL_CLIENT_ID to your local .env.</p>');
      }
      return cfg;
    } catch (e) {
      addBubble('agent', '<p class="hint">Could not load /api/config: ' + e.message + '</p>');
      return {};
    }
  }

  async function loadCatalog() {
    const res = await fetch('/api/catalog');
    catalog = await res.json();
  }

  function sellerOf(product) {
    return catalog.sellers.find((s) => s.id === product.sellerId);
  }

  // eBay titles are external content — escape before injecting into HTML.
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }
  function safeImageUrl(url) {
    return typeof url === 'string' && url.startsWith('https://') ? url : null;
  }

  // Chat helpers. Every step is a message; picking a new product clears
  // the old step messages so element IDs stay unique.
  function scrollChat() {
    if (chatEl) chatEl.scrollTop = chatEl.scrollHeight;
  }
  function addBubble(who, html, step) {
    var div = document.createElement('div');
    div.className = 'msg ' + who;
    if (step) div.setAttribute('data-step', step);
    div.innerHTML = (who === 'agent' ? '<div class="msg-label">ShopPal</div>' : '') + html;
    chatEl.appendChild(div);
    scrollChat();
    return div;
  }
  function userBubble(text) {
    return addBubble('user', '<p>' + text + '</p>');
  }
  function clearSteps() {
    // Only the checkout flow is cleared (risk/hold/cost/checkout). The
    // Proof Vault and past success messages stay in the chat history, so a
    // new question never leaves a stale PayPal button behind, but never
    // wipes proof the buyer already earned.
    var old = chatEl.querySelectorAll('[data-step="risk"], [data-step="hold"], [data-step="cost"], [data-step="checkout"]');
    for (var i = 0; i < old.length; i++) old[i].remove();
  }
  function showTyping() {
    var div = document.createElement('div');
    div.className = 'msg agent typing';
    div.innerHTML = '<span></span><span></span><span></span>';
    chatEl.appendChild(div);
    scrollChat();
    return div;
  }
  function hideTyping(el) {
    if (el && el.remove) el.remove();
  }

  function productCardHtml(p) {
    var seller = sellerOf(p);
    return '<button type="button" class="product-card" data-product="' + p.id + '">' +
      '<img src="/' + (p.image || '') + '" alt="' + p.name + '">' +
      '<span class="card-body"><strong>' + p.name + '</strong>' +
      '<span class="price">' + money(p.priceUSD) + '</span> · ' + p.category + '<br>' +
      '<span class="seller">Seller: ' + seller.name + ' (' + seller.riskProfile + ')</span></span></button>';
  }
  function renderCatalogInto(grid, products) {
    grid.innerHTML = '';
    products.forEach(function (p) {
      var wrap = document.createElement('div');
      wrap.innerHTML = productCardHtml(p);
      var card = wrap.firstChild;
      card.addEventListener('click', function () { selectProduct(p); });
      grid.appendChild(card);
    });
  }

  function marketplaceCardHtml(l) {
    var risk = l.risk || {};
    var zone = (risk.label || 'Caution').toLowerCase();
    var img = safeImageUrl(l.image);
    return '<button type="button" class="product-card" data-marketplace="eBay">' +
      (img ? '<img src="' + img + '" alt="">' : '') +
      '<span class="card-body"><strong>' + escapeHtml(l.title) + '</strong>' +
      '<span class="price">' + money(l.priceUSD) + '</span> · eBay<br>' +
      '<span class="seller">Seller: ' + escapeHtml(l.sellerName) +
      (l.sellerFeedbackPercentage !== null && l.sellerFeedbackPercentage !== undefined
        ? ' (' + l.sellerFeedbackPercentage + '% positive)' : '') + '</span><br>' +
      '<span class="score score-' + zone + '">' +
      (risk.score !== undefined ? risk.score + '/100 · ' + risk.label : risk.label) + '</span> ' +
      (l.itemUrl ? '<a href="' + l.itemUrl + '" target="_blank" rel="noopener" class="ext-link">View on eBay ↗</a>' : '') +
      '</span></button>';
  }
  function renderMarketplaceInto(grid, listings) {
    grid.innerHTML = '';
    listings.forEach(function (l) {
      var wrap = document.createElement('div');
      wrap.innerHTML = marketplaceCardHtml(l);
      var card = wrap.firstChild;
      var link = card.querySelector('a');
      if (link) link.addEventListener('click', function (e) { e.stopPropagation(); });
      card.addEventListener('click', function () { selectMarketplaceItem(l); });
      grid.appendChild(card);
    });
  }

  // A real eBay listing flows through the same 7 steps as a demo product,
  // with its marketplace risk score (attached by the search endpoint).
  // Checkout is a PayPal Sandbox simulation — it never buys the eBay item.
  function selectMarketplaceItem(l) {
    var seller = {
      id: 'ebay:' + (l.sellerName || 'unknown'),
      name: l.sellerName || 'Unknown seller',
      hasTracking: !!l.hasShipping,
      hasReturnPolicy: !!l.returnsAccepted,
    };
    var product = {
      id: 'ebay:' + String(l.itemId || '').slice(0, 60),
      name: l.title,
      priceUSD: l.priceUSD,
      category: 'Marketplace · eBay',
    };
    selected = { product: product, seller: seller, risk: l.risk, holdRisk: l.holdRisk, cost: null, marketplace: l };
    clearSteps();
    userBubble(l.title + ' — ' + money(l.priceUSD) + ' (eBay)');
    showRisk();
    showHold();
    showCost();
    showCheckout();
  }

  function greet() {
    addBubble('agent',
      '<p>Hi, I’m ShopPal — your AI shopping agent. Tell me what you’re looking for, and I’ll check the seller, show you the real total (fees included), and keep your proof if you pay.</p>' +
      '<p>Everything here runs on PayPal Sandbox, so no real money moves.</p>' +
      '<p class="hint">The server version can also search real eBay listings when EBAY_APP_ID + EBAY_CERT_ID are set in .env (free eBay developer keys) — otherwise I search the 10-product demo catalog.</p>' +
      '<div class="chips">' +
      '<button type="button" class="chip" data-q="headphones under $60">Headphones under $60</button>' +
      '<button type="button" class="chip" data-q="smartwatch">Smartwatch</button>' +
      '<button type="button" class="chip" data-q="keyboard">Keyboard</button>' +
      '</div>' +
      '<p class="hint">Or pick any product below.</p>' +
      '<div class="cards" id="catalog"></div>');
    renderCatalogInto($('catalog'), catalog.products);
    var chips = chatEl.querySelectorAll('.chip');
    for (var i = 0; i < chips.length; i++) {
      chips[i].addEventListener('click', function () {
        $('ask').value = this.getAttribute('data-q');
        sendAsk();
      });
    }
  }

  async function sendAsk() {
    var q = $('ask').value.trim();
    if (!q || !catalog) return;
    $('ask').value = '';
    lang = detectLang(q);
    userBubble(q);
    clearSteps();
    var typing = showTyping();
    var askParams = new URLSearchParams({ q, lang });
    if (lastResults && lastResults.length) {
      askParams.set('context', lastResults.map((p) => p.id).join(','));
    }
    var res = await fetch('/api/ask?' + askParams.toString());
    var data = await res.json();
    var products = data.products || catalog.products;
    lastResults = products;
    // "yang pertama" picks the first result shown — go straight to it.
    if (data.selectFirst && products.length) {
      hideTyping(typing);
      selectProduct(products[0]);
      return;
    }
    var understood = [];
    if (data.understood && data.understood.category) understood.push(data.understood.category);
    if (data.understood && data.understood.minPrice !== null && data.understood.minPrice !== undefined && data.understood.maxPrice !== null && data.understood.maxPrice !== undefined) understood.push('$' + data.understood.minPrice + '–$' + data.understood.maxPrice);
    else if (data.understood && data.understood.maxPrice !== null && data.understood.maxPrice !== undefined) understood.push(t('under') + data.understood.maxPrice);
    if (data.understood && data.understood.seller) understood.push(fmt(t('fromSeller'), { seller: data.understood.seller }));
    if (data.understood && data.understood.needsReturn) understood.push(t('withReturns'));
    if (data.understood && data.understood.needsTracking) understood.push(t('withTracking'));
    if (data.understood && data.understood.cheapest) understood.push(t('cheapestFirst'));
    if (data.understood && data.understood.best) understood.push(t('bestFirst'));
    addBubble('agent',
      '<p>' + t('understood') + ' ' + (understood.length ? understood.join(', ') : t('noCategory')) +
      ' — ' + (data.understood ? data.understood.note : '') +
      (data.understood && data.understood.aiParsed ? ' ' + t('parsedByAI') : '') + '</p>' +
      '<div class="cards" id="catalog"></div>');
    renderCatalogInto($('catalog'), products);
    // Real marketplace search (eBay), same query. Runs after the demo
    // catalog reply so the Ask answer never waits on the marketplace.
    try {
      var mpParams = new URLSearchParams({ q, lang });
      if (data.understood && data.understood.maxPrice !== null && data.understood.maxPrice !== undefined) mpParams.set('maxPrice', data.understood.maxPrice);
      if (data.understood && data.understood.cheapest) mpParams.set('cheapest', 'true');
      var mpRes = await fetch('/api/marketplace/search?' + mpParams.toString());
      var mp = await mpRes.json();
      if (mp.configured && mp.listings && mp.listings.length) {
        hideTyping(typing);
        addBubble('agent',
          '<p><strong>' + t('mpHeader') + '</strong></p>' +
          '<p class="hint">' + (mp.note || '') + '</p>' +
          '<div class="cards" id="marketplace"></div>');
        renderMarketplaceInto($('marketplace'), mp.listings);
        return;
      }
      if (mp.configured) {
        hideTyping(typing);
        addBubble('agent', '<p class="hint">' + t('mpNone') + '</p>');
        return;
      }
    } catch (e) {
      // Marketplace search is a bonus — a failure never breaks the Ask flow.
    }
    hideTyping(typing);
  }

  async function selectProduct(product) {
    var seller = sellerOf(product);
    selected = { product: product, seller: seller, risk: null, cost: null };
    clearSteps();
    userBubble(product.name + ' — ' + money(product.priceUSD));
    var typing = showTyping();

    var riskRes = await fetch('/api/risk-score', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sellerId: seller.id, productId: product.id, lang }),
    });
    selected.risk = await riskRes.json();
    showRisk();
    await showHold();
    await showCost();
    hideTyping(typing);
    showCheckout();
  }

  function showRisk() {
    var r = selected.risk;
    var zone = r.label.toLowerCase();
    var extra = '';
    if (r.comparison) extra += '<p>' + r.comparison + '</p>';
    if (r.warning) extra += '<p><strong>' + t('watchOut') + '</strong> ' + r.warning + '</p>';
    if (r.checklist && r.checklist.length) {
      extra += '<p><strong>' + t('beforeYouPay') + '</strong></p><ul>' +
        r.checklist.map((c) => '<li>' + c + '</li>').join('') + '</ul>';
    }
    addBubble('agent',
      '<p><strong>' + selected.seller.name + '</strong> — ' + t('riskScore') + ' <span class="score score-' + zone + '">' + r.score + '/100 · ' + labelText(r.label) + '</span></p>' +
      '<ul>' + r.reasons.map((reason) => '<li>' + reason + '</li>').join('') + '</ul>' +
      '<p><strong>' + t('recommendation') + '</strong> ' + r.recommendation + '</p>' +
      extra +
      '<p class="hint">Profile ' + r.components.profile + ' · History ' + r.components.history +
      ' · Price ' + r.components.price + ' · Tracking ' + r.components.tracking +
      (r.aiAvailable ? '' : ' · ' + (r.aiNote || 'AI explanation unavailable.')) + '</p>',
      'risk');
  }

  async function showHold() {
    // Marketplace listings already carry their hold estimate from search.
    var h = selected.holdRisk || null;
    if (!h) {
      var res = await fetch('/api/hold-risk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sellerId: selected.seller.id, productId: selected.product.id, lang }),
      });
      h = await res.json();
      if (!res.ok) return;
    }
    var zone = h.label === 'Low' ? 'safe' : h.label === 'Moderate' ? 'caution' : 'risky';
    addBubble('agent',
      '<p><strong>' + t('holdTitle') + '</strong> — hold risk <span class="score score-' + zone + '">' + holdLabelText(h.label) + ' · ' + h.chance + '</span></p>' +
      '<ul>' + h.reasons.map((reason) => '<li>' + reason + '</li>').join('') + '</ul>' +
      '<p>' + h.tip + '</p>' +
      '<p class="hint">' + t('holdHint') + '</p>',
      'hold');
  }

  async function showCost() {
    var res = await fetch('/api/total-cost', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ priceUSD: selected.product.priceUSD, international: true, currencyConversion: true, lang }),
    });
    selected.cost = await res.json();
    var c = selected.cost;
    var tc = c.troubleCosts || {};
    var refundLine = c.itemPrice < 12
      ? t('microCheap')
      : t('microInfo');
    addBubble('agent',
      '<p><strong>' + t('honestTotal') + '</strong></p>' +
      '<table>' +
      '<tr><td>' + t('itemPrice') + '</td><td>' + money(c.itemPrice) + '</td></tr>' +
      '<tr><td>' + t('paypalFee') + '</td><td>' + money(c.paypalFee) + '</td></tr>' +
      '<tr><td>' + t('intlFee') + '</td><td>' + money(c.internationalFee) + '</td></tr>' +
      '<tr><td>' + t('convSpread') + '</td><td>' + money(c.conversionSpread) + '</td></tr>' +
      '<tr><td><strong>' + t('totalEst') + '</strong></td><td><strong>' + money(c.total) + '</strong></td></tr>' +
      '</table>' +
      '<div class="card"><p><strong>' + t('troubleTitle') + '</strong></p>' +
      '<ul>' +
      '<li>' + fmt(t('chargeback'), { n: tc.chargebackUSD || 20 }) + '</li>' +
      '<li>' + fmt(t('disputeFee'), { a: tc.disputeStandardUSD || 15, b: tc.disputeHighVolumeUSD || 30 }) + '</li>' +
      '<li>' + t('refundLine') + '</li>' +
      '<li>' + fmt(t('instantLine'), { pct: tc.instantTransferPct || 1.5, min: tc.instantTransferMinUSD || 0.5 }) + '</li>' +
      '<li>' + refundLine + '</li>' +
      '</ul>' +
      '<p><strong>' + t('protectionLabel') + '</strong> ' + (tc.protection || 'PayPal Buyer Protection covers Goods & Services payments. Friends & Family payments are not covered.') + '</p>' +
      '<p class="hint">' + (tc.note || 'Public PayPal merchant fee schedule (US, Oct 2026). Estimates, not a quote.') + '</p></div>',
      'cost');
  }

  function showCheckout() {
    var simNote = selected.marketplace
      ? '<p>' + t('simNote') + '</p>'
      : '';
    var bubble = addBubble('agent',
      '<p><strong>' + t('readyToPay') + '</strong> ' + t('neverPay') + '</p>' +
      simNote +
      '<p><label><input id="approve" type="checkbox"> ' + t('approveLabel') + '</label></p>' +
      '<button id="checkout-btn" type="button" disabled>' + t('payButton') + '</button>' +
      '<p id="checkout-status"></p>' +
      '<p class="hint">' + t('checkoutHint') + '</p>',
      'checkout');
    bubble.querySelector('#approve').addEventListener('change', (e) => {
      bubble.querySelector('#checkout-btn').disabled = !(e.target.checked && selected);
    });
    bubble.querySelector('#checkout-btn').addEventListener('click', startCheckout);
  }

  async function startCheckout() {
    if (!selected || !$('approve') || !$('approve').checked) return;
    $('checkout-status').textContent = t('creatingOrder');
    var total = selected.cost ? selected.cost.total : selected.product.priceUSD;
    var body = selected.marketplace
      ? {
          marketplace: {
            marketplace: 'eBay',
            itemId: selected.marketplace.itemId,
            title: selected.marketplace.title,
            priceUSD: selected.product.priceUSD,
            itemUrl: selected.marketplace.itemUrl,
            image: selected.marketplace.image,
            sellerName: selected.marketplace.sellerName,
            riskScore: selected.risk ? { score: selected.risk.score, label: selected.risk.label } : null,
          },
          totalUSD: total,
          international: true,
          currencyConversion: true,
        }
      : {
          productId: selected.product.id,
          totalUSD: total,
          international: true,
          currencyConversion: true,
        };
    var res = await fetch('/api/paypal/create-order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    var data = await res.json();
    if (!res.ok) {
      $('checkout-status').textContent = fmt(t('orderFailed'), { msg: data.error || res.status });
      return;
    }
    $('checkout-status').innerHTML =
      fmt(t('orderCreated'), { id: data.orderId, total: money(data.totalUSD) });
    addBubble('agent',
      '<p><a href="' + data.approveUrl + '" target="_blank" rel="noopener">' + t('approveLink') + '</a></p>' +
      '<p class="hint">' + t('approveHint') + '</p>');
    if (data.approveUrl) window.open(data.approveUrl, '_blank', 'noopener');
  }

  async function showVault() {
    var old = chatEl.querySelector('[data-step="vault"]');
    if (old) old.remove();
    var res = await fetch('/api/vault');
    var data = await res.json();
    var body = '';
    if (!data.entries || data.entries.length === 0) {
      body = '<p>' + t('vaultEmpty') + '</p>';
    } else {
      lastVaultId = data.entries[0].id;
      body = data.entries.map((e) =>
        '<p><strong>' + (e.product?.name || e.id) + '</strong> — ' +
        (e.paypal?.status || 'unknown') + ' · Order ' + (e.paypal?.orderId || '—') +
        (e.marketplace ? ' · ' + e.marketplace.name + ' (simulation)' : '') + '</p>'
      ).join('');
    }
    var subs = '';
    try {
      var sres = await fetch('/api/subscriptions');
      var sdata = await sres.json();
      if (!sdata.patterns || !sdata.patterns.length) {
        subs = '<p><strong>' + t('subsTitle') + '</strong></p><p>' + t('subsEmpty') + '</p>';
      } else {
        subs = '<p><strong>' + t('subsTitle') + '</strong> — ' + t('subsFound') + '</p>' +
          sdata.patterns.map((p) =>
            '<p>' + fmt(t('subsLine'), { name: p.productName, n: p.purchases, total: money(p.totalSpent), date: p.lastPurchase ? p.lastPurchase.slice(0, 10) : '—' }) + '</p>'
          ).join('');
      }
    } catch (e) {
      subs = '<p>' + t('subsUnavailable') + '</p>';
    }
    var bubble = addBubble('agent',
      '<p><strong>Proof Vault</strong></p>' + body +
      '<div class="card">' + subs + '</div>' +
      '<p><button id="vault-refresh" type="button">' + t('refreshVault') + '</button> ' +
      '<button id="dispute-btn" type="button"' + (data.entries && data.entries.length ? '' : ' disabled') + '>' + t('disputeBtn') + '</button></p>' +
      '<div id="dispute-draft" class="card hidden"></div>',
      'vault');
    bubble.querySelector('#vault-refresh').addEventListener('click', function () { showVault(); });
    bubble.querySelector('#dispute-btn').addEventListener('click', async function () {
      if (!lastVaultId) return;
      var res = await fetch('/api/dispute/draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vaultId: lastVaultId, lang }),
      });
      var d = await res.json();
      var box = $('dispute-draft');
      if (!box) return;
      box.classList.remove('hidden');
      if (!res.ok) {
        box.textContent = d.error || t('disputeFailed');
        return;
      }
      box.innerHTML =
        '<p><strong>' + t('disputeTitle') + '</strong> — ' + fmt(t('disputeReadiness'), { n: d.readinessScore }) + '</p>' +
        '<p>' + d.draft + '</p>' +
        (d.missingProof && d.missingProof.length
          ? '<p>' + fmt(t('disputeMissing'), { list: d.missingProof.join(', ') }) + '</p>'
          : '<p>' + t('disputeNone') + '</p>');
      scrollChat();
    });
  }

  document.addEventListener('DOMContentLoaded', async () => {
    chatEl = $('chat');
    $('ask-btn').addEventListener('click', sendAsk);
    $('ask').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') sendAsk();
    });
    await loadConfig();
    await loadCatalog();
    greet();
    await showVault();
    var params = new URLSearchParams(window.location.search);
    if (params.get('cancelled') === '1') {
      addBubble('agent', '<p>' + t('checkoutCancelled') + '</p>');
    } else if (params.get('approved') === '1' && params.get('token')) {
      var orderId = params.get('token');
      addBubble('agent', '<p>' + fmt(t('approvedCapturing'), { id: orderId }) + '</p>');
      var res = await fetch('/api/paypal/capture-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId }),
      });
      var data = await res.json();
      if (!res.ok) {
        addBubble('agent', '<p>' + fmt(t('captureFailed'), { msg: data.error || res.status }) + '</p>');
        return;
      }
      addBubble('agent',
        '<p><strong>' + t('successTitle') + '</strong> Order ' + data.orderId +
        ' · Capture ' + data.captureId + ' · status ' + data.status + '</p>' +
        '<p>' + t('successProof') + '</p>',
        'success');
      await showVault();
      window.history.replaceState({}, '', window.location.pathname);
    }
  });
})();
