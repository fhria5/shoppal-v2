// ShopPal v2: 7-step demo flow, chat UI. No secrets here; the PayPal
// client ID comes from /api/config at runtime.
(function () {
  'use strict';

  // Live-server demo: the API is the Cloudflare Worker, not this origin.
  var API_BASE = 'https://shoppal-v2.fahriannor07.workers.dev';

  var catalog = null;
  var selected = null; // { product, seller, risk, cost }
  var lastResults = null; // products the last Ask reply showed, follow-ups ("yang termurah") refer to these
  var lastSplit = null; // the active split session {productId, share, initiatorShare, total, friends}, if any
  var sending = false; // true while a request is in flight (replaces disabling the input, so it keeps focus)
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
  // otherwise (English is the demo's default, Devpost requires English
  // materials). The greeting stays English (it renders before any input).
  // Risk/hold/cost reasons come from the server already translated; this
  // dictionary covers the UI chrome around them.
  var lang = 'en';
  var LANG_KEY = 'shoppal-lang';
  var langManual = 'en';
  try {
    var savedLang = localStorage.getItem(LANG_KEY);
    if (savedLang === 'auto') { langManual = null; }
    else if (savedLang === 'id' || savedLang === 'en') { lang = savedLang; langManual = savedLang; }
  } catch (e) { /* storage unavailable - English */ }
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
      holdFailed: 'Could not load the hold estimate: {msg}',
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
      simNote: 'Sandbox simulation: this creates a PayPal Sandbox order for the listing total. It does <strong>not</strong> buy the eBay item, it proves the total and saves the proof.',
      creatingOrder: 'Creating PayPal order…',
      orderFailed: 'Could not create the PayPal order: {msg}',
      orderCreated: 'Order created: <strong>{id}</strong>, total {total}. Approve it in PayPal Sandbox, then you will be sent back here to capture it.',
      approveLink: 'Approve this order in PayPal Sandbox (opens in a new tab)',
      approveHint: 'Use a PayPal sandbox buyer account to approve. No real money is involved.',
      agentSteps: 'What the agent did',
      agentApprove: 'Approve and pay with PayPal', agentPendingApproval: 'Pending Human Approval (Guardrail Triggered)', agentReject: 'Reject',
      calloutWhy: 'This order is above the $20.00 auto-approve limit, so the agent stopped here for your approval.',
      toastCopyLink: 'Payment link for {name} copied', toastCopyJson: 'Dispute JSON copied', toastApproved: 'Order approved', toastRejected: 'Order rejected - left unpaid',
      openPayPal: 'Open PayPal Sandbox', copyLink: 'Copy link', copied: '✓ Copied!', copyJson: 'Copy JSON',
      loadingAgent: 'Agent is working…', trackingAdded: 'Tracking added',
      agentFailed: 'The agent could not finish that. Please try again.',
      vaultEmpty: 'No Proof Vault entries yet. Complete a successful checkout to save proof automatically.',
      subsTitle: 'Subscription Watcher',
      subsEmpty: 'No recurring purchases detected yet. Buy the same product twice and it shows up here with the total you have spent on it.',
      subsFound: 'recurring purchases found',
      subsLine: '{name}, bought {n}×, total spent {total}, last purchase {date}',
      subsUnavailable: 'Subscription Watcher unavailable.',
      refreshVault: 'Refresh Vault', disputeBtn: 'Draft a dispute',
      vaultShow: 'Show vault tools ▾', vaultHide: 'Hide vault tools ▴',
      disputeTitle: 'Simulated dispute draft', disputeReadiness: 'readiness {n}/100',
      disputeMissing: 'Still missing: {list}', disputeNone: 'No proof missing.',
      disputeFailed: 'Could not generate a dispute draft.',
      refundBtn: 'Refund (Sandbox)', refundConfirm: 'Confirm refund?', refundTitle: 'Refund',
      refundSuccess: 'Refund {id}, {status}, {amount}.', refundFailed: 'Refund failed: {msg}',
      refundAlready: 'Already refunded.', orderStatusBtn: 'Check live status',
      orderStatusTitle: 'Live order status (PayPal)',
      orderStatusFailed: 'Could not check the order status: {msg}',
      alreadyCapturedNote: 'This order was already captured, showing the saved proof.',
      simBtn: 'Dispute win chance', simTitle: 'Dispute simulation', simPayloadTitle: 'Dispute payload (PayPal Disputes API format, simulated)',
      simWinChance: 'Win chance: {n}%', simMissing: 'Missing proof: {list}',
      simFailed: 'Could not simulate the dispute: {msg}',
      simPreNote: 'Pre-purchase simulation, what your case would look like if you buy now.',
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
      linkHint: 'Or paste any product link, I will check the seller and the price from the page.',
      impTitle: 'Import cost (estimate)', impDuty: 'Import duty ({rate}%)',
      impVat: 'VAT / GST ({rate}%)',
      impFree: 'Below the {country} de minimis ({min}), no import duty.',
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
      phAsksSecret: 'Asks for a password, OTP code, or full card number, PayPal never does this by message.',
      phGeneric: 'Generic greeting (“{word}”) instead of your name, PayPal uses your name.',
      phMismatch: 'The text says PayPal but the link goes elsewhere.',
      phNote: 'Rule-based check + AI review. When in doubt, never click, open paypal.com yourself.',
      phPlaceholder: 'Paste the suspicious message…',
      cmpToggle: 'Compare products', cmpTitle: 'Compare products',
      cmpSafer: 'Safer pick', cmpCheaper: 'Cheapest',
      cmpVerdictBoth: 'Safer and cheapest: {safer} ({score}/100).',
      cmpVerdictSplit: 'Safer: {safer} ({score}/100). Cheapest: {cheaper} ({price}, saves {saves}).',
      cmpPick: 'Pick two products to compare.',
      cmpSelected: '{n}/2 selected', cmpCompareBtn: 'Compare', cmpClear: 'Clear',
      budTitle: 'Monthly budget', budSet: 'Set monthly budget (USD)',
      budSave: 'Save', budSpent: 'Spent this month: {spent} of {budget} ({pct}%)',
      budLeft: '{left} left this month.', budOver: 'Over budget by {over} this month.',
      budWarn: 'This purchase would take you over your monthly budget ({spent} of {budget} spent).',
      budNoBudget: 'No monthly budget set.',
      grTitle: 'Smart Guardrails', grIntro: 'The agent auto-pays only under your limit. Above it, it asks you first, so a hallucination can never buy something expensive.',
      grLimit: 'Auto-approve up to (USD)', grSave: 'Save guardrails', grSaved: 'Guardrails saved.', grHint: 'Orders above the limit wait for your approval first. Change it anytime in Settings.',
      grCatCap: 'Monthly cap for {cat} (USD, empty = no cap)',
      grNeedApproval: 'Needs your approval', grAboveLimit: 'This purchase ({total}) is above your auto-approve limit ({limit}).',
      grCatOver: 'This would take {cat} over its monthly cap ({spent} of {cap} spent).',
      grApprove: 'Approve and pay', grReject: 'Reject this purchase',
      grApproved: 'Approved, capturing payment...', grRejected: 'Purchase rejected. The PayPal order was not captured and will expire.',
      grAutoOk: 'Under your auto-approve limit, capturing...',
      setTitle: 'Settings', setClose: 'Close settings', setOpen: 'Open settings',
      setLang: 'Language', setLangAuto: 'Auto (follows your message)', setLangHint: 'The agent answers in this language. Buttons and labels switch too.',
      setData: 'Chat data', setClearChat: 'Clear chat history', setClearHint: 'Removes the conversation from this browser. Your Proof Vault stays saved.',
      setCleared: 'Chat history cleared.', setGrSummary: 'Guardrail: auto-approve up to {limit}.', budSaved: 'Budget saved.',
      askPh: 'Ask ShopPal…', quickDemo: 'Demo:',
      dwTitle: 'Delivery Watch', dwIntro: 'The agent watches every delivery. If a parcel stalls for 7 days or misses its estimate, it prepares a dispute draft before your 180-day filing window shrinks.',
      dwAddTracking: 'Add tracking', dwCheck: 'Check delivery', dwNoTracker: 'No tracking yet for this order.',
      dwStatus: 'Delivery: {status}', dwOverdue: 'Overdue {n} days: no delivery update. A dispute draft is ready below.',
      dwOnTime: 'On track, {n} days since purchase.', dwDraftReady: 'Dispute draft prepared automatically.',
      dwNoOrders: 'No orders to watch yet.',
      fxTitle: 'Pay in local currency or USD?', fxNote: 'PayPal adds about 3-4% on currency conversion. Live mid-market rate below, PayPal total includes the markup.',
      fxPaypalTotal: 'PayPal total', fxMidRate: 'Mid-market rate', fxCheaper: 'Cheapest: pay in {cur}.',
      fxUnavailable: 'Live rate unavailable, using a stored rate.',
      exTitle: 'Spending dashboard', exTotal: 'Total spent', exThisMonth: 'this month', exEmpty: 'No spending recorded yet.',
      pwTitle: 'Price Watch', pwIntro: 'Tell the agent a target price. It watches the price and buys the moment it drops to your target. Demo feed: the catalog price is simulated, labelled as such.',
      pwTarget: 'Buy if the price drops to (USD)', pwWatch: 'Watch this price', pwWatching: 'Watching',
      pwCurrent: 'Current price', pwTargetPrice: 'Target', pwCheck: 'Check price now',
      pwTriggered: 'Price hit! Buy now at {price}.', pwBuyNow: 'Buy now', pwNoWatches: 'No price watches yet.',
      pwSimNote: 'Simulated price feed for the demo catalog, not a live market price.',
      sbTitle: 'Split the bill', sbIntro: 'Buy a gift together and split it. The agent works out each share and writes the message to send. Collecting the money happens in the PayPal app (request money); the Invoicing and Payouts APIs are not enabled for this sandbox app.',
      sbFriends: 'Friends (name, one per line)', sbSplit: 'Split it', sbShare: "Each person's share", sbMessage: 'Message to send', sbNoFriends: 'Add at least one friend to split with.',
      splNote: 'Each friend gets their own PayPal Sandbox payment link for their share. You pay your own share through the normal checkout.', splLinks: 'Payment links', splMakeLinks: 'Make payment links', splPayLink: 'Pay link', splTotal: 'Total', splInitiator: 'Your share',
      hrcTitle: 'Hold release checklist', hrcBtn: 'How to release this hold faster',
      hrcIntro: 'PayPal holds new or risky sellers’ money for up to 21 days. Each step below can release it sooner, tick what is already done and see the estimated release.',
      hrcEstimated: 'Estimated release: {n} days', hrcCurrent: 'Current hold: {n} days',
      hrcDone: 'Done', hrcTodo: 'To do', hrcSaves: 'saves up to {n} days',
      hrcPrevents: 'prevents future holds',
      hrcNote: 'PayPal’s published hold rules (new-seller and risk holds, up to 21 days). Estimates, not a guarantee, PayPal decides each case.',
      hrcNotFound: 'Pick a product first to see its hold checklist.',
      mpHeader: 'Real listings · eBay', mpNone: 'No eBay listings found for that search.',
      checkoutCancelled: 'Checkout was cancelled in PayPal. No payment was made.',
      approvedCapturing: 'PayPal approved order {id}, capturing…',
      captureFailed: 'Capture failed: {msg}',
      successTitle: 'Success, payment captured.',
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
      holdFailed: 'Tidak bisa memuat perkiraan hold: {msg}',
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
      simNote: 'Simulasi sandbox: ini membuat order PayPal Sandbox sebesar total listing. Ini <strong>tidak</strong> membeli barang eBay, hanya membuktikan total dan menyimpan bukti.',
      creatingOrder: 'Membuat order PayPal…',
      orderFailed: 'Tidak bisa membuat order PayPal: {msg}',
      orderCreated: 'Order dibuat: <strong>{id}</strong>, total {total}. Setujui di PayPal Sandbox, lalu kamu akan dikembalikan ke sini untuk capture.',
      approveLink: 'Setujui order ini di PayPal Sandbox (terbuka di tab baru)',
      approveHint: 'Pakai akun buyer sandbox PayPal untuk menyetujui. Tidak ada uang asli yang terlibat.',
      agentSteps: 'Yang agen lakukan',
      agentApprove: 'Setujui dan bayar dengan PayPal', agentPendingApproval: 'Pending Human Approval (Guardrail Triggered)', agentReject: 'Tolak',
      calloutWhy: 'Pesanan ini di atas batas setujui otomatis $20.00, jadi agen berhenti di sini menunggu persetujuanmu.',
      toastCopyLink: 'Link pembayaran {name} berhasil disalin', toastCopyJson: 'JSON sengketa disalin', toastApproved: 'Order disetujui', toastRejected: 'Order ditolak - dibiarkan belum dibayar',
      openPayPal: 'Buka PayPal Sandbox', copyLink: 'Salin link', copied: '✓ Tersalin!', copyJson: 'Salin JSON',
      loadingAgent: 'Agen sedang bekerja…', trackingAdded: 'Resi ditambahkan',
      agentFailed: 'Agen tidak bisa menyelesaikan itu. Coba lagi.',
      vaultEmpty: 'Belum ada entri Proof Vault. Selesaikan checkout yang berhasil untuk menyimpan bukti otomatis.',
      subsTitle: 'Pemantau Langganan',
      subsEmpty: 'Belum ada pembelian berulang. Beli produk yang sama dua kali dan akan muncul di sini beserta total yang sudah kamu belanjakan.',
      subsFound: 'pembelian berulang ditemukan',
      subsLine: '{name}, dibeli {n}×, total belanja {total}, pembelian terakhir {date}',
      subsUnavailable: 'Pemantau Langganan tidak tersedia.',
      refreshVault: 'Muat Ulang Vault', disputeBtn: 'Buat draf sengketa',
      vaultShow: 'Tampilkan alat vault ▾', vaultHide: 'Sembunyikan alat vault ▴',
      disputeTitle: 'Draf sengketa simulasi', disputeReadiness: 'kesiapan {n}/100',
      disputeMissing: 'Masih kurang: {list}', disputeNone: 'Tidak ada bukti yang kurang.',
      disputeFailed: 'Tidak bisa membuat draf sengketa.',
      refundBtn: 'Refund (Sandbox)', refundConfirm: 'Konfirmasi refund?', refundTitle: 'Refund',
      refundSuccess: 'Refund {id}, {status}, {amount}.', refundFailed: 'Refund gagal: {msg}',
      refundAlready: 'Sudah di-refund.', orderStatusBtn: 'Cek status live',
      orderStatusTitle: 'Status order live (PayPal)',
      orderStatusFailed: 'Tidak bisa cek status order: {msg}',
      alreadyCapturedNote: 'Order ini sudah di-capture sebelumnya, menampilkan bukti yang tersimpan.',
      simBtn: 'Peluang menang sengketa', simTitle: 'Simulasi sengketa', simPayloadTitle: 'Payload sengketa (format PayPal Disputes API, simulasi)',
      simWinChance: 'Peluang menang: {n}%', simMissing: 'Bukti yang kurang: {list}',
      simFailed: 'Tidak bisa mensimulasikan sengketa: {msg}',
      simPreNote: 'Simulasi sebelum beli, gambaran kasusmu kalau beli sekarang.',
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
      linkHint: 'Atau tempel link produk apa pun, saya akan cek seller dan harganya dari halaman itu.',
      impTitle: 'Biaya impor (perkiraan)', impDuty: 'Bea masuk ({rate}%)',
      impVat: 'PPN / GST ({rate}%)',
      impFree: 'Di bawah batas bebas bea {country} ({min}), tidak ada bea masuk.',
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
      phAsksSecret: 'Meminta password, kode OTP, atau nomor kartu lengkap, PayPal tidak pernah meminta itu lewat pesan.',
      phGeneric: 'Sapaan generik (“{word}”) bukan namamu, PayPal memakai namamu.',
      phMismatch: 'Teksnya bilang PayPal tapi link-nya ke tempat lain.',
      phNote: 'Pemeriksaan berbasis aturan + tinjauan AI. Kalau ragu, jangan klik, buka paypal.com sendiri.',
      phPlaceholder: 'Tempel pesan yang mencurigakan…',
      cmpToggle: 'Bandingkan produk', cmpTitle: 'Bandingkan produk',
      cmpSafer: 'Paling aman', cmpCheaper: 'Termurah',
      cmpVerdictBoth: 'Paling aman dan termurah: {safer} ({score}/100).',
      cmpVerdictSplit: 'Paling aman: {safer} ({score}/100). Termurah: {cheaper} ({price}, hemat {saves}).',
      cmpPick: 'Pilih dua produk untuk dibandingkan.',
      cmpSelected: '{n}/2 dipilih', cmpCompareBtn: 'Bandingkan', cmpClear: 'Bersihkan',
      budTitle: 'Budget bulanan', budSet: 'Atur budget bulanan (USD)',
      budSave: 'Simpan', budSpent: 'Belanja bulan ini: {spent} dari {budget} ({pct}%)',
      budLeft: 'Sisa {left} bulan ini.', budOver: 'Melebihi budget {over} bulan ini.',
      budWarn: 'Pembelian ini akan melampaui budget bulananmu ({spent} dari {budget} sudah terpakai).',
      budNoBudget: 'Belum ada budget bulanan.',
      grTitle: 'Smart Guardrails', grIntro: 'Agen hanya bayar otomatis di bawah batasmu. Di atas itu, ia bertanya dulu, jadi halusinasi tidak bisa membeli barang mahal.',
      grLimit: 'Setujui otomatis sampai (USD)', grSave: 'Simpan guardrails', grSaved: 'Guardrails tersimpan.', grHint: 'Pesanan di atas batas menunggu persetujuanmu dulu. Ubah kapan saja di Pengaturan.',
      grCatCap: 'Batas bulanan untuk {cat} (USD, kosong = tanpa batas)',
      grNeedApproval: 'Butuh persetujuanmu', grAboveLimit: 'Pembelian ini ({total}) di atas batas setujui otomatis ({limit}).',
      grCatOver: 'Ini akan membuat {cat} melewati batas bulanannya ({spent} dari {cap} sudah terpakai).',
      grApprove: 'Setujui dan bayar', grReject: 'Tolak pembelian ini',
      grApproved: 'Disetujui, meng-capture pembayaran...', grRejected: 'Pembelian ditolak. Order PayPal tidak di-capture dan akan kedaluwarsa.',
      grAutoOk: 'Di bawah batas setujui otomatis, meng-capture...',
      setTitle: 'Pengaturan', setClose: 'Tutup pengaturan', setOpen: 'Buka pengaturan',
      setLang: 'Bahasa', setLangAuto: 'Otomatis (ikut pesanmu)', setLangHint: 'Agen menjawab dalam bahasa ini. Tombol dan label ikut berganti.',
      setData: 'Data chat', setClearChat: 'Hapus riwayat chat', setClearHint: 'Menghapus percakapan dari browser ini. Proof Vault tetap tersimpan.',
      setCleared: 'Riwayat chat dihapus.', setGrSummary: 'Guardrail: setujui otomatis sampai {limit}.', budSaved: 'Budget tersimpan.',
      askPh: 'Tanya ShopPal…', quickDemo: 'Demo:',
      dwTitle: 'Delivery Watch', dwIntro: 'Agen memantau tiap pengiriman. Kalau paket macet 7 hari atau melewati estimasi, ia menyiapkan draf sengketa sebelum jendela pengajuan 180 harimu menyusut.',
      dwAddTracking: 'Tambah resi', dwCheck: 'Cek pengiriman', dwNoTracker: 'Belum ada resi untuk order ini.',
      dwStatus: 'Pengiriman: {status}', dwOverdue: 'Terlambat {n} hari: tidak ada update pengiriman. Draf sengketa sudah siap di bawah.',
      dwOnTime: 'Tepat waktu, {n} hari sejak pembelian.', dwDraftReady: 'Draf sengketa disiapkan otomatis.',
      dwNoOrders: 'Belum ada order untuk dipantau.',
      fxTitle: 'Bayar pakai mata uang lokal atau USD?', fxNote: 'PayPal menambah sekitar 3-4% untuk konversi mata uang. Kurs mid-market live di bawah, total PayPal sudah termasuk markup.',
      fxPaypalTotal: 'Total PayPal', fxMidRate: 'Kurs mid-market', fxCheaper: 'Paling hemat: bayar pakai {cur}.',
      fxUnavailable: 'Kurs live tidak tersedia, memakai kurs tersimpan.',
      exTitle: 'Dashboard pengeluaran', exTotal: 'Total belanja', exThisMonth: 'bulan ini', exEmpty: 'Belum ada pengeluaran tercatat.',
      pwTitle: 'Price Watch', pwIntro: 'Beri tahu agen harga targetmu. Ia memantau harga dan membeli begitu harga turun ke targetmu. Feed demo: harga katalog disimulasikan, diberi label.',
      pwTarget: 'Beli kalau harga turun ke (USD)', pwWatch: 'Pantau harga ini', pwWatching: 'Memantau',
      pwCurrent: 'Harga saat ini', pwTargetPrice: 'Target', pwCheck: 'Cek harga sekarang',
      pwTriggered: 'Harga kena! Beli sekarang di {price}.', pwBuyNow: 'Beli sekarang', pwNoWatches: 'Belum ada price watch.',
      pwSimNote: 'Feed harga simulasi untuk katalog demo, bukan harga pasar live.',
      sbTitle: 'Patungan', sbIntro: 'Beli kado bareng dan patungan. Agen menghitung bagian tiap orang dan menulis pesannya. Penagihan uangnya lewat aplikasi PayPal (request money); API Invoicing dan Payouts tidak diaktifkan untuk app sandbox ini.',
      sbFriends: 'Teman (nama, satu per baris)', sbSplit: 'Bagi rata', sbShare: 'Bagian tiap orang', sbMessage: 'Pesan untuk dikirim', sbNoFriends: 'Tambahkan minimal satu teman untuk patungan.',
      splNote: 'Tiap teman dapat link bayar PayPal Sandbox sendiri untuk bagiannya. Bagianmu sendiri dibayar lewat checkout biasa.', splLinks: 'Link bayar', splMakeLinks: 'Buat link bayar', splPayLink: 'Link bayar', splTotal: 'Total', splInitiator: 'Bagianmu',
      hrcTitle: 'Checklist cairkan hold', hrcBtn: 'Cara cairkan hold ini lebih cepat',
      hrcIntro: 'PayPal menahan uang seller baru atau berisiko sampai 21 hari. Tiap langkah di bawah bisa mencairkannya lebih cepat, centang yang sudah dilakukan dan lihat perkiraan cairnya.',
      hrcEstimated: 'Perkiraan cair: {n} hari', hrcCurrent: 'Hold saat ini: {n} hari',
      hrcDone: 'Selesai', hrcTodo: 'Belum', hrcSaves: 'hemat sampai {n} hari',
      hrcPrevents: 'mencegah hold berikutnya',
      hrcNote: 'Aturan hold resmi PayPal (hold seller baru dan berisiko, sampai 21 hari). Perkiraan, bukan jaminan, PayPal yang memutuskan tiap kasus.',
      hrcNotFound: 'Pilih produk dulu untuk melihat checklist hold-nya.',
      mpHeader: 'Listing asli · eBay', mpNone: 'Tidak ada listing eBay untuk pencarian itu.',
      checkoutCancelled: 'Checkout dibatalkan di PayPal. Tidak ada pembayaran.',
      approvedCapturing: 'PayPal menyetujui order {id}, meng-capture…',
      captureFailed: 'Capture gagal: {msg}',
      successTitle: 'Berhasil, pembayaran di-capture.',
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

  // Health badge: fetch /api/health once on load and show the server,
  // PayPal Sandbox and guardrail status in the header + sidebar.
  async function loadHealth() {
    var badge = $('health-badge');
    var sideStatus = $('side-health');
    var sideGuard = $('side-guardrail');
    try {
      var t0 = performance.now();
      const res = await fetch(API_BASE + '/api/health');
      const h = await res.json();
      if (!res.ok || !h.ok) throw new Error('health check failed');
      var pp = (h.paypalSandbox && h.paypalSandbox.status === 'live') ? 'PayPal Sandbox: Live' : 'PayPal Sandbox: Not configured';
      var gl = 'Guardrail Limit: $' + Number(h.guardrail && h.guardrail.autoApproveLimit !== undefined ? h.guardrail.autoApproveLimit : 20).toFixed(2);
      var mcp = 'MCP Tools: ' + (h.mcpTools || 8) + ' Ready';
      var lat = 'Latency: ' + Math.round(performance.now() - t0) + 'ms';
      if (badge) badge.textContent = pp + ' · ' + gl + ' · ' + mcp + ' · ' + lat;
      if (sideStatus) sideStatus.textContent = pp + ' · ' + mcp;
      if (sideGuard) sideGuard.textContent = '$' + Number(h.guardrail && h.guardrail.autoApproveLimit !== undefined ? h.guardrail.autoApproveLimit : 20).toFixed(2);
    } catch (e) {
      if (badge) badge.textContent = 'PayPal Sandbox: Unreachable';
      if (sideStatus) sideStatus.textContent = 'PayPal Sandbox: Unreachable';
    }
  }

  async function loadCatalog() {
    const res = await fetch(API_BASE + '/api/catalog');
    catalog = await res.json();
  }

  function sellerOf(product) {
    return catalog.sellers.find((s) => s.id === product.sellerId);
  }

  // eBay titles are external content, escape before injecting into HTML.
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
  // Smooth-scroll the chat to the newest message. Respects
  // prefers-reduced-motion (instant scroll instead of smooth).
  function scrollChat() {
    if (!chatEl) return;
    var smooth = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    chatEl.scrollTo({ top: chatEl.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
  }
  // Contextual assistant header per flow step (Modern AI Chat: the label
  // says what the agent is doing, not just "ShopPal").
  var STEP_TITLES = {
    greeting: 'ShopPal AI · Assistant',
    catalog: 'ShopPal AI · Catalog',
    vault: 'ShopPal AI · Proof Vault & Subscriptions',
    risk: 'ShopPal AI · Seller Risk & Guardrails',
    hold: 'ShopPal AI · Delivery & Dispute Watch',
    cost: 'ShopPal AI · Spending & Cost Breakdown',
    checkout: 'ShopPal AI · Checkout',
  };
  function addBubble(who, html, step) {
    var div = document.createElement('div');
    div.className = 'msg ' + who;
    if (step) div.setAttribute('data-step', step);
    div.innerHTML = (who === 'agent' ? '<div class="msg-label">' + (STEP_TITLES[step] || 'ShopPal AI · Assistant') + '</div>' : '') + html;
    chatEl.appendChild(div);
    scrollChat();
    saveChatHistory();
    return div;
  }
  // Chat history persistence: the conversation survives a page refresh.
  // The chat HTML is saved to localStorage on every new bubble, excluding
  // bubbles that are re-created fresh on load (greeting, catalog, vault,
  // checkout with its live PayPal button) and the typing indicator. On
  // load, the saved bubbles are restored before the fresh greeting, so the
  // user sees their history and can keep chatting. Restored bubbles are
  // static records - their buttons don't work - except product cards,
  // which are re-wired by the delegated handler in init. The follow-up
  // context (last Ask results, so "yang termurah" still refers to the
  // products shown before the refresh) is saved alongside.
  var CHAT_HISTORY_KEY = 'shoppal-chat-v1';
  var CHAT_HISTORY_MAX_BYTES = 200 * 1024; // 200KB cap; oldest bubbles drop first
  function saveChatHistory() {
    try {
      var clone = chatEl.cloneNode(true);
      clone.querySelectorAll('[data-step="greeting"], [data-step="catalog"], [data-step="vault"], [data-step="checkout"], .typing, .skeleton-msg').forEach(function (el) { el.remove(); });
      var html = clone.innerHTML;
      while (html.length > CHAT_HISTORY_MAX_BYTES) {
        var first = clone.firstElementChild;
        if (!first) break;
        first.remove();
        html = clone.innerHTML;
      }
      localStorage.setItem(CHAT_HISTORY_KEY, html);
    } catch (e) { /* storage unavailable or full - history just doesn't persist */ }
  }
  function restoreChatHistory() {
    try {
      var html = localStorage.getItem(CHAT_HISTORY_KEY);
      if (html) {
        chatEl.innerHTML = html;
        var ctx = localStorage.getItem(CHAT_HISTORY_KEY + '-context');
        if (ctx && catalog) {
          var ids = JSON.parse(ctx);
          if (Array.isArray(ids)) {
            lastResults = ids.map(function (id) { return catalog.products.find(function (p) { return p.id === id; }); }).filter(Boolean);
            if (!lastResults.length) lastResults = null;
          }
        }
        return true;
      }
    } catch (e) { /* corrupted storage - start fresh */ }
    return false;
  }
  function saveChatContext() {
    try {
      if (lastResults && lastResults.length) {
        localStorage.setItem(CHAT_HISTORY_KEY + '-context', JSON.stringify(lastResults.map(function (p) { return p.id; })));
      } else {
        localStorage.removeItem(CHAT_HISTORY_KEY + '-context');
      }
    } catch (e) { /* ignore */ }
  }
  // The active split session persists across refreshes, so "lanjut
  // checkout bagian saya" still resolves to the split product after a
  // reload. It is replaced by the next split, and cleared once the user's
  // own share has been checked out (see renderAgentResult).
  function saveLastSplit() {
    try {
      if (lastSplit && lastSplit.productId) {
        localStorage.setItem(CHAT_HISTORY_KEY + '-split', JSON.stringify(lastSplit));
      } else {
        localStorage.removeItem(CHAT_HISTORY_KEY + '-split');
      }
    } catch (e) { /* storage unavailable - the split session just doesn't persist */ }
  }
  function restoreLastSplit() {
    try {
      var raw = localStorage.getItem(CHAT_HISTORY_KEY + '-split');
      if (raw) {
        var s = JSON.parse(raw);
        if (s && s.productId) lastSplit = s;
      }
    } catch (e) { /* corrupted storage - start with no split session */ }
  }
  // Persist on any chat change (debounced): addBubble saves immediately,
  // but result cards are rendered into an existing bubble afterwards, so
  // a MutationObserver catches those fills too.
  var saveChatTimer = null;
  function scheduleSaveChatHistory() {
    if (saveChatTimer) clearTimeout(saveChatTimer);
    saveChatTimer = setTimeout(saveChatHistory, 300);
  }
  function setupChatHistoryObserver() {
    if (!window.MutationObserver || !chatEl) return;
    new MutationObserver(function () { scheduleSaveChatHistory(); }).observe(chatEl, { childList: true, subtree: true });
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
    div.setAttribute('aria-hidden', 'true');
    div.innerHTML = '<span></span><span></span><span></span><span class="loading-line">' + t('loadingAgent') + '</span>';
    chatEl.appendChild(div);
    scrollChat();
    return div;
  }
  function hideTyping(el) {
    if (el && el.remove) el.remove();
  }

  // Skeleton loader: shimmer placeholder shown while the agent searches
  // for products. It previews the results layout (title + card grid) so
  // the wait feels shorter than bare typing dots. The bubble is
  // aria-hidden and excluded from chat history (see saveChatHistory).
  var skelCounter = 0;
  function showSkeletonLoader(container) {
    var host = container || chatEl;
    if (!host) return null;
    var id = 'skel-' + (++skelCounter) + '-' + Date.now().toString(36);
    var div = document.createElement('div');
    div.className = 'msg agent skeleton-msg';
    div.id = id;
    div.setAttribute('aria-hidden', 'true');
    div.innerHTML =
      '<div class="skeleton-line skeleton-title"></div>' +
      '<div class="cards">' +
      '<div class="skeleton-card"><div class="skeleton-img"></div><div class="skeleton-line"></div><div class="skeleton-line skeleton-short"></div></div>' +
      '<div class="skeleton-card"><div class="skeleton-img"></div><div class="skeleton-line"></div><div class="skeleton-line skeleton-short"></div></div>' +
      '<div class="skeleton-card"><div class="skeleton-img"></div><div class="skeleton-line"></div><div class="skeleton-line skeleton-short"></div></div>' +
      '</div>';
    host.appendChild(div);
    scrollChat();
    return id;
  }
  function removeSkeletonLoader(id) {
    if (!id) return;
    var el = document.getElementById(id);
    if (el && el.remove) el.remove();
  }

  // Toast notifications: instant feedback for copy, approval and other
  // actions. The toast root has aria-live="polite" in the HTML.
  function showToast(msg, kind) {
    var root = $('toast-root');
    if (!root) return;
    var el = document.createElement('div');
    el.className = 'toast' + (kind === 'success' ? ' success' : '');
    el.setAttribute('role', 'status');
    el.textContent = msg;
    root.appendChild(el);
    setTimeout(function () { if (el.remove) el.remove(); }, 3600);
  }

  // Copy to clipboard with a fallback for older browsers, then toast.
  async function copyText(text, okMsg) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        var ta = document.createElement('textarea');
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
      }
      showToast(okMsg, 'success');
      return true;
    } catch (e) {
      showToast(okMsg);
      return false;
    }
  }

  // Disable a button while an async action runs (prevents double-submit)
  // and show a spinner inside it. Restores the original label after.
  function setBusy(btn, busy, busyLabel) {
    if (!btn) return;
    if (busy) {
      if (btn.dataset.origLabel === undefined) btn.dataset.origLabel = btn.textContent;
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner" aria-hidden="true"></span>' + escapeHtml(busyLabel || btn.dataset.origLabel || '');
    } else {
      btn.disabled = false;
      btn.textContent = btn.dataset.origLabel || btn.textContent;
    }
  }

  function productCardHtml(p) {
    var seller = sellerOf(p);
    return '<button type="button" class="product-card" data-product="' + p.id + '">' +
      '<img src="' + (p.image || '') + '" alt="' + p.name + '">' +
      '<span class="card-body"><strong>' + p.name + '</strong>' +
      '<span class="price">' + money(p.priceUSD) + '</span> · ' + p.category + '<br>' +
      '<span class="seller">Seller: ' + seller.name + '</span> ' +
      '<span class="score score-' + seller.riskProfile.toLowerCase() + ' card-score">' + seller.riskProfile + '</span></span></button>';
  }
  function renderCatalogInto(grid, products) {
    grid.innerHTML = '';
    products.forEach(function (p) {
      var wrap = document.createElement('div');
      wrap.innerHTML = productCardHtml(p);
      var card = wrap.firstChild;
      card._wired = true; // JS property only - lost on HTML serialization, so the delegated handler can tell restored cards apart
      card.addEventListener('click', function () {
        if (compareMode) {
          var idx = compareList.findIndex(function (x) { return x.id === p.id; });
          if (idx >= 0) compareList.splice(idx, 1);
          else if (compareList.length < 2) compareList.push(p);
          var inList = compareList.some(function (x) { return x.id === p.id; });
          card.classList.toggle('selected', inList);
          card.setAttribute('aria-pressed', inList ? 'true' : 'false');
          updateCompareBar();
          return;
        }
        selectProduct(p);
      });
      // One-tap buy: a Buy button under each card goes straight to the
      // agent ("buy <id>"), skipping the detail steps. It lives outside
      // the card button (a button cannot contain a button).
      var cell = document.createElement('div');
      cell.className = 'product-cell';
      cell.appendChild(card);
      var buyBtn = document.createElement('button');
      buyBtn.type = 'button';
      buyBtn.className = 'card-buy';
      buyBtn.setAttribute('data-buy', p.id);
      buyBtn.textContent = t('pwBuyNow');
      buyBtn._wired = true; // like card._wired: the delegated handler skips it
      buyBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        buyProduct(p);
      });
      cell.appendChild(buyBtn);
      grid.appendChild(cell);
    });
  }

  function marketplaceCardHtml(l) {
    var risk = l.risk || {};
    var zone = (risk.label || 'Caution').toLowerCase();
    var img = safeImageUrl(l.image);
    // data-listing carries the full listing (URL-encoded JSON) so a card
    // restored from saved chat history can still be opened.
    var listingAttr = '';
    try { listingAttr = ' data-listing="' + encodeURIComponent(JSON.stringify(l)) + '"'; } catch (e) { /* ignore */ }
    return '<button type="button" class="product-card" data-marketplace="eBay"' + listingAttr + '>' +
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
      card._wired = true; // JS property only - see renderCatalogInto
      var link = card.querySelector('a');
      if (link) link.addEventListener('click', function (e) { e.stopPropagation(); });
      card.addEventListener('click', function () { selectMarketplaceItem(l); });
      grid.appendChild(card);
    });
  }

  // A real eBay listing flows through the same 7 steps as a demo product,
  // with its marketplace risk score (attached by the search endpoint).
  // Checkout is a PayPal Sandbox simulation, it never buys the eBay item.
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
    userBubble(l.title + ', ' + money(l.priceUSD) + ' (eBay)');
    showRisk();
    showHold();
    showCost();
    showCheckout();
  }

  function greet() {
    var greeting = addBubble('agent',
      '<button type="button" class="dismiss-btn" id="greet-dismiss" aria-label="Dismiss introduction">×</button>' +
      '<p>Hi, I’m ShopPal, your AI shopping agent. Tell me what you’re looking for, and I’ll check the seller, show you the real total (fees included), and keep your proof if you pay.</p>' +
      '<p class="hint">Try: \u201cFind noise-cancelling headphones under $50\u201d \u2014 or tap a demo below.</p>' +
      '<div class="chips">' +
      '<button type="button" class="chip" id="phish-chip">' + t('phChip') + '</button>' +
      '<button type="button" class="chip" id="compare-toggle">' + t('cmpToggle') + '</button>' +
      '</div>',
      'greeting');
    greeting.querySelector('#greet-dismiss').addEventListener('click', function () { greeting.remove(); });
    addBubble('agent',
      '<div id="compare-bar" class="card hidden"></div>' +
      '<div class="cards" id="catalog"></div>',
      'catalog');
    renderCatalogInto($('catalog'), catalog.products);
    var chips = chatEl.querySelectorAll('.chip[data-q]');
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
      this.classList.toggle('active', compareMode);
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
    bar.innerHTML = '<p><strong>' + t('cmpTitle') + '</strong>, ' + fmt(t('cmpSelected'), { n: compareList.length }) + ' · ' + t('cmpPick') + '</p>' +
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
    var shortHold = function (h) { return (h.chance || '').replace(' (estimate)', '').replace('under 5%', '<5%'); };
    // One-line verdict: which is safer, which is cheaper, then two
    // stacked cards, so nothing ever needs a horizontal scroll on a phone.
    var safer = rows[0].risk.score >= rows[1].risk.score ? rows[0] : rows[1];
    var cheaper = rows[0].product.priceUSD <= rows[1].product.priceUSD ? rows[0] : rows[1];
    var other = cheaper === rows[0] ? rows[1] : rows[0];
    var verdict = safer === cheaper
      ? t('cmpVerdictBoth')
      : fmt(t('cmpVerdictSplit'), { safer: safer.seller.name, score: safer.risk.score, cheaper: cheaper.seller.name, price: money(cheaper.product.priceUSD), saves: money(other.product.priceUSD - cheaper.product.priceUSD) });
    var cardHtml = function (r) {
      var zone = r.risk.label === 'Safe' ? 'safe' : r.risk.label === 'Caution' ? 'caution' : 'risky';
      var hz = r.hold.label === 'Low' ? 'safe' : r.hold.label === 'Moderate' ? 'caution' : 'risky';
      var badges = '';
      if (r === safer) badges += ' <span class="pick-badge pick-safer">' + t('cmpSafer') + '</span>';
      if (r === cheaper && r !== safer) badges += ' <span class="pick-badge pick-cheaper">' + t('cmpCheaper') + '</span>';
      return '<div class="compare-card' + (r === safer ? ' compare-safer' : '') + '">' +
        '<div class="compare-head">' +
        (r.product.image ? '<img src="' + r.product.image + '" alt="' + r.product.name + '">' : '') +
        '<div><strong>' + r.product.name + '</strong><br><span class="price">' + money(r.product.priceUSD) + '</span> · ' + r.seller.name + badges + '</div></div>' +
        '<ul><li>' + t('riskScore') + ': <span class="score score-' + zone + '">' + r.risk.score + '/100 · ' + labelText(r.risk.label) + '</span></li>' +
        '<li>' + t('holdTitle') + ': <span class="score score-' + hz + '">' + holdLabelText(r.hold.label) + ' · ' + shortHold(r.hold) + '</span></li>' +
        '<li>' + t('honestTotal') + ': <strong>' + money(r.cost.total) + '</strong></li>' +
        '<li>Tracking / Returns: ' + (r.seller.hasTracking ? '✓' : '✗') + ' / ' + (r.seller.hasReturnPolicy ? '✓' : '✗') + '</li></ul>' +
        '</div>';
    };
    addBubble('agent',
      '<p><strong>' + t('cmpTitle') + '</strong></p>' +
      '<p>' + verdict + '</p>' +
      '<div class="compare-list">' + rows.map(cardHtml).join('') + '</div>');
    compareList = [];
    updateCompareBar();
    scrollChat();
  }

  // Pay Agent: a buying goal (buy/pay verb + product or budget) goes to the
  // agent endpoint, which runs the whole flow (search, score, total,
  // guardrails, PayPal order) and only asks the user to approve. Everything
  // else keeps the existing Ask flow below.
  // Delivery-status checks ("cek pengiriman" / "check delivery" / "where is
  // my order"): a status verb + a shipment noun. They go to /api/agent,
  // never to the generic Ask search.
  function isDeliveryCheck(q) {
    var s = ' ' + q.toLowerCase() + ' ';
    return /(cek|check|status|where|di mana|dimana|sampai mana|mana)/.test(s) &&
      /(pengiriman|delivery|kiriman|paket|pesanan|order|package|barang|shipment|shipping)/.test(s);
  }

  function isCheckoutContinuation(q) {
    var s = ' ' + q.toLowerCase().replace(/\s+/g, ' ').trim() + ' ';
    return (/\blanjut\b/.test(s) || /\blanjutkan\b/.test(s) ||
      /\bbagian\s+(saya|ku|gue|gw)\b/.test(s) || /\bmy\s+share\b/.test(s) ||
      /\b(bayar|beli|checkout)\s+(bagian|saya|sekarang|now)\b/.test(s));
  }

  function isBuyGoal(q) {
    var s = ' ' + q.toLowerCase() + ' ';
    var buy = /(beli|belikan|bayar|bayarkan|pesan|checkout|buy|purchase|pay|order)/.test(s);
    var watch = /(pantau|memantau|watch|awasi|snipe|cek pantauan|cek harga|check (my )?(price )?watch)/.test(s);
    var split = /(patungan|split|bagi rata|bagi-bagi)/.test(s);
    var track = /(lacak|track|dispute|sengketa)/.test(s);
    var target = /(headphone|smartwatch|keyboard|speaker|charger|paling aman|termurah|terbaik|safest|cheapest|best|\$\s*\d|pantauan|watch|pesanan|order|lacak|track|dispute|sengketa|\bp\d{2}\b)/.test(s);
    // Checkout continuations ("lanjut checkout bagian saya", "beli bagian
    // saya") name no product, so they carry no target - they continue the
    // ACTIVE product (split session, then lastResults), resolved by the
    // agent from the context + lastSplit sent with the request. They must
    // go to /api/agent, never to the generic Ask search.
    var cont = isCheckoutContinuation(q);
    var delivery = isDeliveryCheck(q);
    return ((buy || watch || split || track) && target) || cont || delivery;
  }

  // "Check my budget guardrail limit" is a settings question, not a product
  // search: answer it with the current guardrail state instead of
  // returning a product list.
  function isGuardrailStatus(q) {
    var s = ' ' + q.toLowerCase() + ' ';
    return /guardrail/.test(s) && /(cek|check|lihat|show|berapa|batas|limit|status|budget)/.test(s);
  }
  function showGuardrailStatus() {
    var g = getGuardrails();
    var budget = null;
    try { budget = localStorage.getItem(BUDGET_KEY); } catch (e) { /* private mode */ }
    var caps = g.categoryCaps || {};
    var capLines = Object.keys(caps).filter(function (c) { return caps[c] !== '' && caps[c] !== null && caps[c] !== undefined; }).map(function (c) {
      return '<li>' + fmt(t('grCatCap'), { cat: c }) + ': <strong>' + money(Number(caps[c]) || 0) + '</strong></li>';
    }).join('');
    var html = '<p><strong>' + t('grTitle') + '</strong></p>' +
      '<p>' + t('grIntro') + '</p>' +
      '<ul>' +
      '<li>' + t('grLimit') + ': <strong>' + money(g.autoApproveLimit) + '</strong></li>' +
      '<li>' + t('budTitle') + ': <strong>' + (budget ? money(Number(budget)) : t('budNoBudget')) + '</strong></li>' +
      capLines +
      '</ul>' +
      '<p class="hint">' + t('grHint') + '</p>';
    addBubble('agent', html);
  }

  function renderAgentResult(ag, q) {
    // Track the active split session: a split result sets it (so a later
    // "lanjut checkout bagian saya" resolves to this product's share), and
    // a completed share checkout clears it (the session is done).
    if (ag.splitPayment && ag.splitPayment.productId) {
      lastSplit = { productId: ag.splitPayment.productId, share: ag.splitPayment.share, initiatorShare: ag.splitPayment.initiatorShare, total: ag.splitPayment.total, friends: ag.splitPayment.friends || [] };
      saveLastSplit();
    }
    if (ag.order && ag.order.shareCheckout) {
      lastSplit = null;
      saveLastSplit();
    }
    var html = '';
    if (ag.steps && ag.steps.length) {
      html += '<p><strong>' + t('agentSteps') + '</strong></p><ul>' +
        ag.steps.map(function (st) {
          return '<li>' + escapeHtml(st.action) + ': ' + escapeHtml(st.summary || '') + '</li>';
        }).join('') + '</ul>';
    }
    if (ag.reply) html += '<p>' + escapeHtml(ag.reply) + '</p>';
    var bubble = addBubble('agent', html);
    if (ag.order && ag.order.approveUrl) {
      addBubble('agent',
        '<p>' + fmt(t('orderCreated'), { id: ag.order.orderId, total: money(ag.order.totalUSD) }) + '</p>' +
        '<p><a href="' + ag.order.approveUrl + '" target="_blank" rel="noopener">' + t('approveLink') + '</a></p>' +
        '<p class="hint">' + t('approveHint') + '</p>');
      window.open(ag.order.approveUrl, '_blank', 'noopener');
    } else if (ag.needsApproval && ag.pendingOrder) {
      var callout = document.createElement('div');
      callout.className = 'callout';
      callout.setAttribute('role', 'alert');
      callout.setAttribute('aria-live', 'polite');
      callout.innerHTML =
        '<div class="callout-head"><svg class="shield" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M12 2l8 3v6c0 5.5-3.5 9.5-8 11-4.5-1.5-8-5.5-8-11V5l8-3z" fill="currentColor"/><path d="M8.5 12l2.5 2.5 4.5-5" stroke="#fff" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg><span>' + t('agentPendingApproval') + '</span></div>' +
        '<p>' + t('calloutWhy') + '</p>' +
        '<p class="hint num">' + escapeHtml(ag.pendingOrder.name || '') + ' · ' + money(ag.pendingOrder.totalUSD) + '</p>' +
        '<div class="callout-actions">' +
        '<button type="button" class="btn-primary" data-act="approve">' + t('agentApprove') + '</button>' +
        '<button type="button" class="btn-secondary" data-act="reject">' + t('agentReject') + '</button>' +
        '</div>';
      bubble.appendChild(callout);
      var approveBtn = callout.querySelector('[data-act="approve"]');
      var rejectBtn = callout.querySelector('[data-act="reject"]');
      approveBtn.addEventListener('click', async function () {
        setBusy(approveBtn, true, t('loadingAgent'));
        if (rejectBtn) rejectBtn.disabled = true;
        var typing2 = showTyping();
        try {
          var r2 = await fetch(API_BASE + '/api/agent', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: q, lang: lang, guardrails: getGuardrails(), approved: true, approvedOrder: ag.pendingOrder }),
          });
          var ag2 = await r2.json();
          hideTyping(typing2);
          setBusy(approveBtn, false);
          if (r2.ok) { showToast(t('toastApproved'), 'success'); renderAgentResult(ag2, q); }
          else addBubble('agent', '<p>' + escapeHtml(ag2.error || String(r2.status)) + '</p>');
        } catch (e) {
          hideTyping(typing2);
          setBusy(approveBtn, false);
          if (rejectBtn) rejectBtn.disabled = false;
          addBubble('agent', '<p>' + t('agentFailed') + '</p>');
        }
        scrollChat();
      });
      rejectBtn.addEventListener('click', function () {
        if (callout.remove) callout.remove();
        showToast(t('toastRejected'));
        scrollChat();
      });
    }
    if (ag.splitPayment && ag.splitPayment.links && ag.splitPayment.links.length) {
      var sp = ag.splitPayment;
      var spHtml = '<div class="card split-card"><p><strong>' + t('splLinks') + '</strong></p>' +
        '<div class="split-breakdown">' +
        '<div class="row"><span>' + t('splTotal') + '</span><span class="num">' + money(sp.total) + '</span></div>' +
        '<div class="row"><span>' + t('sbShare') + '</span><span class="num">' + money(sp.share) + '</span></div>' +
        (sp.initiatorShare ? '<div class="row"><span>' + t('splInitiator') + '</span><span class="num">$' + sp.initiatorShare + '</span></div>' : '') +
        '</div>' +
        sp.links.map(function (l) {
          return '<div class="split-link-row"><span>' + escapeHtml(l.friend) + ' · <span class="num badge-amount">' + money(l.amountUSD) + '</span> ' +
            (l.status ? '<span class="score score-emerald">' + escapeHtml(l.status) + '</span>' : '') + '</span>' +
            '<span class="split-link-actions">' +
            (l.approveUrl ? '<a class="btn-primary" href="' + l.approveUrl + '" target="_blank" rel="noopener" style="display:inline-block;padding:0.55rem 0.8rem;border-radius:8px;text-decoration:none;min-height:44px;line-height:1.4">' + t('openPayPal') + ' ↗</a>' : '') +
            (l.approveUrl ? '<button type="button" class="btn-secondary" data-copy="' + escapeHtml(l.approveUrl) + '" data-friend="' + escapeHtml(l.friend) + '">' + t('copyLink') + '</button>' : '') +
            '</span></div>';
        }).join('') + '</div>';
      var spBubble = addBubble('agent', spHtml);
      spBubble.querySelectorAll('[data-copy]').forEach(function (b) {
        b.addEventListener('click', async function () {
          var orig = b.textContent;
          await copyText(b.getAttribute('data-copy'), fmt(t('toastCopyLink'), { name: b.getAttribute('data-friend') }));
          b.textContent = t('copied');
          setTimeout(function () { b.textContent = orig; }, 1800);
        });
      });
    }
    if (ag.dispute && ag.dispute.disputePayload) {
      var dp = ag.dispute.disputePayload;
      var trLine = ag.tracking && ag.tracking.trackingNumber
        ? '<p>' + t('trackingAdded') + ' · <span class="num">' + escapeHtml(ag.tracking.trackingNumber) + '</span> (' + escapeHtml(ag.tracking.carrier || '') + ' · ' + escapeHtml(ag.tracking.status || '') + ')</p>'
        : '';
      var dpBubble = addBubble('agent',
        trLine +
        '<p><strong>' + t('simTitle') + '</strong>, ' + fmt(t('simWinChance'), { n: ag.dispute.winChance }) +
        ' · <span class="score score-' + (ag.dispute.winChance >= 70 ? 'safe' : ag.dispute.winChance >= 40 ? 'caution' : 'risky') + '">' + escapeHtml(ag.dispute.label || '') + '</span></p>' +
        '<div class="dispute-summary">' +
        '<span class="score score-risky">' + escapeHtml(dp.status || 'OPEN') + '</span>' +
        '<span class="score score-caution">' + escapeHtml(dp.dispute_life_cycle_stage || '') + '</span>' +
        '<span class="score order-id">' + escapeHtml(dp.dispute_id || '') + '</span>' +
        '</div>' +
        '<p><strong>' + t('simPayloadTitle') + '</strong></p>' +
        '<pre class="codeblock"><code>' + escapeHtml(JSON.stringify(dp, null, 2)) + '</code></pre>' +
        '<p><button type="button" class="btn-secondary sim-copy-json">' + t('copyJson') + '</button></p>');
      wireSimCopy(dpBubble, ag.dispute);
    }
    if (ag.delivery) {
      var dv = ag.delivery;
      var dtr = dv.tracking || {};
      var dvHtml = '<div class="card"><p><strong>' + t('dwTitle') + '</strong></p>' +
        '<p><strong>' + escapeHtml(dv.product || dv.vaultId || '') + '</strong> · ' + fmt(t('dwStatus'), { status: dtr.status || '-' }) + '</p>' +
        (dtr.trackingNumber ? '<p><span class="num">' + escapeHtml(dtr.trackingNumber) + '</span> (' + escapeHtml(dtr.carrier || '') + ')</p>' : '') +
        '<p>' + (dv.overdue ? fmt(t('dwOverdue'), { n: dv.days }) : fmt(t('dwOnTime'), { n: dv.days })) + '</p>' +
        (dv.overdue && dv.autoDraft ? '<p class="hint">' + t('dwDraftReady') + ' ' + fmt(t('simWinChance'), { n: dv.autoDraft.winChance }) + ' · ' + escapeHtml(dv.autoDraft.label || '') + '</p>' : '') +
        '</div>';
      addBubble('agent', dvHtml);
    }
    scrollChat();
  }

  async function sendAsk() {
    var q = $('ask').value.trim();
    if (!q || !catalog || sending) return;
    // Keep the keyboard open on mobile: focus the input synchronously,
    // inside the tap/keypress gesture, before the async work starts.
    $('ask').focus();
    sending = true;
    // Disable only the send button while the agent works (prevents
    // double-submit); the input stays enabled so it keeps focus, and the
    // cursor returns to it when the reply lands.
    var btn = $('ask-btn');
    btn.disabled = true;
    try {
      await sendAskInner(q);
    } finally {
      btn.disabled = false;
      sending = false;
      $('ask').focus();
    }
  }

  // One-tap buy from a product card: send "buy <id>" straight to the
  // agent, which buys that exact product (deterministic server bypass).
  function buyProduct(p) {
    $('ask').value = 'buy ' + p.id;
    sendAsk();
  }

  async function sendAskInner(q) {
    $('ask').value = '';
    if (!langManual) lang = detectLang(q);
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
      var phBody = '<p><strong>' + t('phTitle') + '</strong>, <span class="score score-' + phZone + '">' + ph.score + '/100 · ' + ph.label + '</span></p>';
      if (ph.signals && ph.signals.length) {
        phBody += '<ul>' + ph.signals.map(function (s) {
          return '<li>' + (s.points > 0 ? '+' : '') + s.points + ', ' + s.note + '</li>';
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
      var clBody = '<p><strong>' + t('clTitle') + '</strong>, ' + (cl.domain || '') +
        ' · <span class="score score-' + clZone + '">' + (cl.score !== undefined ? cl.score + '/100 · ' : '') + labelText(cl.label) + '</span></p>';
      if (cl.title) clBody += '<p><strong>' + escapeHtml(cl.title) + '</strong>' +
        (cl.priceUSD ? ', ' + money(cl.priceUSD) : ' · ' + t('clNoPrice')) + '</p>';
      if (cl.image) clBody += '<p><img src="' + cl.image + '" alt="" style="width:220px;max-width:100%;aspect-ratio:4/3;object-fit:cover;border-radius:8px"></p>';
      if (cl.reasons && cl.reasons.length) {
        clBody += '<ul>' + cl.reasons.map((r) => '<li>' + r + '</li>').join('') + '</ul>';
      }
      if (cl.totalCost) {
        clBody += '<p><strong>' + t('honestTotal') + '</strong>, ' + money(cl.totalCost.total) + '</p>';
      }
      if (cl.note) clBody += '<p class="hint">' + cl.note + '</p>';
      addBubble('agent', clBody);
      return;
    }
    // "Check my budget guardrail limit": a settings question, answered from
    // local guardrail state - never a product search.
    if (isGuardrailStatus(q)) {
      hideTyping(typing);
      showGuardrailStatus();
      return;
    }
    // Pay Agent: buying goals go to the agent, everything else to Ask.
    if (isBuyGoal(q)) {
      try {
        // The agent resolves checkout continuations ("lanjut checkout
        // bagian saya") against the active product: the split session
        // first, then the last search results. Both are sent here; the
        // server validates the IDs against the catalog before use.
        var agBody = { message: q, lang: lang, guardrails: getGuardrails() };
        if (lastResults && lastResults.length) agBody.context = lastResults.map(function (p) { return p.id; });
        if (lastSplit && lastSplit.productId) agBody.lastSplit = lastSplit;
        var agRes = await fetch(API_BASE + '/api/agent', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(agBody),
        });
        var ag = await agRes.json();
        hideTyping(typing);
        // 403 + needsApproval is the guardrail contract, not an error:
        // render the Approve / Reject callout instead of an error bubble.
        if (!agRes.ok && !ag.needsApproval) {
          addBubble('agent', '<p>' + escapeHtml(ag.error || String(agRes.status)) + '</p>');
          return;
        }
        renderAgentResult(ag, q);
      } catch (e) {
        hideTyping(typing);
        addBubble('agent', '<p>' + t('agentFailed') + '</p>');
      }
      return;
    }
    // Ask path: show the skeleton loader while the search runs (it
    // replaces the typing dots here, since it previews the results
    // layout). It is removed as soon as the reply arrives, success or
    // failure, so it can never linger in the chat.
    hideTyping(typing);
    var skelId = showSkeletonLoader(chatEl);
    var askParams = new URLSearchParams({ q, lang });
    if (lastResults && lastResults.length) {
      askParams.set('context', lastResults.map((p) => p.id).join(','));
    }
    var res, data;
    try {
      res = await fetch(API_BASE + '/api/ask?' + askParams.toString());
      data = await res.json();
    } catch (e) {
      removeSkeletonLoader(skelId);
      addBubble('agent', '<p>' + t('agentFailed') + '</p>');
      return;
    }
    removeSkeletonLoader(skelId);
    var products = data.products || catalog.products;
    lastResults = products;
    saveChatContext();
    // "yang pertama" picks the first result shown, go straight to it.
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
    var resultsBubble = addBubble('agent',
      '<p>' + t('understood') + ' ' + (understood.length ? understood.join(', ') : t('noCategory')) +
      ', ' + (data.understood ? data.understood.note : '') +
      (data.understood && data.understood.aiParsed ? ' ' + t('parsedByAI') : '') + '</p>' +
      '<div class="cards"></div>');
    renderCatalogInto(resultsBubble.querySelector('.cards'), products);
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
        var mpBubble = addBubble('agent',
          '<p><strong>' + t('mpHeader') + '</strong></p>' +
          '<p class="hint">' + (mp.note || '') + '</p>' +
          '<div class="cards"></div>');
        renderMarketplaceInto(mpBubble.querySelector('.cards'), mp.listings);
        return;
      }
      if (mp.configured) {
        hideTyping(typing);
        addBubble('agent', '<p class="hint">' + t('mpNone') + '</p>');
        return;
      }
    } catch (e) {
      // Marketplace search is a bonus, a failure never breaks the Ask flow.
    }
    hideTyping(typing);
  }

  async function selectProduct(product) {
    var seller = sellerOf(product);
    selected = { product: product, seller: seller, risk: null, cost: null };
    clearSteps();
    userBubble(product.name + ', ' + money(product.priceUSD));
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
    var html = '<p><strong>' + t('simTitle') + '</strong>, ' + fmt(t('simWinChance'), { n: d.winChance }) +
      ' · <span class="score score-' + (d.winChance >= 70 ? 'safe' : d.winChance >= 40 ? 'caution' : 'risky') + '">' + d.label + '</span></p>';
    if (d.disputePayload) {
      var dp = d.disputePayload;
      html += '<div class="dispute-summary">' +
        '<span class="score score-risky">' + escapeHtml(dp.status || 'OPEN') + '</span>' +
        '<span class="score score-caution">' + escapeHtml(dp.dispute_life_cycle_stage || '') + '</span>' +
        '<span class="score order-id">' + escapeHtml(dp.dispute_id || '') + '</span>' +
        '</div>';
    }
    if (d.note) html += '<p class="hint">' + d.note + '</p>';
    if (d.components && d.components.length) {
      html += '<ul>' + d.components.map((c) =>
        '<li>' + (c.points > 0 ? '+' : '') + c.points + ', ' + c.note + '</li>').join('') + '</ul>';
    }
    if (d.missingProof && d.missingProof.length) {
      html += '<p>' + fmt(t('simMissing'), { list: d.missingProof.join(', ') }) + '</p>';
    }
    if (d.recommendation) html += '<p><strong>' + t('recommendation') + '</strong> ' + d.recommendation + '</p>';
    if (d.aiExplanation) html += '<p class="hint">' + d.aiExplanation + '</p>';
    if (d.disputePayload) {
      html += '<p><strong>' + t('simPayloadTitle') + '</strong></p>' +
        '<pre class="codeblock"><code>' + escapeHtml(JSON.stringify(d.disputePayload, null, 2)) + '</code></pre>' +
        '<p><button type="button" class="btn-secondary sim-copy-json">' + t('copyJson') + '</button></p>';
    }
    return html;
  }

  // Wire the "Copy JSON" button inside a freshly rendered sim result.
  function wireSimCopy(box, d) {
    if (!box || !d || !d.disputePayload) return;
    var btn = box.querySelector('.sim-copy-json');
    if (!btn) return;
    btn.addEventListener('click', async function () {
      var orig = btn.textContent;
      await copyText(JSON.stringify(d.disputePayload, null, 2), t('toastCopyJson'));
      btn.textContent = t('copied');
      setTimeout(function () { btn.textContent = orig; }, 1800);
    });
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
      '<div class="feature-head"><span class="feature-title">' + t('riskScore') + '</span></div>' +
      '<p><strong>' + selected.seller.name + '</strong></p>' +
      '<div class="feature-metric">' + r.score + '<span class="feature-metric-sub">/100</span> <span class="score score-' + zone + '">' + labelText(r.label) + '</span></div>' +
      '<ul>' + r.reasons.map((reason) => '<li>' + reason + '</li>').join('') + '</ul>' +
      '<p><strong>' + t('recommendation') + '</strong> ' + r.recommendation + '</p>' +
      extra +
      '<p class="hint">Profile ' + r.components.profile + ' · History ' + r.components.history +
      ' · Price ' + r.components.price + ' · Tracking ' + r.components.tracking +
      (r.aiAvailable ? '' : ' · ' + (r.aiNote || 'AI explanation unavailable.')) + '</p>' +
      (isDemoProduct ? '<p><button id="pre-sim-btn" type="button">' + t('simBtn') + '</button></p>' +
      '<div id="pre-sim" class="card hidden"></div>' +
      '<p><input id="pw-target" type="number" min="1" step="0.01" placeholder="' + t('pwTarget') + '" style="width:130px"> ' +
      '<button id="pw-watch-btn" type="button" class="btn-secondary">' + t('pwWatch') + '</button> <span id="pw-status"></span></p>' +
      '<p class="hint">' + t('pwSimNote') + '</p>' : ''),
      'risk');
    if (isDemoProduct) {
      $('pw-watch-btn').addEventListener('click', async function () {
        var target = Number($('pw-target').value);
        var st = $('pw-status');
        if (!target || target <= 0) { if (st) st.textContent = t('pwTarget'); return; }
        try {
          var res = await fetch(API_BASE + '/api/price-watch', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ productId: selected.product.id, targetPrice: target, lang: lang }) });
          var d = await res.json();
          if (st) st.textContent = res.ok ? (t('pwWatching') + ': ' + money(d.currentPrice) + ' → ' + money(d.targetPrice)) : (d.error || res.status);
        } catch (e) { if (st) st.textContent = String(e && e.message || e); }
      });
      $('pre-sim-btn').addEventListener('click', async function () {
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
        wireSimCopy(box, d);
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
      if (!res.ok) {
        addBubble('agent', '<p>' + fmt(t('holdFailed'), { msg: h.error || res.status }) + '</p>', 'hold');
        return;
      }
    }
    var zone = h.label === 'Low' ? 'safe' : h.label === 'Moderate' ? 'caution' : 'risky';
    var bubble = addBubble('agent',
      '<div class="feature-head"><span class="feature-title">' + t('holdTitle') + '</span></div>' +
      '<p><span class="score score-' + zone + '">' + holdLabelText(h.label) + ' · ' + h.chance + '</span></p>' +
      '<ul>' + h.reasons.map((reason) => '<li>' + reason + '</li>').join('') + '</ul>' +
      '<p>' + h.tip + '</p>' +
      '<p class="hint">' + t('holdHint') + '</p>' +
      '<p><button id="hrc-btn" type="button">' + t('hrcBtn') + '</button></p>' +
      '<div id="hrc-box" class="card hidden"></div>',
      'hold');
    // Hold Release Checklist: the steps that release the hold early.
    $('hrc-btn').addEventListener('click', async function () {
      var box = $('hrc-box');
      if (!box) return;
      box.classList.remove('hidden');
      box.textContent = t('hrcTitle') + '…';
      var res = await fetch(API_BASE + '/api/hold-checklist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sellerId: selected.seller.id, productId: selected.product.id, lang }),
      });
      var d = await res.json();
      if (!res.ok) {
        box.textContent = d.error || t('hrcNotFound');
        return;
      }
      renderHoldChecklist(box, d);
      scrollChat();
    });
  }

  // Interactive checklist: ticking a step recomputes the estimated release.
  function renderHoldChecklist(box, d) {
    var state = {};
    d.steps.forEach(function (s) { state[s.id] = s.done; });
    var estDays = function () {
      if (state.buyer) return 1;
      if (state.tracking) return 3;
      if (state.shipped) return 7;
      return 21;
    };
    var render = function () {
      var html = '<p><strong>' + t('hrcTitle') + '</strong></p>' +
        '<p>' + t('hrcIntro') + '</p>' +
        '<p><strong>' + fmt(t('hrcCurrent'), { n: d.currentDays }) + '</strong> · <strong>' + fmt(t('hrcEstimated'), { n: estDays() }) + '</strong></p>' +
        '<ul>' + d.steps.map(function (s) {
          return '<li><label><input type="checkbox" data-step="' + s.id + '"' + (state[s.id] ? ' checked' : '') + '> ' +
            '<strong>' + s.title + '</strong>, ' + s.detail + ' <em>(' +
            (s.savesDays > 0 ? fmt(t('hrcSaves'), { n: s.savesDays }) : t('hrcPrevents')) + ')</em></label></li>';
        }).join('') + '</ul>' +
        '<p class="hint">' + d.note + '</p>';
      box.innerHTML = html;
      box.querySelectorAll('input[data-step]').forEach(function (cb) {
        cb.addEventListener('change', function () {
          state[cb.getAttribute('data-step')] = cb.checked;
          render();
        });
      });
    };
    render();
  }

  async function renderFx(totalUSD, boxId) {
    var box = $(boxId);
    if (!box || !totalUSD) return;
    box.innerHTML = '<p><strong>' + t('fxTitle') + '</strong></p>' +
      '<p><select id="fx-cur"><option value="IDR">IDR</option><option value="EUR">EUR</option><option value="GBP">GBP</option><option value="SGD">SGD</option></select></p>' +
      '<p id="fx-out"></p><p class="hint">' + t('fxNote') + '</p>';
    var run = async function () {
      var cur = box.querySelector('#fx-cur').value;
      var out = $('fx-out');
      if (out) out.textContent = '…';
      try {
        var res = await fetch(API_BASE + '/api/fx-compare', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ amountUSD: totalUSD, currency: cur, lang: lang }) });
        var d = await res.json();
        if (!res.ok || !d.rate) { if (out) out.textContent = t('fxUnavailable'); return; }
        if (out) out.innerHTML = t('fxMidRate') + ': ' + d.rate + ' · ' + t('fxPaypalTotal') + ': ' + d.paypalTotal.toLocaleString() + ' ' + d.currency + (d.live ? '' : ' (' + t('fxUnavailable') + ')');
      } catch (e) { if (out) out.textContent = t('fxUnavailable'); }
    };
    box.querySelector('#fx-cur').addEventListener('change', run);
    run();
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
      '<div class="feature-head"><span class="feature-title">' + t('honestTotal') + '</span></div>' +
      '<table>' +
      '<tr><td>' + t('itemPrice') + '</td><td>' + money(c.itemPrice) + '</td></tr>' +
      '<tr><td>' + t('paypalFee') + '</td><td>' + money(c.paypalFee) + '</td></tr>' +
      '<tr><td>' + t('intlFee') + '</td><td>' + money(c.internationalFee) + '</td></tr>' +
      '<tr><td>' + t('convSpread') + '</td><td>' + money(c.conversionSpread) + '</td></tr>' +
      '<tr class="total-row"><td><strong>' + t('totalEst') + '</strong></td><td><strong>' + money(c.total) + '</strong></td></tr>' +
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
      '<div id="fx-box"></div>' +
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
    renderFx(c.total, 'fx-box');
    $('import-country').addEventListener('change', async function () {
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
        '<tr class="total-row"><td><strong>' + t('totalEst') + ' + import</strong></td><td><strong>' + money(c.total + d.total) + '</strong></td></tr>' +
        '</table>' +
        '<p class="hint">' + (d.notes || []).join(' ') + '</p>';
      scrollChat();
    });
  }

  var GUARDRAILS_KEY = 'shoppal-guardrails';
  var CATEGORIES = ['Headphones', 'Smartwatch', 'Keyboard', 'Speaker', 'Charger', 'Mouse', 'Earbuds', 'Webcam', 'Power Bank'];
  function getGuardrails() {
    try {
      var g = JSON.parse(localStorage.getItem(GUARDRAILS_KEY) || 'null');
      if (g && typeof g === 'object') return { autoApproveLimit: Number(g.autoApproveLimit) || 20, categoryCaps: (g.categoryCaps && typeof g.categoryCaps === 'object') ? g.categoryCaps : {} };
    } catch (e) { /* fall through to defaults */ }
    return { autoApproveLimit: 20, categoryCaps: {} };
  }
  function saveGuardrailsLocal(g) {
    try { localStorage.setItem(GUARDRAILS_KEY, JSON.stringify(g)); } catch (e) { /* private mode */ }
  }

  // Settings modal (gear in the header): language, monthly budget, smart
  // guardrails, chat data. Budget + guardrails moved here from the Proof
  // Vault bubble (the vault keeps a summary + an "Open settings" button),
  // so every preference lives in one place.
  function renderSettings() {
    var body = $('settings-body');
    if (!body) return;
    var budget = getBudget();
    var gr = getGuardrails();
    $('settings-title').textContent = t('setTitle');
    $('settings-close').setAttribute('aria-label', t('setClose'));
    $('settings-btn').setAttribute('aria-label', t('setTitle'));
    body.innerHTML =
      '<section class="set-section"><h3>' + t('setLang') + '</h3>' +
      '<div class="seg" role="group" aria-label="' + t('setLang') + '">' +
      '<button type="button" class="seg-btn" data-lang-choice="auto">' + t('setLangAuto') + '</button>' +
      '<button type="button" class="seg-btn" data-lang-choice="en">English</button>' +
      '<button type="button" class="seg-btn" data-lang-choice="id">Bahasa Indonesia</button>' +
      '</div><p class="hint">' + t('setLangHint') + '</p></section>' +
      '<section class="set-section"><h3>' + t('budTitle') + '</h3>' +
      '<p><input id="set-budget-input" type="number" min="1" step="1" placeholder="' + t('budSet') + '" value="' + (budget || '') + '"> ' +
      '<button id="set-budget-save" type="button">' + t('budSave') + '</button> <span id="set-budget-status"></span></p></section>' +
      '<section class="set-section"><h3>' + t('grTitle') + '</h3>' +
      '<p class="hint">' + t('grIntro') + '</p>' +
      '<p><input id="set-gr-limit" type="number" min="0" step="1" value="' + gr.autoApproveLimit + '"> ' + t('grLimit') + '</p>' +
      CATEGORIES.map(function (c) {
        return '<p><input class="set-gr-cap" data-cat="' + c + '" type="number" min="0" step="1" value="' + (gr.categoryCaps[c] || '') + '"> ' + fmt(t('grCatCap'), { cat: c }) + '</p>';
      }).join('') +
      '<p><button id="set-gr-save" type="button">' + t('grSave') + '</button> <span id="set-gr-status"></span></p></section>' +
      '<section class="set-section"><h3>' + t('setData') + '</h3>' +
      '<p><button id="set-clear-chat" type="button" class="btn-secondary">' + t('setClearChat') + '</button> <span id="set-clear-status"></span></p>' +
      '<p class="hint">' + t('setClearHint') + '</p></section>';
    body.querySelectorAll('.seg-btn').forEach(function (b) {
      var choice = b.getAttribute('data-lang-choice');
      var active = (choice === 'auto' && !langManual) || langManual === choice;
      b.setAttribute('aria-pressed', active ? 'true' : 'false');
      b.classList.toggle('seg-active', active);
      b.addEventListener('click', function () { applyLangChoice(choice); });
    });
    body.querySelector('#set-budget-save').addEventListener('click', function () {
      var v = Number(body.querySelector('#set-budget-input').value);
      if (v > 0) setBudget(v);
      var st = $('set-budget-status');
      if (st) st.textContent = t('budSaved');
      refreshVaultSummary();
    });
    body.querySelector('#set-gr-save').addEventListener('click', async function () {
      var limit = Number(body.querySelector('#set-gr-limit').value);
      var caps = {};
      body.querySelectorAll('.set-gr-cap').forEach(function (inp) {
        var n = Number(inp.value);
        if (n > 0) caps[inp.getAttribute('data-cat')] = n;
      });
      var g = { autoApproveLimit: (Number.isFinite(limit) && limit >= 0) ? limit : 20, categoryCaps: caps };
      saveGuardrailsLocal(g);
      try {
        await fetch(API_BASE + '/api/guardrails', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(g),
        });
      } catch (e) { /* local copy still applies */ }
      var st = $('set-gr-status');
      if (st) st.textContent = t('grSaved');
      refreshVaultSummary();
    });
    body.querySelector('#set-clear-chat').addEventListener('click', function () {
      clearChatHistory();
      var st = $('set-clear-status');
      if (st) st.textContent = t('setCleared');
    });
  }
  function applyLangChoice(choice) {
    var keep = null;
    var body = $('settings-body');
    if (body) {
      var bi = body.querySelector('#set-budget-input');
      var gl = body.querySelector('#set-gr-limit');
      if (bi || gl) {
        keep = { budget: bi ? bi.value : null, limit: gl ? gl.value : null, caps: {} };
        body.querySelectorAll('.set-gr-cap').forEach(function (inp) { keep.caps[inp.getAttribute('data-cat')] = inp.value; });
      }
    }
    try {
      localStorage.setItem(LANG_KEY, choice);
      langManual = choice === 'auto' ? null : choice;
      lang = langManual || 'en';
    } catch (e) { langManual = choice === 'auto' ? null : choice; lang = langManual || 'en'; }
    applyStaticLang();
    renderSettings();
    if (keep) {
      var bi2 = $('set-budget-input');
      if (bi2 && keep.budget !== null) bi2.value = keep.budget;
      var gl2 = $('set-gr-limit');
      if (gl2 && keep.limit !== null) gl2.value = keep.limit;
      document.querySelectorAll('.set-gr-cap').forEach(function (inp) {
        var c = inp.getAttribute('data-cat');
        if (keep.caps[c] !== undefined) inp.value = keep.caps[c];
      });
    }
    refreshVaultSummary();
  }
  function applyStaticLang() {
    var ask = $('ask');
    if (ask) ask.setAttribute('placeholder', t('askPh'));
    var lbl = document.querySelector('.quick-demo-label');
    if (lbl) lbl.textContent = t('quickDemo');
  }
  function openSettings() {
    renderSettings();
    var ov = $('settings-overlay');
    if (!ov) return;
    ov.classList.remove('hidden');
    document.body.classList.add('modal-open');
    var closeBtn = $('settings-close');
    if (closeBtn) closeBtn.focus();
  }
  function closeSettings() {
    var ov = $('settings-overlay');
    if (ov) ov.classList.add('hidden');
    document.body.classList.remove('modal-open');
    var btn = $('settings-btn');
    if (btn) btn.focus();
  }
  function openVault() {
    showVault();
    var ov = $('vault-overlay');
    if (!ov) return;
    ov.classList.remove('hidden');
    document.body.classList.add('modal-open');
    var closeBtn = $('vault-close');
    if (closeBtn) closeBtn.focus();
  }
  function closeVault() {
    var ov = $('vault-overlay');
    if (ov) ov.classList.add('hidden');
    document.body.classList.remove('modal-open');
    var btn = $('vault-btn');
    if (btn) btn.focus();
  }
  function refreshVaultSummary() {
    showVault();
  }
  function clearChatHistory() {
    try {
      localStorage.removeItem(CHAT_HISTORY_KEY);
      localStorage.removeItem(CHAT_HISTORY_KEY + '-context');
      localStorage.removeItem(CHAT_HISTORY_KEY + '-split');
    } catch (e) { /* ignore */ }
    lastResults = null;
    lastSplit = null;
    if (chatEl) chatEl.innerHTML = '';
    greet();
    showVault();
  }
  async function checkGuardrailsRemote(totalUSD, category) {
    var g = getGuardrails();
    try {
      var res = await fetch(API_BASE + '/api/guardrails/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ totalUSD: totalUSD, category: category, lang: lang, autoApproveLimit: g.autoApproveLimit, categoryCaps: g.categoryCaps }),
      });
      if (res.ok) return await res.json();
    } catch (e) { /* fall through to local check */ }
    var reasons = [];
    if (totalUSD > g.autoApproveLimit) reasons.push(fmt(t('grAboveLimit'), { total: money(totalUSD), limit: money(g.autoApproveLimit) }));
    return { needsApproval: reasons.length > 0, reasons: reasons };
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
    // Monthly budget warning (background, never blocks the checkout UI).
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
    $('approve').addEventListener('change', (e) => {
      $('checkout-btn').disabled = !(e.target.checked && selected);
    });
    $('checkout-btn').addEventListener('click', startCheckout);
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


  // Sample Proof: a REAL Sandbox capture from this project's own E2E test
  // run (8 Nov 2026), shown so a judge can see the vault's format before
  // buying anything. Clearly labelled SAMPLE; nothing here is a live order.
  var SAMPLE_PROOF = {
    orderId: '7L12554580106983W',
    captureId: '4DA71960H4899750Y',
    captureStatus: 'COMPLETED',
    product: 'Aurora Wireless Headphones',
    seller: 'TechHub Official',
    riskScore: 100,
    riskLabel: 'Safe',
    totalUSD: 65.57
  };
  function sampleProofHtml() {
    var proof = {
      orderId: SAMPLE_PROOF.orderId,
      captureId: SAMPLE_PROOF.captureId,
      captureStatus: SAMPLE_PROOF.captureStatus,
      product: SAMPLE_PROOF.product,
      seller: SAMPLE_PROOF.seller,
      riskScore: SAMPLE_PROOF.riskScore,
      riskLabel: SAMPLE_PROOF.riskLabel,
      totalUSD: SAMPLE_PROOF.totalUSD
    };
    var dispute = {
      dispute_id: 'PP-D-SAMPLE-7L1255',
      reason: 'MERCHANDISE_OR_SERVICE_NOT_RECEIVED',
      status: 'OPEN',
      dispute_life_cycle_stage: 'INQUIRY'
    };
    var letter = 'Subject: Item Not Received - Order ' + SAMPLE_PROOF.orderId + '\n\n' +
      'Hello PayPal Resolution Center,\n\n' +
      'I am writing about order ' + SAMPLE_PROOF.orderId + ' (' + SAMPLE_PROOF.product + ', $' + SAMPLE_PROOF.totalUSD.toFixed(2) + ', paid via PayPal Sandbox). ' +
      'The payment was captured (Capture ID ' + SAMPLE_PROOF.captureId + ', status COMPLETED), but the item was never delivered.\n\n' +
      'Seller: ' + SAMPLE_PROOF.seller + ' (Risk Score ' + SAMPLE_PROOF.riskScore + '/100, ' + SAMPLE_PROOF.riskLabel + ').\n' +
      'Tracking: no tracking number was provided.\n\n' +
      'I request a refund of $' + SAMPLE_PROOF.totalUSD.toFixed(2) + ' under PayPal Purchase Protection (Merchandise or Service Not Received).\n\n' +
      'Proof attached: order receipt, capture confirmation, risk-score report.';
    return '<p><strong>Proof JSON</strong></p><pre>' + escapeHtml(JSON.stringify(proof, null, 2)) + '</pre>' +
      '<p><strong>Dispute draft (PayPal Disputes API format, simulated)</strong></p><pre>' + escapeHtml(JSON.stringify(dispute, null, 2)) + '</pre>' +
      '<p><strong>Pre-filled dispute letter</strong></p><pre>' + escapeHtml(letter) + '</pre>';
  }
  async function showVault() {
    // The vault lives in its own modal now, not in the chat: render into
    // the modal body (hidden until the user opens it) and keep the header
    // badge in sync.
    var box = $('vault-body');
    if (!box) return;
    var res = await fetch(API_BASE + '/api/vault');
    var data = await res.json();
    var body = '';
    if (!data.entries || data.entries.length === 0) {
      body = '<p>' + t('vaultEmpty') + '</p>';
    } else {
      lastVaultId = data.entries[0].id;
      body = data.entries.map((e) =>
        '<p><strong>' + (e.product?.name || e.id) + '</strong>, ' +
        (e.paypal?.status || 'unknown') + ' · Order ' + (e.paypal?.orderId || 'n/a') +
        (e.marketplace ? ' · ' + e.marketplace.name + ' (simulation)' : '') + '</p>'
      ).join('');
    }
    var vc = $('vault-count');
    if (vc) {
      var vn = (data.entries || []).length;
      vc.textContent = String(vn);
      vc.classList.toggle('hidden', vn === 0);
    }
    var subs = '';
    try {
      var sres = await fetch(API_BASE + '/api/subscriptions');
      var sdata = await sres.json();
      if (!sdata.patterns || !sdata.patterns.length) {
        subs = '<p><strong>' + t('subsTitle') + '</strong></p><p>' + t('subsEmpty') + '</p>';
      } else {
        subs = '<p><strong>' + t('subsTitle') + '</strong>, ' + t('subsFound') + '</p>' +
          sdata.patterns.map((p) =>
            '<p>' + fmt(t('subsLine'), { name: p.productName, n: p.purchases, total: money(p.totalSpent), date: p.lastPurchase ? p.lastPurchase.slice(0, 10) : 'n/a' }) + '</p>'
          ).join('');
      }
    } catch (e) {
      subs = '<p>' + t('subsUnavailable') + '</p>';
    }
    var budget = getBudget();
    var spent = monthSpend(data.entries || []);
    var gr = getGuardrails();
    var setHtml = '<div class="card"><p><strong>' + t('setTitle') + '</strong></p>' +
      '<p>' + (budget
        ? fmt(t('budSpent'), { spent: money(spent), budget: money(budget), pct: Math.round(spent / budget * 100) }) + ' ' +
          (spent > budget ? fmt(t('budOver'), { over: money(spent - budget) }) : fmt(t('budLeft'), { left: money(Math.round((budget - spent) * 100) / 100) }))
        : t('budNoBudget')) + '</p>' +
      '<p>' + fmt(t('setGrSummary'), { limit: money(gr.autoApproveLimit) }) + '</p>' +
      '<p><button id="vault-settings" type="button" class="btn-secondary">' + t('setOpen') + '</button></p></div>';
    var dwHtml = '<div class="card" id="dw-card"><p><strong>' + t('dwTitle') + '</strong></p><p class="hint">' + t('dwIntro') + '</p><p id="dw-body">…</p></div>';
    box.innerHTML =
      '<p><strong>Proof Vault</strong></p>' + body +
      '<div class="card" id="sample-proof-card"><p><strong>Sample Proof</strong> <span class="score score-safe">SAMPLE</span></p>' +
      '<p class="hint">A real Sandbox capture from our own test run - see exactly what the vault saves, before you buy anything.</p>' +
      '<p><button id="sample-proof-btn" type="button" class="btn-secondary">View Sample Proof</button></p>' +
      '<div id="sample-proof-body" class="hidden"></div></div>' +
      '<div class="card">' + subs + '</div>' +
      setHtml +
      dwHtml +
      '<div class="card" id="ex-card"><p><strong>' + t('exTitle') + '</strong></p><p id="ex-body">…</p></div>' +
      '<div class="card" id="pw-card"><p><strong>' + t('pwTitle') + '</strong></p><p class="hint">' + t('pwIntro') + '</p><p id="pw-body">…</p></div>' +
      '<div class="card" id="sb-card"><p><strong>' + t('sbTitle') + '</strong></p><p class="hint">' + t('sbIntro') + '</p><p id="sb-body"></p></div>' +
      '<div class="vault-actions"><button id="vault-refresh" type="button" class="btn-secondary">' + t('refreshVault') + '</button> ' +
      '<button id="dispute-btn" type="button" class="btn-secondary"' + (data.entries && data.entries.length ? '' : ' disabled') + '>' + t('disputeBtn') + '</button> ' +
      '<button id="sim-btn" type="button" class="btn-secondary"' + (data.entries && data.entries.length ? '' : ' disabled') + '>' + t('simBtn') + '</button> ' +
      '<button id="evidence-btn" type="button" class="btn-secondary"' + (data.entries && data.entries.length ? '' : ' disabled') + '>' + t('evBtn') + '</button> ' +
      '<button id="deadlines-btn" type="button" class="btn-secondary"' + (data.entries && data.entries.length ? '' : ' disabled') + '>' + t('dlBtn') + '</button> ' +
      '<button id="refund-btn" type="button" class="btn-secondary"' + (data.entries && data.entries.length ? '' : ' disabled') + '>' + t('refundBtn') + '</button> ' +
      '<button id="order-status-btn" type="button" class="btn-secondary"' + (data.entries && data.entries.length ? '' : ' disabled') + '>' + t('orderStatusBtn') + '</button></div>' +
      '<div id="dispute-draft" class="card hidden"></div>' +
      '<div id="vault-tools" class="card hidden"></div>' +
      '<div id="paypal-actions" class="card hidden"></div>';
    $('vault-refresh').addEventListener('click', function () { showVault(); });
    $('sample-proof-btn').addEventListener('click', function () {
      var b = $('sample-proof-body');
      if (!b) return;
      if (b.classList.contains('hidden')) {
        b.innerHTML = sampleProofHtml();
        b.classList.remove('hidden');
      } else {
        b.classList.add('hidden');
      }
    });
    // Budget + guardrails live in the Settings modal now; the vault keeps
    // a summary card with a button that opens it.
    $('vault-settings').addEventListener('click', function () { closeVault(); openSettings(); });
    // Delivery Watch (PayPal Tracking API + auto dispute draft).
    var renderDw = async function () {
      var box = $('dw-body');
      if (!box) return;
      try {
        var dres = await fetch(API_BASE + '/api/delivery-watch?lang=' + lang);
        var ddata = await dres.json();
        if (!ddata.items || !ddata.items.length) { box.innerHTML = '<p>' + t('dwNoOrders') + '</p>'; return; }
        box.innerHTML = ddata.items.slice(0, 3).map(function (it) {
          var line = '<p><strong>' + it.product + '</strong> · ' + fmt(t('dwStatus'), { status: it.status }) + ', ' +
            (it.overdue ? fmt(t('dwOverdue'), { n: it.days }) : fmt(t('dwOnTime'), { n: it.days })) + '</p>';
          if (it.overdue && it.autoDraft) line += '<p>' + t('dwDraftReady') + ' ' + t('simWinChance') + ': ' + it.autoDraft.winChance + '%</p>';
          if (!it.hasTracker) line += '<p><button type="button" class="btn-secondary dw-add" data-vault="' + it.vaultId + '">' + t('dwAddTracking') + '</button></p>';
          else line += '<p><button type="button" class="btn-secondary dw-check" data-vault="' + it.vaultId + '">' + t('dwCheck') + '</button></p>';
          return line;
        }).join('');
        box.querySelectorAll('.dw-add').forEach(function (b) {
          b.addEventListener('click', async function () {
            b.disabled = true;
            await fetch(API_BASE + '/api/tracking/add', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ vaultId: b.getAttribute('data-vault'), lang: lang }) });
            renderDw();
    // Expense dashboard (Proof Vault totals by category).
    (async function renderEx() {
      var box = $('ex-body');
      if (!box) return;
      try {
        var eres = await fetch(API_BASE + '/api/expenses');
        var edata = await eres.json();
        if (!edata.count) { box.innerHTML = '<p>' + t('exEmpty') + '</p>'; return; }
        var max = Math.max.apply(null, edata.byCategory.map(function (r) { return r.total; }).concat([1]));
        box.innerHTML = '<p><strong>' + t('exTotal') + ': ' + money(edata.total) + '</strong> (' + money(edata.monthTotal) + ' ' + t('exThisMonth') + ')</p>' +
          edata.byCategory.map(function (r) {
            var pct = Math.round(r.total / max * 100);
            return '<p>' + r.category + ' · ' + money(r.total) + ' (' + r.count + ')</p><div style="background:#e5e5e5;border-radius:4px;height:8px"><div style="background:#111111;border-radius:4px;height:8px;width:' + pct + '%"></div></div>';
          }).join('');
      } catch (e) { box.innerHTML = '<p>' + t('exEmpty') + '</p>'; }
    })();
          });
        });
        box.querySelectorAll('.dw-check').forEach(function (b) {
          b.addEventListener('click', async function () {
            b.disabled = true;
            await fetch(API_BASE + '/api/tracking/status?vaultId=' + encodeURIComponent(b.getAttribute('data-vault')) + '&lang=' + lang);
            renderDw();
          });
        });
      } catch (e) { box.innerHTML = '<p class="hint">' + t('dwNoOrders') + '</p>'; }
    };
    renderDw();
    // Price Watch list (simulated feed, labelled).
    var renderPw = async function () {
      var box = $('pw-body');
      if (!box) return;
      try {
        var pres = await fetch(API_BASE + '/api/price-watches');
        var pdata = await pres.json();
        if (!pdata.watches || !pdata.watches.length) { box.innerHTML = '<p>' + t('pwNoWatches') + '</p>'; return; }
        box.innerHTML = pdata.watches.slice(0, 3).map(function (w) {
          var line = '<p><strong>' + w.productName + '</strong> · ' + t('pwCurrent') + ': ' + money(w.currentPrice) + ' · ' + t('pwTargetPrice') + ': ' + money(w.targetPrice) + ' · ' + (w.status === 'triggered' ? fmt(t('pwTriggered'), { price: money(w.currentPrice) }) : t('pwWatching')) + '</p>';
          if (w.status === 'triggered') line += '<p><button type="button" class="pw-buy" data-product="' + w.productId + '">' + t('pwBuyNow') + '</button></p>';
          else line += '<p><button type="button" class="btn-secondary pw-check" data-watch="' + w.id + '">' + t('pwCheck') + '</button></p>';
          return line;
        }).join('') + '<p class="hint">' + t('pwSimNote') + '</p>';
        box.querySelectorAll('.pw-check').forEach(function (b) {
          b.addEventListener('click', async function () {
            b.disabled = true;
            await fetch(API_BASE + '/api/price-watch/check', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ watchId: b.getAttribute('data-watch') }) });
            renderPw();
          });
        });
        box.querySelectorAll('.pw-buy').forEach(function (b) {
          b.addEventListener('click', function () {
            var p = catalog.products.find(function (x) { return x.id === b.getAttribute('data-product'); });
            if (p) selectProduct(p);
          });
        });
      } catch (e) { box.innerHTML = '<p>' + t('pwNoWatches') + '</p>'; }
    };
    renderPw();
    // Split Bill (shares + message; collection happens in the PayPal app).
    (function renderSb() {
      var box = $('sb-body');
      if (!box) return;
      box.innerHTML = '<p><textarea id="sb-friends" rows="3" style="width:100%" placeholder="' + t('sbFriends') + '"></textarea></p>' +
        '<p><button id="sb-go" type="button">' + t('sbSplit') + '</button></p><div id="sb-out"></div>';
      box.querySelector('#sb-go').addEventListener('click', async function () {
        var out = $('sb-out');
        var friends = box.querySelector('#sb-friends').value;
        if (!friends.trim()) { out.innerHTML = '<p>' + t('sbNoFriends') + '</p>'; return; }
        out.textContent = '…';
        var body = { friends: friends, lang: lang };
        if (lastVaultId) body.vaultId = lastVaultId;
        else if (selected && selected.product) body.productId = selected.product.id;
        try {
          var res = await fetch(API_BASE + '/api/split-bill', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
          var d = await res.json();
          if (!res.ok) { out.innerHTML = '<p>' + (d.error || res.status) + '</p>'; return; }
          out.innerHTML = '<p><strong>' + d.product + '</strong> · ' + t('sbShare') + ': ' + money(d.share) + ' (' + d.people + ')</p><pre style="white-space:pre-wrap">' + d.message + '</pre>' +
            '<p><button id="spl-go" type="button">' + t('splMakeLinks') + '</button></p><div id="spl-out"></div>';
          out.querySelector('#spl-go').addEventListener('click', async function () {
            var splOut = $('spl-out');
            splOut.textContent = '…';
            var splBtn = out.querySelector('#spl-go');
            setBusy(splBtn, true, t('loadingAgent'));
            try {
              var r2 = await fetch(API_BASE + '/api/split-payment-link', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
              var d2 = await r2.json();
              setBusy(splBtn, false);
              if (!r2.ok) { splOut.innerHTML = '<p>' + (d2.error || r2.status) + '</p>'; return; }
              // A split made here is an active split session too.
              if (d2.productId) { lastSplit = { productId: d2.productId, share: d2.share, initiatorShare: d2.initiatorShare, total: d2.total, friends: d2.friends || [] }; saveLastSplit(); }
              var splHtml = '<div class="card split-card"><p><strong>' + t('splLinks') + '</strong></p>' +
                '<div class="split-breakdown">' +
                '<div class="row"><span>' + t('splTotal') + '</span><span class="num">' + money(d2.total) + '</span></div>' +
                '<div class="row"><span>' + t('sbShare') + '</span><span class="num">' + money(d2.share) + '</span></div>' +
                (d2.initiatorShare ? '<div class="row"><span>' + t('splInitiator') + '</span><span class="num">$' + d2.initiatorShare + '</span></div>' : '') +
                '</div>' +
                d2.links.map(function (l) {
                  return '<div class="split-link-row"><span>' + escapeHtml(l.friend) + ' · <span class="num badge-amount">' + money(l.amountUSD) + '</span> ' +
                    (l.status ? '<span class="score score-emerald">' + escapeHtml(l.status) + '</span>' : '') + '</span>' +
                    '<span class="split-link-actions">' +
                    (l.approveUrl ? '<a class="btn-primary" href="' + l.approveUrl + '" target="_blank" rel="noopener" style="display:inline-block;padding:0.55rem 0.8rem;border-radius:8px;text-decoration:none;min-height:44px;line-height:1.4">' + t('openPayPal') + ' ↗</a>' : '') +
                    (l.approveUrl ? '<button type="button" class="btn-secondary" data-copy="' + escapeHtml(l.approveUrl) + '" data-friend="' + escapeHtml(l.friend) + '">' + t('copyLink') + '</button>' : '') +
                    '</span></div>';
                }).join('') +
                '<p class="hint">' + t('splNote') + '</p></div>';
              splOut.innerHTML = splHtml;
              splOut.querySelectorAll('[data-copy]').forEach(function (b) {
                b.addEventListener('click', async function () {
                  var orig = b.textContent;
                  await copyText(b.getAttribute('data-copy'), fmt(t('toastCopyLink'), { name: b.getAttribute('data-friend') }));
                  b.textContent = t('copied');
                  setTimeout(function () { b.textContent = orig; }, 1800);
                });
              });
            } catch (e) { setBusy(splBtn, false); splOut.innerHTML = '<p>' + (e && e.message || e) + '</p>'; }
          });
        } catch (e) { out.innerHTML = '<p>' + (e && e.message || e) + '</p>'; }
      });
    })();
    // Dispute simulation for the latest vault entry (post-purchase case).
    $('sim-btn').addEventListener('click', async function () {
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
      wireSimCopy(box, d);
      scrollChat();
    });
    // Evidence Pack: download a printable proof page (order, capture,
    // risk, timeline) as a file the buyer can attach to a PayPal dispute.
    $('evidence-btn').addEventListener('click', async function () {
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
    $('deadlines-btn').addEventListener('click', async function () {
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
          else if (dl.status === 'expired') when = t('dlExpired') + ', ' + fmt(t('dlOverdue'), { days: -dl.daysLeft });
          else if (dl.daysLeft === 0) when = t('dlToday');
          else when = fmt(t('dlLeft'), { days: dl.daysLeft });
          return '<li><strong>' + dl.label + '</strong>, ' + when +
            (dl.dueDate ? ' (' + dl.dueDate.slice(0, 10) + ')' : '') + '</li>';
        }).join('') + '</ul>';
      scrollChat();
    });
    // Refund the latest vault entry (full amount, PayPal Sandbox).
    // Two clicks: the first arms the button, the second executes it.
    var refundBtn = $('refund-btn');
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
      box.innerHTML = '<p><strong>' + t('refundTitle') + '</strong>, ' +
        fmt(t('refundSuccess'), { id: d.refundId || 'n/a', status: d.status || 'n/a', amount: money(d.amount) }) + '</p>';
      await showVault();
      scrollChat();
    });
    // Live order status, re-verified with PayPal (not just the saved snapshot).
    $('order-status-btn').addEventListener('click', async function () {
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
        '<p>Order ' + (d.orderId || 'n/a') + ', ' + (d.orderStatus || 'n/a') +
        ' · Capture ' + (d.captureId || 'n/a') + ', ' + (d.captureStatus || 'n/a') +
        ' · ' + money(d.amount) + '</p>';
      scrollChat();
    });
    $('dispute-btn').addEventListener('click', async function () {
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
        '<p><strong>' + t('disputeTitle') + '</strong>, ' + fmt(t('disputeReadiness'), { n: d.readinessScore }) + '</p>' +
        '<p>' + d.draft + '</p>' +
        (d.missingProof && d.missingProof.length
          ? '<p>' + fmt(t('disputeMissing'), { list: d.missingProof.join(', ') }) + '</p>'
          : '<p>' + t('disputeNone') + '</p>');
      scrollChat();
    });
  }

  document.addEventListener('DOMContentLoaded', async () => {
    chatEl = $('chat');
    setupChatHistoryObserver();
    $('ask-btn').addEventListener('click', sendAsk);
    $('ask').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') sendAsk();
    });
    // The composer is a real form now: Enter submits it, so stop the
    // reload. The keydown handler above already calls sendAsk, so the
    // submit handler only prevents the default navigation.
    var chatForm = $('chat-form');
    if (chatForm) chatForm.addEventListener('submit', function (e) { e.preventDefault(); });
    // Modern AI Chat interaction: mark the clicked product card as
    // selected (single selection; compare mode manages its own selection)
    // and smooth-scroll to the newest message after a card or chip click.
    document.addEventListener('click', function (e) {
      var card = e.target.closest('.product-card');
      var chip = e.target.closest('.chip');
      if (card && !compareMode) {
        chatEl.querySelectorAll('.product-card.selected').forEach(function (el) { el.classList.remove('selected'); });
        card.classList.add('selected');
      }
      if (card || chip) {
        setTimeout(scrollChat, 120);
      }
    });
    // Settings modal: gear in the header opens it, Escape or a tap on
    // the backdrop closes it. The saved language applies to the static
    // chrome (composer placeholder, Quick Demo label) at startup.
    applyStaticLang();
    var settingsBtn = $('settings-btn');
    if (settingsBtn) settingsBtn.addEventListener('click', function () { openSettings(); });
    var settingsClose = $('settings-close');
    if (settingsClose) settingsClose.addEventListener('click', function () { closeSettings(); });
    var settingsOverlay = $('settings-overlay');
    if (settingsOverlay) settingsOverlay.addEventListener('click', function (e) { if (e.target === settingsOverlay) closeSettings(); });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && settingsOverlay && !settingsOverlay.classList.contains('hidden')) closeSettings();
    });
    // Proof Vault button in the header opens the vault modal (same
    // pattern as Settings); Escape or a tap on the backdrop closes it.
    var vaultBtn = $('vault-btn');
    if (vaultBtn) vaultBtn.addEventListener('click', function () { openVault(); });
    var vaultClose = $('vault-close');
    if (vaultClose) vaultClose.addEventListener('click', function () { closeVault(); });
    var vaultOverlay = $('vault-overlay');
    if (vaultOverlay) vaultOverlay.addEventListener('click', function (e) { if (e.target === vaultOverlay) closeVault(); });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && vaultOverlay && !vaultOverlay.classList.contains('hidden')) closeVault();
    });
    // Quick Demo chips: one tap fills the prompt and sends it, so a demo
    // scenario runs without typing.
    document.querySelectorAll('.quick-chip').forEach(function (chip) {
      chip.addEventListener('click', function () {
        var prompt = chip.getAttribute('data-prompt') || '';
        if (!prompt) return;
        $('ask').value = prompt;
        sendAsk();
      });
    });
    await loadConfig();
    await loadCatalog();
    // Restore the previous conversation (if any) before the fresh
    // greeting, so a refresh keeps the chat history and its context.
    restoreChatHistory();
    restoreLastSplit();
    // Re-wire product cards restored from history: their per-card
    // listeners are lost when the HTML is serialized, so a delegated
    // handler on the chat covers them. Fresh cards carry _wired (a JS
    // property, not serialized) and keep their own listeners, so the
    // delegated handler skips them and nothing fires twice.
    chatEl.addEventListener('click', function (e) {
      if (e.target.closest('a')) return; // e.g. "View on eBay" opens the link only
      var buyBtn = e.target.closest('.card-buy');
      if (buyBtn && !buyBtn._wired) {
        var pid = buyBtn.getAttribute('data-buy');
        if (pid && catalog) {
          var bp = catalog.products.find(function (x) { return x.id === pid; });
          if (bp) buyProduct(bp);
        }
        return;
      }
      var card = e.target.closest('.product-card');
      if (!card || card._wired) return;
      var pid = card.getAttribute('data-product');
      if (pid && catalog) {
        var p = catalog.products.find(function (x) { return x.id === pid; });
        if (!p) return;
        if (compareMode) {
          var idx = compareList.findIndex(function (x) { return x.id === p.id; });
          if (idx >= 0) compareList.splice(idx, 1);
          else if (compareList.length < 2) compareList.push(p);
          var inList = compareList.some(function (x) { return x.id === p.id; });
          card.classList.toggle('selected', inList);
          card.setAttribute('aria-pressed', inList ? 'true' : 'false');
          updateCompareBar();
          return;
        }
        selectProduct(p);
        return;
      }
      var raw = card.getAttribute('data-listing');
      if (raw) {
        try { selectMarketplaceItem(JSON.parse(decodeURIComponent(raw))); } catch (err) { /* ignore */ }
      }
    });
    greet();
    await showVault();
    loadHealth();
    var params = new URLSearchParams(window.location.search);
    if (params.get('cancelled') === '1') {
      addBubble('agent', '<p>' + t('checkoutCancelled') + '</p>');
    } else if (params.get('approved') === '1' && params.get('token')) {
      var orderId = params.get('token');
      var orderInfo = null;
      try {
        var ores = await fetch(API_BASE + '/api/paypal/order?orderId=' + encodeURIComponent(orderId));
        if (ores.ok) orderInfo = await ores.json();
      } catch (e) { /* guardrail check falls back to auto-capture */ }
      var doCapture = async function () {
        addBubble('agent', '<p>' + fmt(t('approvedCapturing'), { id: orderId }) + '</p>');
        var res = await fetch(API_BASE + '/api/paypal/capture-order', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ orderId: orderId }),
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
      };
      if (orderInfo && orderInfo.amount) {
        var chk = await checkGuardrailsRemote(orderInfo.amount, orderInfo.category);
        if (chk && chk.needsApproval) {
          var ab = addBubble('agent',
            '<p><strong>' + t('grNeedApproval') + '</strong></p>' +
            '<p>' + money(orderInfo.amount) + ' · ' + (orderInfo.category || '') + '</p>' +
            '<ul>' + chk.reasons.map(function (r) { return '<li>' + r + '</li>'; }).join('') + '</ul>' +
            '<p><button id="gr-approve" type="button">' + t('grApprove') + '</button> ' +
            '<button id="gr-reject" type="button" class="btn-secondary">' + t('grReject') + '</button></p>');
          ab.querySelector('#gr-approve').addEventListener('click', function () {
            ab.querySelector('#gr-approve').disabled = true;
            ab.querySelector('#gr-reject').disabled = true;
            addBubble('agent', '<p>' + t('grApproved') + '</p>');
            doCapture();
          });
          ab.querySelector('#gr-reject').addEventListener('click', function () {
            ab.querySelector('#gr-approve').disabled = true;
            ab.querySelector('#gr-reject').disabled = true;
            addBubble('agent', '<p>' + t('grRejected') + '</p>');
            window.history.replaceState({}, '', window.location.pathname);
          });
          return;
        }
      }
      await doCapture();
    }
  });
})();
