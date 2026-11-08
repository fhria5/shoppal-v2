// ShopPal v2 — static demo for GitHub Pages, chat UI.
// Same 7-step flow as the Node.js server, running fully in the browser:
// risk score and total cost use the same rule formulas as server.js;
// checkout uses the official PayPal JS SDK (Sandbox); Proof Vault lives
// in localStorage. No secrets here — the Client ID in index.html is
// a public identifier.
(function () {
  'use strict';

  // Demo catalog (same data as data/catalog.json). Photos are AI-generated
  // illustrations of generic products, not real listings.
  var IMAGE = {
    Headphones: './images/headphones.jpg',
    Smartwatch: './images/smartwatch.jpg',
    Keyboard: './images/keyboard.jpg',
    Speaker: './images/speaker.jpg',
    Charger: './images/charger.jpg'
  };
  var CATALOG = {
    products: [
      { id: 'p01', name: 'Aurora Wireless Headphones', priceUSD: 59.99, referencePriceUSD: 59.99, category: 'Headphones', sellerId: 'seller-safe' },
      { id: 'p02', name: 'Aurora Wireless Headphones', priceUSD: 54.99, referencePriceUSD: 59.99, category: 'Headphones', sellerId: 'seller-caution' },
      { id: 'p03', name: 'Aurora Wireless Headphones', priceUSD: 29.99, referencePriceUSD: 59.99, category: 'Headphones', sellerId: 'seller-risky' },
      { id: 'p04', name: 'Pulse Smartwatch Series 5', priceUSD: 89.00, referencePriceUSD: 89.00, category: 'Smartwatch', sellerId: 'seller-safe' },
      { id: 'p05', name: 'Pulse Smartwatch Series 5', priceUSD: 44.00, referencePriceUSD: 89.00, category: 'Smartwatch', sellerId: 'seller-risky' },
      { id: 'p06', name: 'Nova Mechanical Keyboard', priceUSD: 79.00, referencePriceUSD: 79.00, category: 'Keyboard', sellerId: 'seller-safe' },
      { id: 'p07', name: 'Nova Mechanical Keyboard', priceUSD: 69.00, referencePriceUSD: 79.00, category: 'Keyboard', sellerId: 'seller-caution' },
      { id: 'p08', name: 'Echo Bluetooth Speaker', priceUSD: 39.99, referencePriceUSD: 39.99, category: 'Speaker', sellerId: 'seller-safe' },
      { id: 'p09', name: 'Echo Bluetooth Speaker', priceUSD: 19.99, referencePriceUSD: 39.99, category: 'Speaker', sellerId: 'seller-risky' },
      { id: 'p10', name: 'Volt 65W GaN Charger', priceUSD: 24.99, referencePriceUSD: 24.99, category: 'Charger', sellerId: 'seller-caution' }
    ],
    sellers: [
      { id: 'seller-safe', name: 'TechHub Official', riskProfile: 'Safe', accountAgeYears: 4.2, profileComplete: true, totalTransactions: 12400, disputeRate: 0.4, hasTracking: true, hasReturnPolicy: true },
      { id: 'seller-caution', name: 'GadgetZone ID', riskProfile: 'Caution', accountAgeYears: 1.1, profileComplete: true, totalTransactions: 340, disputeRate: 2.8, hasTracking: true, hasReturnPolicy: false },
      { id: 'seller-risky', name: 'DealHunter88', riskProfile: 'Risky', accountAgeYears: 0.2, profileComplete: false, totalTransactions: 18, disputeRate: 6.5, hasTracking: false, hasReturnPolicy: false }
    ]
  };

  var VAULT_KEY = 'shoppal-vault-v1';
  // Refund and live order status run on the deployed Worker (the static
  // demo has no server of its own). CORS on the Worker is open.
  var WORKER_API = 'https://shoppal-v2.fahriannor07.workers.dev';
  var selected = null; // { product, seller, risk, cost }
  var lastResults = null; // products the last Ask reply showed — follow-ups ("yang termurah") refer to these

  // Bilingual replies (Dwibahasa). The agent answers in the language the
  // buyer types: Indonesian when the message has Indonesian words, English
  // otherwise (English is the demo's default — Devpost requires English
  // materials). The greeting stays English (it renders before any input).
  var lang = 'en';
  function detectLang(text) {
    return /\b(di|yang|mau|aku|saya|murah|termurah|terbaik|paling|bawah|dari|ada|garansi|pertama|berapa|cari|beli|baru|dan|untuk|dengan|ini|itu|aja|saja|tolong|dong)\b/i.test(String(text || ''))
      ? 'id'
      : 'en';
  }
  function fmt(template, vars) {
    return String(template).replace(/\{(\w+)\}/g, function (_, k) { return vars[k] !== undefined ? vars[k] : '{' + k + '}'; });
  }
  function t(key) {
    var dict = STR[lang] || STR.en;
    return dict[key] !== undefined ? dict[key] : STR.en[key];
  }
  function labelText(label) { return t('label' + label); }
  function holdLabelText(label) { return t('hold' + label); }
  var STR = {
    en: {
      understood: 'Understood:', noCategory: 'no category or budget found',
      under: 'under $', fromSeller: 'from {seller} only', withReturns: 'with returns', withTracking: 'with tracking',
      cheapestFirst: 'cheapest first', bestFirst: 'best match first',
      noteCheapest: 'Matches sorted cheapest first.', noteBest: 'Best match first (safest, then cheapest).',
      noteSafest: 'Matches sorted safest first.', noteNoMatch: 'No exact match in the demo catalog — showing all 10 demo products.',
      riskScore: 'Risk Score', labelSafe: 'Safe', labelCaution: 'Caution', labelRisky: 'Risky',
      recommendation: 'Recommendation:', watchOut: 'Watch out:', beforeYouPay: 'Before you pay:',
      riskProfileLow: 'This seller account is new or its profile is incomplete.',
      riskProfileHigh: 'This seller has an established, complete profile.',
      riskHistoryLow: 'This seller has a high dispute rate compared with other sellers.',
      riskHistoryHigh: 'This seller has a low dispute rate across many transactions.',
      riskPriceLow: 'This price is far below the category median — a common scam pattern.',
      riskTrackingLow: 'This seller does not offer tracking or a clear return policy.',
      riskPriceFair: 'The price is fair for this category, with tracking and returns offered.',
      recSafe: 'Safe to proceed with PayPal Goods & Services.',
      recCaution: 'Proceed with caution. Use PayPal Goods & Services — never Friends & Family.',
      recRisky: 'Risky. Consider an alternative seller before paying.',
      comparison: 'Safer than {n} of {total} demo listings.',
      warning: 'Too-good-to-be-true pattern: a price far below the median from a seller with a high dispute rate. This is the most common scam shape in the demo.',
      checklistSafe: ['Pay with PayPal Goods & Services (not Friends & Family).', 'Save the tracking number when the seller ships.', 'Keep the Proof Vault entry — it is saved automatically.'],
      checklistCaution: ['Pay only with PayPal Goods & Services.', 'Ask the seller for tracking before the money clears.', 'If the seller asks you to pay outside PayPal, stop — that voids Buyer Protection.'],
      checklistRisky: ['Do not pay this seller if you can avoid it.', 'If you still proceed, use Goods & Services only — never Friends & Family.', 'Screenshot the listing and the chat before paying; you will need them for a dispute.'],
      aiNoteStatic: 'AI explanation unavailable in the static demo — showing rule-based reasons.',
      holdTitle: 'Hold Predictor', holdLow: 'Low', holdModerate: 'Moderate', holdHigh: 'High',
      holdHint: 'Estimate from public hold patterns, not a PayPal decision.',
      holdChanceLow: 'under 5% (estimate)', holdChanceModerate: '5–20% (estimate)', holdChanceHigh: 'over 20% (estimate)',
      holdDisputeVeryHigh: 'Dispute rate is very high ({rate}%).', holdDisputeHigh: 'Dispute rate is above average ({rate}%).',
      holdDisputeSlight: 'Dispute rate is slightly above 1%.', holdAge6m: 'Seller account is less than 6 months old.',
      holdAge18m: 'Seller account is less than 18 months old.', holdAge3y: 'Seller account is less than 3 years old.',
      holdTxFew: 'Very few completed transactions ({tx}).', holdTxSome: 'Relatively few completed transactions.',
      holdPriceHalf: 'Price is 50% or more below the category median.', holdPriceBelow: 'Price is notably below the category median.',
      holdNoTracking: 'No tracking offered, so delivery is harder to prove.', holdNoSignals: 'No hold-risk signals in this seller pattern.',
      holdTipLow: 'Funds usually clear on the normal schedule for this pattern.',
      holdTipHigh: 'Ask the seller to upload tracking promptly, and keep the order total close to the seller’s usual range.',
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
      protectionLabel: 'Buyer Protection:', protection: 'PayPal Buyer Protection covers Goods & Services payments. Friends & Family payments are not covered.',
      troubleNote: 'Public PayPal merchant fee schedule (US, Oct 2026). Estimates, not a quote.',
      costNote: 'Estimated fees. PayPal Checkout 3.49% + $0.49, international 1.5%, conversion spread ~3.5%.',
      readyToPay: 'Ready to pay?', neverPay: 'I never pay without your approval.',
      approveLabel: 'I reviewed the risk score and total cost, and I approve this payment.',
      checkoutHint: 'Pay with the gold PayPal button above. Approve with a PayPal Sandbox Personal (buyer) account — no real money is involved. The order total is exactly the total shown above.',
      sdkFailed: 'PayPal SDK failed to load. Check your connection and reload.',
      tickFirst: 'Please tick the approval checkbox first.', creatingOrder: 'Creating PayPal order…',
      approvedCapturing: 'PayPal approved order {id} — capturing…',
      captureFailed: 'Capture did not complete (status: {status}). Nothing was saved to the Proof Vault.',
      paymentCaptured: 'Payment captured: {id}',
      successTitle: 'Success — paid {total} via PayPal Sandbox.',
      successProof: 'Proof was saved to the Proof Vault automatically (this browser).',
      checkoutCancelled: 'Checkout was cancelled in PayPal. No payment was made.',
      checkoutError: 'PayPal checkout error: {msg}',
      vaultEmpty: 'No Proof Vault entries yet. Complete a successful checkout to save proof automatically.',
      subsTitle: 'Subscription Watcher',
      subsEmpty: 'No recurring purchases detected yet. Buy the same product twice and it shows up here with the total you have spent on it.',
      subsFound: 'recurring purchases found',
      subsLine: '{name} — bought {n}×, total spent {total}, last purchase {date}',
      refreshVault: 'Refresh Vault', disputeBtn: 'Simulate Dispute',
      disputeNotFound: 'Proof Vault entry not found. Save a successful checkout first.',
      refundBtn: 'Refund (Sandbox)', refundConfirm: 'Confirm refund?', refundTitle: 'Refund',
      refundSuccess: 'Refund {id} — {status}, {amount}.', refundFailed: 'Refund failed: {msg}',
      refundAlready: 'Already refunded.', orderStatusBtn: 'Check live status',
      orderStatusTitle: 'Live order status (PayPal)',
      orderStatusFailed: 'Could not check the order status: {msg}',
      disputeTitle: 'Simulated dispute draft', disputeReadiness: 'readiness {n}/100',
      disputeBody: 'Dispute response draft (simulated, factual only): Order {order} for {product} ({total}) was paid via PayPal Sandbox and captured as {status}. Seller: {seller} (risk score {score} at checkout). Proof is attached in the Proof Vault entry {id}.',
      disputeMissing: 'Still missing: {list}', disputeNone: 'No proof missing.',
      sdkNotLoaded: 'PayPal SDK did not load yet — it loads from paypal.com; check your connection and reload the page if the PayPal button never appears.'
    },
    id: {
      understood: 'Mengerti:', noCategory: 'tidak ada kategori atau budget yang dikenali',
      under: 'di bawah $', fromSeller: 'dari {seller} saja', withReturns: 'ada garansi/retur', withTracking: 'ada tracking',
      cheapestFirst: 'termurah dulu', bestFirst: 'terbaik dulu',
      noteCheapest: 'Hasil diurutkan termurah dulu.', noteBest: 'Hasil terbaik dulu (paling aman, lalu termurah).',
      noteSafest: 'Hasil diurutkan paling aman dulu.', noteNoMatch: 'Tidak ada yang cocok di katalog demo — menampilkan 10 produk demo.',
      riskScore: 'Skor Risiko', labelSafe: 'Aman', labelCaution: 'Hati-hati', labelRisky: 'Berisiko',
      recommendation: 'Rekomendasi:', watchOut: 'Perhatian:', beforeYouPay: 'Sebelum bayar:',
      riskProfileLow: 'Akun seller ini baru atau profilnya belum lengkap.',
      riskProfileHigh: 'Seller ini sudah lama dan profilnya lengkap.',
      riskHistoryLow: 'Seller ini punya tingkat sengketa tinggi dibanding seller lain.',
      riskHistoryHigh: 'Seller ini punya tingkat sengketa rendah dari banyak transaksi.',
      riskPriceLow: 'Harga ini jauh di bawah median kategori — pola scam yang umum.',
      riskTrackingLow: 'Seller ini tidak menyediakan tracking atau kebijakan retur yang jelas.',
      riskPriceFair: 'Harganya wajar untuk kategori ini, dengan tracking dan retur.',
      recSafe: 'Aman lanjut dengan PayPal Goods & Services.',
      recCaution: 'Lanjut dengan hati-hati. Pakai PayPal Goods & Services — jangan Friends & Family.',
      recRisky: 'Berisiko. Pertimbangkan seller lain sebelum bayar.',
      comparison: 'Lebih aman dari {n} dari {total} listing demo.',
      warning: 'Pola terlalu-bagus-untuk-jadi-kenyataan: harga jauh di bawah median dari seller dengan tingkat sengketa tinggi. Ini pola scam paling umum di demo.',
      checklistSafe: ['Bayar dengan PayPal Goods & Services (bukan Friends & Family).', 'Simpan nomor tracking saat seller mengirim.', 'Simpan entri Proof Vault — tersimpan otomatis.'],
      checklistCaution: ['Bayar hanya dengan PayPal Goods & Services.', 'Minta tracking ke seller sebelum dananya cair.', 'Kalau seller minta bayar di luar PayPal, berhenti — itu membatalkan Perlindungan Pembeli.'],
      checklistRisky: ['Jangan bayar seller ini kalau bisa dihindari.', 'Kalau tetap lanjut, pakai Goods & Services saja — jangan Friends & Family.', 'Screenshot listing dan chat sebelum bayar; kamu akan butuh untuk sengketa.'],
      aiNoteStatic: 'Penjelasan AI tidak tersedia di demo statis — menampilkan alasan berbasis aturan.',
      holdTitle: 'Prediktor Hold', holdLow: 'Rendah', holdModerate: 'Sedang', holdHigh: 'Tinggi',
      holdHint: 'Perkiraan dari pola hold publik, bukan keputusan PayPal.',
      holdChanceLow: 'di bawah 5% (perkiraan)', holdChanceModerate: '5–20% (perkiraan)', holdChanceHigh: 'di atas 20% (perkiraan)',
      holdDisputeVeryHigh: 'Tingkat sengketa sangat tinggi ({rate}%).', holdDisputeHigh: 'Tingkat sengketa di atas rata-rata ({rate}%).',
      holdDisputeSlight: 'Tingkat sengketa sedikit di atas 1%.', holdAge6m: 'Akun seller berumur kurang dari 6 bulan.',
      holdAge18m: 'Akun seller berumur kurang dari 18 bulan.', holdAge3y: 'Akun seller berumur kurang dari 3 tahun.',
      holdTxFew: 'Transaksi selesai sangat sedikit ({tx}).', holdTxSome: 'Transaksi selesai relatif sedikit.',
      holdPriceHalf: 'Harga 50% atau lebih di bawah median kategori.', holdPriceBelow: 'Harga jauh di bawah median kategori.',
      holdNoTracking: 'Tidak ada tracking, jadi pengiriman sulit dibuktikan.', holdNoSignals: 'Tidak ada sinyal risiko hold pada pola seller ini.',
      holdTipLow: 'Dana biasanya cair sesuai jadwal normal untuk pola ini.',
      holdTipHigh: 'Minta seller segera mengunggah tracking, dan jaga total order tetap dekat dengan kisaran biasa seller.',
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
      protectionLabel: 'Perlindungan Pembeli:', protection: 'Perlindungan Pembeli PayPal mencakup pembayaran Goods & Services. Pembayaran Friends & Family tidak dilindungi.',
      troubleNote: 'Jadwal biaya merchant PayPal publik (AS, Okt 2026). Perkiraan, bukan penawaran.',
      costNote: 'Perkiraan biaya. PayPal Checkout 3.49% + $0.49, internasional 1.5%, selisih kurs ~3.5%.',
      readyToPay: 'Siap bayar?', neverPay: 'Saya tidak pernah bayar tanpa persetujuanmu.',
      approveLabel: 'Saya sudah memeriksa skor risiko dan total biaya, dan saya menyetujui pembayaran ini.',
      checkoutHint: 'Bayar dengan tombol PayPal emas di atas. Setujui dengan akun Personal (buyer) PayPal Sandbox — tidak ada uang asli yang terlibat. Total order sama persis dengan total di atas.',
      sdkFailed: 'PayPal SDK gagal dimuat. Periksa koneksi dan muat ulang.',
      tickFirst: 'Centang kotak persetujuan dulu.', creatingOrder: 'Membuat order PayPal…',
      approvedCapturing: 'PayPal menyetujui order {id} — meng-capture…',
      captureFailed: 'Capture tidak selesai (status: {status}). Tidak ada yang tersimpan ke Proof Vault.',
      paymentCaptured: 'Pembayaran berhasil di-capture: {id}',
      successTitle: 'Berhasil — dibayar {total} via PayPal Sandbox.',
      successProof: 'Bukti tersimpan otomatis ke Proof Vault (browser ini).',
      checkoutCancelled: 'Checkout dibatalkan di PayPal. Tidak ada pembayaran.',
      checkoutError: 'Error checkout PayPal: {msg}',
      vaultEmpty: 'Belum ada entri Proof Vault. Selesaikan checkout yang berhasil untuk menyimpan bukti otomatis.',
      subsTitle: 'Pemantau Langganan',
      subsEmpty: 'Belum ada pembelian berulang. Beli produk yang sama dua kali dan akan muncul di sini beserta total yang sudah kamu belanjakan.',
      subsFound: 'pembelian berulang ditemukan',
      subsLine: '{name} — dibeli {n}×, total belanja {total}, pembelian terakhir {date}',
      refreshVault: 'Muat Ulang Vault', disputeBtn: 'Simulasikan Sengketa',
      disputeNotFound: 'Entri Proof Vault tidak ditemukan. Simpan checkout yang berhasil dulu.',
      refundBtn: 'Refund (Sandbox)', refundConfirm: 'Konfirmasi refund?', refundTitle: 'Refund',
      refundSuccess: 'Refund {id} — {status}, {amount}.', refundFailed: 'Refund gagal: {msg}',
      refundAlready: 'Sudah di-refund.', orderStatusBtn: 'Cek status live',
      orderStatusTitle: 'Status order live (PayPal)',
      orderStatusFailed: 'Tidak bisa cek status order: {msg}',
      disputeTitle: 'Draf sengketa simulasi', disputeReadiness: 'kesiapan {n}/100',
      disputeBody: 'Draf jawaban sengketa (simulasi, hanya fakta): Order {order} untuk {product} ({total}) dibayar via PayPal Sandbox dan di-capture sebagai {status}. Seller: {seller} (skor risiko {score} saat checkout). Bukti terlampir di entri Proof Vault {id}.',
      disputeMissing: 'Masih kurang: {list}', disputeNone: 'Tidak ada bukti yang kurang.',
      sdkNotLoaded: 'PayPal SDK belum dimuat — dimuat dari paypal.com; periksa koneksi dan muat ulang halaman jika tombol PayPal tidak muncul.'
    }
  };
  var lastVaultId = null;
  var paypalRenderToken = 0;

  var $ = function (id) { return document.getElementById(id); };
  var money = function (n) { return '$' + Number(n).toFixed(2); };
  var chatEl = null;

  // Risk Score (same formulas as server.js)
  function scoreProfile(s) {
    return Math.round(Math.min(s.accountAgeYears / 3, 1) * 60 + (s.profileComplete ? 40 : 0));
  }
  function scoreHistory(s) {
    if (s.disputeRate <= 1) return 100;
    if (s.disputeRate >= 5) return 0;
    return Math.round(100 - ((s.disputeRate - 1) / 4) * 100);
  }
  function scorePrice(p) {
    var median = p.referencePriceUSD;
    if (!median || median <= 0) return 50;
    var deviation = Math.abs(p.priceUSD / median - 1);
    if (deviation <= 0.2) return 100;
    if (deviation >= 0.5) return 0;
    return Math.round(100 - ((deviation - 0.2) / 0.3) * 100);
  }
  function scoreTracking(s) {
    if (s.hasTracking && s.hasReturnPolicy) return 100;
    if (s.hasTracking || s.hasReturnPolicy) return 50;
    return 0;
  }
  function calculateRiskScore(seller, product) {
    var components = {
      profile: scoreProfile(seller),
      history: scoreHistory(seller),
      price: scorePrice(product),
      tracking: scoreTracking(seller)
    };
    var total = Math.round(components.profile * 0.25 + components.history * 0.35 + components.price * 0.2 + components.tracking * 0.2);
    var label = total >= 80 ? 'Safe' : total >= 50 ? 'Caution' : 'Risky';
    var reasons = [];
    reasons.push(components.profile < 60 ? t('riskProfileLow') : t('riskProfileHigh'));
    reasons.push(components.history < 60 ? t('riskHistoryLow') : t('riskHistoryHigh'));
    if (components.price < 60) reasons.push(t('riskPriceLow'));
    else if (components.tracking < 60) reasons.push(t('riskTrackingLow'));
    else reasons.push(t('riskPriceFair'));
    var recommendation = label === 'Safe'
      ? t('recSafe')
      : label === 'Caution'
        ? t('recCaution')
        : t('recRisky');
    return { score: total, label: label, components: components, reasons: reasons.slice(0, 3), recommendation: recommendation, aiAvailable: false, aiNote: t('aiNoteStatic') };
  }

  // Total Cost (same rates as server.js)
  function calculateTotalCost(priceUSD, international, currencyConversion) {
    var price = Number(priceUSD);
    var paypalFee = Math.round((price * 0.0349 + 0.49) * 100) / 100;
    var internationalFee = international ? Math.round(price * 0.015 * 100) / 100 : 0;
    var conversionSpread = currencyConversion ? Math.round(price * 0.035 * 100) / 100 : 0;
    var total = Math.round((price + paypalFee + internationalFee + conversionSpread) * 100) / 100;
    return { currency: 'USD', itemPrice: price, paypalFee: paypalFee, internationalFee: internationalFee, conversionSpread: conversionSpread, total: total, estimated: true };
  }

  // Hold Predictor (same rules as server.js). Estimate from public hold
  // patterns, not a PayPal decision.
  function calculateHoldRisk(seller, product) {
    var reasons = [];
    var points = 0;
    if (seller.disputeRate >= 5) { points += 40; reasons.push(fmt(t('holdDisputeVeryHigh'), { rate: seller.disputeRate })); }
    else if (seller.disputeRate >= 2) { points += 25; reasons.push(fmt(t('holdDisputeHigh'), { rate: seller.disputeRate })); }
    else if (seller.disputeRate >= 1) { points += 10; reasons.push(t('holdDisputeSlight')); }
    if (seller.accountAgeYears < 0.5) { points += 25; reasons.push(t('holdAge6m')); }
    else if (seller.accountAgeYears < 1.5) { points += 15; reasons.push(t('holdAge18m')); }
    else if (seller.accountAgeYears < 3) { points += 5; reasons.push(t('holdAge3y')); }
    if (seller.totalTransactions < 50) { points += 15; reasons.push(fmt(t('holdTxFew'), { tx: seller.totalTransactions })); }
    else if (seller.totalTransactions < 1000) { points += 5; reasons.push(t('holdTxSome')); }
    var median = product.referencePriceUSD;
    if (median && median > 0) {
      var below = 1 - product.priceUSD / median;
      if (below >= 0.5) { points += 15; reasons.push(t('holdPriceHalf')); }
      else if (below >= 0.2) { points += 5; reasons.push(t('holdPriceBelow')); }
    }
    if (!seller.hasTracking) { points += 5; reasons.push(t('holdNoTracking')); }
    var score = Math.min(points, 100);
    var label = score < 25 ? 'Low' : score < 60 ? 'Moderate' : 'High';
    var chance = label === 'Low' ? t('holdChanceLow') : label === 'Moderate' ? t('holdChanceModerate') : t('holdChanceHigh');
    return {
      score: score,
      label: label,
      chance: chance,
      reasons: reasons.length ? reasons : [t('holdNoSignals')],
      tip: label === 'Low'
        ? t('holdTipLow')
        : t('holdTipHigh')
    };
  }

  // Ask parser: category + max budget out of plain language, matches
  // ranked safest first.
  var ASK_SYNONYMS = {
    headphones: ['headphone', 'earbud', 'earphone', 'headset', 'audio'],
    smartwatch: ['smartwatch', 'watch', 'jam tangan', 'arloji'],
    keyboard: ['keyboard'],
    speaker: ['speaker', 'bluetooth'],
    charger: ['charger', 'cable', 'power', 'gan', 'adapter']
  };
  // Ask parser, v2. Two stages: parseAskRegex reads the words,
  // applyIntent does the filtering and ranking. Understands English and
  // Indonesian: budgets ("under $60", "di bawah 60"), ranges
  // ("antara $30 dan $60"), rankings ("termurah" = cheapest first,
  // "terbaik" = best first, "paling aman" = safest first), sellers
  // ("dari TechHub"), features ("ada garansi", "ada tracking"), and
  // follow-ups that refer to the last results ("yang termurah",
  // "yang pertama" picks the first one shown).
  var ASK_SELLERS = {
    'techhub': 'TechHub Official',
    'official': 'TechHub Official',
    'gadgetzone': 'GadgetZone ID',
    'dealhunter': 'DealHunter88'
  };
  function parseAskRegex(query) {
    var q = String(query || '').toLowerCase();
    var rangeMatch = q.match(/(?:antara|between)\s*\$?\s*(\d+(?:\.\d{1,2})?)\s*(?:dan|and|sampai|-|–|to)\s*\$?\s*(\d+(?:\.\d{1,2})?)/);
    var budgetMatch = q.match(/(?:under|below|less than|max|up to|budget|di bawah|dibawah|bawah|kurang dari|maksimal|maks|dana)\s*\$?\s*(\d+(?:\.\d{1,2})?)|\$\s*(\d+(?:\.\d{1,2})?)/);
    var maxPrice = rangeMatch
      ? Number(rangeMatch[2])
      : budgetMatch
        ? Number(budgetMatch[1] || budgetMatch[2])
        : null;
    var minPrice = rangeMatch ? Number(rangeMatch[1]) : null;
    var cheapest = /\b(murah|termurah|hemat|cheapest|cheap|affordable|lowest price|paling murah)\b/.test(q);
    var best = /\b(terbaik|paling bagus|rekomendasi|recommended|best|paling baik)\b/.test(q);
    var safest = /\b(teraman|paling aman|safest|paling terpercaya)\b/.test(q);
    var selectFirst = /\b(yang pertama|pertama|yang itu|itu aja|pilih yang pertama)\b/.test(q) && !cheapest && !best;
    var category = null;
    for (var cat in ASK_SYNONYMS) {
      if (ASK_SYNONYMS[cat].some(function (w) { return q.includes(w); })) { category = cat; break; }
    }
    var seller = null;
    for (var word in ASK_SELLERS) {
      if (q.includes(word)) { seller = ASK_SELLERS[word]; break; }
    }
    var needsReturn = /\b(garansi|return|retur|refund|pengembalian|bisa dikembalikan)\b/.test(q);
    var needsTracking = /\b(tracking|lacak|resi|track)\b/.test(q);
    return { category: category, maxPrice: maxPrice, minPrice: minPrice, cheapest: cheapest, best: best, safest: safest, seller: seller, needsReturn: needsReturn, needsTracking: needsTracking, selectFirst: selectFirst };
  }
  function riskScoreOf(product) {
    return calculateRiskScore(sellerOf(product), product).score;
  }
  function applyIntent(intent, contextProducts) {
    var hasSearch = intent.category || intent.maxPrice !== null || intent.minPrice !== null || intent.seller || intent.needsReturn || intent.needsTracking;
    var matches = hasSearch
      ? CATALOG.products.slice()
      : (contextProducts && contextProducts.length ? contextProducts.slice() : CATALOG.products.slice());
    if (intent.category) {
      var want = intent.category.charAt(0).toUpperCase() + intent.category.slice(1);
      matches = matches.filter(function (p) { return p.category === want; });
    }
    if (intent.seller) matches = matches.filter(function (p) { return sellerOf(p).name === intent.seller; });
    if (intent.needsReturn) matches = matches.filter(function (p) { return sellerOf(p).hasReturnPolicy; });
    if (intent.needsTracking) matches = matches.filter(function (p) { return sellerOf(p).hasTracking; });
    if (intent.maxPrice !== null) matches = matches.filter(function (p) { return p.priceUSD <= intent.maxPrice; });
    if (intent.minPrice !== null) matches = matches.filter(function (p) { return p.priceUSD >= intent.minPrice; });
    var selectFirst = false;
    if (intent.selectFirst && matches.length) {
      matches = [matches[0]];
      selectFirst = true;
    } else if (intent.cheapest) {
      matches.sort(function (a, b) { return a.priceUSD - b.priceUSD; });
    } else if (intent.best) {
      matches.sort(function (a, b) { return riskScoreOf(b) - riskScoreOf(a) || a.priceUSD - b.priceUSD; });
    } else {
      matches.sort(function (a, b) { return riskScoreOf(b) - riskScoreOf(a); });
    }
    var note = !matches.length
      ? t('noteNoMatch')
      : intent.cheapest
        ? t('noteCheapest')
        : intent.best
          ? t('noteBest')
          : t('noteSafest');
    return {
      understood: {
        category: intent.category,
        maxPrice: intent.maxPrice,
        minPrice: intent.minPrice,
        cheapest: intent.cheapest,
        best: intent.best,
        seller: intent.seller,
        needsReturn: intent.needsReturn,
        needsTracking: intent.needsTracking,
        note: note
      },
      products: matches.length ? matches : CATALOG.products,
      selectFirst: selectFirst
    };
  }
  function parseAsk(query, contextProducts) {
    return applyIntent(parseAskRegex(query), contextProducts);
  }

  // Risk extras: what the score means next to the other listings, the
  // scam pattern to watch for, and a short checklist before paying.
  function riskExtras(seller, product, score, label, components) {
    var saferThan = CATALOG.products.filter(function (p) {
      return calculateRiskScore(sellerOf(p), p).score < score;
    }).length;
    var comparison = fmt(t('comparison'), { n: saferThan, total: CATALOG.products.length });
    var warning =
      components.price < 60 && (seller.disputeRate >= 2 || label === 'Risky')
        ? t('warning')
        : null;
    var checklist =
      label === 'Safe'
        ? t('checklistSafe')
        : label === 'Caution'
          ? t('checklistCaution')
          : t('checklistRisky');
    return { comparison: comparison, warning: warning, checklist: checklist };
  }

  // Subscription Watcher: same product bought twice or more.
  function findSubscriptions(entries) {
    var groups = {};
    (entries || []).forEach(function (e) {
      var name = e.product && e.product.name ? e.product.name : null;
      if (!name) return;
      var g = groups[name] || { productName: name, purchases: 0, totalSpent: 0, lastPurchase: null };
      g.purchases += 1;
      g.totalSpent = Math.round((g.totalSpent + Number(e.totalCost && e.totalCost.total || 0)) * 100) / 100;
      if (!g.lastPurchase || (e.createdAt || '') > g.lastPurchase) g.lastPurchase = e.createdAt || null;
      groups[name] = g;
    });
    return Object.keys(groups).map(function (k) { return groups[k]; })
      .filter(function (g) { return g.purchases >= 2; })
      .sort(function (a, b) { return b.purchases - a.purchases; });
  }

  // Public PayPal fee figures the cost table doesn't show (US merchant
  // schedule, Oct 2026). Estimates, not a quote.
  var TROUBLE_COSTS = {
    chargebackUSD: 20,
    disputeStandardUSD: 15,
    disputeHighVolumeUSD: 30,
    instantTransferPct: 1.5,
    instantTransferMinUSD: 0.5,
    protection: 'PayPal Buyer Protection covers Goods & Services payments. Friends & Family payments are not covered.',
    note: 'Public PayPal merchant fee schedule (US, Oct 2026). Estimates, not a quote.'
  };

  // Proof Vault (localStorage)
  function loadVault() {
    try { return JSON.parse(localStorage.getItem(VAULT_KEY) || '[]'); } catch (e) { return []; }
  }
  function saveVaultEntry(entry) {
    var entries = loadVault();
    entries.unshift(entry);
    try { localStorage.setItem(VAULT_KEY, JSON.stringify(entries)); } catch (e) { /* storage unavailable */ }
  }

  function sellerOf(product) {
    return CATALOG.sellers.find(function (s) { return s.id === product.sellerId; });
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
      '<img src="' + IMAGE[p.category] + '" alt="' + p.name + '">' +
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

  function greet() {
    addBubble('agent',
      '<p>Hi, I’m ShopPal — your AI shopping agent. Tell me what you’re looking for, and I’ll check the seller, show you the real total (fees included), and keep your proof if you pay.</p>' +
      '<p>Everything here runs on PayPal Sandbox, so no real money moves.</p>' +
      '<p class="hint">The server version can also search real eBay listings (free eBay developer keys in .env) — this static demo searches the 10-product demo catalog.</p>' +
      '<div class="chips">' +
      '<button type="button" class="chip" data-q="headphones under $60">Headphones under $60</button>' +
      '<button type="button" class="chip" data-q="smartwatch">Smartwatch</button>' +
      '<button type="button" class="chip" data-q="keyboard">Keyboard</button>' +
      '</div>' +
      '<p class="hint">Or pick any product below.</p>' +
      '<div class="cards" id="catalog"></div>');
    renderCatalogInto($('catalog'), CATALOG.products);
    var chips = chatEl.querySelectorAll('.chip');
    for (var i = 0; i < chips.length; i++) {
      chips[i].addEventListener('click', function () {
        $('ask').value = this.getAttribute('data-q');
        sendAsk();
      });
    }
  }

  function sendAsk() {
    var q = $('ask').value.trim();
    if (!q) return;
    $('ask').value = '';
    lang = detectLang(q);
    userBubble(q);
    clearSteps();
    var typing = showTyping();
    setTimeout(function () {
      hideTyping(typing);
      var parsed = parseAsk(q, lastResults);
      var products = parsed.products;
      lastResults = products;
      // "yang pertama" picks the first result shown — go straight to it.
      if (parsed.selectFirst && products.length) {
        selectProduct(products[0]);
        return;
      }
      var u = parsed.understood;
      var understood = [];
      if (u.category) understood.push(u.category);
      if (u.minPrice !== null && u.maxPrice !== null) understood.push('$' + u.minPrice + '–$' + u.maxPrice);
      else if (u.maxPrice !== null) understood.push(t('under') + u.maxPrice);
      if (u.seller) understood.push(fmt(t('fromSeller'), { seller: u.seller }));
      if (u.needsReturn) understood.push(t('withReturns'));
      if (u.needsTracking) understood.push(t('withTracking'));
      if (u.cheapest) understood.push(t('cheapestFirst'));
      if (u.best) understood.push(t('bestFirst'));
      addBubble('agent',
        '<p>' + t('understood') + ' ' + (understood.length ? understood.join(', ') : t('noCategory')) +
        ' — ' + u.note + '</p>' +
        '<div class="cards" id="catalog"></div>');
      renderCatalogInto($('catalog'), products);
    }, 500);
  }

  function selectProduct(product) {
    var seller = sellerOf(product);
    selected = { product: product, seller: seller, risk: calculateRiskScore(seller, product), cost: null };
    clearSteps();
    userBubble(product.name + ' — ' + money(product.priceUSD));
    var typing = showTyping();
    setTimeout(function () {
      hideTyping(typing);
      showRisk();
      showHold();
      showCost();
      showCheckout();
    }, 500);
  }

  function showRisk() {
    var r = selected.risk;
    var zone = r.label.toLowerCase();
    var extras = riskExtras(selected.seller, selected.product, r.score, r.label, r.components);
    var extra = '';
    if (extras.comparison) extra += '<p>' + extras.comparison + '</p>';
    if (extras.warning) extra += '<p><strong>' + t('watchOut') + '</strong> ' + extras.warning + '</p>';
    if (extras.checklist && extras.checklist.length) {
      extra += '<p><strong>' + t('beforeYouPay') + '</strong></p><ul>' +
        extras.checklist.map(function (c) { return '<li>' + c + '</li>'; }).join('') + '</ul>';
    }
    addBubble('agent',
      '<p><strong>' + selected.seller.name + '</strong> — ' + t('riskScore') + ' <span class="score score-' + zone + '">' + r.score + '/100 · ' + labelText(r.label) + '</span></p>' +
      '<ul>' + r.reasons.map(function (reason) { return '<li>' + reason + '</li>'; }).join('') + '</ul>' +
      '<p><strong>' + t('recommendation') + '</strong> ' + r.recommendation + '</p>' +
      extra +
      '<p class="hint">Profile ' + r.components.profile + ' · History ' + r.components.history +
      ' · Price ' + r.components.price + ' · Tracking ' + r.components.tracking + ' · ' + r.aiNote + '</p>',
      'risk');
  }

  function showHold() {
    var h = calculateHoldRisk(selected.seller, selected.product);
    var zone = h.label === 'Low' ? 'safe' : h.label === 'Moderate' ? 'caution' : 'risky';
    addBubble('agent',
      '<p><strong>' + t('holdTitle') + '</strong> — hold risk <span class="score score-' + zone + '">' + holdLabelText(h.label) + ' · ' + h.chance + '</span></p>' +
      '<ul>' + h.reasons.map(function (reason) { return '<li>' + reason + '</li>'; }).join('') + '</ul>' +
      '<p>' + h.tip + '</p>' +
      '<p class="hint">' + t('holdHint') + '</p>',
      'hold');
  }

  function showCost() {
    selected.cost = calculateTotalCost(selected.product.priceUSD, true, true);
    var c = selected.cost;
    var tc = TROUBLE_COSTS;
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
      '<li>' + fmt(t('chargeback'), { n: tc.chargebackUSD }) + '</li>' +
      '<li>' + fmt(t('disputeFee'), { a: tc.disputeStandardUSD, b: tc.disputeHighVolumeUSD }) + '</li>' +
      '<li>' + t('refundLine') + '</li>' +
      '<li>' + fmt(t('instantLine'), { pct: tc.instantTransferPct, min: tc.instantTransferMinUSD }) + '</li>' +
      '<li>' + refundLine + '</li>' +
      '</ul>' +
      '<p><strong>' + t('protectionLabel') + '</strong> ' + t('protection') + '</p>' +
      '<p class="hint">' + t('troubleNote') + '</p></div>',
      'cost');
  }

  function showCheckout() {
    var bubble = addBubble('agent',
      '<p><strong>' + t('readyToPay') + '</strong> ' + t('neverPay') + '</p>' +
      '<p><label><input id="approve" type="checkbox"> ' + t('approveLabel') + '</label></p>' +
      '<div id="paypal-button-container"></div>' +
      '<p id="checkout-status"></p>' +
      '<p class="hint">' + t('checkoutHint') + ' <a href="https://developer.paypal.com/dashboard/accounts" target="_blank" rel="noopener">PayPal Sandbox Personal (buyer)</a></p>',
      'checkout');
    var approve = bubble.querySelector('#approve');
    approve.addEventListener('change', function () { renderPayPalButton(); });
    renderPayPalButton();
  }

  // PayPal JS SDK checkout (Sandbox, client-side)
  function renderPayPalButton() {
    var container = $('paypal-button-container');
    if (!container) return;
    if (!selected || !window.paypal) {
      if (!window.paypal) container.innerHTML = '<p class="hint">' + t('sdkFailed') + '</p>';
      return;
    }
    var token = ++paypalRenderToken;
    container.innerHTML = '';
    var total = selected.cost ? selected.cost.total : selected.product.priceUSD;
    var fees = selected.cost ? (selected.cost.paypalFee + selected.cost.internationalFee + selected.cost.conversionSpread) : 0;
    var product = selected.product;
    var seller = selected.seller;
    var risk = selected.risk;
    window.paypal.Buttons({
      style: { layout: 'vertical', color: 'gold', shape: 'rect', label: 'paypal' },
      onClick: function (data, actions) {
        if (!$('approve') || !$('approve').checked) {
          $('checkout-status').textContent = t('tickFirst');
          return actions.reject();
        }
        return actions.resolve();
      },
      createOrder: function (data, actions) {
        if (token !== paypalRenderToken) return Promise.reject(new Error('Selection changed.'));
        $('checkout-status').textContent = t('creatingOrder');
        return actions.order.create({
          intent: 'CAPTURE',
          purchase_units: [{
            reference_id: product.id,
            description: product.name + ' — ShopPal v2 demo (PayPal Sandbox)',
            amount: {
              currency_code: 'USD',
              value: total.toFixed(2),
              breakdown: {
                item_total: { currency_code: 'USD', value: product.priceUSD.toFixed(2) },
                handling: { currency_code: 'USD', value: fees.toFixed(2) }
              }
            },
            items: [{
              name: product.name,
              unit_amount: { currency_code: 'USD', value: product.priceUSD.toFixed(2) },
              quantity: '1',
              category: 'PHYSICAL_GOODS'
            }]
          }],
          application_context: { brand_name: 'ShopPal v2', landing_page: 'LOGIN', user_action: 'PAY_NOW' }
        });
      },
      onApprove: function (data, actions) {
        $('checkout-status').textContent = fmt(t('approvedCapturing'), { id: data.orderID });
        return actions.order.capture().then(function (details) {
          if (token !== paypalRenderToken) return;
          var capture = (details.purchase_units && details.purchase_units[0] && details.purchase_units[0].payments && details.purchase_units[0].payments.captures && details.purchase_units[0].payments.captures[0]) || null;
          if (!details || details.status !== 'COMPLETED' || !capture) {
            $('checkout-status').textContent = fmt(t('captureFailed'), { status: details && details.status });
            return;
          }
          var entry = {
            id: data.orderID,
            createdAt: new Date().toISOString(),
            product: { id: product.id, name: product.name, priceUSD: product.priceUSD, category: product.category },
            seller: { id: seller.id, name: seller.name, tracking: seller.hasTracking, returnPolicy: seller.hasReturnPolicy },
            riskScore: { score: risk.score, label: risk.label },
            totalCost: { total: Number(capture.amount.value), currency: capture.amount.currency_code || 'USD' },
            paypal: {
              orderId: data.orderID,
              captureId: capture.id,
              status: capture.status,
              payerEmail: (details.payer && details.payer.email_address) || null,
              createTime: capture.create_time || null,
              updateTime: capture.update_time || null
            }
          };
          saveVaultEntry(entry);
          $('checkout-status').textContent = fmt(t('paymentCaptured'), { id: capture.id });
          addBubble('agent',
            '<p><strong>' + fmt(t('successTitle'), { total: money(entry.totalCost.total) }) + '</strong> Order ' + data.orderID +
            ' · Capture ' + capture.id + ' · status ' + capture.status + '</p>' +
            '<p>' + t('successProof') + '</p>',
            'success');
          showVault();
        });
      },
      onCancel: function () {
        $('checkout-status').textContent = t('checkoutCancelled');
      },
      onError: function (err) {
        $('checkout-status').textContent = fmt(t('checkoutError'), { msg: err && err.message ? err.message : err });
      }
    }).render('#paypal-button-container');
  }

  function showVault() {
    var old = chatEl.querySelector('[data-step="vault"]');
    if (old) old.remove();
    var entries = loadVault();
    var body = '';
    if (!entries.length) {
      body = '<p>' + t('vaultEmpty') + '</p>';
    } else {
      lastVaultId = entries[0].id;
      body = entries.map(function (e) {
        return '<p><strong>' + (e.product && e.product.name || e.id) + '</strong> — ' +
          (e.paypal && e.paypal.status || 'unknown') + ' · Order ' + (e.paypal && e.paypal.orderId || '—') + '</p>';
      }).join('');
    }
    var patterns = findSubscriptions(entries);
    var subs = '';
    if (!patterns.length) {
      subs = '<p><strong>' + t('subsTitle') + '</strong></p><p>' + t('subsEmpty') + '</p>';
    } else {
      subs = '<p><strong>' + t('subsTitle') + '</strong> — ' + t('subsFound') + '</p>' +
        patterns.map(function (p) {
          return '<p>' + fmt(t('subsLine'), { name: p.productName, n: p.purchases, total: money(p.totalSpent), date: p.lastPurchase ? p.lastPurchase.slice(0, 10) : '—' }) + '</p>';
        }).join('');
    }
    var bubble = addBubble('agent',
      '<p><strong>Proof Vault</strong></p>' + body +
      '<div class="card">' + subs + '</div>' +
      '<p><button id="vault-refresh" type="button">' + t('refreshVault') + '</button> ' +
      '<button id="dispute-btn" type="button"' + (entries.length ? '' : ' disabled') + '>' + t('disputeBtn') + '</button> ' +
      '<button id="refund-btn" type="button"' + (entries.length ? '' : ' disabled') + '>' + t('refundBtn') + '</button> ' +
      '<button id="order-status-btn" type="button"' + (entries.length ? '' : ' disabled') + '>' + t('orderStatusBtn') + '</button></p>' +
      '<div id="dispute-draft" class="card hidden"></div>' +
      '<div id="paypal-actions" class="card hidden"></div>',
      'vault');
    bubble.querySelector('#vault-refresh').addEventListener('click', function () { showVault(); });
    bubble.querySelector('#dispute-btn').addEventListener('click', function () { showDisputeDraft(); });
    // Refund the latest vault entry (full amount, PayPal Sandbox) via the
    // deployed Worker. Two clicks: the first arms the button.
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
      var entry = loadVault().find(function (e) { return e.id === lastVaultId; });
      var box = $('paypal-actions');
      if (!box) return;
      box.classList.remove('hidden');
      if (!entry || !entry.paypal || !entry.paypal.captureId) { box.textContent = t('refundFailed').replace('{msg}', t('disputeNotFound')); return; }
      box.textContent = t('refundTitle') + '…';
      var res = await fetch(WORKER_API + '/api/paypal/refund', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ captureId: entry.paypal.captureId, lang: lang }),
      });
      var d = await res.json();
      if (!res.ok) {
        box.textContent = fmt(t('refundFailed'), { msg: d.error || res.status });
        return;
      }
      // Record the refund on the local copy so the vault shows it.
      var all = loadVault();
      var i = all.findIndex(function (e) { return e.id === lastVaultId; });
      if (i >= 0) {
        all[i].paypal = all[i].paypal || {};
        all[i].paypal.refund = { id: d.refundId, status: d.status, amount: d.amount, currency: d.currency, createTime: new Date().toISOString() };
        try { localStorage.setItem(VAULT_KEY, JSON.stringify(all)); } catch (e) { /* storage unavailable */ }
      }
      box.innerHTML = '<p><strong>' + t('refundTitle') + '</strong> — ' +
        fmt(t('refundSuccess'), { id: d.refundId || '—', status: d.status || '—', amount: money(d.amount) }) + '</p>';
      showVault();
      scrollChat();
    });
    // Live order status, re-verified with PayPal via the Worker.
    bubble.querySelector('#order-status-btn').addEventListener('click', async function () {
      if (!lastVaultId) return;
      var box = $('paypal-actions');
      if (!box) return;
      box.classList.remove('hidden');
      box.textContent = t('orderStatusTitle') + '…';
      var res = await fetch(WORKER_API + '/api/paypal/order?orderId=' + encodeURIComponent(lastVaultId));
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
  }

  function showDisputeDraft() {
    if (!lastVaultId) return;
    var entry = loadVault().find(function (e) { return e.id === lastVaultId; });
    var box = $('dispute-draft');
    if (!box) return;
    box.classList.remove('hidden');
    if (!entry) { box.textContent = t('disputeNotFound'); return; }
    var missing = [];
    if (!entry.paypal || !entry.paypal.captureId) missing.push('capture ID');
    if (!entry.seller || !entry.seller.tracking) missing.push('tracking proof');
    var readiness = missing.length === 0 ? 100 : 70;
    box.innerHTML =
      '<p><strong>' + t('disputeTitle') + '</strong> — ' + fmt(t('disputeReadiness'), { n: readiness }) + '</p>' +
      '<p>' + fmt(t('disputeBody'), {
        order: entry.paypal && entry.paypal.orderId || 'unknown',
        product: entry.product && entry.product.name || 'the product',
        total: '$' + (entry.totalCost && entry.totalCost.total != null ? entry.totalCost.total : entry.product && entry.product.priceUSD || 'unknown'),
        status: entry.paypal && entry.paypal.status || 'unknown',
        seller: entry.seller && entry.seller.name || 'unknown',
        score: entry.riskScore && entry.riskScore.score != null ? entry.riskScore.score : 'unknown',
        id: entry.id,
      }) + '</p>' +
      (missing.length ? '<p>' + fmt(t('disputeMissing'), { list: missing.join(', ') }) + '</p>' : '<p>' + t('disputeNone') + '</p>');
    scrollChat();
  }

  document.addEventListener('DOMContentLoaded', function () {
    chatEl = $('chat');
    $('ask-btn').addEventListener('click', sendAsk);
    $('ask').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') sendAsk();
    });
    greet();
    showVault();
    if (!window.paypal) {
      addBubble('agent', '<p class="hint">' + t('sdkNotLoaded') + '</p>');
    }
  });
})();
