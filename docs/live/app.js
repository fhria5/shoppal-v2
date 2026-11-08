// ShopPal v2: 7-step demo flow, chat UI. No secrets here; the PayPal
// client ID comes from /api/config at runtime.
(function () {
  'use strict';

  // Live-server demo: the API is the Cloudflare Worker, not this origin.
  var API_BASE = 'https://shoppal-v2.fahriannor07.workers.dev';

  var catalog = null;
  var selected = null; // { product, seller, risk, cost }
  var lastResults = null; // products the last Ask reply showed, follow-ups ("yang termurah") refer to these
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
      agentApprove: 'Approve and pay with PayPal', agentPendingApproval: 'Pending Human Approval (Guardrail Triggered)',
      agentFailed: 'The agent could not finish that. Please try again.',
      vaultEmpty: 'No Proof Vault entries yet. Complete a successful checkout to save proof automatically.',
      subsTitle: 'Subscription Watcher',
      subsEmpty: 'No recurring purchases detected yet. Buy the same product twice and it shows up here with the total you have spent on it.',
      subsFound: 'recurring purchases found',
      subsLine: '{name}, bought {n}×, total spent {total}, last purchase {date}',
      subsUnavailable: 'Subscription Watcher unavailable.',
      refreshVault: 'Refresh Vault', disputeBtn: 'Draft a dispute',
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
      grLimit: 'Auto-approve up to (USD)', grSave: 'Save guardrails', grSaved: 'Guardrails saved.',
      grCatCap: 'Monthly cap for {cat} (USD, empty = no cap)',
      grNeedApproval: 'Needs your approval', grAboveLimit: 'This purchase ({total}) is above your auto-approve limit ({limit}).',
      grCatOver: 'This would take {cat} over its monthly cap ({spent} of {cap} spent).',
      grApprove: 'Approve and pay', grReject: 'Reject this purchase',
      grApproved: 'Approved, capturing payment...', grRejected: 'Purchase rejected. The PayPal order was not captured and will expire.',
      grAutoOk: 'Under your auto-approve limit, capturing...',
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
      splNote: 'Each friend gets their own PayPal Sandbox payment link for their share. You pay your own share through the normal checkout.', splLinks: 'Payment links', splMakeLinks: 'Make payment links', splPayLink: 'Pay link',
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
      agentApprove: 'Setujui dan bayar dengan PayPal', agentPendingApproval: 'Pending Human Approval (Guardrail Triggered)',
      agentFailed: 'Agen tidak bisa menyelesaikan itu. Coba lagi.',
      vaultEmpty: 'Belum ada entri Proof Vault. Selesaikan checkout yang berhasil untuk menyimpan bukti otomatis.',
      subsTitle: 'Pemantau Langganan',
      subsEmpty: 'Belum ada pembelian berulang. Beli produk yang sama dua kali dan akan muncul di sini beserta total yang sudah kamu belanjakan.',
      subsFound: 'pembelian berulang ditemukan',
      subsLine: '{name}, dibeli {n}×, total belanja {total}, pembelian terakhir {date}',
      subsUnavailable: 'Pemantau Langganan tidak tersedia.',
      refreshVault: 'Muat Ulang Vault', disputeBtn: 'Buat draf sengketa',
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
      grLimit: 'Setujui otomatis sampai (USD)', grSave: 'Simpan guardrails', grSaved: 'Guardrails tersimpan.',
      grCatCap: 'Batas bulanan untuk {cat} (USD, kosong = tanpa batas)',
      grNeedApproval: 'Butuh persetujuanmu', grAboveLimit: 'Pembelian ini ({total}) di atas batas setujui otomatis ({limit}).',
      grCatOver: 'Ini akan membuat {cat} melewati batas bulanannya ({spent} dari {cap} sudah terpakai).',
      grApprove: 'Setujui dan bayar', grReject: 'Tolak pembelian ini',
      grApproved: 'Disetujui, meng-capture pembayaran...', grRejected: 'Pembelian ditolak. Order PayPal tidak di-capture dan akan kedaluwarsa.',
      grAutoOk: 'Di bawah batas setujui otomatis, meng-capture...',
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
      splNote: 'Tiap teman dapat link bayar PayPal Sandbox sendiri untuk bagiannya. Bagianmu sendiri dibayar lewat checkout biasa.', splLinks: 'Link bayar', splMakeLinks: 'Buat link bayar', splPayLink: 'Link bayar',
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
    div.setAttribute('aria-hidden', 'true');
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
      '<span class="seller">Seller: ' + seller.name + '</span> ' +
      '<span class="score score-' + seller.riskProfile.toLowerCase() + ' card-score">' + seller.riskProfile + '</span></span></button>';
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
          var inList = compareList.some(function (x) { return x.id === p.id; });
          card.classList.toggle('selected', inList);
          card.setAttribute('aria-pressed', inList ? 'true' : 'false');
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
      '<div class="chips">' +
      '<button type="button" class="chip" data-q="headphones under $60">Headphones under $60</button>' +
      '<button type="button" class="chip" data-q="smartwatch">Smartwatch</button>' +
      '<button type="button" class="chip" data-q="keyboard">Keyboard</button>' +
      '<button type="button" class="chip" id="phish-chip">' + t('phChip') + '</button>' +
      '<button type="button" class="chip" id="compare-toggle">' + t('cmpToggle') + '</button>' +
      '</div>' +
      '<p class="hint">' + t('linkHint') + '</p>',
      'greeting');
    greeting.querySelector('#greet-dismiss').addEventListener('click', function () { greeting.remove(); });
    addBubble('agent',
      '<div id="compare-bar" class="card hidden"></div>' +
      '<div class="cards" id="catalog"></div>',
      'catalog');
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
        (r.product.image ? '<img src="/' + r.product.image + '" alt="' + r.product.name + '">' : '') +
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
  function isBuyGoal(q) {
    var s = ' ' + q.toLowerCase() + ' ';
    var buy = /(beli|belikan|bayar|bayarkan|pesan|checkout|buy|purchase|pay|order)/.test(s);
    var watch = /(pantau|memantau|watch|awasi|snipe|cek pantauan|cek harga|check (my )?(price )?watch)/.test(s);
    var split = /(patungan|split|bagi rata|bagi-bagi)/.test(s);
    var target = /(headphone|smartwatch|keyboard|speaker|charger|paling aman|termurah|terbaik|safest|cheapest|best|\$\s*\d|pantauan|watch)/.test(s);
    return (buy || watch || split) && target;
  }

  function renderAgentResult(ag, q) {
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
      var pend = document.createElement('p');
      pend.innerHTML = '<span class="score score-caution">' + t('agentPendingApproval') + '</span>';
      bubble.appendChild(pend);
      var btn = document.createElement('button');
      btn.className = 'btn-primary';
      btn.textContent = t('agentApprove');
      btn.addEventListener('click', async function () {
        btn.disabled = true;
        var typing2 = showTyping();
        try {
          var r2 = await fetch(API_BASE + '/api/agent', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: q, lang: lang, guardrails: getGuardrails(), approved: true, approvedOrder: ag.pendingOrder }),
          });
          var ag2 = await r2.json();
          hideTyping(typing2);
          if (r2.ok) renderAgentResult(ag2, q);
          else addBubble('agent', '<p>' + escapeHtml(ag2.error || String(r2.status)) + '</p>');
        } catch (e) {
          hideTyping(typing2);
          addBubble('agent', '<p>' + t('agentFailed') + '</p>');
        }
        scrollChat();
      });
      bubble.appendChild(btn);
    }
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
    // Pay Agent: buying goals go to the agent, everything else to Ask.
    if (isBuyGoal(q)) {
      try {
        var agRes = await fetch(API_BASE + '/api/agent', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: q, lang: lang, guardrails: getGuardrails() }),
        });
        var ag = await agRes.json();
        hideTyping(typing);
        if (!agRes.ok) {
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
    var askParams = new URLSearchParams({ q, lang });
    if (lastResults && lastResults.length) {
      askParams.set('context', lastResults.map((p) => p.id).join(','));
    }
    var res = await fetch(API_BASE + '/api/ask?' + askParams.toString());
    var data = await res.json();
    var products = data.products || catalog.products;
    lastResults = products;
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
    if (d.disputePayload) html += '<p><strong>' + t('simPayloadTitle') + '</strong></p><pre style="white-space:pre-wrap;font-size:12px">' + escapeHtml(JSON.stringify(d.disputePayload, null, 2)) + '</pre>';
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
      bubble.querySelector('#pw-watch-btn').addEventListener('click', async function () {
        var target = Number(bubble.querySelector('#pw-target').value);
        var st = $('pw-status');
        if (!target || target <= 0) { if (st) st.textContent = t('pwTarget'); return; }
        try {
          var res = await fetch(API_BASE + '/api/price-watch', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ productId: selected.product.id, targetPrice: target, lang: lang }) });
          var d = await res.json();
          if (st) st.textContent = res.ok ? (t('pwWatching') + ': ' + money(d.currentPrice) + ' → ' + money(d.targetPrice)) : (d.error || res.status);
        } catch (e) { if (st) st.textContent = String(e && e.message || e); }
      });
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
    bubble.querySelector('#hrc-btn').addEventListener('click', async function () {
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
        '<tr class="total-row"><td><strong>' + t('totalEst') + ' + import</strong></td><td><strong>' + money(c.total + d.total) + '</strong></td></tr>' +
        '</table>' +
        '<p class="hint">' + (d.notes || []).join(' ') + '</p>';
      scrollChat();
    });
  }

  var GUARDRAILS_KEY = 'shoppal-guardrails';
  var CATEGORIES = ['Headphones', 'Smartwatch', 'Keyboard', 'Speaker', 'Charger'];
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
        '<p><strong>' + (e.product?.name || e.id) + '</strong>, ' +
        (e.paypal?.status || 'unknown') + ' · Order ' + (e.paypal?.orderId || 'n/a') +
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
    var budHtml = '<div class="card"><p><strong>' + t('budTitle') + '</strong></p>' +
      '<p><input id="budget-input" type="number" min="1" step="1" placeholder="' + t('budSet') + '" value="' + (budget || '') + '" style="width:130px"> ' +
      '<button id="budget-save" type="button">' + t('budSave') + '</button></p>' +
      '<p id="budget-status">' + (budget
        ? fmt(t('budSpent'), { spent: money(spent), budget: money(budget), pct: Math.round(spent / budget * 100) }) + ' ' +
          (spent > budget ? fmt(t('budOver'), { over: money(spent - budget) }) : fmt(t('budLeft'), { left: money(Math.round((budget - spent) * 100) / 100) }))
        : t('budNoBudget')) + '</p></div>';
    var gr = getGuardrails();
    var grHtml = '<div class="card"><p><strong>' + t('grTitle') + '</strong></p>' +
      '<p class="hint">' + t('grIntro') + '</p>' +
      '<p><input id="gr-limit" type="number" min="0" step="1" value="' + gr.autoApproveLimit + '" style="width:90px"> ' + t('grLimit') + '</p>' +
      CATEGORIES.map(function (c) {
        return '<p><input class="gr-cap" data-cat="' + c + '" type="number" min="0" step="1" value="' + (gr.categoryCaps[c] || '') + '" style="width:90px"> ' + fmt(t('grCatCap'), { cat: c }) + '</p>';
      }).join('') +
      '<p><button id="gr-save" type="button">' + t('grSave') + '</button> <span id="gr-status"></span></p></div>';
    var dwHtml = '<div class="card" id="dw-card"><p><strong>' + t('dwTitle') + '</strong></p><p class="hint">' + t('dwIntro') + '</p><p id="dw-body">…</p></div>';
    var bubble = addBubble('agent',
      '<p><strong>Proof Vault</strong></p>' + body +
      '<div class="card">' + subs + '</div>' +
      budHtml +
      grHtml +
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
      '<div id="paypal-actions" class="card hidden"></div>',
      'vault');
    bubble.querySelector('#vault-refresh').addEventListener('click', function () { showVault(); });
    // Monthly budget (stored in this browser).
    bubble.querySelector('#budget-save').addEventListener('click', function () {
      var v = Number(bubble.querySelector('#budget-input').value);
      if (v > 0) setBudget(v);
      showVault();
    });
    // Smart Guardrails (stored in this browser + on the server).
    bubble.querySelector('#gr-save').addEventListener('click', async function () {
      var limit = Number(bubble.querySelector('#gr-limit').value);
      var caps = {};
      bubble.querySelectorAll('.gr-cap').forEach(function (inp) {
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
      var st = $('gr-status');
      if (st) st.textContent = t('grSaved');
    });
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
            try {
              var r2 = await fetch(API_BASE + '/api/split-payment-link', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
              var d2 = await r2.json();
              if (!r2.ok) { splOut.innerHTML = '<p>' + (d2.error || r2.status) + '</p>'; return; }
              splOut.innerHTML = '<p><strong>' + t('splLinks') + '</strong></p><ul>' + d2.links.map(function (l) {
                return '<li>' + escapeHtml(l.friend) + ' · ' + money(l.amountUSD) + (l.approveUrl ? ' · <a href="' + l.approveUrl + '" target="_blank" rel="noopener">' + t('splPayLink') + '</a> (' + escapeHtml(l.orderId) + ')' : ' · ' + escapeHtml(l.error || '')) + '</li>';
              }).join('') + '</ul><p class="hint">' + t('splNote') + '</p>';
            } catch (e) { splOut.innerHTML = '<p>' + (e && e.message || e) + '</p>'; }
          });
        } catch (e) { out.innerHTML = '<p>' + (e && e.message || e) + '</p>'; }
      });
    })();
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
      box.innerHTML = '<p><strong>' + t('refundTitle') + '</strong>, ' +
        fmt(t('refundSuccess'), { id: d.refundId || 'n/a', status: d.status || 'n/a', amount: money(d.amount) }) + '</p>';
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
        '<p>Order ' + (d.orderId || 'n/a') + ', ' + (d.orderStatus || 'n/a') +
        ' · Capture ' + (d.captureId || 'n/a') + ', ' + (d.captureStatus || 'n/a') +
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
