// ShopPal v2 — 7-step demo flow, chat UI. No secrets here; the PayPal
// client ID comes from /api/config at runtime.
(function () {
  'use strict';

  // Live-server demo: the API is the Cloudflare Worker, not this origin.
  var API_BASE = 'https://shoppal-v2.fahriannor07.workers.dev';

  var catalog = null;
  var selected = null; // { product, seller, risk, cost }
  var lastResults = null; // products the last Ask reply showed — follow-ups ("yang termurah") refer to these
  var lastVaultId = null;
  var phishingMode = false; // next Ask input is a suspicious message to check
  var compareMode = false; // product cards add to the compare list instead of selecting
  var compareList = []; // up to 2 products for the comparison table
  var BUDGET_KEY = 'shoppal-budget-usd';

  function getBudget() {
    try {
      var v = Number(localStorage.getItem(BUDGET_KEY));
      return v > 0 ? v : null;
    } catch (e) { return null; }
  }
  function setBudget(v) {
    try { localStorage.setItem(BUDGET_KEY, String(v)); } catch (e) { /* storage unavailable */ }
  }
  function monthSpend(entries) {
    var now = new Date();
    var ym = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
    var sum = 0;
    (entries || []).forEach(function (e) {
      var d = (e.createdAt || e.paypal && e.paypal.createTime || '').slice(0, 7);
      if (d === ym) sum += Number(e.totalCost && e.totalCost.total || e.product && e.product.priceUSD || 0);
    });
    return Math.round(sum * 100) / 100;
  }

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
      refundBtn: 'Refund (Sandbox)', refundConfirm: 'Confirm refund?', refundTitle: 'Refund',
      refundSuccess: 'Refund {id} — {status}, {amount}.', refundFailed: 'Refund failed: {msg}',
      refundAlready: 'Already refunded.', orderStatusBtn: 'Check live status',
      orderStatusTitle: 'Live order status (PayPal)',
      orderStatusFailed: 'Could not check the order status: {msg}',
      alreadyCapturedNote: 'This order was already captured — showing the saved proof.',
      simBtn: 'Simulate a dispute', simTitle: 'Dispute simulation',
      simWinChance: 'Win chance: {n}%', simMissing: 'Missing proof: {list}',
      simFailed: 'Could not simulate the dispute: {msg}',
      simPreNote: 'Pre-purchase simulation — what your case would look like if you buy now.',
      evBtn: 'Download Evidence Pack',
      evFailed: 'Could not build the evidence pack: {msg}',
      dlBtn: 'Deadlines', dlTitle: 'Deadlines',
      dlFailed: 'Could not load the deadlines: {msg}',
      dlLeft: '{days} days left', dlOverdue: '{days} days overdue',
      dlToday: 'Due today', dlExpired: 'Expired',
      dlNoReturn: 'No return policy', dlNoDispute: 'No dispute filed yet',
      clTitle: 'Link check', clFailed: 'Could not check that link: {msg}',
      clKnown: 'Known marketplace', clUnknown: 'Unknown domain',
      clNoPrice: 'No price found on the page',
      linkHint: 'Or paste any product link — I will check the seller and the price from the page.',
      impTitle: 'Import cost (estimate)', impDuty: 'Import duty ({rate}%)',
      impVat: 'VAT / GST ({rate}%)',
      impFree: 'Below the {country} de minimis ({min}) — no import duty.',
      impNote: 'Estimate only. Exact duty depends on the product HS code.',
      impNoCountry: 'No import (domestic)',
      phChip: 'Check a suspicious message', phTitle: 'Phishing check',
      phLegit: 'Looks legitimate', phSuspicious: 'Suspicious', phLikely: 'Likely phishing',
      phEmpty: 'Paste the message you want checked.',
      phDomainOk: 'Links point to a real PayPal domain.',
      phDomainBad: 'Links point to a domain that is not PayPal: {domain}.',
      phNoLink: 'No link found in the message.',
      phNoPaypalLink: 'No link in the message points to PayPal.',
      phUrgency: 'Uses urgency language to pressure you (“{word}”).',
      phAsksSecret: 'Asks for a password, OTP code, or full card number — PayPal never does this by message.',
      phGeneric: 'Generic greeting (“{word}”) instead of your name — PayPal uses your name.',
      phMismatch: 'The text says PayPal but the link goes elsewhere.',
      phNote: 'Rule-based check + AI review. When in doubt, never click — open paypal.com yourself.',
      phPlaceholder: 'Paste the suspicious message…',
      cmpToggle: 'Compare products', cmpTitle: 'Compare products',
      cmpPick: 'Pick two products to compare.',
      cmpSelected: '{n}/2 selected', cmpCompareBtn: 'Compare', cmpClear: 'Clear',
      budTitle: 'Monthly budget', budSet: 'Set monthly budget (USD)',
      budSave: 'Save', budSpent: 'Spent this month: {spent} of {budget} ({pct}%)',
      budLeft: '{left} left this month.', budOver: 'Over budget by {over} this month.',
      budWarn: 'This purchase would take you over your monthly budget ({spent} of {budget} spent).',
      budNoBudget: 'No monthly budget set.',
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
      refundBtn: 'Refund (Sandbox)', refundConfirm: 'Konfirmasi refund?', refundTitle: 'Refund',
      refundSuccess: 'Refund {id} — {status}, {amount}.', refundFailed: 'Refund gagal: {msg}',
      refundAlready: 'Sudah di-refund.', orderStatusBtn: 'Cek status live',
      orderStatusTitle: 'Status order live (PayPal)',
      orderStatusFailed: 'Tidak bisa cek status order: {msg}',
      alreadyCapturedNote: 'Order ini sudah di-capture sebelumnya — menampilkan bukti yang tersimpan.',
      simBtn: 'Simulasikan sengketa', simTitle: 'Simulasi sengketa',
      simWinChance: 'Peluang menang: {n}%', simMissing: 'Bukti yang kurang: {list}',
      simFailed: 'Tidak bisa mensimulasikan sengketa: {msg}',
      simPreNote: 'Simulasi sebelum beli — gambaran kasusmu kalau beli sekarang.',
      evBtn: 'Unduh Paket Bukti',
      evFailed: 'Tidak bisa membuat paket bukti: {msg}',
      dlBtn: 'Tenggat', dlTitle: 'Tenggat',
      dlFailed: 'Tidak bisa memuat tenggat: {msg}',
      dlLeft: 'sisa {days} hari', dlOverdue: 'terlambat {days} hari',
      dlToday: 'Jatuh tempo hari ini', dlExpired: 'Kedaluwarsa',
      dlNoReturn: 'Tidak ada kebijakan retur', dlNoDispute: 'Belum ada sengketa',
      clTitle: 'Cek link', clFailed: 'Tidak bisa mengecek link itu: {msg}',
      clKnown: 'Marketplace dikenal', clUnknown: 'Domain tidak dikenal',
      clNoPrice: 'Tidak ada harga di halaman itu',
      linkHint: 'Atau tempel link produk apa pun — saya akan cek seller dan harganya dari halaman itu.',
      impTitle: 'Biaya impor (perkiraan)', impDuty: 'Bea masuk ({rate}%)',
      impVat: 'PPN / GST ({rate}%)',
      impFree: 'Di bawah batas bebas bea {country} ({min}) — tidak ada bea masuk.',
      impNote: 'Perkiraan saja. Bea pastinya tergantung kode HS barang.',
      impNoCountry: 'Tidak ada impor (domestik)',
      phChip: 'Cek pesan mencurigakan', phTitle: 'Cek phishing',
      phLegit: 'Terlihat asli', phSuspicious: 'Mencurigakan', phLikely: 'Kemungkinan phishing',
      phEmpty: 'Tempel pesan yang mau dicek.',
      phDomainOk: 'Link mengarah ke domain PayPal asli.',
      phDomainBad: 'Link mengarah ke domain yang bukan PayPal: {domain}.',
      phNoLink: 'Tidak ada link di pesan itu.',
      phNoPaypalLink: 'Tidak ada link di pesan itu yang mengarah ke PayPal.',
      phUrgency: 'Memakai bahasa mendesak untuk menekanmu (“{word}”).',
      phAsksSecret: 'Meminta password, kode OTP, atau nomor kartu lengkap — PayPal tidak pernah meminta itu lewat pesan.',
      phGeneric: 'Sapaan generik (“{word}”) bukan namamu — PayPal memakai namamu.',
      phMismatch: 'Teksnya bilang PayPal tapi link-nya ke tempat lain.',
      phNote: 'Pemeriksaan berbasis aturan + tinjauan AI. Kalau ragu, jangan klik — buka paypal.com sendiri.',
      phPlaceholder: 'Tempel pesan yang mencurigakan…',
      cmpToggle: 'Bandingkan produk', cmpTitle: 'Bandingkan produk',
      cmpPick: 'Pilih dua produk untuk dibandingkan.',
      cmpSelected: '{n}/2 dipilih', cmpCompareBtn: 'Bandingkan', cmpClear: 'Bersihkan',
      budTitle: 'Budget bulanan', budSet: 'Atur budget bulanan (USD)',
      budSave: 'Simpan', budSpent: 'Belanja bulan ini: {spent} dari {budget} ({pct}%)',
      budLeft: 'Sisa {left} bulan ini.', budOver: 'Melebihi budget {over} bulan ini.',
      budWarn: 'Pembelian ini akan melampaui budget bulananmu ({spent} dari {budget} sudah terpakai).',
      budNoBudget: 'Belum ada budget bulanan.',
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
      const res = await fetch(API_BASE + '/api/config');
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
    const res = await fetch(API_BASE + '/api/catalog');
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
      card.addEventListener('click', function () {
        if (compareMode) {
          var idx = compareList.findIndex(function (x) { return x.id === p.id; });
          if (idx >= 0) compareList.splice(idx, 1);
          else if (compareList.length < 2) compareList.push(p);
          card.classList.toggle('selected', compareList.some(function (x) { return x.id === p.id; }));
          updateCompareBar();
          return;
        }
        selectProduct(p);
      });
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
      '<button type="button" class="chip" id="phish-chip">' + t('phChip') + '</button>' +
      '<button type="button" class="chip" id="compare-toggle">' + t('cmpToggle') + '</button>' +
      '</div>' +
      '<p class="hint">Or pick any product below.</p>' +
      '<p class="hint">' + t('linkHint') + '</p>' +
      '<div id="compare-bar" class="card hidden"></div>' +
      '<div class="cards" id="catalog"></div>');
    renderCatalogInto($('catalog'), catalog.products);
    var chips = chatEl.querySelectorAll('.chip');
    for (var i = 0; i < chips.length; i++) {
      chips[i].addEventListener('click', function () {
        $('ask').value = this.getAttribute('data-q');
        sendAsk();
      });
    }
    $('phish-chip').addEventListener('click', function () {
      phishingMode = true;
      $('ask').placeholder = t('phPlaceholder');
      $('ask').focus();
    });
    $('compare-toggle').addEventListener('click', function () {
      compareMode = !compareMode;
      compareList = [];
      this.textContent = compareMode ? t('cmpToggle') + ' ✓' : t('cmpToggle');
      updateCompareBar();
    });
  }

  function updateCompareBar() {
    var bar = $('compare-bar');
    if (!bar) return;
    if (!compareMode) {
      bar.classList.add('hidden');
      return;
    }
    bar.classList.remove('hidden');
    bar.innerHTML = '<p><strong>' + t('cmpTitle') + '</strong> — ' + fmt(t('cmpSelected'), { n: compareList.length }) + ' · ' + t('cmpPick') + '</p>' +
      '<p><button id="compare-go" type="button"' + (compareList.length === 2 ? '' : ' disabled') + '>' + t('cmpCompareBtn') + '</button> ' +
      '<button id="compare-clear" type="button">' + t('cmpClear') + '</button></p>';
    bar.querySelector('#compare-go').addEventListener('click', renderCompare);
    bar.querySelector('#compare-clear').addEventListener('click', function () {
      compareList = [];
      updateCompareBar();
    });
  }

  async function renderCompare() {
    if (compareList.length !== 2) return;
    var rows = [];
    for (var i = 0; i < 2; i++) {
      var p = compareList[i];
      var seller = sellerOf(p);
      var rRes = await fetch(API_BASE + '/api/risk-score', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sellerId: seller.id, productId: p.id, lang }),
      });
      var risk = await rRes.json();
      var hRes = await fetch(API_BASE + '/api/hold-risk', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sellerId: seller.id, productId: p.id, lang }),
      });
      var hold = await hRes.json();
      var cRes = await fetch(API_BASE + '/api/total-cost', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ priceUSD: p.priceUSD, international: true, currencyConversion: true, lang }),
      });
      var cost = await cRes.json();
      rows.push({ product: p, seller: seller, risk: risk, hold: hold, cost: cost });
    }
    var cell = function (r, fn) { return '<td>' + fn(r) + '</td>'; };
    addBubble('agent',
      '<p><strong>' + t('cmpTitle') + '</strong></p>' +
      '<table>' +
      '<tr><th></th>' + rows.map(function (r) { return '<th>' + r.product.name + '</th>'; }).join('') + '</tr>' +
      '<tr><td>Price</td>' + rows.map(function (r) { return cell(r, function (x) { return money(x.product.priceUSD); }); }).join('') + '</tr>' +
      '<tr><td>' + t('riskScore') + '</td>' + rows.map(function (r) { return cell(r, function (x) { return x.risk.score + '/100 · ' + labelText(x.risk.label); }); }).join('') + '</tr>' +
      '<tr><td>' + t('holdTitle') + '</td>' + rows.map(function (r) { return cell(r, function (x) { return holdLabelText(x.hold.label) + ' · ' + x.hold.chance; }); }).join('') + '</tr>' +
      '<tr><td>' + t('honestTotal') + '</td>' + rows.map(function (r) { return cell(r, function (x) { return money(x.cost.total); }); }).join('') + '</tr>' +
      '<tr><td>Seller</td>' + rows.map(function (r) { return cell(r, function (x) { return x.seller.name; }); }).join('') + '</tr>' +
      '<tr><td>Tracking / Returns</td>' + rows.map(function (r) { return cell(r, function (x) { return (x.seller.hasTracking ? '✓' : '✗') + ' / ' + (x.seller.hasReturnPolicy ? '✓' : '✗'); }); }).join('') + '</tr>' +
      '</table>');
    compareList = [];
    updateCompareBar();
    scrollChat();
  }

  async function sendAsk() {
    var q = $('ask').value.trim();
    if (!q || !catalog) return;
    $('ask').value = '';
    lang = detectLang(q);
    userBubble(q);
    clearSteps();
    var typing = showTyping();
    // Phishing mode: the input holds a suspicious message, not a search.
    if (phishingMode) {
      phishingMode = false;
      $('ask').placeholder = 'Ask ShopPal…';
      var phRes = await fetch(API_BASE + '/api/phishing-check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: q, lang }),
      });
      var ph = await phRes.json();
      hideTyping(typing);
      if (!phRes.ok) {
        addBubble('agent', '<p>' + (ph.error || t('phEmpty')) + '</p>');
        return;
      }
      var phZone = ph.score >= 80 ? 'safe' : ph.score >= 50 ? 'caution' : 'risky';
      var phBody = '<p><strong>' + t('phTitle') + '</strong> — <span class="score score-' + phZone + '">' + ph.score + '/100 · ' + ph.label + '</span></p>';
      if (ph.signals && ph.signals.length) {
        phBody += '<ul>' + ph.signals.map(function (s) {
          return '<li>' + (s.points > 0 ? '+' : '') + s.points + ' — ' + s.note + '</li>';
        }).join('') + '</ul>';
      }
      if (ph.aiReview) phBody += '<p class="hint">' + ph.aiReview + '</p>';
      if (ph.note) phBody += '<p class="hint">' + ph.note + '</p>';
      addBubble('agent', phBody);
      return;
    }
    // A pasted product link goes to the link checker, not the catalog.
    if (/^https?:\/\/\S+/i.test(q)) {
      var clRes = await fetch(API_BASE + '/api/check-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: q, lang }),
      });
      var cl = await clRes.json();
      hideTyping(typing);
      if (!clRes.ok) {
        addBubble('agent', '<p>' + fmt(t('clFailed'), { msg: cl.error || clRes.status }) + '</p>');
        return;
      }
      var clZone = (cl.label || 'Caution').toLowerCase();
      var clBody = '<p><strong>' + t('clTitle') + '</strong> — ' + (cl.domain || '') +
        ' · <span class="score score-' + clZone + '">' + (cl.score !== undefined ? cl.score + '/100 · ' : '') + labelText(cl.label) + '</span></p>';
      if (cl.title) clBody += '<p><strong>' + escapeHtml(cl.title) + '</strong>' +
        (cl.priceUSD ? ' — ' + money(cl.priceUSD) : ' · ' + t('clNoPrice')) + '</p>';
      if (cl.image) clBody += '<p><img src="' + cl.image + '" alt="" style="max-width:220px;border-radius:8px"></p>';
      if (cl.reasons && cl.reasons.length) {
        clBody += '<ul>' + cl.reasons.map((r) => '<li>' + r + '</li>').join('') + '</ul>';
      }
      if (cl.totalCost) {
        clBody += '<p><strong>' + t('honestTotal') + '</strong> — ' + money(cl.totalCost.total) + '</p>';
      }
      if (cl.note) clBody += '<p class="hint">' + cl.note + '</p>';
      addBubble('agent', clBody);
      return;
    }
    var askParams = new URLSearchParams({ q, lang });
    if (lastResults && lastResults.length) {
      askParams.set('context', lastResults.map((p) => p.id).join(','));
    }
    var res = await fetch(API_BASE + '/api/ask?' + askParams.toString());
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
      var mpRes = await fetch(API_BASE + '/api/marketplace/search?' + mpParams.toString());
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

    var riskRes = await fetch(API_BASE + '/api/risk-score', {
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

  // Render a dispute-simulation result (shared by the pre-purchase button
  // in the risk bubble and the vault button). Win chance is rules-only;
  // the AI text (when present) only rewrites the explanation.
  function renderSimHtml(d) {
    var html = '<p><strong>' + t('simTitle') + '</strong> — ' + fmt(t('simWinChance'), { n: d.winChance }) +
      ' · <span class="score score-' + (d.winChance >= 70 ? 'safe' : d.winChance >= 40 ? 'caution' : 'risky') + '">' + d.label + '</span></p>';
    if (d.note) html += '<p class="hint">' + d.note + '</p>';
    if (d.components && d.components.length) {
      html += '<ul>' + d.components.map((c) =>
        '<li>' + (c.points > 0 ? '+' : '') + c.points + ' — ' + c.note + '</li>').join('') + '</ul>';
    }
    if (d.missingProof && d.missingProof.length) {
      html += '<p>' + fmt(t('simMissing'), { list: d.missingProof.join(', ') }) + '</p>';
    }
    if (d.recommendation) html += '<p><strong>' + t('recommendation') + '</strong> ' + d.recommendation + '</p>';
    if (d.aiExplanation) html += '<p class="hint">' + d.aiExplanation + '</p>';
    return html;
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
    var isDemoProduct = selected.product && selected.product.id && selected.product.id.indexOf('ebay:') !== 0;
    var bubble = addBubble('agent',
      '<p><strong>' + selected.seller.name + '</strong> — ' + t('riskScore') + ' <span class="score score-' + zone + '">' + r.score + '/100 · ' + labelText(r.label) + '</span></p>' +
      '<ul>' + r.reasons.map((reason) => '<li>' + reason + '</li>').join('') + '</ul>' +
      '<p><strong>' + t('recommendation') + '</strong> ' + r.recommendation + '</p>' +
      extra +
      '<p class="hint">Profile ' + r.components.profile + ' · History ' + r.components.history +
      ' · Price ' + r.components.price + ' · Tracking ' + r.components.tracking +
      (r.aiAvailable ? '' : ' · ' + (r.aiNote || 'AI explanation unavailable.')) + '</p>' +
      (isDemoProduct ? '<p><button id="pre-sim-btn" type="button">' + t('simBtn') + '</button></p>' +
      '<div id="pre-sim" class="card hidden"></div>' : ''),
      'risk');
    if (isDemoProduct) {
      bubble.querySelector('#pre-sim-btn').addEventListener('click', async function () {
        var box = $('pre-sim');
        if (!box) return;
        box.classList.remove('hidden');
        box.textContent = t('simTitle') + '…';
        var res = await fetch(API_BASE + '/api/dispute/simulate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sellerId: selected.seller.id, productId: selected.product.id, lang }),
        });
        var d = await res.json();
        if (!res.ok) {
          box.textContent = fmt(t('simFailed'), { msg: d.error || res.status });
          return;
        }
        box.innerHTML = renderSimHtml(d);
        scrollChat();
      });
    }
  }

  async function showHold() {
    // Marketplace listings already carry their hold estimate from search.
    var h = selected.holdRisk || null;
    if (!h) {
      var res = await fetch(API_BASE + '/api/hold-risk', {
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
    var res = await fetch(API_BASE + '/api/total-cost', {
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
    var bubble = addBubble('agent',
      '<p><strong>' + t('honestTotal') + '</strong></p>' +
      '<table>' +
      '<tr><td>' + t('itemPrice') + '</td><td>' + money(c.itemPrice) + '</td></tr>' +
      '<tr><td>' + t('paypalFee') + '</td><td>' + money(c.paypalFee) + '</td></tr>' +
      '<tr><td>' + t('intlFee') + '</td><td>' + money(c.internationalFee) + '</td></tr>' +
      '<tr><td>' + t('convSpread') + '</td><td>' + money(c.conversionSpread) + '</td></tr>' +
      '<tr><td><strong>' + t('totalEst') + '</strong></td><td><strong>' + money(c.total) + '</strong></td></tr>' +
      '</table>' +
      '<p><label>' + t('impTitle') + ': <select id="import-country">' +
      '<option value="">' + t('impNoCountry') + '</option>' +
      '<option value="ID">Indonesia</option>' +
      '<option value="US">United States</option>' +
      '<option value="EU">European Union</option>' +
      '<option value="UK">United Kingdom</option>' +
      '<option value="SG">Singapore</option>' +
      '</select></label></p>' +
      '<div id="import-cost"></div>' +
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
    // Import cost for the selected destination country (duty + VAT/GST).
    bubble.querySelector('#import-country').addEventListener('change', async function () {
      var box = $('import-cost');
      if (!box) return;
      var country = this.value;
      if (!country) {
        box.innerHTML = '';
        return;
      }
      box.textContent = t('impTitle') + '…';
      var res = await fetch(API_BASE + '/api/import-cost', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ priceUSD: selected.product.priceUSD, country: country, lang }),
      });
      var d = await res.json();
      if (!res.ok) {
        box.textContent = d.error || t('impNotFound');
        return;
      }
      box.innerHTML = '<table>' +
        '<tr><td>' + fmt(t('impDuty'), { rate: d.dutyRate }) + '</td><td>' + money(d.duty) + '</td></tr>' +
        '<tr><td>' + fmt(t('impVat'), { rate: d.vatRate }) + ' (' + d.vatLabel + ')</td><td>' + money(d.vat) + '</td></tr>' +
        '<tr><td><strong>' + t('impTitle') + '</strong></td><td><strong>' + money(d.total) + '</strong></td></tr>' +
        '<tr><td><strong>' + t('totalEst') + ' + import</strong></td><td><strong>' + money(c.total + d.total) + '</strong></td></tr>' +
        '</table>' +
        '<p class="hint">' + (d.notes || []).join(' ') + '</p>';
      scrollChat();
    });
  }

  function showCheckout() {
    var simNote = selected.marketplace
      ? '<p>' + t('simNote') + '</p>'
      : '';
    var bubble = addBubble('agent',
      '<p><strong>' + t('readyToPay') + '</strong> ' + t('neverPay') + '</p>' +
      simNote +
      '<div id="budget-warn"></div>' +
      '<p><label><input id="approve" type="checkbox"> ' + t('approveLabel') + '</label></p>' +
      '<button id="checkout-btn" type="button" disabled>' + t('payButton') + '</button>' +
      '<p id="checkout-status"></p>' +
      '<p class="hint">' + t('checkoutHint') + '</p>',
      'checkout');
    // Monthly budget warning (background — never blocks the checkout UI).
    var budget = getBudget();
    if (budget) {
      fetch(API_BASE + '/api/vault').then(function (r) { return r.json(); }).then(function (vData) {
        var warn = $('budget-warn');
        if (!warn) return;
        var spent = monthSpend(vData.entries || []);
        var total = selected && selected.cost ? selected.cost.total : (selected ? selected.product.priceUSD : 0);
        if (spent + total > budget) {
          warn.innerHTML = '<p><strong>' + fmt(t('budWarn'), { spent: money(spent), budget: money(budget) }) + '</strong></p>';
        }
      }).catch(function () { /* budget warning is a bonus */ });
    }
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
    var res = await fetch(API_BASE + '/api/paypal/create-order', {
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
    var res = await fetch(API_BASE + '/api/vault');
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
      var sres = await fetch(API_BASE + '/api/subscriptions');
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
    var budget = getBudget();
    var spent = monthSpend(data.entries || []);
    var budHtml = '<div class="card"><p><strong>' + t('budTitle') + '</strong></p>' +
      '<p><input id="budget-input" type="number" min="1" step="1" placeholder="' + t('budSet') + '" value="' + (budget || '') + '" style="width:130px"> ' +
      '<button id="budget-save" type="button">' + t('budSave') + '</button></p>' +
      '<p id="budget-status">' + (budget
        ? fmt(t('budSpent'), { spent: money(spent), budget: money(budget), pct: Math.round(spent / budget * 100) }) + ' ' +
          (spent > budget ? fmt(t('budOver'), { over: money(spent - budget) }) : fmt(t('budLeft'), { left: money(Math.round((budget - spent) * 100) / 100) }))
        : t('budNoBudget')) + '</p></div>';
    var bubble = addBubble('agent',
      '<p><strong>Proof Vault</strong></p>' + body +
      '<div class="card">' + subs + '</div>' +
      budHtml +
      '<p><button id="vault-refresh" type="button">' + t('refreshVault') + '</button> ' +
      '<button id="dispute-btn" type="button"' + (data.entries && data.entries.length ? '' : ' disabled') + '>' + t('disputeBtn') + '</button> ' +
      '<button id="sim-btn" type="button"' + (data.entries && data.entries.length ? '' : ' disabled') + '>' + t('simBtn') + '</button> ' +
      '<button id="evidence-btn" type="button"' + (data.entries && data.entries.length ? '' : ' disabled') + '>' + t('evBtn') + '</button> ' +
      '<button id="deadlines-btn" type="button"' + (data.entries && data.entries.length ? '' : ' disabled') + '>' + t('dlBtn') + '</button> ' +
      '<button id="refund-btn" type="button"' + (data.entries && data.entries.length ? '' : ' disabled') + '>' + t('refundBtn') + '</button> ' +
      '<button id="order-status-btn" type="button"' + (data.entries && data.entries.length ? '' : ' disabled') + '>' + t('orderStatusBtn') + '</button></p>' +
      '<div id="dispute-draft" class="card hidden"></div>' +
      '<div id="vault-tools" class="card hidden"></div>' +
      '<div id="paypal-actions" class="card hidden"></div>',
      'vault');
    bubble.querySelector('#vault-refresh').addEventListener('click', function () { showVault(); });
    // Monthly budget (stored in this browser).
    bubble.querySelector('#budget-save').addEventListener('click', function () {
      var v = Number(bubble.querySelector('#budget-input').value);
      if (v > 0) setBudget(v);
      showVault();
    });
    // Dispute simulation for the latest vault entry (post-purchase case).
    bubble.querySelector('#sim-btn').addEventListener('click', async function () {
      if (!lastVaultId) return;
      var box = $('vault-tools');
      if (!box) return;
      box.classList.remove('hidden');
      box.textContent = t('simTitle') + '…';
      var res = await fetch(API_BASE + '/api/dispute/simulate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vaultId: lastVaultId, lang }),
      });
      var d = await res.json();
      if (!res.ok) {
        box.textContent = fmt(t('simFailed'), { msg: d.error || res.status });
        return;
      }
      box.innerHTML = renderSimHtml(d);
      scrollChat();
    });
    // Evidence Pack: download a printable proof page (order, capture,
    // risk, timeline) as a file the buyer can attach to a PayPal dispute.
    bubble.querySelector('#evidence-btn').addEventListener('click', async function () {
      if (!lastVaultId) return;
      var res = await fetch(API_BASE + '/api/evidence?vaultId=' + encodeURIComponent(lastVaultId) + '&lang=' + lang);
      var d = await res.json();
      if (!res.ok) {
        var box = $('vault-tools');
        if (box) {
          box.classList.remove('hidden');
          box.textContent = fmt(t('evFailed'), { msg: d.error || res.status });
        }
        return;
      }
      var blob = new Blob([d.html], { type: 'text/html' });
      var url = URL.createObjectURL(blob);
      window.open(url, '_blank', 'noopener');
      setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
    });
    // Deadline Tracker: 180-day filing + 20-day escalation + 30-day return.
    bubble.querySelector('#deadlines-btn').addEventListener('click', async function () {
      if (!lastVaultId) return;
      var box = $('vault-tools');
      if (!box) return;
      box.classList.remove('hidden');
      box.textContent = t('dlTitle') + '…';
      var res = await fetch(API_BASE + '/api/deadlines?vaultId=' + encodeURIComponent(lastVaultId) + '&lang=' + lang);
      var d = await res.json();
      if (!res.ok) {
        box.textContent = fmt(t('dlFailed'), { msg: d.error || res.status });
        return;
      }
      box.innerHTML = '<p><strong>' + t('dlTitle') + '</strong></p>' +
        '<ul>' + (d.deadlines || []).map(function (dl) {
          var when;
          if (dl.status === 'none') when = dl.note || t('dlNoReturn');
          else if (dl.status === 'expired') when = t('dlExpired') + ' — ' + fmt(t('dlOverdue'), { days: -dl.daysLeft });
          else if (dl.daysLeft === 0) when = t('dlToday');
          else when = fmt(t('dlLeft'), { days: dl.daysLeft });
          return '<li><strong>' + dl.label + '</strong> — ' + when +
            (dl.dueDate ? ' (' + dl.dueDate.slice(0, 10) + ')' : '') + '</li>';
        }).join('') + '</ul>';
      scrollChat();
    });
    // Refund the latest vault entry (full amount, PayPal Sandbox).
    // Two clicks: the first arms the button, the second executes it.
    var refundBtn = bubble.querySelector('#refund-btn');
    refundBtn.addEventListener('click', async function () {
      if (!lastVaultId) return;
      if (refundBtn.getAttribute('data-armed') !== '1') {
        refundBtn.setAttribute('data-armed', '1');
        refundBtn.textContent = t('refundConfirm');
        return;
      }
      refundBtn.setAttribute('data-armed', '0');
      refundBtn.textContent = t('refundBtn');
      var box = $('paypal-actions');
      if (!box) return;
      box.classList.remove('hidden');
      box.textContent = t('refundTitle') + '…';
      var res = await fetch(API_BASE + '/api/paypal/refund', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vaultId: lastVaultId, lang }),
      });
      var d = await res.json();
      if (!res.ok) {
        box.textContent = fmt(t('refundFailed'), { msg: d.error || res.status });
        return;
      }
      box.innerHTML = '<p><strong>' + t('refundTitle') + '</strong> — ' +
        fmt(t('refundSuccess'), { id: d.refundId || '—', status: d.status || '—', amount: money(d.amount) }) + '</p>';
      await showVault();
      scrollChat();
    });
    // Live order status, re-verified with PayPal (not just the saved snapshot).
    bubble.querySelector('#order-status-btn').addEventListener('click', async function () {
      if (!lastVaultId) return;
      var box = $('paypal-actions');
      if (!box) return;
      box.classList.remove('hidden');
      box.textContent = t('orderStatusTitle') + '…';
      var res = await fetch(API_BASE + '/api/paypal/order?orderId=' + encodeURIComponent(lastVaultId));
      var d = await res.json();
      if (!res.ok) {
        box.textContent = fmt(t('orderStatusFailed'), { msg: d.error || res.status });
        return;
      }
      box.innerHTML = '<p><strong>' + t('orderStatusTitle') + '</strong></p>' +
        '<p>Order ' + (d.orderId || '—') + ' — ' + (d.orderStatus || '—') +
        ' · Capture ' + (d.captureId || '—') + ' — ' + (d.captureStatus || '—') +
        ' · ' + money(d.amount) + '</p>';
      scrollChat();
    });
    bubble.querySelector('#dispute-btn').addEventListener('click', async function () {
      if (!lastVaultId) return;
      var res = await fetch(API_BASE + '/api/dispute/draft', {
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
      var res = await fetch(API_BASE + '/api/paypal/capture-order', {
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
        (data.alreadyCaptured ? '<p>' + t('alreadyCapturedNote') + '</p>' : '') +
        '<p>' + t('successProof') + '</p>',
        'success');
      await showVault();
      window.history.replaceState({}, '', window.location.pathname);
    }
  });
})();
