// ShopPal v2: PayPal AI Hackathon. Sandbox only, no real money.
// Express + static frontend. PayPal: JS SDK (client) + REST API (server).
// AI: one server function (Vyce API / DeepSeek) that rewrites the
// rule-based risk reasons in plain language; it never changes the score.
// Secrets come from env vars only. Nothing secret is logged or returned
// to the browser, the PayPal Client ID is the only credential the
// browser ever sees (via /api/config).

require('dotenv').config();
const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
// Behind Render / any proxy, req.protocol and req.get('host') must reflect
// the public URL, needed for the PayPal return/cancel URLs.
app.set('trust proxy', true);
const PORT = process.env.PORT || 3000;
const PAYPAL_MODE = process.env.PAYPAL_MODE || 'sandbox';
const PAYPAL_API_BASE =
  process.env.PAYPAL_API_BASE || 'https://api-m.sandbox.paypal.com';

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Demo catalog: 10 products, 3 sellers.
const catalogPath = path.join(__dirname, 'data', 'catalog.json');
const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
const sellersById = new Map(catalog.sellers.map((s) => [s.id, s]));
const productsById = new Map(catalog.products.map((p) => [p.id, p]));

// Real marketplaces, one adapter each. eBay is first (free Browse API);
// see marketplace/ebay.js for how the next one plugs in.
const ebay = require('./marketplace/ebay');

// Bilingual replies (Dwibahasa). The agent answers in the language the
// buyer types: Indonesian when the message has Indonesian words, English
// otherwise (English is the demo's default, Devpost requires English
// materials). `lang` threads through the Ask/risk/hold/cost/marketplace
// paths; the client sends it, or the server detects it from the query.
function detectLang(text) {
  return /\b(di|yang|mau|aku|saya|murah|termurah|terbaik|paling|bawah|dari|ada|garansi|pertama|berapa|cari|beli|baru|dan|untuk|dengan|ini|itu|aja|saja|tolong|dong)\b/i.test(String(text || ''))
    ? 'id'
    : 'en';
}
function fmt(template, vars) {
  return String(template).replace(/\{(\w+)\}/g, (_, k) => (vars[k] !== undefined ? vars[k] : '{' + k + '}'));
}
function t(lang, key) {
  const dict = STR[lang] || STR.en;
  return dict[key] !== undefined ? dict[key] : STR.en[key];
}
const STR = {
  en: {
    noteCheapest: 'Matches sorted cheapest first.',
    noteBest: 'Best match first (safest, then cheapest).',
    noteSafest: 'Matches sorted safest first.',
    noteNoMatch: 'No exact match in the demo catalog, showing all 10 demo products.',
    riskProfileLow: 'This seller account is new or its profile is incomplete.',
    riskProfileHigh: 'This seller has an established, complete profile.',
    riskHistoryLow: 'This seller has a high dispute rate compared with other sellers.',
    riskHistoryHigh: 'This seller has a low dispute rate across many transactions.',
    riskPriceLow: 'This price is far below the category median, a common scam pattern.',
    riskTrackingLow: 'This seller does not offer tracking or a clear return policy.',
    riskPriceFair: 'The price is fair for this category, with tracking and returns offered.',
    recSafe: 'Safe to proceed with PayPal Goods & Services.',
    recCaution: 'Proceed with caution. Use PayPal Goods & Services, never Friends & Family.',
    recRisky: 'Risky. Consider an alternative seller before paying.',
    comparison: 'Safer than {n} of {total} demo listings.',
    warning: 'Too-good-to-be-true pattern: a price far below the median from a seller with a high dispute rate. This is the most common scam shape in the demo.',
    checklistSafe: ['Pay with PayPal Goods & Services (not Friends & Family).', 'Save the tracking number when the seller ships.', 'Keep the Proof Vault entry, it is saved automatically.'],
    checklistCaution: ['Pay only with PayPal Goods & Services.', 'Ask the seller for tracking before the money clears.', 'If the seller asks you to pay outside PayPal, stop, that voids Buyer Protection.'],
    checklistRisky: ['Do not pay this seller if you can avoid it.', 'If you still proceed, use Goods & Services only, never Friends & Family.', 'Screenshot the listing and the chat before paying; you will need them for a dispute.'],
    holdChanceLow: 'under 5% (estimate)',
    holdChanceModerate: '5–20% (estimate)',
    holdChanceHigh: 'over 20% (estimate)',
    holdDisputeVeryHigh: 'Dispute rate is very high ({rate}%).',
    holdDisputeHigh: 'Dispute rate is above average ({rate}%).',
    holdDisputeSlight: 'Dispute rate is slightly above 1%.',
    holdAge6m: 'Seller account is less than 6 months old.',
    holdAge18m: 'Seller account is less than 18 months old.',
    holdAge3y: 'Seller account is less than 3 years old.',
    holdTxFew: 'Very few completed transactions ({tx}).',
    holdTxSome: 'Relatively few completed transactions.',
    holdPriceHalf: 'Price is 50% or more below the category median.',
    holdPriceBelow: 'Price is notably below the category median.',
    holdNoTracking: 'No tracking offered, so delivery is harder to prove.',
    holdNoSignals: 'No hold-risk signals in this seller pattern.',
    holdTipLow: 'Funds usually clear on the normal schedule for this pattern.',
    holdTipHigh: 'Ask the seller to upload tracking promptly, and keep the order total close to the seller’s usual range.',
    costNote: 'Estimated fees. PayPal Checkout 3.49% + $0.49, international 1.5%, conversion spread ~3.5%.',
    protection: 'PayPal Buyer Protection covers Goods & Services payments. Friends & Family payments are not covered.',
    troubleNote: 'Public PayPal merchant fee schedule (US, Oct 2026). Estimates, not a quote.',
    mpFeedbackUnknown: 'This marketplace does not share this seller’s feedback percentage.',
    mpFeedbackHigh: 'This seller has {fb}% positive feedback on eBay.',
    mpFeedbackLow: 'This seller has {fb}% positive feedback on eBay, below the 99%+ that careful buyers look for.',
    mpPriceLow: 'This price is far below the median of this search, a common scam pattern.',
    mpPriceFair: 'This price is close to the median of this search.',
    mpReturnsYes: 'The listing accepts returns.',
    mpReturnsNo: 'The listing does not say it accepts returns.',
    mpRecSafe: 'Safe to proceed with PayPal Goods & Services.',
    mpRecCaution: 'Proceed with caution. Use PayPal Goods & Services, never Friends & Family.',
    mpRecRisky: 'Risky. Consider another listing before paying.',
    mpComparison: 'Safer than {n} of {total} listings in this search.',
    mpWarning: 'Too-good-to-be-true pattern: a price far below the median from a seller without strong feedback. This is the most common scam shape.',
    mpHoldNoFeedback: 'No feedback percentage shared for this seller.',
    mpHoldFeedbackLow: 'Seller feedback is {fb}%, below 98%.',
    mpHoldFeedbackMid: 'Seller feedback is {fb}%, below 99%.',
    mpHoldFeedbackHigh: 'Seller feedback is {fb}%.',
    mpHoldPriceHalf: 'Price is 50% or more below the median of this search.',
    mpHoldPriceBelow: 'Price is notably below the median of this search.',
    mpHoldNoReturns: 'No returns accepted, so a dispute is harder to win.',
    mpHoldNoSignals: 'No hold-risk signals in this listing.',
    mpHoldTipLow: 'Funds usually clear on the normal schedule for this pattern.',
    mpHoldTipHigh: 'Ask the seller to upload tracking promptly, and keep the order total close to the seller’s usual range.',
    mpAiNote: 'Marketplace scores use marketplace signals; account age is not shared by eBay, so it scores neutral.',
    mpNote: 'Real eBay listings (Browse API). Prices in USD; risk scores use marketplace signals, feedback %, price vs this search’s median, returns and shipping.',
    mpNotConfigured: 'Real marketplace search needs free eBay developer keys. Add EBAY_APP_ID and EBAY_CERT_ID to .env (developer.ebay.com), no keys, no real listings.',
    aiNoteFallback: 'AI explanation unavailable, showing rule-based reasons.',
    aiNoteVyce: 'Explanation rewritten by AI (Vyce); the numeric score is rule-based and unchanged.',
    disputeBody: 'Dispute response draft (simulated, factual only): Order {order} for {product} ({total}) was paid via PayPal Sandbox and captured as {status}. Seller: {seller} (risk score {score} at checkout). Proof is attached in the Proof Vault entry {id}.',
    disputeNotFound: 'Proof Vault entry not found. Save a successful checkout first.',
    refundNoCapture: 'No capture ID found for this vault entry.',
    refundAlready: 'This capture was already refunded.',
    refundBadAmount: 'Refund amount must be a positive number.',
    refundTooBig: 'Refund amount is larger than the capture total.',
    simStrong: 'Strong case',
    simModerate: 'Moderate case',
    simWeak: 'Weak case',
    simNotFound: 'Nothing to simulate yet, save a successful checkout first, or pick a product.',
    simTooLate: 'Too late to file: the 180-day PayPal filing window has passed.',
    simAlreadyRefunded: 'This capture was already refunded, there is nothing left to dispute.',
    simPrePurchase: 'Pre-purchase simulation, this is what your dispute case would look like if you buy now.',
    simCaptureOk: 'Payment captured and verified (COMPLETED).',
    simCapturePlanned: 'Payment would be captured and verified (COMPLETED).',
    simTrackingYes: 'Seller provides tracking, delivery can be proved.',
    simTrackingNo: 'No tracking from this seller, delivery is hard to prove.',
    simReturnsYes: 'Seller accepts returns.',
    simReturnsNo: 'Seller does not accept returns.',
    simDisputeRateHigh: 'Seller dispute rate is high ({rate}%), a pattern that supports the buyer.',
    simDisputeRateLow: 'Seller dispute rate is low ({rate}%).',
    simWithinWindow: 'Still inside the 180-day PayPal filing window ({days} days left).',
    simExpiredWindow: 'The 180-day filing window has passed.',
    simTypeUnauthorized: 'Unauthorized payment, PayPal usually sides with the buyer when reported quickly.',
    simTypeNotReceived: 'Item not received, tracking decides the outcome.',
    simTypeNotDescribed: 'Item not as described, photos and the listing text decide the outcome.',
    simMissingTracking: 'Tracking number / delivery proof',
    simMissingPhotos: 'Photos of the item received vs the listing',
    simMissingChat: 'Message history with the seller',
    simMissingPolicy: 'Screenshot of the seller return policy',
    simMissingReport: 'Report the unauthorized payment to PayPal and your bank/card issuer quickly',
    simRecStrong: 'File with confidence, attach the proof from the Proof Vault.',
    simRecModerate: 'File, but collect the missing proof first, it decides the outcome.',
    simRecWeak: 'Collect the missing proof before filing, or ask the seller for a refund first.',
    simRecTooLate: 'The filing window has passed. Your remaining option is a chargeback through your bank/card issuer.',
    evTitle: 'ShopPal Evidence Pack',
    evNotFound: 'Proof Vault entry not found. Save a successful checkout first.',
    evOrder: 'Order',
    evCapture: 'Capture (verified)',
    evProduct: 'Product',
    evSeller: 'Seller',
    evRisk: 'Seller Risk Score at checkout',
    evTotal: 'Total paid',
    evTimeline: 'Timeline',
    evDraft: 'Dispute draft (simulated)',
    evRefund: 'Refund',
    evNote: 'Generated by ShopPal v2 (PayPal AI Hackathon). Sandbox proof only, no real money moved. Print this page to PDF to attach it to a PayPal dispute.',
    clNotUrl: 'That does not look like a product link. Paste a full URL starting with http:// or https://.',
    clFetchFailed: 'Could not read that page. The site may block previews, or the link may be dead.',
    clKnownMarketplace: 'Known marketplace domain.',
    clUnknownDomain: 'Unknown domain, not a marketplace ShopPal recognises.',
    clPriceLow: 'This price is far below the demo catalog median for this category, a common scam pattern.',
    clPriceFair: 'This price is close to the demo catalog median for this category.',
    clNoPrice: 'No price found on the page, the verdict uses the domain and listing signals only.',
    clNote: 'Link preview + verdict from the page’s public metadata (title, price, image). Not a full marketplace search, prices and seller data come from the page itself.',
    dlFiling: 'Dispute filing deadline',
    dlEscalation: 'Escalation deadline (dispute → claim)',
    dlReturn: 'Return deadline',
    dlNoReturn: 'Seller has no return policy.',
    dlNoDispute: 'No dispute filed yet, the escalation deadline starts when you file.',
    dlExpired: 'Expired',
    dlDaysLeft: '{days} days left',
    dlToday: 'Due today',
    dlOverdue: '{days} days overdue',
    dlNotFound: 'Nothing to track yet, save a successful checkout first, or pick a product.',
    impTitle: 'Import cost (estimate)',
    impNotFound: 'Pick a destination country to estimate import cost.',
    impDuty: 'Import duty ({rate}%)',
    impVat: 'VAT / GST ({rate}%)',
    impFree: 'Below the {country} de minimis ({min}), no import duty.',
    impNote: 'Estimate only. Exact duty depends on the product HS code; thresholds are in the local currency and the USD price is used as an approximation.',
    impIDNote: 'Indonesia (PMK 96/2023 + PMK 4/2025): under FOB US$3 duty is waived but VAT still applies; US$3–1,500 duty 7.5% + VAT 11% (effective), PPh waived for parcels.',
    phTitle: 'Phishing check',
    phLegit: 'Looks legitimate',
    phSuspicious: 'Suspicious',
    phLikely: 'Likely phishing',
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
    cmpTitle: 'Compare products',
    cmpPick: 'Pick two products to compare.',
    cmpSelected: '{n}/2 selected',
    cmpCompareBtn: 'Compare',
    cmpClear: 'Clear',
    budTitle: 'Monthly budget',
    budSet: 'Set monthly budget (USD)',
    budSave: 'Save',
    budSpent: 'Spent this month: {spent} of {budget} ({pct}%)',
    budLeft: '{left} left this month.',
    budOver: 'Over budget by {over} this month.',
    budWarn: 'This purchase would take you over your monthly budget ({spent} of {budget} spent).',
    budNoBudget: 'No monthly budget set.',
    grTitle: 'Smart Guardrails',
    grIntro: 'The agent auto-pays only under your limit. Above it, it asks you first, so a hallucination can never buy something expensive.',
    grLimit: 'Auto-approve up to (USD)',
    grSave: 'Save guardrails',
    grSaved: 'Guardrails saved.',
    grCatCap: 'Monthly cap for {cat} (USD, empty = no cap)',
    grNeedApproval: 'Needs your approval',
    grAboveLimit: 'This purchase ({total}) is above your auto-approve limit ({limit}).',
    grCatOver: 'This would take {cat} over its monthly cap ({spent} of {cap} spent).',
    grApprove: 'Approve and pay',
    grReject: 'Reject this purchase',
    grApproved: 'Approved, capturing payment...',
    grRejected: 'Purchase rejected. The PayPal order was not captured and will expire.',
    grAutoOk: 'Under your auto-approve limit, capturing...',
    dwTitle: 'Delivery Watch',
    dwIntro: 'The agent watches every delivery. If a parcel stalls for 7 days or misses its estimate, it prepares a dispute draft before your 180-day filing window shrinks.',
    dwAddTracking: 'Add tracking',
    dwCheck: 'Check delivery',
    dwNoTracker: 'No tracking yet for this order.',
    dwStatus: 'Delivery: {status}',
    dwOverdue: 'Overdue {n} days: no delivery update. A dispute draft is ready below.',
    dwOnTime: 'On track, {n} days since purchase.',
    dwDraftReady: 'Dispute draft prepared automatically.',
    dwNoOrders: 'No orders to watch yet.',
    fxTitle: 'Pay in local currency or USD?',
    fxNote: 'PayPal adds about 3-4% on currency conversion. Live mid-market rate below, PayPal total includes the markup.',
    fxPaypalTotal: 'PayPal total',
    fxMidRate: 'Mid-market rate',
    fxCheaper: 'Cheapest: pay in {cur}.',
    fxUnavailable: 'Live rate unavailable, using a stored rate.',
    exTitle: 'Spending dashboard',
    exTotal: 'Total spent',
    exThisMonth: 'this month',
    exEmpty: 'No spending recorded yet.',
    pwTitle: 'Price Watch',
    pwIntro: 'Tell the agent a target price. It watches the price and buys the moment it drops to your target. Demo feed: the catalog price is simulated, labelled as such.',
    pwTarget: 'Buy if the price drops to (USD)',
    pwWatch: 'Watch this price',
    pwWatching: 'Watching',
    pwCurrent: 'Current price',
    pwTargetPrice: 'Target',
    pwCheck: 'Check price now',
    pwTriggered: 'Price hit! Buy now at {price}.',
    pwBuyNow: 'Buy now',
    pwNoWatches: 'No price watches yet.',
    pwSimNote: 'Simulated price feed for the demo catalog, not a live market price.',
    sbTitle: 'Split the bill',
    sbIntro: 'Buy a gift together and split it. The agent works out each share and writes the message to send. Collecting the money happens in the PayPal app (request money); the Invoicing and Payouts APIs are not enabled for this sandbox app.',
    sbFriends: 'Friends (name, one per line)',
    sbSplit: 'Split it',
    sbShare: "Each person's share",
    sbMessage: 'Message to send',
    sbNoFriends: 'Add at least one friend to split with.',
    hrcTitle: 'Hold release checklist',
    hrcBtn: 'How to release this hold faster',
    hrcIntro: 'PayPal holds new or risky sellers’ money for up to 21 days. Each step below can release it sooner, tick what is already done and see the estimated release.',
    hrcEstimated: 'Estimated release: {n} days',
    hrcCurrent: 'Current hold: {n} days',
    hrcDone: 'Done',
    hrcTodo: 'To do',
    hrcSaves: 'saves up to {n} days',
    hrcPrevents: 'prevents future holds',
    hrcStepTracking: 'Add a tracking number to the PayPal transaction',
    hrcStepTrackingDetail: 'The hold is released 3 days after the carrier confirms delivery.',
    hrcStepShipped: 'Mark the order as Shipped in PayPal',
    hrcStepShippedDetail: 'Without tracking, the hold is released 7 days after the ship date.',
    hrcStepBuyer: 'Ask the buyer to confirm receipt in PayPal',
    hrcStepBuyerDetail: 'The hold is released 1 day after the buyer confirms receipt.',
    hrcStepProof: 'Upload proof of delivery (invoice, delivery photo)',
    hrcStepProofDetail: 'Helps PayPal release the hold faster if the transaction is reviewed.',
    hrcStepShipFast: 'Ship within 7 days of payment',
    hrcStepShipFastDetail: 'Late shipping can extend the hold.',
    hrcStepDisputes: 'Keep the dispute rate low and respond to disputes fast',
    hrcStepDisputesDetail: 'High dispute rates trigger holds on future sales.',
    hrcNote: 'PayPal’s published hold rules (new-seller and risk holds, up to 21 days). Estimates, not a guarantee, PayPal decides each case.',
    hrcNotFound: 'Pick a product first to see its hold checklist.',
  },
  id: {
    noteCheapest: 'Hasil diurutkan termurah dulu.',
    noteBest: 'Hasil terbaik dulu (paling aman, lalu termurah).',
    noteSafest: 'Hasil diurutkan paling aman dulu.',
    noteNoMatch: 'Tidak ada yang cocok di katalog demo, menampilkan 10 produk demo.',
    riskProfileLow: 'Akun seller ini baru atau profilnya belum lengkap.',
    riskProfileHigh: 'Seller ini sudah lama dan profilnya lengkap.',
    riskHistoryLow: 'Seller ini punya tingkat sengketa tinggi dibanding seller lain.',
    riskHistoryHigh: 'Seller ini punya tingkat sengketa rendah dari banyak transaksi.',
    riskPriceLow: 'Harga ini jauh di bawah median kategori, pola scam yang umum.',
    riskTrackingLow: 'Seller ini tidak menyediakan tracking atau kebijakan retur yang jelas.',
    riskPriceFair: 'Harganya wajar untuk kategori ini, dengan tracking dan retur.',
    recSafe: 'Aman lanjut dengan PayPal Goods & Services.',
    recCaution: 'Lanjut dengan hati-hati. Pakai PayPal Goods & Services, jangan Friends & Family.',
    recRisky: 'Berisiko. Pertimbangkan seller lain sebelum bayar.',
    comparison: 'Lebih aman dari {n} dari {total} listing demo.',
    warning: 'Pola terlalu-bagus-untuk-jadi-kenyataan: harga jauh di bawah median dari seller dengan tingkat sengketa tinggi. Ini pola scam paling umum di demo.',
    checklistSafe: ['Bayar dengan PayPal Goods & Services (bukan Friends & Family).', 'Simpan nomor tracking saat seller mengirim.', 'Simpan entri Proof Vault, tersimpan otomatis.'],
    checklistCaution: ['Bayar hanya dengan PayPal Goods & Services.', 'Minta tracking ke seller sebelum dananya cair.', 'Kalau seller minta bayar di luar PayPal, berhenti, itu membatalkan Perlindungan Pembeli.'],
    checklistRisky: ['Jangan bayar seller ini kalau bisa dihindari.', 'Kalau tetap lanjut, pakai Goods & Services saja, jangan Friends & Family.', 'Screenshot listing dan chat sebelum bayar; kamu akan butuh untuk sengketa.'],
    holdChanceLow: 'di bawah 5% (perkiraan)',
    holdChanceModerate: '5–20% (perkiraan)',
    holdChanceHigh: 'di atas 20% (perkiraan)',
    holdDisputeVeryHigh: 'Tingkat sengketa sangat tinggi ({rate}%).',
    holdDisputeHigh: 'Tingkat sengketa di atas rata-rata ({rate}%).',
    holdDisputeSlight: 'Tingkat sengketa sedikit di atas 1%.',
    holdAge6m: 'Akun seller berumur kurang dari 6 bulan.',
    holdAge18m: 'Akun seller berumur kurang dari 18 bulan.',
    holdAge3y: 'Akun seller berumur kurang dari 3 tahun.',
    holdTxFew: 'Transaksi selesai sangat sedikit ({tx}).',
    holdTxSome: 'Transaksi selesai relatif sedikit.',
    holdPriceHalf: 'Harga 50% atau lebih di bawah median kategori.',
    holdPriceBelow: 'Harga jauh di bawah median kategori.',
    holdNoTracking: 'Tidak ada tracking, jadi pengiriman sulit dibuktikan.',
    holdNoSignals: 'Tidak ada sinyal risiko hold pada pola seller ini.',
    holdTipLow: 'Dana biasanya cair sesuai jadwal normal untuk pola ini.',
    holdTipHigh: 'Minta seller segera mengunggah tracking, dan jaga total order tetap dekat dengan kisaran biasa seller.',
    costNote: 'Perkiraan biaya. PayPal Checkout 3.49% + $0.49, internasional 1.5%, selisih kurs ~3.5%.',
    protection: 'Perlindungan Pembeli PayPal mencakup pembayaran Goods & Services. Pembayaran Friends & Family tidak dilindungi.',
    troubleNote: 'Jadwal biaya merchant PayPal publik (AS, Okt 2026). Perkiraan, bukan penawaran.',
    mpFeedbackUnknown: 'Marketplace ini tidak membagikan persentase feedback seller ini.',
    mpFeedbackHigh: 'Seller ini punya feedback positif {fb}% di eBay.',
    mpFeedbackLow: 'Seller ini punya feedback positif {fb}% di eBay, di bawah 99%+ yang dicari pembeli hati-hati.',
    mpPriceLow: 'Harga ini jauh di bawah median pencarian ini, pola scam yang umum.',
    mpPriceFair: 'Harga ini dekat dengan median pencarian ini.',
    mpReturnsYes: 'Listing ini menerima retur.',
    mpReturnsNo: 'Listing ini tidak menyatakan menerima retur.',
    mpRecSafe: 'Aman lanjut dengan PayPal Goods & Services.',
    mpRecCaution: 'Lanjut dengan hati-hati. Pakai PayPal Goods & Services, jangan Friends & Family.',
    mpRecRisky: 'Berisiko. Pertimbangkan listing lain sebelum bayar.',
    mpComparison: 'Lebih aman dari {n} dari {total} listing dalam pencarian ini.',
    mpWarning: 'Pola terlalu-bagus-untuk-jadi-kenyataan: harga jauh di bawah median dari seller tanpa feedback kuat. Ini pola scam paling umum.',
    mpHoldNoFeedback: 'Tidak ada persentase feedback untuk seller ini.',
    mpHoldFeedbackLow: 'Feedback seller {fb}%, di bawah 98%.',
    mpHoldFeedbackMid: 'Feedback seller {fb}%, di bawah 99%.',
    mpHoldFeedbackHigh: 'Feedback seller {fb}%.',
    mpHoldPriceHalf: 'Harga 50% atau lebih di bawah median pencarian ini.',
    mpHoldPriceBelow: 'Harga jauh di bawah median pencarian ini.',
    mpHoldNoReturns: 'Tidak ada retur, jadi sengketa lebih sulit dimenangkan.',
    mpHoldNoSignals: 'Tidak ada sinyal risiko hold pada listing ini.',
    mpHoldTipLow: 'Dana biasanya cair sesuai jadwal normal untuk pola ini.',
    mpHoldTipHigh: 'Minta seller segera mengunggah tracking, dan jaga total order tetap dekat dengan kisaran biasa seller.',
    mpAiNote: 'Skor marketplace memakai sinyal marketplace; umur akun tidak dibagikan eBay, jadi dinilai netral.',
    mpNote: 'Listing eBay asli (Browse API). Harga dalam USD; skor risiko memakai sinyal marketplace, feedback %, harga vs median pencarian ini, retur dan shipping.',
    mpNotConfigured: 'Pencarian marketplace asli butuh kunci developer eBay gratis. Tambahkan EBAY_APP_ID dan EBAY_CERT_ID ke .env (developer.ebay.com), tanpa kunci, tidak ada listing asli.',
    aiNoteFallback: 'Penjelasan AI tidak tersedia, menampilkan alasan berbasis aturan.',
    aiNoteVyce: 'Penjelasan ditulis ulang oleh AI (Vyce); skor angka berbasis aturan dan tidak berubah.',
    disputeBody: 'Draf jawaban sengketa (simulasi, hanya fakta): Order {order} untuk {product} ({total}) dibayar via PayPal Sandbox dan di-capture sebagai {status}. Seller: {seller} (skor risiko {score} saat checkout). Bukti terlampir di entri Proof Vault {id}.',
    disputeNotFound: 'Entri Proof Vault tidak ditemukan. Simpan checkout yang berhasil dulu.',
    refundNoCapture: 'Tidak ada capture ID untuk entri vault ini.',
    refundAlready: 'Capture ini sudah di-refund.',
    refundBadAmount: 'Jumlah refund harus angka positif.',
    refundTooBig: 'Jumlah refund lebih besar dari total capture.',
    simStrong: 'Kasus kuat',
    simModerate: 'Kasus sedang',
    simWeak: 'Kasus lemah',
    simNotFound: 'Belum ada yang bisa disimulasikan, simpan checkout yang berhasil dulu, atau pilih produk.',
    simTooLate: 'Terlambat mengajukan: batas 180 hari PayPal sudah lewat.',
    simAlreadyRefunded: 'Capture ini sudah di-refund, tidak ada lagi yang bisa disengketakan.',
    simPrePurchase: 'Simulasi sebelum beli, inilah gambaran kasus sengketamu kalau kamu beli sekarang.',
    simCaptureOk: 'Pembayaran ter-capture dan terverifikasi (COMPLETED).',
    simCapturePlanned: 'Pembayaran akan ter-capture dan terverifikasi (COMPLETED).',
    simTrackingYes: 'Seller menyediakan tracking, pengiriman bisa dibuktikan.',
    simTrackingNo: 'Seller tidak menyediakan tracking, pengiriman sulit dibuktikan.',
    simReturnsYes: 'Seller menerima retur.',
    simReturnsNo: 'Seller tidak menerima retur.',
    simDisputeRateHigh: 'Tingkat sengketa seller tinggi ({rate}%), pola yang mendukung pembeli.',
    simDisputeRateLow: 'Tingkat sengketa seller rendah ({rate}%).',
    simWithinWindow: 'Masih dalam batas 180 hari pengajuan sengketa PayPal (sisa {days} hari).',
    simExpiredWindow: 'Batas 180 hari pengajuan sudah lewat.',
    simTypeUnauthorized: 'Pembayaran tidak sah, PayPal biasanya memihak pembeli kalau dilaporkan cepat.',
    simTypeNotReceived: 'Barang tidak diterima, tracking yang menentukan hasil.',
    simTypeNotDescribed: 'Barang tidak sesuai deskripsi, foto dan teks listing yang menentukan hasil.',
    simMissingTracking: 'Nomor tracking / bukti pengiriman',
    simMissingPhotos: 'Foto barang yang diterima vs listing',
    simMissingChat: 'Riwayat chat dengan seller',
    simMissingPolicy: 'Screenshot kebijakan retur seller',
    simMissingReport: 'Laporkan pembayaran tidak sah ke PayPal dan bank/penerbit kartu secepatnya',
    simRecStrong: 'Ajukan dengan percaya diri, lampirkan bukti dari Proof Vault.',
    simRecModerate: 'Ajukan, tapi lengkapi dulu bukti yang kurang, itu yang menentukan hasil.',
    simRecWeak: 'Lengkapi dulu bukti yang kurang sebelum mengajukan, atau minta refund ke seller dulu.',
    simRecTooLate: 'Batas pengajuan sudah lewat. Opsi yang tersisa adalah chargeback lewat bank/penerbit kartu.',
    evTitle: 'Paket Bukti ShopPal',
    evNotFound: 'Entri Proof Vault tidak ditemukan. Simpan checkout yang berhasil dulu.',
    evOrder: 'Order',
    evCapture: 'Capture (terverifikasi)',
    evProduct: 'Produk',
    evSeller: 'Seller',
    evRisk: 'Skor Risiko Seller saat checkout',
    evTotal: 'Total dibayar',
    evTimeline: 'Linimasa',
    evDraft: 'Draf sengketa (simulasi)',
    evRefund: 'Refund',
    evNote: 'Dibuat oleh ShopPal v2 (PayPal AI Hackathon). Bukti Sandbox saja, tidak ada uang asli yang berpindah. Cetak halaman ini ke PDF untuk dilampirkan ke sengketa PayPal.',
    clNotUrl: 'Itu bukan link produk. Tempel URL lengkap yang diawali http:// atau https://.',
    clFetchFailed: 'Halaman itu tidak bisa dibaca. Situsnya mungkin memblokir pratinjau, atau link-nya mati.',
    clKnownMarketplace: 'Domain marketplace yang dikenal.',
    clUnknownDomain: 'Domain tidak dikenal, bukan marketplace yang dikenali ShopPal.',
    clPriceLow: 'Harga ini jauh di bawah median katalog demo untuk kategori ini, pola scam yang umum.',
    clPriceFair: 'Harga ini dekat dengan median katalog demo untuk kategori ini.',
    clNoPrice: 'Tidak ada harga di halaman itu, verdict hanya memakai sinyal domain dan listing.',
    clNote: 'Pratinjau link + verdict dari metadata publik halaman (judul, harga, gambar). Bukan pencarian marketplace penuh, harga dan data seller berasal dari halaman itu sendiri.',
    dlFiling: 'Batas ajukan sengketa',
    dlEscalation: 'Batas eskalasi (sengketa → klaim)',
    dlReturn: 'Batas retur',
    dlNoReturn: 'Seller tidak punya kebijakan retur.',
    dlNoDispute: 'Belum ada sengketa yang diajukan, batas eskalasi mulai saat kamu mengajukan.',
    dlExpired: 'Kedaluwarsa',
    dlDaysLeft: 'sisa {days} hari',
    dlToday: 'Jatuh tempo hari ini',
    dlOverdue: 'terlambat {days} hari',
    dlNotFound: 'Belum ada yang bisa dilacak, simpan checkout yang berhasil dulu, atau pilih produk.',
    impTitle: 'Biaya impor (perkiraan)',
    impNotFound: 'Pilih negara tujuan untuk memperkirakan biaya impor.',
    impDuty: 'Bea masuk ({rate}%)',
    impVat: 'PPN / GST ({rate}%)',
    impFree: 'Di bawah batas bebas bea {country} ({min}), tidak ada bea masuk.',
    impNote: 'Perkiraan saja. Bea pastinya tergantung kode HS barang; ambang batas dalam mata uang lokal dan harga USD dipakai sebagai pendekatan.',
    impIDNote: 'Indonesia (PMK 96/2023 + PMK 4/2025): di bawah FOB US$3 bea dibebaskan tapi PPN tetap ditagih; US$3–1.500 bea 7,5% + PPN 11% (efektif), PPh dikecualikan untuk barang kiriman.',
    phTitle: 'Cek phishing',
    phLegit: 'Terlihat asli',
    phSuspicious: 'Mencurigakan',
    phLikely: 'Kemungkinan phishing',
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
    cmpTitle: 'Bandingkan produk',
    cmpPick: 'Pilih dua produk untuk dibandingkan.',
    cmpSelected: '{n}/2 dipilih',
    cmpCompareBtn: 'Bandingkan',
    cmpClear: 'Bersihkan',
    budTitle: 'Budget bulanan',
    budSet: 'Atur budget bulanan (USD)',
    budSave: 'Simpan',
    budSpent: 'Belanja bulan ini: {spent} dari {budget} ({pct}%)',
    budLeft: 'Sisa {left} bulan ini.',
    budOver: 'Melebihi budget {over} bulan ini.',
    budWarn: 'Pembelian ini akan melampaui budget bulananmu ({spent} dari {budget} sudah terpakai).',
    budNoBudget: 'Belum ada budget bulanan.',
    grTitle: 'Smart Guardrails',
    grIntro: 'Agen hanya bayar otomatis di bawah batasmu. Di atas itu, ia bertanya dulu, jadi halusinasi tidak bisa membeli barang mahal.',
    grLimit: 'Setujui otomatis sampai (USD)',
    grSave: 'Simpan guardrails',
    grSaved: 'Guardrails tersimpan.',
    grCatCap: 'Batas bulanan untuk {cat} (USD, kosong = tanpa batas)',
    grNeedApproval: 'Butuh persetujuanmu',
    grAboveLimit: 'Pembelian ini ({total}) di atas batas setujui otomatis ({limit}).',
    grCatOver: 'Ini akan membuat {cat} melewati batas bulanannya ({spent} dari {cap} sudah terpakai).',
    grApprove: 'Setujui dan bayar',
    grReject: 'Tolak pembelian ini',
    grApproved: 'Disetujui, meng-capture pembayaran...',
    grRejected: 'Pembelian ditolak. Order PayPal tidak di-capture dan akan kedaluwarsa.',
    grAutoOk: 'Di bawah batas setujui otomatis, meng-capture...',
    dwTitle: 'Delivery Watch',
    dwIntro: 'Agen memantau tiap pengiriman. Kalau paket macet 7 hari atau melewati estimasi, ia menyiapkan draf sengketa sebelum jendela pengajuan 180 harimu menyusut.',
    dwAddTracking: 'Tambah resi',
    dwCheck: 'Cek pengiriman',
    dwNoTracker: 'Belum ada resi untuk order ini.',
    dwStatus: 'Pengiriman: {status}',
    dwOverdue: 'Terlambat {n} hari: tidak ada update pengiriman. Draf sengketa sudah siap di bawah.',
    dwOnTime: 'Tepat waktu, {n} hari sejak pembelian.',
    dwDraftReady: 'Draf sengketa disiapkan otomatis.',
    dwNoOrders: 'Belum ada order untuk dipantau.',
    fxTitle: 'Bayar pakai mata uang lokal atau USD?',
    fxNote: 'PayPal menambah sekitar 3-4% untuk konversi mata uang. Kurs mid-market live di bawah, total PayPal sudah termasuk markup.',
    fxPaypalTotal: 'Total PayPal',
    fxMidRate: 'Kurs mid-market',
    fxCheaper: 'Paling hemat: bayar pakai {cur}.',
    fxUnavailable: 'Kurs live tidak tersedia, memakai kurs tersimpan.',
    exTitle: 'Dashboard pengeluaran',
    exTotal: 'Total belanja',
    exThisMonth: 'bulan ini',
    exEmpty: 'Belum ada pengeluaran tercatat.',
    pwTitle: 'Price Watch',
    pwIntro: 'Beri tahu agen harga targetmu. Ia memantau harga dan membeli begitu harga turun ke targetmu. Feed demo: harga katalog disimulasikan, diberi label.',
    pwTarget: 'Beli kalau harga turun ke (USD)',
    pwWatch: 'Pantau harga ini',
    pwWatching: 'Memantau',
    pwCurrent: 'Harga saat ini',
    pwTargetPrice: 'Target',
    pwCheck: 'Cek harga sekarang',
    pwTriggered: 'Harga kena! Beli sekarang di {price}.',
    pwBuyNow: 'Beli sekarang',
    pwNoWatches: 'Belum ada price watch.',
    pwSimNote: 'Feed harga simulasi untuk katalog demo, bukan harga pasar live.',
    sbTitle: 'Patungan',
    sbIntro: 'Beli kado bareng dan patungan. Agen menghitung bagian tiap orang dan menulis pesannya. Penagihan uangnya lewat aplikasi PayPal (request money); API Invoicing dan Payouts tidak diaktifkan untuk app sandbox ini.',
    sbFriends: 'Teman (nama, satu per baris)',
    sbSplit: 'Bagi rata',
    sbShare: 'Bagian tiap orang',
    sbMessage: 'Pesan untuk dikirim',
    sbNoFriends: 'Tambahkan minimal satu teman untuk patungan.',
    hrcTitle: 'Checklist cairkan hold',
    hrcBtn: 'Cara cairkan hold ini lebih cepat',
    hrcIntro: 'PayPal menahan uang seller baru atau berisiko sampai 21 hari. Tiap langkah di bawah bisa mencairkannya lebih cepat, centang yang sudah dilakukan dan lihat perkiraan cairnya.',
    hrcEstimated: 'Perkiraan cair: {n} hari',
    hrcCurrent: 'Hold saat ini: {n} hari',
    hrcDone: 'Selesai',
    hrcTodo: 'Belum',
    hrcSaves: 'hemat sampai {n} hari',
    hrcPrevents: 'mencegah hold berikutnya',
    hrcStepTracking: 'Tambahkan nomor resi ke transaksi PayPal',
    hrcStepTrackingDetail: 'Hold cair 3 hari setelah kurir mengonfirmasi barang diterima.',
    hrcStepShipped: 'Tandai order sebagai Shipped di PayPal',
    hrcStepShippedDetail: 'Tanpa resi, hold cair 7 hari setelah tanggal kirim.',
    hrcStepBuyer: 'Minta pembeli mengonfirmasi penerimaan di PayPal',
    hrcStepBuyerDetail: 'Hold cair 1 hari setelah pembeli mengonfirmasi.',
    hrcStepProof: 'Unggah bukti pengiriman (invoice, foto pengiriman)',
    hrcStepProofDetail: 'Membantu PayPal mencairkan hold lebih cepat bila transaksi ditinjau.',
    hrcStepShipFast: 'Kirim dalam 7 hari setelah pembayaran',
    hrcStepShipFastDetail: 'Pengiriman terlambat bisa memperpanjang hold.',
    hrcStepDisputes: 'Jaga dispute tetap rendah dan balas sengketa dengan cepat',
    hrcStepDisputesDetail: 'Tingkat dispute tinggi memicu hold di penjualan berikutnya.',
    hrcNote: 'Aturan hold resmi PayPal (hold seller baru dan berisiko, sampai 21 hari). Perkiraan, bukan jaminan, PayPal yang memutuskan tiap kasus.',
    hrcNotFound: 'Pilih produk dulu untuk melihat checklist hold-nya.',
  },
};

// AI explanations. The rule-based reasons come first (deterministic,
// auditable). If VYCE_API_KEY is set, the Vyce API (default model
// deepseek-v4.1) rewrites them in plain language only. No key, or a
// failed call, falls back to the rule-based reasons.
async function explainScore(components, label, lang) {
  lang = lang === 'id' ? 'id' : 'en';
  // Rule-based explanation, deterministic, auditable, works offline.
  const reasons = [];
  if (components.profile < 60) {
    reasons.push(t(lang, 'riskProfileLow'));
  } else {
    reasons.push(t(lang, 'riskProfileHigh'));
  }
  if (components.history < 60) {
    reasons.push(t(lang, 'riskHistoryLow'));
  } else {
    reasons.push(t(lang, 'riskHistoryHigh'));
  }
  if (components.price < 60) {
    reasons.push(t(lang, 'riskPriceLow'));
  } else if (components.tracking < 60) {
    reasons.push(t(lang, 'riskTrackingLow'));
  } else {
    reasons.push(t(lang, 'riskPriceFair'));
  }
  const recommendation =
    label === 'Safe'
      ? t(lang, 'recSafe')
      : label === 'Caution'
        ? t(lang, 'recCaution')
        : t(lang, 'recRisky');
  const fallback = {
    reasons: reasons.slice(0, 3),
    recommendation,
    aiAvailable: false,
    aiNote: t(lang, 'aiNoteFallback'),
  };
  const apiKey = process.env.VYCE_API_KEY;
  if (!apiKey) return fallback;
  const baseUrl = (process.env.VYCE_API_BASE || 'https://vyceai.com/v1').replace(/\/$/, '');
  const model = process.env.VYCE_MODEL || 'deepseek-v4.1';
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30000);
    const res = await fetch(baseUrl + '/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + apiKey,
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'system',
            content:
              'You rewrite seller-risk reasons for a shopper. Keep the meaning, ' +
              'do not change any numbers, do not add new facts, do not invent scores. ' +
              'Return exactly 3 lines, one reason per line, no numbering, no extra text.' +
              (lang === 'id' ? ' Reply in Indonesian.' : ' Reply in English.'),
          },
          {
            role: 'user',
            content: reasons.slice(0, 3).join('\n'),
          },
        ],
        temperature: 0.2,
        max_tokens: 200,
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return fallback;
    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content || '';
    const lines = text
      .split('\n')
      .map((l) => l.replace(/^[-*•\d.)\s]+/, '').trim())
      .filter(Boolean)
      .slice(0, 3);
    if (lines.length !== 3) return fallback;
    return {
      reasons: lines,
      recommendation,
      aiAvailable: true,
      aiNote: t(lang, 'aiNoteVyce'),
    };
  } catch (err) {
    return fallback;
  }
}

// Risk Score (0-100, higher = safer). Weights: profile 25, history 35,
// price fairness 20, tracking/returns 20. Zones: 80+ Safe, 50-79 Caution,
// under 50 Risky.
function scoreProfile(seller) {
  const agePart = Math.min(seller.accountAgeYears / 3, 1) * 60;
  const completePart = seller.profileComplete ? 40 : 0;
  return Math.round(agePart + completePart);
}

function scoreHistory(seller) {
  // Dispute rate under 1% scores full; over 5% scores near zero.
  const rate = seller.disputeRate;
  if (rate <= 1) return 100;
  if (rate >= 5) return 0;
  return Math.round(100 - ((rate - 1) / 4) * 100);
}

function scorePrice(product) {
  const median = product.referencePriceUSD;
  if (!median || median <= 0) return 50;
  const ratio = product.priceUSD / median;
  const deviation = Math.abs(ratio - 1);
  if (deviation <= 0.2) return 100;
  if (deviation >= 0.5) return 0;
  return Math.round(100 - ((deviation - 0.2) / 0.3) * 100);
}

function scoreTracking(seller) {
  if (seller.hasTracking && seller.hasReturnPolicy) return 100;
  if (seller.hasTracking || seller.hasReturnPolicy) return 50;
  return 0;
}

function calculateRiskScore(seller, product) {
  const components = {
    profile: scoreProfile(seller),
    history: scoreHistory(seller),
    price: scorePrice(product),
    tracking: scoreTracking(seller),
  };
  const total = Math.round(
    components.profile * 0.25 +
      components.history * 0.35 +
      components.price * 0.2 +
      components.tracking * 0.2
  );
  const label = total >= 80 ? 'Safe' : total >= 50 ? 'Caution' : 'Risky';
  return { score: total, label, components };
}

// Risk Score for a real marketplace listing. Same weights and zones as
// the demo catalog, but built from the signals a marketplace actually
// shares: seller feedback % instead of a dispute rate, price vs the
// median of this search, returns/shipping flags instead of a seller
// profile. Signals the marketplace does not share score neutral (50)
// and are labelled as unknown, never invented.
function scoreMarketplaceListing(listing, allListings, lang) {
  lang = lang === 'id' ? 'id' : 'en';
  const fb = listing.sellerFeedbackPercentage;
  const history =
    fb === null || fb === undefined
      ? 50
      : fb >= 99.5 ? 100 : fb >= 99 ? 85 : fb >= 98 ? 70 : fb >= 95 ? 45 : 15;
  const prices = (allListings || [])
    .map((l) => l.priceUSD)
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b);
  const median = prices.length ? prices[Math.floor(prices.length / 2)] : listing.priceUSD;
  const deviation = median && median > 0 ? Math.abs(listing.priceUSD / median - 1) : 0;
  const price =
    deviation <= 0.2 ? 100 : deviation >= 0.5 ? 0 : Math.round(100 - ((deviation - 0.2) / 0.3) * 100);
  const tracking =
    listing.returnsAccepted && listing.hasShipping
      ? 100
      : listing.returnsAccepted || listing.hasShipping
        ? 50
        : 0;
  const components = { profile: 50, history, price, tracking };
  const total = Math.round(
    components.profile * 0.25 +
      components.history * 0.35 +
      components.price * 0.2 +
      components.tracking * 0.2
  );
  const label = total >= 80 ? 'Safe' : total >= 50 ? 'Caution' : 'Risky';
  const reasons = [];
  reasons.push(
    fb === null || fb === undefined
      ? t(lang, 'mpFeedbackUnknown')
      : fb >= 99
        ? fmt(t(lang, 'mpFeedbackHigh'), { fb })
        : fmt(t(lang, 'mpFeedbackLow'), { fb })
  );
  reasons.push(
    price < 60
      ? t(lang, 'mpPriceLow')
      : t(lang, 'mpPriceFair')
  );
  reasons.push(
    listing.returnsAccepted
      ? t(lang, 'mpReturnsYes')
      : t(lang, 'mpReturnsNo')
  );
  const saferThan = (allListings || []).filter(
    (l) => l !== listing && scoreMarketplaceListingShallow(l, allListings) < total
  ).length;
  const warning =
    price < 60 && (fb === null || fb < 98)
      ? t(lang, 'mpWarning')
      : null;
  const checklist =
    label === 'Safe'
      ? t(lang, 'checklistSafe')
      : label === 'Caution'
        ? t(lang, 'checklistCaution')
        : t(lang, 'checklistRisky');
  return {
    score: total,
    label,
    components,
    reasons: reasons.slice(0, 3),
    recommendation:
      label === 'Safe'
        ? t(lang, 'mpRecSafe')
        : label === 'Caution'
          ? t(lang, 'mpRecCaution')
          : t(lang, 'mpRecRisky'),
    comparison: fmt(t(lang, 'mpComparison'), { n: saferThan, total: (allListings || []).length }),
    warning,
    checklist,
    aiAvailable: false,
    aiNote: t(lang, 'mpAiNote'),
  };
}
// Lightweight score used only to rank listings against each other
// (avoids infinite recursion in the comparison above).
function scoreMarketplaceListingShallow(listing, allListings) {
  const fb = listing.sellerFeedbackPercentage;
  const history =
    fb === null || fb === undefined
      ? 50
      : fb >= 99.5 ? 100 : fb >= 99 ? 85 : fb >= 98 ? 70 : fb >= 95 ? 45 : 15;
  const prices = (allListings || [])
    .map((l) => l.priceUSD)
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b);
  const median = prices.length ? prices[Math.floor(prices.length / 2)] : listing.priceUSD;
  const deviation = median && median > 0 ? Math.abs(listing.priceUSD / median - 1) : 0;
  const price =
    deviation <= 0.2 ? 100 : deviation >= 0.5 ? 0 : Math.round(100 - ((deviation - 0.2) / 0.3) * 100);
  const tracking =
    listing.returnsAccepted && listing.hasShipping
      ? 100
      : listing.returnsAccepted || listing.hasShipping
        ? 50
        : 0;
  return Math.round(50 * 0.25 + history * 0.35 + price * 0.2 + tracking * 0.2);
}

// Hold estimate for a marketplace listing, from the same public signals:
// weak feedback and a price far below the median are the patterns PayPal
// holds are most often tied to. Labelled an estimate, as always.
function holdRiskForMarketplaceListing(listing, allListings, lang) {
  lang = lang === 'id' ? 'id' : 'en';
  const fb = listing.sellerFeedbackPercentage;
  let points = 0;
  const reasons = [];
  if (fb === null || fb === undefined) {
    points += 10;
    reasons.push(t(lang, 'mpHoldNoFeedback'));
  } else if (fb < 98) {
    points += 40;
    reasons.push(fmt(t(lang, 'mpHoldFeedbackLow'), { fb }));
  } else if (fb < 99) {
    points += 25;
    reasons.push(fmt(t(lang, 'mpHoldFeedbackMid'), { fb }));
  } else if (fb < 99.5) {
    points += 10;
    reasons.push(fmt(t(lang, 'mpHoldFeedbackHigh'), { fb }));
  }
  const prices = (allListings || [])
    .map((l) => l.priceUSD)
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b);
  const median = prices.length ? prices[Math.floor(prices.length / 2)] : listing.priceUSD;
  if (median && median > 0) {
    const below = 1 - listing.priceUSD / median;
    if (below >= 0.5) {
      points += 15;
      reasons.push(t(lang, 'mpHoldPriceHalf'));
    } else if (below >= 0.2) {
      points += 5;
      reasons.push(t(lang, 'mpHoldPriceBelow'));
    }
  }
  if (!listing.returnsAccepted) {
    points += 5;
    reasons.push(t(lang, 'mpHoldNoReturns'));
  }
  const score = Math.min(points, 100);
  const label = score < 25 ? 'Low' : score < 60 ? 'Moderate' : 'High';
  return {
    score,
    label,
    chance: label === 'Low' ? t(lang, 'holdChanceLow') : label === 'Moderate' ? t(lang, 'holdChanceModerate') : t(lang, 'holdChanceHigh'),
    reasons: reasons.length ? reasons : [t(lang, 'mpHoldNoSignals')],
    tip:
      label === 'Low'
        ? t(lang, 'mpHoldTipLow')
        : t(lang, 'mpHoldTipHigh'),
  };
}

// Total Cost. Public rates: PayPal Checkout 3.49% + $0.49, international
// 1.5%, conversion spread ~3.5% (estimate).
function calculateTotalCost(priceUSD, international, currencyConversion, lang) {
  lang = lang === 'id' ? 'id' : 'en';
  const price = Number(priceUSD);
  if (!Number.isFinite(price) || price < 0) {
    throw new Error('priceUSD must be a non-negative number.');
  }
  const paypalFee = Math.round((price * 0.0349 + 0.49) * 100) / 100;
  const internationalFee = international
    ? Math.round(price * 0.015 * 100) / 100
    : 0;
  const conversionSpread = currencyConversion
    ? Math.round(price * 0.035 * 100) / 100
    : 0;
  const total = Math.round((price + paypalFee + internationalFee + conversionSpread) * 100) / 100;
  return {
    currency: 'USD',
    itemPrice: price,
    paypalFee,
    internationalFee,
    conversionSpread,
    total,
    estimated: true,
    troubleCosts: {
      ...TROUBLE_COSTS,
      protection: t(lang, 'protection'),
      note: t(lang, 'troubleNote'),
    },
    note: t(lang, 'costNote'),
  };
}

// Hold Predictor. Rule-based estimate of how likely PayPal is to hold
// this seller's funds, from public hold patterns (new account, high
// dispute rate, few transactions, price far below median, no tracking).
// This is an estimate from patterns, not a PayPal decision.
function calculateHoldRisk(seller, product, lang) {
  lang = lang === 'id' ? 'id' : 'en';
  const reasons = [];
  let points = 0;
  if (seller.disputeRate >= 5) { points += 40; reasons.push(fmt(t(lang, 'holdDisputeVeryHigh'), { rate: seller.disputeRate })); }
  else if (seller.disputeRate >= 2) { points += 25; reasons.push(fmt(t(lang, 'holdDisputeHigh'), { rate: seller.disputeRate })); }
  else if (seller.disputeRate >= 1) { points += 10; reasons.push(t(lang, 'holdDisputeSlight')); }
  if (seller.accountAgeYears < 0.5) { points += 25; reasons.push(t(lang, 'holdAge6m')); }
  else if (seller.accountAgeYears < 1.5) { points += 15; reasons.push(t(lang, 'holdAge18m')); }
  else if (seller.accountAgeYears < 3) { points += 5; reasons.push(t(lang, 'holdAge3y')); }
  if (seller.totalTransactions < 50) { points += 15; reasons.push(fmt(t(lang, 'holdTxFew'), { tx: seller.totalTransactions })); }
  else if (seller.totalTransactions < 1000) { points += 5; reasons.push(t(lang, 'holdTxSome')); }
  const median = product.referencePriceUSD;
  if (median && median > 0) {
    const below = 1 - product.priceUSD / median;
    if (below >= 0.5) { points += 15; reasons.push(t(lang, 'holdPriceHalf')); }
    else if (below >= 0.2) { points += 5; reasons.push(t(lang, 'holdPriceBelow')); }
  }
  if (!seller.hasTracking) { points += 5; reasons.push(t(lang, 'holdNoTracking')); }
  const score = Math.min(points, 100);
  const label = score < 25 ? 'Low' : score < 60 ? 'Moderate' : 'High';
  const chance = label === 'Low' ? t(lang, 'holdChanceLow') : label === 'Moderate' ? t(lang, 'holdChanceModerate') : t(lang, 'holdChanceHigh');
  return {
    score,
    label,
    chance,
    reasons: reasons.length ? reasons : [t(lang, 'holdNoSignals')],
    tip: label === 'Low'
      ? t(lang, 'holdTipLow')
      : t(lang, 'holdTipHigh'),
  };
}

// Ask parser, v2. Two stages so the AI path and the rule path share one
// filter/sort: parseAskRegex reads the words, applyIntent does the work.
// Understands English and Indonesian: budgets ("under $60", "di bawah 60"),
// ranges ("antara $30 dan $60"), rankings ("termurah" = cheapest first,
// "terbaik" = best first, "paling aman" = safest first), sellers
// ("dari TechHub"), features ("ada garansi", "ada tracking"), and
// follow-ups that refer to the last results ("yang termurah",
// "yang pertama" picks the first one shown).
const ASK_SYNONYMS = {
  headphones: ['headphone', 'earbud', 'earphone', 'headset', 'audio'],
  smartwatch: ['smartwatch', 'watch', 'jam tangan', 'arloji'],
  keyboard: ['keyboard'],
  speaker: ['speaker', 'bluetooth'],
  charger: ['charger', 'cable', 'power', 'gan', 'adapter'],
};
const ASK_SELLERS = {
  'techhub': 'TechHub Official',
  'official': 'TechHub Official',
  'gadgetzone': 'GadgetZone ID',
  'dealhunter': 'DealHunter88',
};
function parseAskRegex(query) {
  const q = String(query || '').toLowerCase();
  const rangeMatch = q.match(/(?:antara|between)\s*\$?\s*(\d+(?:\.\d{1,2})?)\s*(?:dan|and|sampai|-|–|to)\s*\$?\s*(\d+(?:\.\d{1,2})?)/);
  const budgetMatch = q.match(/(?:under|below|less than|max|up to|budget|di bawah|dibawah|bawah|kurang dari|maksimal|maks|dana)\s*\$?\s*(\d+(?:\.\d{1,2})?)|\$\s*(\d+(?:\.\d{1,2})?)/);
  const maxPrice = rangeMatch
    ? Number(rangeMatch[2])
    : budgetMatch
      ? Number(budgetMatch[1] || budgetMatch[2])
      : null;
  const minPrice = rangeMatch ? Number(rangeMatch[1]) : null;
  const cheapest = /\b(murah|termurah|hemat|cheapest|cheap|affordable|lowest price|paling murah)\b/.test(q);
  const best = /\b(terbaik|paling bagus|rekomendasi|recommended|best|paling baik)\b/.test(q);
  const safest = /\b(teraman|paling aman|safest|paling terpercaya)\b/.test(q);
  const selectFirst = /\b(yang pertama|pertama|yang itu|itu aja|pilih yang pertama)\b/.test(q) && !cheapest && !best;
  let category = null;
  for (const [cat, words] of Object.entries(ASK_SYNONYMS)) {
    if (words.some((w) => q.includes(w))) { category = cat; break; }
  }
  let seller = null;
  for (const [word, name] of Object.entries(ASK_SELLERS)) {
    if (q.includes(word)) { seller = name; break; }
  }
  const needsReturn = /\b(garansi|return|retur|refund|pengembalian|bisa dikembalikan)\b/.test(q);
  const needsTracking = /\b(tracking|lacak|resi|track)\b/.test(q);
  return { category, maxPrice, minPrice, cheapest, best, safest, seller, needsReturn, needsTracking, selectFirst };
}
function riskScoreOf(product) {
  return calculateRiskScore(sellersById.get(product.sellerId), product).score;
}
function applyIntent(intent, contextProducts, lang) {
  lang = lang === 'id' ? 'id' : 'en';
  const hasSearch = intent.category || intent.maxPrice !== null || intent.minPrice !== null || intent.seller || intent.needsReturn || intent.needsTracking;
  let matches = hasSearch
    ? [...catalog.products]
    : (contextProducts && contextProducts.length ? [...contextProducts] : [...catalog.products]);
  if (intent.category) {
    const want = intent.category.charAt(0).toUpperCase() + intent.category.slice(1);
    matches = matches.filter((p) => p.category === want);
  }
  if (intent.seller) matches = matches.filter((p) => sellersById.get(p.sellerId).name === intent.seller);
  if (intent.needsReturn) matches = matches.filter((p) => sellersById.get(p.sellerId).hasReturnPolicy);
  if (intent.needsTracking) matches = matches.filter((p) => sellersById.get(p.sellerId).hasTracking);
  if (intent.maxPrice !== null) matches = matches.filter((p) => p.priceUSD <= intent.maxPrice);
  if (intent.minPrice !== null) matches = matches.filter((p) => p.priceUSD >= intent.minPrice);
  let selectFirst = false;
  if (intent.selectFirst && matches.length) {
    matches = [matches[0]];
    selectFirst = true;
  } else if (intent.cheapest) {
    matches.sort((a, b) => a.priceUSD - b.priceUSD);
  } else if (intent.best) {
    matches.sort((a, b) => riskScoreOf(b) - riskScoreOf(a) || a.priceUSD - b.priceUSD);
  } else {
    matches.sort((a, b) => riskScoreOf(b) - riskScoreOf(a));
  }
  const note = !matches.length
    ? t(lang, 'noteNoMatch')
    : intent.cheapest
      ? t(lang, 'noteCheapest')
      : intent.best
        ? t(lang, 'noteBest')
        : t(lang, 'noteSafest');
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
      note,
    },
    products: matches.length ? matches : catalog.products,
    selectFirst,
  };
}
function parseAsk(query, contextProducts, lang) {
  return applyIntent(parseAskRegex(query), contextProducts, lang);
}

// Vyce intent parsing. When VYCE_API_KEY is set, the AI reads the query
// (English or Indonesian) and returns structured intent as strict JSON.
// Anything invalid, slow, or missing falls back to the regex parser above,
// so the Ask feature never depends on the AI being up.
async function parseAskWithVyce(query) {
  const apiKey = process.env.VYCE_API_KEY;
  if (!apiKey) return null;
  const baseUrl = (process.env.VYCE_API_BASE || 'https://vyceai.com/v1').replace(/\/$/, '');
  const model = process.env.VYCE_MODEL || 'deepseek-v4.1';
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30000);
    const res = await fetch(baseUrl + '/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + apiKey,
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'system',
            content:
              'You extract shopping intent from a short message (English or Indonesian). ' +
              'Reply with strict JSON only, no other text: ' +
              '{"category": "Headphones"|"Smartwatch"|"Keyboard"|"Speaker"|"Charger"|null, ' +
              '"maxPrice": number|null, "minPrice": number|null, "cheapest": boolean, "best": boolean, ' +
              '"seller": "TechHub Official"|"GadgetZone ID"|"DealHunter88"|null, ' +
              '"needsReturn": boolean, "needsTracking": boolean, "selectFirst": boolean}. ' +
              '"murah"/"termurah" means cheapest=true. "paling aman" means safest. ' +
              '"terbaik"/"rekomendasi" means best=true. "yang pertama" means selectFirst=true, the buyer wants the first result shown before.',
          },
          { role: 'user', content: query },
        ],
        temperature: 0,
        max_tokens: 200,
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const data = await res.json();
    const text = (data?.choices?.[0]?.message?.content || '').replace(/```json|```/g, '').trim();
    const intent = JSON.parse(text);
    const cats = ['Headphones', 'Smartwatch', 'Keyboard', 'Speaker', 'Charger'];
    const sellers = ['TechHub Official', 'GadgetZone ID', 'DealHunter88'];
    if (intent.category !== null && !cats.includes(intent.category)) return null;
    if (intent.seller !== null && !sellers.includes(intent.seller)) return null;
    if (intent.maxPrice !== null && !Number.isFinite(intent.maxPrice)) return null;
    if (intent.minPrice !== null && !Number.isFinite(intent.minPrice)) return null;
    return {
      category: intent.category ? intent.category.toLowerCase() : null,
      maxPrice: intent.maxPrice,
      minPrice: intent.minPrice,
      cheapest: !!intent.cheapest,
      best: !!intent.best,
      safest: false,
      seller: intent.seller,
      needsReturn: !!intent.needsReturn,
      needsTracking: !!intent.needsTracking,
      selectFirst: !!intent.selectFirst,
    };
  } catch (err) {
    return null;
  }
}

// Risk extras: what the score means next to the other listings, the
// scam pattern to watch for, and a short checklist before paying.
function riskExtras(seller, product, score, label, components, lang) {
  lang = lang === 'id' ? 'id' : 'en';
  const saferThan = catalog.products.filter(
    (p) => calculateRiskScore(sellersById.get(p.sellerId), p).score < score
  ).length;
  const comparison = fmt(t(lang, 'comparison'), { n: saferThan, total: catalog.products.length });
  const warning =
    components.price < 60 && (seller.disputeRate >= 2 || label === 'Risky')
      ? t(lang, 'warning')
      : null;
  const checklist =
    label === 'Safe'
      ? t(lang, 'checklistSafe')
      : label === 'Caution'
        ? t(lang, 'checklistCaution')
        : t(lang, 'checklistRisky');
  return { comparison, warning, checklist };
}

// Subscription Watcher. Groups saved Proof Vault entries by product;
// buying the same product twice or more counts as a recurring pattern.
function findSubscriptions(entries) {
  const groups = new Map();
  for (const e of entries || []) {
    const name = e.product && e.product.name ? e.product.name : null;
    if (!name) continue;
    const g = groups.get(name) || { productName: name, purchases: 0, totalSpent: 0, lastPurchase: null };
    g.purchases += 1;
    g.totalSpent = Math.round((g.totalSpent + Number(e.totalCost && e.totalCost.total || 0)) * 100) / 100;
    if (!g.lastPurchase || (e.createdAt || '') > g.lastPurchase) g.lastPurchase = e.createdAt || null;
    groups.set(name, g);
  }
  return [...groups.values()]
    .filter((g) => g.purchases >= 2)
    .sort((a, b) => b.purchases - a.purchases);
}

// Public PayPal fee figures that the cost table doesn't show (US merchant
// schedule, Oct 2026). Estimates, the exact fee depends on the account.
const TROUBLE_COSTS = {
  chargebackUSD: 20,
  disputeStandardUSD: 15,
  disputeHighVolumeUSD: 30,
  refundKeepsFee: true,
  instantTransferPct: 1.5,
  instantTransferMinUSD: 0.5,
  micropaymentRate: 0.0499,
  micropaymentFixedUSD: 0.09,
  micropaymentCheaperBelowUSD: 12,
  protection: 'PayPal Buyer Protection covers Goods & Services payments. Friends & Family payments are not covered.',
  note: 'Public PayPal merchant fee schedule (US, Oct 2026). Estimates, not a quote.',
};

// Routes
app.get('/api/health', (req, res) => {
  const configured = !!(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET);
  res.json({
    ok: true,
    status: 'ok',
    service: 'shoppal-v2',
    server: 'shoppal-v2',
    mode: PAYPAL_MODE,
    sandbox: true,
    guardrail: { autoApproveLimit: guardrails.autoApproveLimit, currency: 'USD' },
    paypalSandbox: {
      configured,
      tokenCached: !!cachedToken && Date.now() < cachedTokenExpiresAt,
      status: configured ? 'live' : 'not_configured',
    },
    mcpTools: 8,
    timestamp: new Date().toISOString(),
  });
});

app.get('/api/config', (req, res) => {
  // Only the public Client ID is ever sent to the browser. Never the secret.
  res.json({
    paypalClientId: process.env.PAYPAL_CLIENT_ID || null,
    paypalMode: PAYPAL_MODE,
    hasVyceKey: Boolean(process.env.VYCE_API_KEY),
  });
});

app.get('/api/catalog', (req, res) => {
  res.json(catalog);
});

app.post('/api/risk-score', async (req, res) => {
  const { sellerId, productId } = req.body || {};
  const seller = sellersById.get(sellerId);
  const product = productsById.get(productId);
  if (!seller || !product) {
    return res
      .status(400)
      .json({ error: 'Unknown sellerId or productId.' });
  }
  if (product.sellerId !== seller.id) {
    return res
      .status(400)
      .json({ error: 'Product does not belong to this seller.' });
  }
  const { score, label, components } = calculateRiskScore(seller, product);
  const lang = (req.body || {}).lang === 'id' ? 'id' : 'en';
  const explanation = await explainScore(components, label, lang);
  const extras = riskExtras(seller, product, score, label, components, lang);
  res.json({
    sellerId: seller.id,
    sellerName: seller.name,
    productId: product.id,
    productName: product.name,
    score,
    label,
    components,
    reasons: explanation.reasons,
    recommendation: explanation.recommendation,
    aiAvailable: explanation.aiAvailable,
    aiNote: explanation.aiNote,
    comparison: extras.comparison,
    warning: extras.warning,
    checklist: extras.checklist,
  });
});

app.post('/api/total-cost', (req, res) => {
  const { priceUSD, international, currencyConversion } = req.body || {};
  const lang = (req.body || {}).lang === 'id' ? 'id' : 'en';
  try {
    const breakdown = calculateTotalCost(
      priceUSD,
      international !== false,
      currencyConversion !== false,
      lang
    );
    res.json(breakdown);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/hold-risk', (req, res) => {
  const { sellerId, productId } = req.body || {};
  const seller = sellersById.get(sellerId);
  const product = productsById.get(productId);
  if (!seller || !product) {
    return res.status(400).json({ error: 'Unknown sellerId or productId.' });
  }
  if (product.sellerId !== seller.id) {
    return res.status(400).json({ error: 'Product does not belong to this seller.' });
  }
  res.json({
    sellerId: seller.id,
    sellerName: seller.name,
    productId: product.id,
    productName: product.name,
    ...calculateHoldRisk(seller, product, (req.body || {}).lang === 'id' ? 'id' : 'en'),
  });
});

app.get('/api/ask', async (req, res) => {
  const q = req.query.q || '';
  const lang = (req.query.lang === 'id' || req.query.lang === 'en') ? req.query.lang : detectLang(q);
  // Follow-up context: the product IDs the chat last showed, so "yang
  // termurah" / "yang pertama" can refer to them.
  const ctxIds = String(req.query.context || '').split(',').filter(Boolean);
  const ctxProducts = ctxIds
    .map((id) => productsById.get(id))
    .filter(Boolean);
  // AI first when the Vyce key is set; regex fallback otherwise.
  const aiIntent = await parseAskWithVyce(q);
  const intent = aiIntent || parseAskRegex(q);
  const result = applyIntent(intent, ctxProducts, lang);
  res.json({
    query: q,
    lang,
    understood: { ...result.understood, aiParsed: Boolean(aiIntent) },
    products: result.products,
    selectFirst: result.selectFirst,
  });
});

// ---------------------------------------------------------------------------
// Pay Agent (agentic commerce, ADDITIVE layer)
// The agent orchestrates the existing features as tools. It never replaces
// Ask, Risk Score, Total Cost, Hold Predictor, Guardrails, or the PayPal
// checkout flow, and it never changes how they work.
// How it works: a server-driven loop. The model (Vyce/deepseek-v4.1) picks
// the next action as strict JSON; the server executes the tool and feeds the
// result back. The model cannot call functions natively on this endpoint
// (verified 9 Nov 2026: tools are ignored, forced tool_choice returns empty
// content), so the loop is driven by the server and the model's JSON.
// Money safety is enforced SERVER-SIDE, never by the model:
//  - create_order only runs after checkGuardrails passes for that total,
//    or after the user explicitly approved this purchase in this call.
//  - the user always approves the payment on PayPal's site (approveUrl).
//  - capture is never called by the agent; the existing approval-return
//    flow captures after the user approves on PayPal.
// Without a Vyce key the agent runs a rule-based fallback (same tools,
// same guardrails), so the pay flow never depends on the AI being up.
// ---------------------------------------------------------------------------

const AGENT_MAX_STEPS = 5;

function agentToolList(lang) {
  return (
    'Tools, call exactly one per step, strict JSON only:\n' +
    '- search_products {"category": "Headphones"|"Smartwatch"|"Keyboard"|"Speaker"|"Charger"|null, "maxPrice": number|null, "cheapest": boolean, "safest": boolean}: search the demo catalog, safest first by default.\n' +
    '- get_risk_score {"productId": string}: seller risk score 0-100, label Safe/Caution/Risky.\n' +
    '- get_total_cost {"productId": string}: honest PayPal total with fees.\n' +
    '- get_hold_risk {"productId": string}: hold risk Low/Moderate/High.\n' +
    '- check_guardrails {"totalUSD": number, "category": string}: whether the agent may pay without asking first.\n' +
    '- create_order {"productId": string, "amountUSD": number|null}: create the PayPal order, returns approveUrl. amountUSD is only for checking out the user\'s own share of a split (smaller than the full total); omit it for a normal full-total purchase. Only after check_guardrails passed for this purchase, or the user approved it.\n' +
    '- get_vault {}: past purchases from the Proof Vault.\n' +
    '- simulate_dispute {"vaultId": string, "reason": "not_received"|"not_as_described"|"unauthorized"}: dispute win chance for a vault entry.\n' +
    '- price_watch {"productId": string, "targetPrice": number}: watch a product and snipe it when the price drops to the target. The demo price feed is simulated and labelled.\n' +
    '- check_price_watch {"watchId": string}: check a watch, moves the simulated price once and reports current price and status (watching/triggered). When triggered, you may create the order for that product.\n' +
    '- list_price_watches {}: list all active price watches with their current price and status.\n' +
    '- split_payment_link {"productId": string, "friends": [string]}: split a product price with friends and create a separate PayPal Sandbox order + payment link for each friend\'s share. This replaces the Invoicing API, which is not authorized for this sandbox app.\n' +
    '- track_and_dispute {"reason": "not_received"|"not_as_described"|"unauthorized"}: track the latest purchase with the PayPal Tracking API and simulate a dispute for it, returns the dispute payload (PayPal Disputes API format, simulated). Use when the user asks to track or dispute their order.\n' +
    'Reply per step, strict JSON only, no other text:\n' +
    '{"action": "<tool>", "args": {...}, "reason": "<one short sentence>"} or ' +
    '{"action": "reply", "text": "<final message to the user>"} or ' +
    '{"action": "ask_approval", "productId": "<id>", "totalUSD": <number>, "text": "<why approval is needed>"}.\n' +
    'Rules: always search first. Check risk, total, and hold before buying. Never pick a Risky seller when a Safe one fits the budget. Never pay above the user-stated budget. Always check guardrails before create_order. If the user asks to continue or check out their share after a split or a search (for example "lanjut checkout bagian saya", "beli bagian saya", "lanjut checkout"), use the active product from the session note below - call create_order for it (with amountUSD = the share when one is given) - and never re-search the catalog for it. The buyer approves the payment on PayPal, you only prepare the order and hand them the link. Reply in ' + (lang === 'id' ? 'Indonesian' : 'English') + '.'
  );
}

async function agentAskModel(messages) {
  const apiKey = process.env.VYCE_API_KEY;
  if (!apiKey) return null;
  const baseUrl = (process.env.VYCE_API_BASE || 'https://vyceai.com/v1').replace(/\/$/, '');
  const model = process.env.VYCE_MODEL || 'deepseek-v4.1';
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30000);
    const res = await fetch(baseUrl + '/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + apiKey,
      },
      body: JSON.stringify({ model, messages, temperature: 0, max_tokens: 400 }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const data = await res.json();
    const text = (data?.choices?.[0]?.message?.content || '').replace(/```json|```/g, '').trim();
    const decision = JSON.parse(text);
    if (!decision || typeof decision.action !== 'string') return null;
    return decision;
  } catch (e) {
    return null;
  }
}

function agentProductSummary(p) {
  const seller = sellersById.get(p.sellerId);
  const risk = calculateRiskScore(seller, p);
  return { id: p.id, name: p.name, priceUSD: p.priceUSD, category: p.category, seller: seller ? seller.name : null, riskScore: risk.score, riskLabel: risk.label };
}

function agentApplyGuardrails(clientGuardrails) {
  const saved = guardrails;
  if (clientGuardrails && Number.isFinite(Number(clientGuardrails.autoApproveLimit))) {
    guardrails = {
      autoApproveLimit: Number(clientGuardrails.autoApproveLimit),
      categoryCaps: (clientGuardrails.categoryCaps && typeof clientGuardrails.categoryCaps === 'object')
        ? clientGuardrails.categoryCaps
        : saved.categoryCaps,
    };
  }
  return saved;
}

function agentSearch(args) {
  const cats = ['headphones', 'smartwatch', 'keyboard', 'speaker', 'charger'];
  const cat = args.category ? String(args.category).toLowerCase() : null;
  const intent = {
    category: cat && cats.includes(cat) ? cat : null,
    maxPrice: Number.isFinite(Number(args.maxPrice)) ? Number(args.maxPrice) : null,
    minPrice: null,
    cheapest: !!args.cheapest,
    best: !!args.safest,
    safest: !!args.safest,
    seller: null,
    needsReturn: false,
    needsTracking: false,
    selectFirst: false,
  };
  const result = applyIntent(intent, null, 'en');
  const products = result.products.slice(0, 5).map(agentProductSummary);
  return { data: { products }, summary: products.length + ' product(s) found' };
}

function agentRiskScore(args) {
  const p = productsById.get(String(args.productId || ''));
  if (!p) return { data: { error: 'Unknown productId.' }, summary: 'unknown product' };
  const seller = sellersById.get(p.sellerId);
  const risk = calculateRiskScore(seller, p);
  return {
    data: { productId: p.id, name: p.name, riskScore: risk.score, label: risk.label, components: risk.components },
    summary: p.name + ': ' + risk.score + '/100 ' + risk.label,
  };
}

function agentTotalCost(args, lang) {
  const p = productsById.get(String(args.productId || ''));
  if (!p) return { data: { error: 'Unknown productId.' }, summary: 'unknown product' };
  const cost = calculateTotalCost(p.priceUSD, true, true, lang);
  return {
    data: { productId: p.id, name: p.name, itemPrice: cost.itemPrice, totalUSD: cost.total, currency: 'USD' },
    summary: p.name + ' total $' + cost.total,
  };
}

function agentHoldRisk(args, lang) {
  const p = productsById.get(String(args.productId || ''));
  if (!p) return { data: { error: 'Unknown productId.' }, summary: 'unknown product' };
  const seller = sellersById.get(p.sellerId);
  const hold = calculateHoldRisk(seller, p, lang);
  return {
    data: { productId: p.id, name: p.name, level: hold.level, points: hold.points, reasons: hold.reasons },
    summary: p.name + ' hold risk: ' + hold.level,
  };
}

function agentCheckGuardrails(args, lang, clientGuardrails) {
  const saved = agentApplyGuardrails(clientGuardrails);
  const out = checkGuardrails(Number(args.totalUSD) || 0, String(args.category || ''), lang);
  guardrails = saved;
  return { data: out, summary: out.needsApproval ? 'needs approval: ' + out.reasons.join(' ') : 'within limits' };
}

function agentGetVault() {
  const entries = [...vaultEntries.values()]
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
    .slice(0, 5);
  const data = entries.map((e) => ({
    id: e.id,
    product: e.product ? e.product.name : null,
    totalUSD: e.totalCost ? e.totalCost.total : null,
    status: e.paypal ? e.paypal.status : null,
    orderId: e.paypal ? e.paypal.orderId : null,
  }));
  return { data: { entries: data }, summary: data.length + ' past purchase(s)' };
}

async function agentSimulateDispute(args, lang) {
  const result = await simulateDispute(
    { vaultId: String(args.vaultId || ''), disputeType: String(args.reason || 'not_received') },
    lang
  );
  if (result.error) return { data: { error: result.error }, summary: 'dispute check failed' };
  return { data: result, summary: 'dispute win chance ' + result.winChance + '% (' + result.label + ')' };
}

function agentPriceWatch(args) {
  const p = productsById.get(String(args.productId || ''));
  if (!p) return { data: { error: 'Unknown productId.' }, summary: 'unknown product' };
  const target = Number(args.targetPrice);
  if (!Number.isFinite(target) || target <= 0) return { data: { error: 'targetPrice must be a positive number.' }, summary: 'bad target price' };
  const w = createPriceWatch(p, target);
  return {
    data: { watchId: w.id, productId: w.productId, productName: w.productName, targetPrice: w.targetPrice, currentPrice: w.currentPrice, status: w.status, note: 'Demo price feed is simulated and labelled.' },
    summary: 'watching ' + w.productName + ' for $' + w.targetPrice + ' (now $' + w.currentPrice + ', ' + w.status + ')',
  };
}

function agentCheckPriceWatch(args) {
  const w = checkPriceWatch(String(args.watchId || ''));
  if (!w) return { data: { error: 'Unknown watchId.' }, summary: 'unknown watch' };
  return {
    data: { watchId: w.id, productId: w.productId, productName: w.productName, targetPrice: w.targetPrice, currentPrice: w.currentPrice, status: w.status },
    summary: w.productName + ' now $' + w.currentPrice + ', target $' + w.targetPrice + ' (' + w.status + ')',
  };
}

function agentListPriceWatches() {
  const watches = [...priceWatches.values()]
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
    .map((w) => ({ watchId: w.id, productId: w.productId, productName: w.productName, targetPrice: w.targetPrice, currentPrice: w.currentPrice, status: w.status }));
  return { data: { watches }, summary: watches.length + ' watch(es)' };
}

// Track the latest purchase and simulate a dispute for it. The tracking
// step reuses the /api/tracking/add route (real PayPal Tracking API) over
// HTTP so the route stays the single source of truth; the dispute step
// calls simulateDispute directly (simulated Disputes API payload).
async function agentTrackAndDispute(args, ctx) {
  const reason = ['not_received', 'not_as_described', 'unauthorized'].includes(String(args.reason || ''))
    ? String(args.reason)
    : 'not_received';
  const entries = [...vaultEntries.values()].sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  const entry = entries[0];
  if (!entry) return { data: { error: 'No purchase yet. Buy something first, then track and dispute it.' }, summary: 'no purchase to track' };
  let tracking = null;
  try {
    const r = await fetch(ctx.baseUrl + '/api/tracking/add', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vaultId: entry.id, lang: ctx.lang }),
    });
    tracking = await r.json();
    if (!r.ok) tracking = { error: tracking.error || ('tracking failed (HTTP ' + r.status + ')') };
  } catch (e) {
    tracking = { error: String((e && e.message) || e) };
  }
  const dispute = await simulateDispute({ vaultId: entry.id, disputeType: reason }, ctx.lang);
  return {
    data: { vaultId: entry.id, product: entry.product ? entry.product.name : null, tracking, dispute },
    summary: 'tracked ' + (entry.product ? entry.product.name : entry.id) + ', dispute win chance ' + (dispute.winChance !== undefined ? dispute.winChance + '%' : 'n/a'),
  };
}

async function agentSplitPaymentLink(args, ctx) {
  const p = productsById.get(String(args.productId || ''));
  if (!p) return { data: { error: 'Unknown productId.' }, summary: 'unknown product' };
  const friends = (Array.isArray(args.friends) ? args.friends : []).map((x) => String(x).trim()).filter(Boolean).slice(0, 10);
  if (!friends.length) return { data: { error: 'Add at least one friend to split with.' }, summary: 'no friends' };
  // Split the ITEM price (same as /api/split-payment-link for a productId),
  // not the fee-inclusive total: p01 $59.99 / 3 = $20.00 per friend.
  const totalPrice = p.priceUSD;
  const people = friends.length + 1;
  // Integer-cents split (same as /api/split-payment-link): each friend pays
  // the share rounded to the nearest cent; the initiator's share absorbs
  // the leftover cents so the exact total adds up.
  const totalCents = Math.round(totalPrice * 100);
  const shareCents = Math.round(totalCents / people);
  const share = shareCents / 100;
  const initiatorShare = ((totalCents - friends.length * shareCents) / 100).toFixed(2);
  const exactTotalVerified = (totalCents / 100).toFixed(2);
  const links = [];
  for (const friend of friends) {
    try {
      const order = await createSplitPaymentOrder(share, p.name, ctx.baseUrl);
      links.push({ friend, orderId: order.orderId, approveUrl: order.approveUrl, amountUSD: share, status: order.status });
    } catch (err) {
      links.push({ friend, amountUSD: share, error: err.message || String(err.status || 502) });
    }
  }
  return {
    data: { productId: p.id, product: p.name, total: totalPrice, people, share, initiatorShare, exactTotalVerified, friends, links },
    summary: 'split ' + p.name + ' ' + people + ' ways, $' + share + ' each, ' + links.filter((l) => l.approveUrl).length + ' payment link(s)',
  };
}

// Execute one agent tool. The guardrail gate lives here, not in the model:
// create_order re-runs checkGuardrails itself and only proceeds when it
// passes, or the user approved this purchase in this call. The model's
// check_guardrails call is informational only.
async function agentExecuteTool(action, args, ctx) {
  const a = args && typeof args === 'object' ? args : {};
  switch (action) {
    case 'search_products': return agentSearch(a);
    case 'get_risk_score': return agentRiskScore(a);
    case 'get_total_cost': return agentTotalCost(a, ctx.lang);
    case 'get_hold_risk': return agentHoldRisk(a, ctx.lang);
    case 'check_guardrails': {
      const out = agentCheckGuardrails(a, ctx.lang, ctx.clientGuardrails);
      return out;
    }
    case 'create_order': {
      const p = productsById.get(String(a.productId || ''));
      if (!p) return { data: { error: 'Unknown productId.' }, summary: 'unknown product' };
      const full = calculateTotalCost(p.priceUSD, true, true, ctx.lang);
      // Optional amountUSD: a split share checkout (the user's own share,
      // smaller than the full total). It must be positive and no larger
      // than the full total; anything else uses the full total.
      const want = Number(a.amountUSD);
      const amount = Number.isFinite(want) && want > 0 && want <= full.total + 0.01
        ? Math.round(want * 100) / 100 : full.total;
      const isShare = amount < full.total - 0.01;
      if (!ctx.userApproved) {
        const saved = agentApplyGuardrails(ctx.clientGuardrails);
        const g = checkGuardrails(amount, p.category, ctx.lang);
        guardrails = saved;
        if (g.needsApproval) {
          return {
            data: { error: g.reasons.join(' '), totalUSD: amount, needsApproval: true, shareCheckout: isShare },
            summary: 'blocked by guardrails, approval needed',
          };
        }
      }
      // A share amount goes through createSplitPaymentOrder (arbitrary
      // amount); createPayPalOrder rejects any total that does not match
      // the computed full total.
      const raw = isShare
        ? await createSplitPaymentOrder(amount, p.name + ' (your share)', ctx.baseUrl)
        : await createPayPalOrder(p, amount, ctx.baseUrl, null, true, true);
      const order = { orderId: raw.orderId, status: raw.status, approveUrl: raw.approveUrl, totalUSD: amount, productId: p.id, shareCheckout: isShare };
      return { data: order, summary: 'order ' + order.orderId + ' created, total $' + order.totalUSD };
    }
    case 'get_vault': return agentGetVault();
    case 'simulate_dispute': return agentSimulateDispute(a, ctx.lang);
    case 'price_watch': return agentPriceWatch(a);
    case 'check_price_watch': return agentCheckPriceWatch(a);
    case 'list_price_watches': return agentListPriceWatches();
    case 'split_payment_link': return agentSplitPaymentLink(a, ctx);
    case 'track_and_dispute': return agentTrackAndDispute(a, ctx);
    default: return { data: { error: 'Unknown tool: ' + action }, summary: 'unknown tool' };
  }
}

// Checkout continuations: after a split (or a product search), the user
// often follows up with a short phrase that names no product - "lanjut
// checkout bagian saya", "beli bagian saya", "lanjut checkout". Those
// phrases must resolve to the ACTIVE product and run the checkout flow,
// never a generic catalog search. The frontend routes them to /api/agent
// and sends the active product as context + lastSplit; the server never
// guesses a product when there is no active one.
function isCheckoutContinuation(message) {
  const s = ' ' + String(message || '').toLowerCase().replace(/\s+/g, ' ').trim() + ' ';
  return (
    /\blanjut\b/.test(s) ||
    /\blanjutkan\b/.test(s) ||
    /\bbagian\s+(saya|ku|gue|gw)\b/.test(s) ||
    /\bmy\s+share\b/.test(s) ||
    /\b(bayar|beli|checkout)\s+(bagian|saya|sekarang|now)\b/.test(s)
  );
}

// Resolve the active product for a continuation. Priority: (1) the active
// split session - the user split THIS product, so "bagian saya" is its
// share; (2) the first product of the last search results the chat showed
// (frontend `lastResults`, sent as `context`). IDs are validated against
// the catalog, so a forged ID resolves to nothing, never to a purchase.
function resolveContinuationProduct(ctx) {
  const splitId = ctx && ctx.lastSplit ? String(ctx.lastSplit.productId || '') : '';
  if (splitId && productsById.get(splitId)) return productsById.get(splitId);
  const ids = ctx && Array.isArray(ctx.context) ? ctx.context : [];
  for (const id of ids) {
    const p = productsById.get(String(id || ''));
    if (p) return p;
  }
  return null;
}

// Shared by the runAgentLoop bypass and the agentFallback branch: resolve
// the continuation to the active product and check out. Returns the full
// agent result object (an order, or needsApproval, or a clarification
// reply when there is no active product - never a catalog dump).
async function agentCheckoutContinuation(message, lang, ctx) {
  const steps = [{ action: 'checkout_continuation', summary: 'continuation: ' + String(message || '').slice(0, 60) }];
  const p = resolveContinuationProduct(ctx);
  if (!p) {
    return {
      reply: lang === 'id'
        ? 'Produk mana yang mau kamu checkout? Sebutkan produknya, misalnya "beli headphone p01", atau cari dulu lalu lanjut checkout.'
        : 'Which product do you want to check out? Name it, for example "buy headphones p01", or search first and then continue to checkout.',
      steps, aiUsed: false,
    };
  }
  // The user's own share of an active split: the initiator's share absorbs
  // the leftover cents (see agentSplitPaymentLink). Anything else is the
  // normal full-total checkout for this product.
  const split = ctx && ctx.lastSplit && String(ctx.lastSplit.productId || '') === p.id ? ctx.lastSplit : null;
  const shareAmount = split ? Number(split.initiatorShare ?? split.share) : NaN;
  const isShare = Number.isFinite(shareAmount) && shareAmount > 0;
  const full = calculateTotalCost(p.priceUSD, true, true, lang);
  const amount = isShare ? Math.round(shareAmount * 100) / 100 : full.total;
  // Guardrails apply to the amount actually being paid (the share, or the
  // full total). A share under $20 auto-passes; an over-limit amount still
  // needs the user's approval, like any other purchase.
  const saved = agentApplyGuardrails(ctx.clientGuardrails);
  const g = checkGuardrails(amount, p.category, lang);
  guardrails = saved;
  steps.push({ action: 'check_guardrails', summary: g.needsApproval ? 'needs approval' : 'within limits' });
  if (g.needsApproval && !ctx.userApproved) {
    return {
      reply: lang === 'id'
        ? (isShare ? 'Bagianmu ' + p.name + ' ($' + amount.toFixed(2) + ') ' : 'Total ' + p.name + ' ($' + amount.toFixed(2) + ') ') + g.reasons.join(' ') + ' Ketuk setujui untuk lanjut ke pembayaran PayPal.'
        : (isShare ? 'Your share of ' + p.name + ' ($' + amount.toFixed(2) + ') ' : p.name + ' total ($' + amount.toFixed(2) + ') ') + g.reasons.join(' ') + ' Tap approve to continue to PayPal payment.',
      steps,
      needsApproval: true,
      pendingOrder: { productId: p.id, totalUSD: amount, name: p.name, shareCheckout: isShare },
      aiUsed: false,
    };
  }
  // The share is an arbitrary amount (not the catalog total), so it goes
  // through createSplitPaymentOrder - createPayPalOrder rejects any total
  // that does not match the computed full total. The full-total path uses
  // createPayPalOrder as usual.
  const raw = isShare
    ? await createSplitPaymentOrder(amount, p.name + ' (your share)', ctx.baseUrl)
    : await createPayPalOrder(p, amount, ctx.baseUrl, null, true, true);
  const order = { orderId: raw.orderId, status: raw.status, approveUrl: raw.approveUrl, totalUSD: amount, productId: p.id, shareCheckout: isShare };
  steps.push({ action: 'create_order', summary: 'order ' + order.orderId + ' created, total $' + order.totalUSD });
  return {
    reply: lang === 'id'
      ? (isShare ? 'Bagianmu ' + p.name + ' sudah disiapkan: $' + amount.toFixed(2) + '. ' : 'Pesanan ' + p.name + ' sudah dibuat (total $' + amount.toFixed(2) + '). ') + 'Silakan setujui pembayarannya di PayPal.'
      : (isShare ? 'Your share of ' + p.name + ' is ready: $' + amount.toFixed(2) + '. ' : 'The order for ' + p.name + ' is ready (total $' + amount.toFixed(2) + '). ') + 'Please approve the payment on PayPal.',
    steps, order, aiUsed: false,
  };
}

// Rule-based fallback when Vyce is not configured or stops answering.
// Same tools, same guardrails, no model. Keeps the pay flow working.
async function agentFallback(message, lang, ctx) {
  const steps = [];
  const intent = parseAskRegex(message);
  // "Cek pantauan" carries no product/price intent, so it must be checked
  // before the hasIntent gate below.
  const isCheckWatches = /cek (pantau|harga|watch)|check (my )?(price )?(watch|watches)|lihat pantauan/.test(message.toLowerCase());
  // "Lacak & dispute pesanan" also carries no product/price intent.
  const isTrackDispute = /(lacak|track|dispute|sengketa)/.test(message.toLowerCase());
  // Checkout continuations ("lanjut checkout bagian saya", "beli bagian
  // saya") also name no product - the product comes from the active split
  // session or the last search results (ctx), never from a fresh search.
  const isContinuation = isCheckoutContinuation(message);
  // No shopping intent at all (the frontend only routes buy goals here,
  // but a direct API call could send anything): do not guess a purchase.
  const hasIntent = intent.category || intent.maxPrice !== null || intent.minPrice !== null
    || intent.cheapest || intent.best || intent.seller || intent.needsReturn || intent.needsTracking
    || isCheckWatches || isTrackDispute || isContinuation;
  if (!hasIntent) {
    return {
      reply: lang === 'id'
        ? 'Saya agen belanja PayPal: beri saya tujuan belanja, misalnya "beli headphone paling aman di bawah $60".'
        : 'I am a PayPal shopping agent: give me a shopping goal, for example "buy the safest headphones under $60".',
      steps, aiUsed: false,
    };
  }
  const result = applyIntent(intent, null, lang);
  const products = result.products.slice(0, 5);
  // Track & dispute intent ("lacak dan dispute pesanan terakhir"): track
  // the latest purchase with the PayPal Tracking API and simulate a
  // dispute, returning the dispute payload.
  if (isTrackDispute) {
    const out = await agentTrackAndDispute({ reason: 'not_received' }, ctx);
    steps.push({ action: 'track_and_dispute', summary: out.summary });
    if (out.data.error) {
      return {
        reply: lang === 'id'
          ? 'Belum ada pesanan yang bisa dilacak. Beli dulu sesuatu, lalu lacak pesanannya di sini.'
          : 'No purchase to track yet. Buy something first, then track it here.',
        steps, aiUsed: false,
      };
    }
    const d = out.data.dispute || {};
    return {
      reply: lang === 'id'
        ? 'Pesanan terakhir (' + (out.data.product || out.data.vaultId) + ') sudah dilacak' + (out.data.tracking && out.data.tracking.status ? ' (' + out.data.tracking.status + ')' : '') + '. Simulasi sengketa: peluang menang ' + (d.winChance !== undefined ? d.winChance + '%' : '-') + ' (' + (d.label || '') + '). Payload sengketa ada di bawah.'
        : 'Latest order (' + (out.data.product || out.data.vaultId) + ') tracked' + (out.data.tracking && out.data.tracking.status ? ' (' + out.data.tracking.status + ')' : '') + '. Dispute simulation: win chance ' + (d.winChance !== undefined ? d.winChance + '%' : '-') + ' (' + (d.label || '') + '). The dispute payload is below.',
      steps, tracking: out.data.tracking, dispute: d, aiUsed: false,
    };
  }
  // Check watches intent ("cek pantauan harga"): list watches, check each,
  // and if one triggered, prepare the buy (guardrails still apply).
  if (isCheckWatches) {
    const watches = [...priceWatches.values()].sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    steps.push({ action: 'list_price_watches', summary: watches.length + ' watch(es)' });
    if (!watches.length) {
      return {
        reply: lang === 'id'
          ? 'Belum ada pantauan harga. Buat dulu, misalnya "pantau headphone, target $25".'
          : 'No price watches yet. Create one first, for example "watch headphones, target $25".',
        steps, aiUsed: false,
      };
    }
    const checked = watches.map((w) => checkPriceWatch(w.id));
    steps.push({ action: 'check_price_watch', summary: checked.map((w) => w.productName + ' $' + w.currentPrice + ' (' + w.status + ')').join(', ') });
    const triggered = checked.find((w) => w.status === 'triggered');
    if (!triggered) {
      const lines = checked.map((w) => w.productName + ': $' + w.currentPrice + ' (target $' + w.targetPrice + ')');
      return {
        reply: lang === 'id'
          ? 'Pantauan harga:\n' + lines.join('\n') + '\nBelum ada yang kena target. Cek lagi nanti.'
          : 'Price watches:\n' + lines.join('\n') + '\nNone hit the target yet. Check again later.',
        steps, watches: checked, aiUsed: false,
      };
    }
    const p = productsById.get(triggered.productId);
    const total = calculateTotalCost(p.priceUSD, true, true, lang);
    const saved = agentApplyGuardrails(ctx.clientGuardrails);
    const g = checkGuardrails(total.total, p.category, lang);
    guardrails = saved;
    steps.push({ action: 'check_guardrails', summary: g.needsApproval ? 'needs approval' : 'within limits' });
    if (g.needsApproval && !ctx.userApproved) {
      return {
        reply: lang === 'id'
          ? 'Kena target! ' + triggered.productName + ' sekarang $' + triggered.currentPrice + ' (target $' + triggered.targetPrice + '). Total $' + total.total + '. ' + g.reasons.join(' ') + ' Ketuk setujui untuk beli sekarang.'
          : 'Target hit! ' + triggered.productName + ' is now $' + triggered.currentPrice + ' (target $' + triggered.targetPrice + '). Total $' + total.total + '. ' + g.reasons.join(' ') + ' Tap approve to buy now.',
        steps, needsApproval: true, watches: checked,
        pendingOrder: { productId: p.id, totalUSD: total.total, name: p.name },
        triggeredWatch: { watchId: triggered.id, productId: triggered.productId, productName: triggered.productName, targetPrice: triggered.targetPrice, currentPrice: triggered.currentPrice, status: triggered.status },
        aiUsed: false,
      };
    }
    const order = await createPayPalOrder(p, total.total, ctx.baseUrl, null, true, true);
    steps.push({ action: 'create_order', summary: 'order ' + order.orderId + ' created' });
    return {
      reply: lang === 'id'
        ? 'Kena target! ' + triggered.productName + ' sekarang $' + triggered.currentPrice + '. Pesanan PayPal sudah dibuat (total $' + total.total + '). Silakan setujui pembayarannya di PayPal.'
        : 'Target hit! ' + triggered.productName + ' is now $' + triggered.currentPrice + '. The PayPal order is ready (total $' + total.total + '). Please approve the payment on PayPal.',
      steps, order, watches: checked,
      triggeredWatch: { watchId: triggered.id, productId: triggered.productId, productName: triggered.productName, targetPrice: triggered.targetPrice, currentPrice: triggered.currentPrice, status: triggered.status },
      aiUsed: false,
    };
  }
  // Checkout continuation ("lanjut checkout bagian saya", "beli bagian
  // saya"): resolve the active product (split first, then the last search
  // results) and check out. Never a generic catalog search.
  if (isContinuation) {
    return agentCheckoutContinuation(message, lang, ctx);
  }
  // Watch intent ("pantau ... $25"): create a price watch, do not buy.
  // The target is a future price, so the product is found by category only
  // (not filtered by the target price).
  const isWatch = /\b(pantau|memantau|watch|awasi|snipe)\b/.test(message.toLowerCase());
  if (isWatch) {
    const target = intent.maxPrice;
    const watchIntent = { ...intent, maxPrice: null, minPrice: null, cheapest: false, best: false };
    const wResult = applyIntent(watchIntent, null, lang);
    const wProducts = wResult.products.slice(0, 5);
    steps.push({ action: 'search_products', summary: wProducts.length + ' product(s) found' });
    if (!wProducts.length) {
      return {
        reply: lang === 'id'
          ? 'Saya tidak menemukan produk yang cocok untuk dipantau.'
          : 'I could not find a matching product to watch.',
        steps, aiUsed: false,
      };
    }
    if (!Number.isFinite(target) || target <= 0) {
      return {
        reply: lang === 'id'
          ? 'Sebutkan harga targetnya, misalnya "pantau headphone, target $25".'
          : 'Tell me the target price, for example "watch headphones, target $25".',
        steps, aiUsed: false,
      };
    }
    const p = wProducts[0];
    const w = createPriceWatch(p, target);
    steps.push({ action: 'price_watch', summary: 'watching ' + w.productName + ' for $' + w.targetPrice + ' (now $' + w.currentPrice + ', ' + w.status + ')' });
    return {
      reply: lang === 'id'
        ? 'Siap, saya pantau ' + w.productName + ' (sekarang $' + w.currentPrice + '). Kalau harganya turun ke $' + w.targetPrice + ', saya beri tahu dan kamu bisa langsung beli. Cek pantauan dengan "cek pantauan harga".'
        : 'Done, I am watching ' + w.productName + ' (now $' + w.currentPrice + '). When the price drops to $' + w.targetPrice + ', I will tell you and you can buy right away. Check your watches with "check my price watches".',
      steps,
      watch: { watchId: w.id, productId: w.productId, productName: w.productName, targetPrice: w.targetPrice, currentPrice: w.currentPrice, status: w.status },
      aiUsed: false,
    };
  }
  // Split intent ("patungan headphone sama Budi dan Sari"): create a
  // payment link per friend via the Orders API (the Invoicing API is 403).
  const isSplit = /\b(patungan|split|bagi rata|bagi-bagi)\b/.test(message.toLowerCase());
  if (isSplit) {
    // Friends are the names after "sama/with/bareng/dengan", split by
    // "dan/and" or commas; category/price words are stripped first.
    let tail = message.toLowerCase();
    const m = tail.match(/(?:sama|with|bareng|dengan|bersama)\s+(.+)$/);
    tail = m ? m[1] : '';
    const friends = tail
      .replace(/\$\s*\d+(\.\d+)?/g, '')
      .replace(/\b(headphone|headphones|smartwatch|keyboard|speaker|charger|paling aman|termurah|terbaik|safest|cheapest|best|patungan|split|bagi rata|bagi-bagi)\b/g, '')
      .split(/\s*(?:dan|and|,)\s*/)
      .map((x) => x.trim())
      .filter(Boolean)
      .slice(0, 10);
    const splitIntent = { ...intent, maxPrice: null, minPrice: null, cheapest: false, best: false };
    const sResult = applyIntent(splitIntent, null, lang);
    const sProducts = sResult.products.slice(0, 5);
    steps.push({ action: 'search_products', summary: sProducts.length + ' product(s) found' });
    if (!sProducts.length) {
      return {
        reply: lang === 'id'
          ? 'Saya tidak menemukan produk yang cocok untuk patungan.'
          : 'I could not find a matching product to split.',
        steps, aiUsed: false,
      };
    }
    if (!friends.length) {
      return {
        reply: lang === 'id'
          ? 'Sebutkan nama temanmu, misalnya "patungan headphone sama Budi dan Sari".'
          : 'Tell me your friends\' names, for example "split headphones with Budi and Sari".',
        steps, aiUsed: false,
      };
    }
    const p = sProducts[0];
    const split = await agentSplitPaymentLink({ productId: p.id, friends }, ctx);
    if (split.data.error) {
      return { reply: split.data.error, steps, aiUsed: false };
    }
    steps.push({ action: 'split_payment_link', summary: split.summary });
    return {
      reply: lang === 'id'
        ? 'Patungan ' + p.name + ': total $' + split.data.total + ', tiap orang $' + split.data.share + ' (' + split.data.people + ' orang). Link bayar tiap teman sudah dibuat, kirim ke mereka. Bagianmu sendiri dibayar lewat checkout biasa.'
        : 'Splitting ' + p.name + ': total $' + split.data.total + ', each share $' + split.data.share + ' (' + split.data.people + ' people). Each friend\'s payment link is ready, send it to them. Your own share is paid through the normal checkout.',
      steps,
      splitPayment: split.data,
      aiUsed: false,
    };
  }
  steps.push({ action: 'search_products', summary: products.length + ' product(s) found' });
  if (!products.length) {
    return {
      reply: lang === 'id'
        ? 'Saya tidak menemukan produk yang cocok di katalog demo.'
        : 'I could not find a matching product in the demo catalog.',
      steps, aiUsed: false,
    };
  }
  const p = products[0];
  const seller = sellersById.get(p.sellerId);
  const risk = calculateRiskScore(seller, p);
  const total = calculateTotalCost(p.priceUSD, true, true, lang);
  steps.push({ action: 'get_total_cost', summary: p.name + ' total $' + total.total });
  const saved = agentApplyGuardrails(ctx.clientGuardrails);
  const g = checkGuardrails(total.total, p.category, lang);
  guardrails = saved;
  steps.push({ action: 'check_guardrails', summary: g.needsApproval ? 'needs approval' : 'within limits' });
  if (g.needsApproval && !ctx.userApproved) {
    return {
      reply: lang === 'id'
        ? 'Saya menemukan ' + p.name + ' (' + risk.score + '/100 ' + risk.label + '), total $' + total.total + '. ' + g.reasons.join(' ') + ' Ketuk setujui untuk lanjut ke pembayaran PayPal.'
        : 'I found ' + p.name + ' (' + risk.score + '/100 ' + risk.label + '), total $' + total.total + '. ' + g.reasons.join(' ') + ' Tap approve to continue to PayPal payment.',
      steps,
      needsApproval: true,
      pendingOrder: { productId: p.id, totalUSD: total.total, name: p.name },
      aiUsed: false,
    };
  }
  const order = await createPayPalOrder(p, total.total, ctx.baseUrl, null, true, true);
  steps.push({ action: 'create_order', summary: 'order ' + order.orderId + ' created' });
  return {
    reply: lang === 'id'
      ? 'Saya menemukan ' + p.name + ' (' + risk.score + '/100 ' + risk.label + '), total $' + total.total + '. Pesanan PayPal sudah dibuat, silakan setujui pembayarannya di PayPal.'
      : 'I found ' + p.name + ' (' + risk.score + '/100 ' + risk.label + '), total $' + total.total + '. The PayPal order is ready, please approve the payment on PayPal.',
    steps, order, aiUsed: false,
  };
}

async function runAgentLoop(message, lang, ctx) {
  // The user approved a pending order: create it directly, no model call.
  if (ctx.userApproved && ctx.approvedOrder && ctx.approvedOrder.productId) {
    const p = productsById.get(String(ctx.approvedOrder.productId));
    if (!p) {
      return { reply: lang === 'id' ? 'Produk itu tidak ditemukan.' : 'That product was not found.', steps: [], aiUsed: false };
    }
    const full = calculateTotalCost(p.priceUSD, true, true, lang);
    // Honor an explicit total when the pending order carried one (a split
    // share checkout: the amount is the share, not the full total). It
    // must be positive and no larger than the full total; anything else
    // falls back to the computed full total.
    const want = Number(ctx.approvedOrder.totalUSD);
    const amount = Number.isFinite(want) && want > 0 && want <= full.total + 0.01
      ? Math.round(want * 100) / 100 : full.total;
    const isShare = amount < full.total - 0.01;
    const raw = isShare
      ? await createSplitPaymentOrder(amount, p.name + ' (your share)', ctx.baseUrl)
      : await createPayPalOrder(p, amount, ctx.baseUrl, null, true, true);
    const order = { orderId: raw.orderId, status: raw.status, approveUrl: raw.approveUrl, totalUSD: amount, productId: p.id, shareCheckout: isShare };
    return {
      reply: lang === 'id'
        ? 'Baik, pesanan PayPal untuk ' + p.name + ' sudah dibuat (total $' + amount.toFixed(2) + '). Silakan setujui pembayarannya di PayPal.'
        : 'Done, the PayPal order for ' + p.name + ' is ready (total $' + amount.toFixed(2) + '). Please approve the payment on PayPal.',
      steps: [{ action: 'create_order', summary: 'order ' + order.orderId + ' created' }],
      order, aiUsed: false,
    };
  }
  // Track & dispute is deterministic (the Quick Demo chip): run it directly
  // instead of letting the model ask a clarifying question first.
  if (/(lacak|track|dispute|sengketa)/.test(message.toLowerCase())) {
    const steps = [];
    const out = await agentTrackAndDispute({ reason: 'not_received' }, ctx);
    steps.push({ action: 'track_and_dispute', summary: out.summary });
    if (out.data.error) {
      return {
        reply: lang === 'id'
          ? 'Belum ada pesanan yang bisa dilacak. Beli dulu sesuatu, lalu lacak pesanannya di sini.'
          : 'No purchase to track yet. Buy something first, then track it here.',
        steps, aiUsed: false,
      };
    }
    const d = out.data.dispute || {};
    return {
      reply: lang === 'id'
        ? 'Pesanan terakhir (' + (out.data.product || out.data.vaultId) + ') sudah dilacak' + (out.data.tracking && out.data.tracking.status ? ' (' + out.data.tracking.status + ')' : '') + '. Simulasi sengketa: peluang menang ' + (d.winChance !== undefined ? d.winChance + '%' : '-') + ' (' + (d.label || '') + '). Payload sengketa ada di bawah.'
        : 'Latest order (' + (out.data.product || out.data.vaultId) + ') tracked' + (out.data.tracking && out.data.tracking.status ? ' (' + out.data.tracking.status + ')' : '') + '. Dispute simulation: win chance ' + (d.winChance !== undefined ? d.winChance + '%' : '-') + ' (' + (d.label || '') + '). The dispute payload is below.',
      steps, tracking: out.data.tracking, dispute: d, aiUsed: false,
    };
  }
  // Checkout continuations are deterministic (like track & dispute): the
  // user is continuing an active split or search, so resolve the active
  // product and check out instead of letting the model ask "which product?"
  if (isCheckoutContinuation(message)) {
    return agentCheckoutContinuation(message, lang, ctx);
  }
  // Tell the model about the active session, so even the model path (when
  // the bypass above does not apply) never re-searches the catalog for a
  // product the user is already working on.
  let sessionNote = '';
  const active = resolveContinuationProduct(ctx);
  if (active) {
    const split = ctx.lastSplit && String(ctx.lastSplit.productId || '') === active.id ? ctx.lastSplit : null;
    const share = split ? Number(split.initiatorShare ?? split.share) : NaN;
    sessionNote = '\nActive session: the user is working on ' + active.name + ' (' + active.id + ', $' + active.priceUSD + ')' +
      (Number.isFinite(share) && share > 0
        ? ', split with friends, their own share is $' + share.toFixed(2) + '. If the user asks to continue, check out, or pay their share (for example "lanjut checkout bagian saya", "beli bagian saya", "lanjut checkout"), call create_order for ' + active.id + ' with amountUSD ' + share.toFixed(2) + ' - do not search the catalog again.'
        : '. If the user asks to continue or check out (for example "lanjut checkout", "beli bagian saya"), call create_order for ' + active.id + ' - do not search the catalog again.');
  }
  const system = 'You are ShopPal, a PayPal shopping agent. You act for the user: you search, check, and prepare PayPal payments. ' + agentToolList(lang) + sessionNote;
  const messages = [
    { role: 'system', content: system },
    { role: 'user', content: message },
  ];
  const steps = [];
  const toolCtx = { ...ctx };
  for (let i = 0; i < AGENT_MAX_STEPS; i++) {
    const decision = await agentAskModel(messages);
    if (!decision) break;
    if (decision.action === 'reply') {
      return { reply: String(decision.text || ''), steps, aiUsed: true };
    }
    if (decision.action === 'ask_approval') {
      const p = productsById.get(String(decision.productId || ''));
      if (!p) {
        return { reply: String(decision.text || ''), steps, aiUsed: true };
      }
      const total = calculateTotalCost(p.priceUSD, true, true, lang);
      return {
        reply: String(decision.text || ''),
        steps,
        needsApproval: true,
        pendingOrder: { productId: p.id, totalUSD: total.total, name: p.name },
        aiUsed: true,
      };
    }
    if (!['search_products', 'get_risk_score', 'get_total_cost', 'get_hold_risk', 'check_guardrails', 'create_order', 'get_vault', 'simulate_dispute', 'price_watch', 'check_price_watch', 'list_price_watches', 'split_payment_link', 'track_and_dispute'].includes(decision.action)) {
      messages.push({ role: 'assistant', content: JSON.stringify(decision) });
      messages.push({ role: 'user', content: 'Tool result: {"error": "Unknown tool: ' + decision.action + '"}' });
      continue;
    }
    const result = await agentExecuteTool(decision.action, decision.args || {}, toolCtx);
    steps.push({ action: decision.action, summary: result.summary });
    messages.push({ role: 'assistant', content: JSON.stringify({ action: decision.action, args: decision.args || {}, reason: decision.reason || '' }) });
    messages.push({ role: 'user', content: 'Tool result: ' + JSON.stringify(result.data).slice(0, 2000) });
    if (decision.action === 'create_order' && result.data && result.data.approveUrl) {
      return {
        reply: lang === 'id'
          ? 'Pesanan PayPal sudah dibuat, total $' + result.data.totalUSD + '. Silakan setujui pembayarannya di PayPal.'
          : 'The PayPal order is ready, total $' + result.data.totalUSD + '. Please approve the payment on PayPal.',
        steps, order: result.data, aiUsed: true,
      };
    }
    if (decision.action === 'create_order' && result.data && result.data.needsApproval) {
      return {
        reply: lang === 'id'
          ? 'Pembelian ini butuh persetujuanmu dulu: ' + (result.data.error || '') + ' Ketuk setujui untuk lanjut.'
          : 'This purchase needs your approval first: ' + (result.data.error || '') + ' Tap approve to continue.',
        steps,
        needsApproval: true,
        pendingOrder: { productId: String(decision.args.productId || ''), totalUSD: result.data.totalUSD || 0, name: '', shareCheckout: !!result.data.shareCheckout },
        aiUsed: true,
      };
    }
  }
  // Model stopped answering or ran out of steps: fall back to the rules.
  const fb = await agentFallback(message, lang, ctx);
  fb.steps = [...steps, ...fb.steps];
  return fb;
}

app.post('/api/agent', async (req, res) => {
  try {
    const b = req.body || {};
    const message = String(b.message || b.q || '').trim();
    if (!message) return res.status(400).json({ error: 'message is required.' });
    const lang = (b.lang === 'id' || b.lang === 'en') ? b.lang : detectLang(message);
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const ctx = {
      lang,
      baseUrl,
      clientGuardrails: b.guardrails || null,
      userApproved: !!b.approved,
      approvedOrder: b.approvedOrder || null,
      // Conversation state the client owns: the product IDs the chat last
      // showed (lastResults) and the active split session, if any. Both
      // are validated against the catalog before use - a forged ID
      // resolves to nothing, never to a purchase.
      context: Array.isArray(b.context) ? b.context.map((x) => String(x)) : [],
      lastSplit: (b.lastSplit && typeof b.lastSplit === 'object') ? b.lastSplit : null,
    };
    const out = await runAgentLoop(message, lang, ctx);
    // Guardrail contract: when the agent refuses a purchase because it is
    // over the user's auto-approve limit, the endpoint answers 403 with a
    // GUARDRAIL_TRIGGERED status (and the pending order), instead of a
    // plain 200. The client treats this as "needs manual confirmation",
    // not as an error: it shows the Approve / Reject callout, and a retry
    // with approved:true + approvedOrder creates the order (HTTP 200).
    if (out && out.needsApproval) {
      return res.status(403).json({ ...out, status: 'GUARDRAIL_TRIGGERED', lang });
    }
    res.json({ ...out, lang });
  } catch (err) {
    res.status(err.status || 502).json({ error: err.message, paypalName: err.paypalName || null });
  }
});

// Real marketplace search (eBay Browse API). Returns real listings with a
// ShopPal risk score attached. Without eBay keys it says so plainly and
// returns no listings, the UI then shows the demo catalog only.
app.get('/api/marketplace/search', async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) return res.status(400).json({ error: 'q is required.' });
  const lang = (req.query.lang === 'id' || req.query.lang === 'en') ? req.query.lang : detectLang(q);
  if (!ebay.isConfigured()) {
    return res.json({
      configured: false,
      source: null,
      listings: [],
      note: t(lang, 'mpNotConfigured'),
    });
  }
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || 8, 1), 20);
    let listings = await ebay.searchEbay(q, { limit });
    if (!listings) listings = [];
    const maxPrice = Number(req.query.maxPrice);
    if (Number.isFinite(maxPrice)) listings = listings.filter((l) => l.priceUSD <= maxPrice);
    if (req.query.cheapest === 'true' || req.query.cheapest === '1') {
      listings.sort((a, b) => a.priceUSD - b.priceUSD);
    }
    const scored = listings.map((l) => ({
      ...l,
      risk: scoreMarketplaceListing(l, listings, lang),
      holdRisk: holdRiskForMarketplaceListing(l, listings, lang),
    }));
    res.json({
      configured: true,
      source: 'eBay',
      listings: scored,
      note: t(lang, 'mpNote'),
    });
  } catch (err) {
    res.status(502).json({ configured: true, source: 'eBay', listings: [], error: err.message });
  }
});

app.get('/api/subscriptions', (req, res) => {
  const entries = [...vaultEntries.values()].sort((a, b) =>
    (b.createdAt || '').localeCompare(a.createdAt || '')
  );
  res.json({ patterns: findSubscriptions(entries) });
});

// PayPal. Server-side only, the secret never leaves this file: no logging
// of it, no token value in any API response. Tokens are cached in memory
// until shortly before expiry.
let cachedToken = null;
let cachedTokenExpiresAt = 0;

async function getPayPalAccessToken() {
  const now = Date.now();
  if (cachedToken && now < cachedTokenExpiresAt) return cachedToken;
  const clientId = process.env.PAYPAL_CLIENT_ID;
  const secret = process.env.PAYPAL_CLIENT_SECRET;
  if (!clientId || !secret) {
    const err = new Error('PayPal sandbox credentials are not configured in .env.');
    err.status = 503;
    throw err;
  }
  const basic = Buffer.from(`${clientId}:${secret}`).toString('base64');
  const res = await fetch(`${PAYPAL_API_BASE}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  if (!res.ok) {
    const err = new Error(`PayPal token request failed (HTTP ${res.status}).`);
    err.status = 502;
    throw err;
  }
  const data = await res.json();
  cachedToken = data.access_token;
  // Refresh a minute before the real expiry.
  cachedTokenExpiresAt = now + (data.expires_in - 60) * 1000;
  return cachedToken;
}

async function paypalFetch(path, method, body) {
  const token = await getPayPalAccessToken();
  const res = await fetch(`${PAYPAL_API_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(
      data.message || data.error_description || `PayPal request failed (HTTP ${res.status}).`
    );
    err.status = res.status === 401 || res.status === 403 ? 502 : res.status;
    err.paypalName = data.name || null;
    // A 422 carries the specific problem in details[].issue
    // (e.g. ORDER_ALREADY_CAPTURED), not in the top-level name.
    err.paypalIssue = (data.details && data.details[0] && data.details[0].issue) || null;
    throw err;
  }
  return data;
}

function vaultDir() {
  // On Vercel the repo filesystem is read-only; /tmp is the writable area.
  // Locally, keep using data/vault/ so entries persist across restarts.
  return process.env.VERCEL
    ? path.join('/tmp', 'shoppal-vault')
    : path.join(__dirname, 'data', 'vault');
}

// Vault entries live in memory (source of truth for reads) and are also
// written to disk best-effort. On Vercel the disk copy is per-instance
// /tmp, so a judge's checkout -> vault flow reads the in-memory copy.
const vaultEntries = new Map();
// Marketplace orders (orderId -> listing details) so capture can build a
// Marketplace orders (orderId -> listing details) so capture can build a

// Proof Vault entry for a real listing, not just a demo catalog product.
const marketplaceOrders = new Map();
// Smart Guardrails: human-in-the-loop for agentic purchases.
// Memory-only (the Worker has no disk); the frontend also keeps a copy
// in localStorage and sends it with the check. Default: auto-approve
// up to $20, no per-category caps.
let guardrails = { autoApproveLimit: 20, categoryCaps: {} };
function categorySpendThisMonth(category) {
  const ym = new Date().toISOString().slice(0, 7);
  let spent = 0;
  for (const e of vaultEntries.values()) {
    const t = (e.paypal && e.paypal.createTime) || e.createdAt || '';
    if (t.slice(0, 7) !== ym) continue;
    if ((e.product && e.product.category) !== category) continue;
    spent += Number((e.totalCost && e.totalCost.total) || e.product.priceUSD || 0);
  }
  return spent;
}
function checkGuardrails(totalUSD, category, lang) {
  const reasons = [];
  const total = Number(totalUSD) || 0;
  const limit = Number(guardrails.autoApproveLimit) || 0;
  if (total > limit) reasons.push(fmt(t(lang, 'grAboveLimit'), { total: '$' + total.toFixed(2), limit: '$' + limit.toFixed(2) }));
  const cap = category && guardrails.categoryCaps ? Number(guardrails.categoryCaps[category]) : NaN;
  if (category && Number.isFinite(cap) && cap > 0) {
    const spent = categorySpendThisMonth(category);
    if (spent + total > cap) reasons.push(fmt(t(lang, 'grCatOver'), { cat: category, spent: '$' + spent.toFixed(2), cap: '$' + cap.toFixed(2) }));
  }
  return { needsApproval: reasons.length > 0, reasons };
}
try {
  const dir = vaultDir();
  if (fs.existsSync(dir)) {
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json'))) {
      try {
        const entry = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
        if (entry && entry.id) vaultEntries.set(entry.id, entry);
      } catch (e) { /* skip a corrupt vault file */ }
    }
  }
} catch (e) { /* vault starts empty if the disk cannot be read */ }

function saveVaultEntry(entry) {
  vaultEntries.set(entry.id, entry);
  try {
    const dir = vaultDir();
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${entry.id}.json`), JSON.stringify(entry, null, 2) + '\n');
  } catch (e) { /* disk is best-effort on serverless; memory still holds it */ }
  return entry;
}

// Dispute Deadline Tracker
// PayPal rules (public, Oct 2026): a dispute must be filed within 180 days
// of the payment; once filed, it auto-closes if not escalated to a claim
// within 20 days. Returns are the seller's own policy (30-day window is
// the demo standard when a return policy exists).
function deadlineStatus(daysLeft) {
  if (daysLeft < 0) return { daysLeft, status: 'expired' };
  if (daysLeft <= 7) return { daysLeft, status: 'urgent' };
  if (daysLeft <= 30) return { daysLeft, status: 'soon' };
  return { daysLeft, status: 'ok' };
}

function calculateDeadlines(purchaseISO, hasReturnPolicy, disputeFiledISO, lang) {
  const now = new Date();
  const purchase = new Date(purchaseISO);
  const out = [];
  if (!isNaN(purchase.getTime())) {
    // Days left counts whole days since the purchase, so a deadline set
    // 180 days out still reads "180 days left" right after buying.
    const daysSince = Math.max(0, Math.floor((now.getTime() - purchase.getTime()) / 86400000));
    const filingDue = new Date(purchase.getTime() + 180 * 86400000);
    out.push({
      type: 'filing',
      label: t(lang, 'dlFiling'),
      dueDate: filingDue.toISOString(),
      ...deadlineStatus(180 - daysSince),
    });
    if (hasReturnPolicy) {
      const returnDue = new Date(purchase.getTime() + 30 * 86400000);
      out.push({
        type: 'return',
        label: t(lang, 'dlReturn'),
        dueDate: returnDue.toISOString(),
        ...deadlineStatus(30 - daysSince),
      });
    } else {
      out.push({
        type: 'return',
        label: t(lang, 'dlReturn'),
        dueDate: null,
        daysLeft: null,
        status: 'none',
        note: t(lang, 'dlNoReturn'),
      });
    }
  }
  if (disputeFiledISO) {
    const filed = new Date(disputeFiledISO);
    if (!isNaN(filed.getTime())) {
      const daysSinceFiled = Math.max(0, Math.floor((now.getTime() - filed.getTime()) / 86400000));
      const escDue = new Date(filed.getTime() + 20 * 86400000);
      out.push({
        type: 'escalation',
        label: t(lang, 'dlEscalation'),
        dueDate: escDue.toISOString(),
        ...deadlineStatus(20 - daysSinceFiled),
      });
    }
  } else {
    out.push({
      type: 'escalation',
      label: t(lang, 'dlEscalation'),
      dueDate: null,
      daysLeft: null,
      status: 'none',
      note: t(lang, 'dlNoDispute'),
    });
  }
  return out;
}

// Dispute Win Simulator
// Transparent rule-based win-chance estimate for a PayPal dispute.
// The score is rules only; Vyce only rewrites the explanation in plain
// language and never changes a number.
async function simulateDispute(opts, lang) {
  lang = lang === 'id' ? 'id' : 'en';
  const type = ['not_received', 'not_as_described', 'unauthorized'].includes(opts.disputeType)
    ? opts.disputeType
    : 'not_received';
  const entry = opts.vaultId ? vaultEntries.get(opts.vaultId) : null;
  const product = opts.productId ? productsById.get(opts.productId) : null;
  const seller = product ? sellersById.get(product.sellerId) : null;
  if (!entry && !product) return { error: t(lang, 'simNotFound') };

  const isVault = !!entry;
  const hasTracking = isVault ? !!entry.seller?.tracking : !!seller?.hasTracking;
  const hasReturns = isVault ? !!entry.seller?.returnPolicy : !!seller?.hasReturnPolicy;
  const disputeRate = isVault
    ? (seller ? seller.disputeRate : null)
    : (seller ? seller.disputeRate : null);
  const riskScore = isVault ? entry.riskScore?.score : (seller && product ? calculateRiskScore(seller, product).score : null);
  const refunded = isVault && entry.paypal?.refund?.status === 'COMPLETED';
  const purchaseISO = isVault ? (entry.paypal?.createTime || entry.createdAt) : new Date().toISOString();
  const daysSince = Math.max(0, Math.floor((Date.now() - new Date(purchaseISO).getTime()) / 86400000));
  const filingDaysLeft = 180 - daysSince;
  const tooLate = filingDaysLeft < 0;

  const components = [];
  let chance = 50;
  if (isVault) {
    chance += 15;
    components.push({ points: 15, note: t(lang, 'simCaptureOk') });
  } else {
    chance += 10;
    components.push({ points: 10, note: t(lang, 'simCapturePlanned') });
  }
  if (hasTracking) {
    chance += 10;
    components.push({ points: 10, note: t(lang, 'simTrackingYes') });
  } else {
    components.push({ points: 0, note: t(lang, 'simTrackingNo') });
  }
  if (hasReturns) {
    chance += 5;
    components.push({ points: 5, note: t(lang, 'simReturnsYes') });
  } else {
    components.push({ points: 0, note: t(lang, 'simReturnsNo') });
  }
  if (disputeRate !== null && disputeRate !== undefined) {
    if (disputeRate >= 2) {
      chance += 10;
      components.push({ points: 10, note: fmt(t(lang, 'simDisputeRateHigh'), { rate: disputeRate }) });
    } else {
      chance += 5;
      components.push({ points: 5, note: fmt(t(lang, 'simDisputeRateLow'), { rate: disputeRate }) });
    }
  }
  if (tooLate) {
    chance -= 40;
    components.push({ points: -40, note: t(lang, 'simExpiredWindow') });
  } else {
    chance += 10;
    components.push({ points: 10, note: fmt(t(lang, 'simWithinWindow'), { days: filingDaysLeft }) });
  }
  if (type === 'unauthorized') {
    chance += 10;
    components.push({ points: 10, note: t(lang, 'simTypeUnauthorized') });
  } else if (type === 'not_received') {
    chance += 5;
    components.push({ points: 5, note: t(lang, 'simTypeNotReceived') });
  } else {
    components.push({ points: 0, note: t(lang, 'simTypeNotDescribed') });
  }
  if (refunded) {
    chance -= 45;
    components.push({ points: -45, note: t(lang, 'simAlreadyRefunded') });
  }
  chance = Math.max(5, Math.min(95, chance));
  const label = chance >= 70 ? t(lang, 'simStrong') : chance >= 40 ? t(lang, 'simModerate') : t(lang, 'simWeak');

  // Dispute payload in the shape of the official PayPal Disputes API
  // (GET /v1/customer/disputes/{dispute_id}). This is a SIMULATION: no
  // dispute is actually opened with PayPal; the payload shows what the
  // real ticket would look like so the demo reads as a real dispute.
  const reasonMap = {
    not_received: 'MERCHANDISE_OR_SERVICE_NOT_RECEIVED',
    not_as_described: 'MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED',
    unauthorized: 'UNAUTHORIZED_TRANSACTION',
  };
  const disputeAmount = isVault
    ? Number((entry.totalCost && entry.totalCost.total) || 0)
    : (product ? calculateTotalCost(product.priceUSD, true, true, lang).total : 0);
  const captureId = isVault ? (entry.paypal?.captureId || entry.paypal?.orderId || null) : null;
  const disputePayload = {
    dispute_id: 'PP-D-' + (isVault ? String(entry.id).replace(/[^A-Za-z0-9]/g, '').slice(-6).toUpperCase() : (product ? product.id.toUpperCase() : 'DEMO')) + '-' + Date.now().toString(36).toUpperCase(),
    create_time: new Date().toISOString(),
    update_time: new Date().toISOString(),
    reason: reasonMap[type],
    status: 'OPEN',
    dispute_amount: { currency_code: 'USD', value: disputeAmount.toFixed(2) },
    dispute_life_cycle_stage: 'INQUIRY',
    disputed_transactions: [
      {
        buyer_transaction_id: captureId,
        seller_transaction_id: captureId,
        create_time: purchaseISO,
        transaction_status: isVault ? 'COMPLETED' : 'NOT_COMPLETED',
        gross_amount: { currency_code: 'USD', value: disputeAmount.toFixed(2) },
        invoice_number: isVault ? (entry.paypal?.orderId || null) : null,
      },
    ],
    seller: isVault ? { name: entry.seller?.name || null } : (seller ? { name: seller.name } : null),
    messages: [],
    outcome: null,
  };

  const missingProof = [];
  if (!hasTracking) missingProof.push(t(lang, 'simMissingTracking'));
  if (type === 'not_as_described') missingProof.push(t(lang, 'simMissingPhotos'));
  if (!hasReturns) missingProof.push(t(lang, 'simMissingPolicy'));
  if (isVault) missingProof.push(t(lang, 'simMissingChat'));
  if (type === 'unauthorized') missingProof.push(t(lang, 'simMissingReport'));

  const recommendation = tooLate
    ? t(lang, 'simRecTooLate')
    : refunded
      ? t(lang, 'simAlreadyRefunded')
      : chance >= 70
        ? t(lang, 'simRecStrong')
        : chance >= 40
          ? t(lang, 'simRecModerate')
          : t(lang, 'simRecWeak');

  // AI explanation (Vyce), rewrites the component notes only.
  let aiExplanation = null;
  let aiAvailable = false;
  const apiKey = process.env.VYCE_API_KEY;
  if (apiKey) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 30000);
      const baseUrl = (process.env.VYCE_API_BASE || 'https://vyceai.com/v1').replace(/\/$/, '');
      const model = process.env.VYCE_MODEL || 'deepseek-v4.1';
      const res = await fetch(baseUrl + '/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiKey },
        body: JSON.stringify({
          model,
          messages: [
            {
              role: 'system',
              content:
                'You explain a PayPal dispute win-chance estimate to a shopper in 2 short sentences. ' +
                'Keep the meaning, do not change any numbers, do not add new facts, do not invent scores. ' +
                (lang === 'id' ? 'Reply in Indonesian.' : 'Reply in English.'),
            },
            {
              role: 'user',
              content: `Win chance ${chance}% (${label}). ` + components.map((c) => c.note).join(' '),
            },
          ],
          temperature: 0.2,
          max_tokens: 150,
        }),
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (res.ok) {
        const data = await res.json();
        const text = (data?.choices?.[0]?.message?.content || '').trim();
        if (text) {
          aiExplanation = text;
          aiAvailable = true;
        }
      }
    } catch (err) { /* AI is optional; the rule-based result stands */ }
  }

  return {
    simulated: true,
    prePurchase: !isVault,
    vaultId: entry ? entry.id : null,
    product: isVault ? entry.product?.name : product?.name,
    disputeType: type,
    winChance: chance,
    label,
    components,
    missingProof,
    recommendation,
    filingDaysLeft,
    riskScore,
    disputePayload,
    aiExplanation,
    aiAvailable,
    aiNote: aiAvailable ? t(lang, 'aiNoteVyce') : t(lang, 'aiNoteFallback'),
    note: !isVault ? t(lang, 'simPrePurchase') : null,
  };
}

// Evidence Pack (one-click proof download)
// A standalone printable HTML page: order, verified capture, risk score,
// timeline, dispute draft. Returned as JSON { html } so the Worker (which
// only returns JSON) can serve it; the client opens it via a blob URL.
function evidenceHtml(entry, lang) {
  lang = lang === 'id' ? 'id' : 'en';
  const esc = (s) =>
    String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const row = (k, v) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`;
  const refund = entry.paypal?.refund;
  const timeline = [
    ['Purchase / capture', entry.paypal?.createTime || entry.createdAt],
    ['Capture verified', entry.paypal?.updateTime || ''],
    refund ? ['Refund ' + (refund.status || ''), refund.createTime || ''] : null,
  ].filter(Boolean);
  return '<!DOCTYPE html><html lang="' + lang + '"><head><meta charset="utf-8">' +
    '<title>' + esc(t(lang, 'evTitle')) + ', ' + esc(entry.id) + '</title>' +
    '<style>body{font-family:system-ui,sans-serif;max-width:720px;margin:32px auto;padding:0 20px;color:#1a2233}' +
    'h1{font-size:22px}h2{font-size:16px;margin-top:28px;border-bottom:2px solid #111111;padding-bottom:4px}' +
    'table{border-collapse:collapse;width:100%}th,td{text-align:left;padding:8px 10px;border-bottom:1px solid #e5e7eb;vertical-align:top}' +
    'th{width:200px;color:#475569}.note{font-size:13px;color:#64748b;margin-top:28px}' +
    'button{background:#111111;color:#fff;border:0;padding:10px 18px;border-radius:8px;font-size:15px;cursor:pointer}' +
    '@media print{button{display:none}}</style></head><body>' +
    '<h1>' + esc(t(lang, 'evTitle')) + '</h1>' +
    '<p>ShopPal v2 · ' + esc(entry.id) + ' · ' + esc(entry.createdAt || '') + '</p>' +
    '<button onclick="window.print()">Print / Save as PDF</button>' +
    '<h2>' + esc(t(lang, 'evOrder')) + ' / ' + esc(t(lang, 'evCapture')) + '</h2><table>' +
    row('Order ID', entry.paypal?.orderId || entry.id) +
    row('Capture ID', entry.paypal?.captureId || '') +
    row('Capture status', entry.paypal?.status || '') +
    row('Payer', entry.paypal?.payerEmail || '') +
    row(t(lang, 'evTotal'), '$' + (entry.totalCost?.total ?? entry.product?.priceUSD ?? '') + ' ' + (entry.totalCost?.currency || 'USD')) +
    (refund ? row(t(lang, 'evRefund'), refund.id + ', ' + (refund.status || '') + ', $' + refund.amount) : '') +
    '</table>' +
    '<h2>' + esc(t(lang, 'evProduct')) + ' / ' + esc(t(lang, 'evSeller')) + '</h2><table>' +
    row('Product', entry.product?.name || '') +
    row('Category', entry.product?.category || '') +
    row('Price', '$' + (entry.product?.priceUSD ?? '')) +
    row('Seller', entry.seller?.name || '') +
    row(t(lang, 'evRisk'), entry.riskScore ? entry.riskScore.score + ' / 100 (' + entry.riskScore.label + ')' : '') +
    (entry.marketplace ? row('Marketplace', entry.marketplace.name + ', ' + (entry.marketplace.itemUrl || '')) : '') +
    '</table>' +
    '<h2>' + esc(t(lang, 'evTimeline')) + '</h2><table>' +
    timeline.map(([k, v]) => row(k, v)).join('') +
    '</table>' +
    '<p class="note">' + esc(t(lang, 'evNote')) + '</p>' +
    '</body></html>';
}

// Check a Link (paste any product URL)
// Reads the page's public metadata (title, price, image) the way a chat
// app builds a link preview, no marketplace scraping, no login, no
// checkout. Verdict uses the domain + price vs the demo catalog median.
const KNOWN_MARKETPLACES = [
  'ebay.com', 'ebay.co.uk', 'amazon.com', 'amazon.co.uk', 'amazon.de',
  'shopee.co.id', 'shopee.com', 'tokopedia.com', 'lazada.co.id', 'lazada.com',
  'ali' + 'ex' + 'press.com', 'etsy.com', 'walmart.com', 'target.com', 'bestbuy.com',
];
const LINK_CATEGORIES = [
  { key: 'headphones', words: ['headphone', 'earphone', 'earbud', 'headset'] },
  { key: 'smartwatch', words: ['smartwatch', 'watch'] },
  { key: 'keyboard', words: ['keyboard'] },
  { key: 'speaker', words: ['speaker'] },
  { key: 'charger', words: ['charger', 'charging'] },
];

function isBlockedHost(host) {
  const h = String(host || '').toLowerCase();
  if (!h || h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal')) return true;
  if (/^(127\.|10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.)/.test(h)) return true;
  if (h === '::1' || h === '[::1]') return true;
  return false;
}

function extractMeta(html) {
  const pick = (re) => {
    const m = html.match(re);
    return m ? m[1].trim() : null;
  };
  const title =
    pick(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i) ||
    pick(/<title[^>]*>([^<]+)<\/title>/i);
  const image = pick(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i);
  let price = pick(/<meta[^>]+(?:property|name)=["'](?:product:price:amount|og:price:amount)["'][^>]+content=["']([\d.,]+)["']/i);
  if (!price) {
    const ld = html.match(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/i);
    if (ld) {
      try {
        const data = JSON.parse(ld[1]);
        const items = Array.isArray(data) ? data : [data];
        for (const item of items) {
          const offers = item?.offers;
          const offer = Array.isArray(offers) ? offers[0] : offers;
          if (offer?.price) {
            price = String(offer.price);
            break;
          }
        }
      } catch (e) { /* malformed JSON-LD is ignored */ }
    }
  }
  return { title, image, priceUSD: price ? Number(String(price).replace(/,/g, '')) : null };
}

async function checkLink(url, lang) {
  lang = lang === 'id' ? 'id' : 'en';
  let parsed;
  try {
    parsed = new URL(url);
  } catch (e) {
    return { error: t(lang, 'clNotUrl') };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { error: t(lang, 'clNotUrl') };
  }
  if (isBlockedHost(parsed.hostname)) {
    return { error: t(lang, 'clNotUrl') };
  }
  const domain = parsed.hostname.replace(/^www\./, '');
  const knownMarketplace = KNOWN_MARKETPLACES.some((d) => domain === d || domain.endsWith('.' + d));
  let html = '';
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(url, {
      headers: { 'User-Agent': 'ShopPal-LinkPreview/1.0 (+https://fhria5.github.io/shoppal-v2/)', Accept: 'text/html' },
      signal: controller.signal,
      redirect: 'follow',
    });
    clearTimeout(timer);
    if (!res.ok) return { error: t(lang, 'clFetchFailed'), domain, knownMarketplace };
    const buf = await res.arrayBuffer();
    html = new TextDecoder('utf-8').decode(buf.slice(0, 500000));
  } catch (err) {
    return { error: t(lang, 'clFetchFailed'), domain, knownMarketplace };
  }
  const meta = extractMeta(html);
  const text = ((meta.title || '') + ' ' + html.slice(0, 20000)).toLowerCase();
  let category = null;
  for (const c of LINK_CATEGORIES) {
    if (c.words.some((w) => text.includes(w))) {
      category = c.key;
      break;
    }
  }
  // Price vs the demo catalog median for the detected category.
  let median = null;
  if (category) {
    const prices = catalog.products
      .filter((p) => p.category.toLowerCase() === category)
      .map((p) => p.priceUSD)
      .sort((a, b) => a - b);
    if (prices.length) median = prices[Math.floor(prices.length / 2)];
  }
  const reasons = [];
  let score = 50;
  if (knownMarketplace) {
    score += 20;
    reasons.push(t(lang, 'clKnownMarketplace'));
  } else {
    score -= 10;
    reasons.push(t(lang, 'clUnknownDomain'));
  }
  let totalCost = null;
  if (meta.priceUSD && median) {
    if (meta.priceUSD < median * 0.5) {
      score -= 25;
      reasons.push(t(lang, 'clPriceLow'));
    } else {
      score += 10;
      reasons.push(t(lang, 'clPriceFair'));
    }
    totalCost = calculateTotalCost(meta.priceUSD, false, false, lang);
  } else if (meta.priceUSD) {
    totalCost = calculateTotalCost(meta.priceUSD, false, false, lang);
  } else {
    reasons.push(t(lang, 'clNoPrice'));
  }
  score = Math.max(0, Math.min(100, score));
  const label = score >= 80 ? 'Safe' : score >= 50 ? 'Caution' : 'Risky';
  return {
    url,
    domain,
    knownMarketplace,
    title: meta.title || null,
    image: meta.image || null,
    priceUSD: meta.priceUSD || null,
    category,
    medianUSD: median,
    score,
    label,
    reasons,
    totalCost,
    note: t(lang, 'clNote'),
  };
}

// Import Cost (per destination country)
// Duty + VAT/GST for a cross-border purchase. Rates are the public
// e-commerce parcel rules (Indonesia verified against PMK 96/2023 +
// PMK 4/2025; others are the standard published rates). Duty is waived
// under the de minimis threshold; VAT/GST applies from $0 in most
// countries. Always an estimate, exact duty depends on the HS code.
const IMPORT_RULES = {
  ID: { name: 'Indonesia', currency: 'USD', deMinimis: 3, dutyRate: 0.075, vatRate: 0.11, vatLabel: 'PPN', specialNote: 'impIDNote' },
  US: { name: 'United States', currency: 'USD', deMinimis: 800, dutyRate: 0.02, vatRate: 0, vatLabel: 'VAT', specialNote: null },
  EU: { name: 'European Union (Germany)', currency: 'EUR', deMinimis: 150, dutyRate: 0, vatRate: 0.19, vatLabel: 'VAT', specialNote: null },
  UK: { name: 'United Kingdom', currency: 'GBP', deMinimis: 135, dutyRate: 0, vatRate: 0.20, vatLabel: 'VAT', specialNote: null },
  SG: { name: 'Singapore', currency: 'SGD', deMinimis: 400, dutyRate: 0, vatRate: 0.09, vatLabel: 'GST', specialNote: null },
};

function calculateImportCost(priceUSD, countryCode, lang) {
  lang = lang === 'id' ? 'id' : 'en';
  const rule = IMPORT_RULES[countryCode];
  if (!rule) return { error: t(lang, 'impNotFound') };
  const price = Number(priceUSD);
  if (!price || price <= 0) return { error: t(lang, 'impNotFound') };
  const dutyFree = price <= rule.deMinimis;
  const duty = dutyFree ? 0 : Math.round(price * rule.dutyRate * 100) / 100;
  const vat = Math.round((price + duty) * rule.vatRate * 100) / 100;
  const total = Math.round((duty + vat) * 100) / 100;
  const notes = [t(lang, 'impNote')];
  if (rule.specialNote) notes.push(t(lang, rule.specialNote));
  if (dutyFree && rule.dutyRate > 0) notes.push(fmt(t(lang, 'impFree'), { country: rule.name, min: rule.currency + ' ' + rule.deMinimis }));
  return {
    country: countryCode,
    countryName: rule.name,
    currency: rule.currency,
    priceUSD: price,
    duty,
    dutyRate: Math.round(rule.dutyRate * 1000) / 10,
    vat,
    vatRate: Math.round(rule.vatRate * 1000) / 10,
    vatLabel: rule.vatLabel,
    total,
    deMinimis: rule.deMinimis,
    deMinimisApplies: dutyFree,
    notes,
  };
}

// PayPal Phishing Check
// Rule-based signals + an AI review (Vyce). Scores 0-100 (higher =
// safer). PayPal's real domains are whitelisted; everything else that
// claims to be PayPal is flagged.
const PAYPAL_DOMAINS = ['paypal.com', 'paypal.me', 'paypalobjects.com', 'paypal-communication.com'];
const PHISH_URGENCY = [
  'urgent', 'immediately', 'account will be closed', 'account suspended', 'verify now',
  'verify your account', 'limited time', 'act now', 'final notice', 'security alert',
  'segera', 'akun akan ditutup', 'akun ditangguhkan', 'verifikasi sekarang', 'segera verifikasi',
  'waktu terbatas', 'peringatan keamanan', 'pemberitahuan terakhir',
];
const PHISH_GENERIC = ['dear customer', 'dear user', 'dear member', 'pelanggan yang terhormat', 'pengguna yang terhormat'];

function extractUrls(text) {
  const urls = [];
  const re = /https?:\/\/[^\s<>"')\]]+/gi;
  let m;
  while ((m = re.exec(text)) !== null) urls.push(m[0]);
  const bare = text.match(/\b[\w-]+(?:\.[\w-]+)+(?:\/[^\s<>"')\]]*)?/g) || [];
  for (const b of bare) {
    if (/paypal/i.test(b) && !/^https?:\/\//i.test(b)) urls.push('https://' + b);
  }
  return urls;
}

// A lookalike domain swaps letters for lookalike characters (paypa1,
// paypaI, pay-pal). Normalise those swaps, then check for "paypal".
function looksLikePaypal(host) {
  const norm = String(host || '').toLowerCase()
    .replace(/1/g, 'l').replace(/0/g, 'o').replace(/\|/g, 'l')
    .replace(/[^a-z]/g, '');
  return norm.includes('paypal');
}

async function checkPhishing(text, lang) {
  lang = lang === 'id' ? 'id' : 'en';
  const input = String(text || '').trim();
  if (!input) return { error: t(lang, 'phEmpty') };
  const signals = [];
  let score = 100;
  const urls = extractUrls(input);
  const lower = input.toLowerCase();
  if (!urls.length) {
    signals.push({ points: 0, note: t(lang, 'phNoLink') });
  } else {
    let badDomain = null;
    let goodDomain = false;
    for (const u of urls) {
      let host = '';
      try { host = new URL(u).hostname.toLowerCase().replace(/^www\./, ''); } catch (e) { continue; }
      const isPaypal = PAYPAL_DOMAINS.some((d) => host === d || host.endsWith('.' + d));
      if (isPaypal) goodDomain = true;
      else if (looksLikePaypal(host)) badDomain = host;
    }
    if (badDomain) {
      score -= 50;
      signals.push({ points: -50, note: fmt(t(lang, 'phDomainBad'), { domain: badDomain }) });
    } else if (goodDomain) {
      signals.push({ points: 0, note: t(lang, 'phDomainOk') });
    } else {
      score -= 15;
      signals.push({ points: -15, note: t(lang, 'phNoPaypalLink') });
    }
  }
  for (const word of PHISH_URGENCY) {
    if (lower.includes(word)) {
      score -= 20;
      signals.push({ points: -20, note: fmt(t(lang, 'phUrgency'), { word }) });
      break;
    }
  }
  if (/password|otp|one-time|kode otp|nomor kartu|card number|cvv|pin/i.test(input) &&
      /verif|confirm|masukkan|enter|send|kirim/i.test(input)) {
    score -= 30;
    signals.push({ points: -30, note: t(lang, 'phAsksSecret') });
  }
  for (const word of PHISH_GENERIC) {
    if (lower.includes(word)) {
      score -= 10;
      signals.push({ points: -10, note: fmt(t(lang, 'phGeneric'), { word }) });
      break;
    }
  }
  if (/paypal/i.test(input) && urls.length) {
    const hasRealPaypalLink = urls.some((u) => {
      try {
        const host = new URL(u).hostname.toLowerCase().replace(/^www\./, '');
        return PAYPAL_DOMAINS.some((d) => host === d || host.endsWith('.' + d));
      } catch (e) { return false; }
    });
    if (!hasRealPaypalLink && urls.some((u) => looksLikePaypal(new URL(u).hostname))) {
      score -= 20;
      signals.push({ points: -20, note: t(lang, 'phMismatch') });
    }
  }
  score = Math.max(0, Math.min(100, score));
  const label = score >= 80 ? t(lang, 'phLegit') : score >= 50 ? t(lang, 'phSuspicious') : t(lang, 'phLikely');

  // AI review (Vyce), a second opinion in plain language.
  let aiReview = null;
  let aiAvailable = false;
  const apiKey = process.env.VYCE_API_KEY;
  if (apiKey) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 45000);
      const baseUrl = (process.env.VYCE_API_BASE || 'https://vyceai.com/v1').replace(/\/$/, '');
      const model = process.env.VYCE_MODEL || 'deepseek-v4.1';
      const res = await fetch(baseUrl + '/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiKey },
        body: JSON.stringify({
          model,
          messages: [
            {
              role: 'system',
              content:
                'You are a phishing analyst. Read the message and say in 2 short sentences whether it looks like a PayPal phishing attempt and why. ' +
                'Do not invent facts. Do not ask the user for anything. ' +
                (lang === 'id' ? 'Reply in Indonesian.' : 'Reply in English.'),
            },
            { role: 'user', content: input.slice(0, 2000) },
          ],
          temperature: 0.2,
          max_tokens: 150,
        }),
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (res.ok) {
        const data = await res.json();
        const textOut = (data?.choices?.[0]?.message?.content || '').trim();
        if (textOut) {
          aiReview = textOut;
          aiAvailable = true;
        }
      }
    } catch (err) { /* AI is optional; the rule-based verdict stands */ }
  }

  return {
    score,
    label,
    signals,
    aiReview,
    aiAvailable,
    aiNote: aiAvailable ? t(lang, 'aiNoteVyce') : t(lang, 'aiNoteFallback'),
    note: t(lang, 'phNote'),
  };
}

// Hold Release Checklist
// PayPal's published hold rules: a new or risky seller's money is held
// for up to 21 days. The hold is released 3 days after the carrier
// confirms delivery (tracking added), 7 days after the ship date
// (marked Shipped, no tracking), 1 day after the buyer confirms
// receipt, or after 21 days if nothing is done. Steps are pre-ticked
// from the seller's own data where it is known (tracking, dispute
// rate); the rest are manual, the buyer or seller ticks them off.
function buildHoldChecklist(seller, product, lang) {
  lang = lang === 'id' ? 'id' : 'en';
  if (!seller || !product) return { error: t(lang, 'hrcNotFound') };
  const hold = calculateHoldRisk(seller, product);
  const currentDays = hold.label === 'Low' ? 0 : hold.label === 'Moderate' ? 7 : 21;
  const steps = [
    {
      id: 'tracking',
      title: t(lang, 'hrcStepTracking'),
      detail: t(lang, 'hrcStepTrackingDetail'),
      done: Boolean(seller.hasTracking),
      savesDays: 18,
    },
    {
      id: 'shipped',
      title: t(lang, 'hrcStepShipped'),
      detail: t(lang, 'hrcStepShippedDetail'),
      done: false,
      savesDays: 14,
    },
    {
      id: 'buyer',
      title: t(lang, 'hrcStepBuyer'),
      detail: t(lang, 'hrcStepBuyerDetail'),
      done: false,
      savesDays: 20,
    },
    {
      id: 'proof',
      title: t(lang, 'hrcStepProof'),
      detail: t(lang, 'hrcStepProofDetail'),
      done: false,
      savesDays: 0,
    },
    {
      id: 'shipFast',
      title: t(lang, 'hrcStepShipFast'),
      detail: t(lang, 'hrcStepShipFastDetail'),
      done: false,
      savesDays: 0,
    },
    {
      id: 'disputes',
      title: t(lang, 'hrcStepDisputes'),
      detail: t(lang, 'hrcStepDisputesDetail'),
      done: Number(seller.disputeRate || 0) < 1,
      savesDays: 0,
    },
  ];
  return {
    sellerId: seller.id,
    productId: product.id,
    holdLabel: hold.label,
    holdChance: hold.chance,
    currentDays,
    estimatedDays: estimatedHoldDays(steps),
    steps,
    note: t(lang, 'hrcNote'),
  };
}

// The fastest release path wins: buyer confirmation (1d) beats tracking
// (3d after delivery), which beats marking Shipped (7d); otherwise 21d.
function estimatedHoldDays(steps) {
  const byId = {};
  for (const s of steps) byId[s.id] = s.done;
  if (byId.buyer) return 1;
  if (byId.tracking) return 3;
  if (byId.shipped) return 7;
  return 21;
}

app.post('/api/paypal/token', async (req, res) => {
  // The token value itself is never returned to the browser.
  try {
    await getPayPalAccessToken();
    res.json({ ok: true, configured: true, mode: PAYPAL_MODE });
  } catch (err) {
    res.status(err.status || 502).json({ ok: false, error: err.message });
  }
});

// Shared PayPal order creation for the checkout route AND the Pay Agent.
// The route and the agent both call this; the amount must match the total
// the user saw, and the buyer still approves on PayPal's site (approveUrl).
// Returns the same shape the create-order route returns.
// Split Payment Link: create a PayPal Sandbox order for one person's share
// of a split bill. Unlike createPayPalOrder, the amount is a portion of a
// total (not a product price), so there is no total-validation against the
// catalog. This is the replacement for the Invoicing API, which returns
// 403 NOT_AUTHORIZED for this sandbox app: each friend gets their own
// order + approveUrl to pay their share.
async function createSplitPaymentOrder(amountUSD, itemName, baseUrl) {
  const amount = Number(amountUSD);
  if (!Number.isFinite(amount) || amount <= 0) {
    const err = new Error('Split share must be a positive number.');
    err.status = 400;
    throw err;
  }
  const order = await paypalFetch('/v2/checkout/orders', 'POST', {
    intent: 'CAPTURE',
    purchase_units: [
      {
        reference_id: 'split-' + Date.now().toString(36),
        description: 'Split payment for ' + itemName + ' (ShopPal v2, PayPal Sandbox)',
        amount: {
          currency_code: 'USD',
          value: amount.toFixed(2),
        },
      },
    ],
    application_context: {
      brand_name: 'ShopPal v2',
      landing_page: 'LOGIN',
      user_action: 'PAY_NOW',
      return_url: `${baseUrl}/?approved=1`,
      cancel_url: `${baseUrl}/?cancelled=1`,
    },
  });
  const approveUrl =
    (order.links || []).find((l) => l.rel === 'approve')?.href || null;
  return {
    orderId: order.id,
    status: order.status,
    approveUrl,
    amountUSD: amount,
  };
}

async function createPayPalOrder(product, totalUSD, baseUrl, marketplaceDetails, international, currencyConversion) {
  // The order amount has to match the total the user approved in step 3.
  const expected = calculateTotalCost(
    product.priceUSD,
    international !== false,
    currencyConversion !== false
  );
  const approved = Number(totalUSD);
  if (!Number.isFinite(approved) || Math.abs(approved - expected.total) > 0.01) {
    const err = new Error(`Total mismatch: approved $${approved} does not match the calculated total $${expected.total}.`);
    err.status = 400;
    throw err;
  }
  const order = await paypalFetch('/v2/checkout/orders', 'POST', {
    intent: 'CAPTURE',
    purchase_units: [
      {
        reference_id: product.id,
        description: marketplaceDetails
          ? `${product.name}, ShopPal v2 marketplace simulation (PayPal Sandbox, does not buy the eBay item)`
          : `${product.name}, ShopPal v2 demo (PayPal Sandbox)`,
        amount: {
          currency_code: 'USD',
          value: expected.total.toFixed(2),
          breakdown: {
            item_total: { currency_code: 'USD', value: product.priceUSD.toFixed(2) },
            handling: {
              currency_code: 'USD',
              value: (expected.paypalFee + expected.internationalFee + expected.conversionSpread).toFixed(2),
            },
          },
        },
        items: [
          {
            name: product.name,
            unit_amount: { currency_code: 'USD', value: product.priceUSD.toFixed(2) },
            quantity: '1',
            category: 'PHYSICAL_GOODS',
          },
        ],
      },
    ],
    application_context: {
      brand_name: 'ShopPal v2',
      landing_page: 'LOGIN',
      user_action: 'PAY_NOW',
      // PayPal returns here after approval (localhost, or the deploy URL).
      return_url: `${baseUrl}/?approved=1`,
      cancel_url: `${baseUrl}/?cancelled=1`,
    },
  });
  const approveUrl =
    (order.links || []).find((l) => l.rel === 'approve')?.href || null;
  if (marketplaceDetails) marketplaceOrders.set(order.id, marketplaceDetails);
  return {
    orderId: order.id,
    status: order.status,
    approveUrl,
    totalUSD: expected.total,
    productId: product.id,
    marketplace: marketplaceDetails ? marketplaceDetails.marketplace : null,
  };
}

app.post('/api/paypal/create-order', async (req, res) => {
  try {
    const { productId, totalUSD, international, currencyConversion } = req.body || {};
    // Marketplace checkout (e.g. a real eBay listing): the item comes from
    // the search result, not the demo catalog. The PayPal order below is a
    // SANDBOX SIMULATION of paying that listing's total, it does not buy
    // the item on the marketplace. The buyer is told this in the UI.
    const mp = (req.body || {}).marketplace || null;
    let product;
    let marketplaceDetails = null;
    if (mp) {
      if (mp.marketplace !== 'eBay') {
        return res.status(400).json({ error: 'Unknown marketplace: ' + mp.marketplace });
      }
      const price = Number(mp.priceUSD);
      if (!mp.title || !mp.itemId || !Number.isFinite(price) || price <= 0 || price > 10000) {
        return res.status(400).json({ error: 'Invalid marketplace item.' });
      }
      product = {
        id: 'ebay:' + String(mp.itemId).slice(0, 60),
        name: String(mp.title).slice(0, 120),
        priceUSD: Math.round(price * 100) / 100,
        category: 'Marketplace · eBay',
      };
      marketplaceDetails = {
        marketplace: 'eBay',
        itemId: String(mp.itemId),
        title: product.name,
        priceUSD: product.priceUSD,
        itemUrl: mp.itemUrl || null,
        image: mp.image || null,
        sellerName: mp.sellerName || 'Unknown seller',
        riskScore: mp.riskScore && Number.isFinite(mp.riskScore.score)
          ? { score: mp.riskScore.score, label: mp.riskScore.label }
          : null,
      };
    } else {
      product = productsById.get(productId);
      if (!product) return res.status(400).json({ error: 'Unknown productId.' });
    }
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const result = await createPayPalOrder(product, totalUSD, baseUrl, marketplaceDetails, international, currencyConversion);
    res.status(201).json(result);
  } catch (err) {
    res.status(err.status || 502).json({ error: err.message, paypalName: err.paypalName || null });
  }
});

app.post('/api/paypal/capture-order', async (req, res) => {
  try {
    const { orderId } = req.body || {};
    if (!orderId) return res.status(400).json({ error: 'orderId is required.' });
    let captured = null;
    let alreadyCaptured = false;
    try {
      captured = await paypalFetch(`/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, 'POST', {});
    } catch (err) {
      // A reload or double approval after the first capture returns
      // ORDER_ALREADY_CAPTURED. Recover the existing capture instead of
      // losing the proof, the verification below reads it back.
      if (err.paypalName === 'ORDER_ALREADY_CAPTURED' || err.paypalIssue === 'ORDER_ALREADY_CAPTURED' || /already captured/i.test(err.message || '')) {
        alreadyCaptured = true;
      } else {
        throw err;
      }
    }
    // Verify with the Orders API, then the Payments API, before trusting
    // the result. Only a COMPLETED capture is saved as proof.
    const verifiedOrder = await paypalFetch(
      `/v2/checkout/orders/${encodeURIComponent(orderId)}`,
      'GET'
    );
    const unit = (verifiedOrder.purchase_units || [])[0] || {};
    const capture = ((unit.payments || {}).captures || [])[0] || null;
    if (!capture || !capture.id) {
      return res.status(502).json({
        error: 'Capture was not found on the verified order.',
        orderStatus: verifiedOrder.status || null,
      });
    }
    const verifiedCapture = await paypalFetch(
      `/v2/payments/captures/${encodeURIComponent(capture.id)}`,
      'GET'
    );
    if (verifiedCapture.status !== 'COMPLETED') {
      return res.status(502).json({
        error: `Capture is not COMPLETED (verified status: ${verifiedCapture.status}). Nothing was saved to the Proof Vault.`,
        orderId,
        captureId: capture.id,
        status: verifiedCapture.status,
      });
    }
    const productId = unit.reference_id || null;
    const product = productsById.get(productId) || null;
    const seller = product ? sellersById.get(product.sellerId) : null;
    const risk = product && seller ? calculateRiskScore(seller, product) : null;
    const amount = verifiedCapture.amount || {};
    const mp = marketplaceOrders.get(orderId) || null;
    const entry = {
      id: orderId,
      createdAt: new Date().toISOString(),
      product: mp
        ? { id: productId, name: mp.title, priceUSD: mp.priceUSD, category: 'Marketplace · eBay' }
        : product
          ? { id: product.id, name: product.name, priceUSD: product.priceUSD, category: product.category }
          : { id: productId },
      seller: mp
        ? { name: mp.sellerName }
        : seller
          ? { id: seller.id, name: seller.name, tracking: seller.hasTracking, returnPolicy: seller.hasReturnPolicy }
          : null,
      riskScore: mp
        ? mp.riskScore
        : risk
          ? { score: risk.score, label: risk.label }
          : null,
      marketplace: mp
        ? { name: mp.marketplace, itemId: mp.itemId, itemUrl: mp.itemUrl, image: mp.image }
        : null,
      simulation: mp ? true : false,
      simulationNote: mp
        ? 'Sandbox simulation, this PayPal order did not buy the eBay item. It proves the total and saves the proof.'
        : null,
      totalCost: {
        total: Number(amount.value),
        currency: amount.currency_code || 'USD',
      },
      paypal: {
        orderId,
        captureId: verifiedCapture.id,
        status: verifiedCapture.status,
        payerEmail: captured?.payer?.email_address || verifiedOrder.payer?.email_address || null,
        createTime: verifiedCapture.create_time || null,
        updateTime: verifiedCapture.update_time || null,
      },
    };
    saveVaultEntry(entry);
    res.json({ orderId, captureId: verifiedCapture.id, status: 'COMPLETED', vaultId: entry.id, entry, alreadyCaptured });
  } catch (err) {
    res.status(err.status || 502).json({ error: err.message, paypalName: err.paypalName || null });
  }
});

// Refund a captured payment (Payments API v2). A real PayPal Sandbox
// action, no real money moves. The vault entry is updated so the refund
// becomes part of the proof (checkout -> dispute -> refund lifecycle).
// vaultId is optional: the static demo has no server-side vault, so it
// passes captureId directly and updates its own localStorage copy.
app.post('/api/paypal/refund', async (req, res) => {
  try {
    const { vaultId, captureId, amount, reason } = req.body || {};
    const lang = (req.body || {}).lang === 'id' ? 'id' : 'en';
    const entry = vaultId ? vaultEntries.get(vaultId) : null;
    const cid = captureId || (entry && entry.paypal && entry.paypal.captureId) || null;
    if (!cid) return res.status(404).json({ error: t(lang, 'refundNoCapture') });
    if (entry && entry.paypal && entry.paypal.refund && entry.paypal.refund.status === 'COMPLETED') {
      return res.status(409).json({ error: t(lang, 'refundAlready'), refund: entry.paypal.refund });
    }
    // Full refund by default; a partial amount must not exceed the capture total.
    const total = entry && entry.totalCost ? Number(entry.totalCost.total) : null;
    let value = null;
    if (amount !== undefined && amount !== null && amount !== '') {
      value = Number(amount);
      if (!Number.isFinite(value) || value <= 0) {
        return res.status(400).json({ error: t(lang, 'refundBadAmount') });
      }
      if (Number.isFinite(total) && value > total + 0.001) {
        return res.status(400).json({ error: t(lang, 'refundTooBig') });
      }
    }
    const body = {};
    if (value !== null) {
      body.amount = { value: value.toFixed(2), currency_code: (entry && entry.totalCost && entry.totalCost.currency) || 'USD' };
    }
    if (reason) body.note_to_payer = String(reason).slice(0, 255);
    const refund = await paypalFetch(`/v2/payments/captures/${encodeURIComponent(cid)}/refund`, 'POST', body);
    const refundInfo = {
      id: refund.id || null,
      status: refund.status || null,
      amount: refund.amount ? Number(refund.amount.value) : (value !== null ? value : total),
      currency: (refund.amount && refund.amount.currency_code) || (entry && entry.totalCost && entry.totalCost.currency) || 'USD',
      createTime: refund.create_time || new Date().toISOString(),
      reason: reason ? String(reason).slice(0, 255) : null,
    };
    if (entry) {
      entry.paypal = entry.paypal || {};
      entry.paypal.refund = refundInfo;
      saveVaultEntry(entry);
    }
    res.json({
      refundId: refundInfo.id,
      status: refundInfo.status,
      amount: refundInfo.amount,
      currency: refundInfo.currency,
      vaultId: entry ? entry.id : null,
      entry: entry || null,
    });
  } catch (err) {
    res.status(err.status || 502).json({ error: err.message, paypalName: err.paypalName || null });
  }
});

// Live order status (Orders API v2 + Payments API verification). Lets the
// Proof Vault prove the payment is still COMPLETED at PayPal, not just a
// snapshot saved at checkout time.
app.get('/api/paypal/order', async (req, res) => {
  try {
    const orderId = (req.query || {}).orderId;
    if (!orderId) return res.status(400).json({ error: 'orderId is required.' });
    const order = await paypalFetch(`/v2/checkout/orders/${encodeURIComponent(orderId)}`, 'GET');
    const unit = (order.purchase_units || [])[0] || {};
    const capture = ((unit.payments || {}).captures || [])[0] || null;
    let captureStatus = capture ? capture.status : null;
    let captureAmount = capture && capture.amount ? Number(capture.amount.value) : null;
    let captureCurrency = capture && capture.amount ? capture.amount.currency_code : null;
    if (capture && capture.id) {
      try {
        const vc = await paypalFetch(`/v2/payments/captures/${encodeURIComponent(capture.id)}`, 'GET');
        captureStatus = vc.status || captureStatus;
        if (vc.amount) {
          captureAmount = Number(vc.amount.value);
          captureCurrency = vc.amount.currency_code;
        }
      } catch (e) { /* keep the Orders API view if the Payments check fails */ }
    }
    res.json({
      orderId: order.id,
      productId: unit.reference_id || null,
      category: (productsById.get(unit.reference_id) || {}).category || null,
      orderStatus: order.status,
      intent: order.intent || null,
      payerEmail: order.payer ? order.payer.email_address : null,
      captureId: capture ? capture.id : null,
      captureStatus,
      amount: captureAmount,
      currency: captureCurrency,
      createTime: order.create_time || null,
      updateTime: order.update_time || null,
      inVault: vaultEntries.has(order.id),
    });
  } catch (err) {
    res.status(err.status || 502).json({ error: err.message, paypalName: err.paypalName || null });
  }
});

// Proof Vault
app.get('/api/vault', (req, res) => {
  const entries = [...vaultEntries.values()].sort((a, b) =>
    (b.createdAt || '').localeCompare(a.createdAt || '')
  );
  res.json({ entries });
});

app.post('/api/dispute/draft', (req, res) => {
  // Simulated draft, built only from a saved Proof Vault entry.
  const { vaultId } = req.body || {};
  const lang = (req.body || {}).lang === 'id' ? 'id' : 'en';
  const entry = vaultId ? vaultEntries.get(vaultId) : null;
  if (!entry) {
    return res.status(404).json({
      error: t(lang, 'disputeNotFound'),
    });
  }
  // The draft date starts the 20-day escalation clock for the tracker.
  if (!entry.disputeDraftAt) {
    entry.disputeDraftAt = new Date().toISOString();
    saveVaultEntry(entry);
  }
  const missing = [];
  if (!entry.paypal || !entry.paypal.captureId) missing.push('capture ID');
  if (!entry.seller || !entry.seller.tracking) missing.push('tracking proof');
  res.json({
    simulated: true,
    vaultId: entry.id,
    readinessScore: missing.length === 0 ? 100 : 70,
    missingProof: missing,
    draft: fmt(t(lang, 'disputeBody'), {
      order: entry.paypal?.orderId || 'unknown',
      product: entry.product?.name || 'the product',
      total: '$' + (entry.totalCost?.total ?? entry.product?.priceUSD ?? 'unknown'),
      status: entry.paypal?.status || 'unknown',
      seller: entry.seller?.name || 'unknown',
      score: entry.riskScore?.score ?? 'unknown',
      id: entry.id,
    }),
  });
});

// Dispute Win Simulator: win-chance estimate for a PayPal dispute, from a
// Proof Vault entry (post-purchase) or a product (pre-purchase).
app.post('/api/dispute/simulate', async (req, res) => {
  const lang = (req.body || {}).lang === 'id' ? 'id' : 'en';
  const result = await simulateDispute(req.body || {}, lang);
  if (result.error) return res.status(404).json({ error: result.error });
  res.json(result);
});

// Smart Guardrails: read/update the rules, and check a purchase.
app.get('/api/guardrails', (req, res) => {
  res.json({ autoApproveLimit: guardrails.autoApproveLimit, categoryCaps: guardrails.categoryCaps });
});
app.post('/api/guardrails', (req, res) => {
  const b = req.body || {};
  const limit = Number(b.autoApproveLimit);
  if (Number.isFinite(limit) && limit >= 0) guardrails.autoApproveLimit = limit;
  if (b.categoryCaps && typeof b.categoryCaps === 'object') {
    const caps = {};
    for (const [k, v] of Object.entries(b.categoryCaps)) {
      const n = Number(v);
      if (Number.isFinite(n) && n > 0) caps[k] = n;
    }
    guardrails.categoryCaps = caps;
  }
  res.json({ autoApproveLimit: guardrails.autoApproveLimit, categoryCaps: guardrails.categoryCaps });
});
app.post('/api/guardrails/check', (req, res) => {
  const lang = (req.body || {}).lang === 'id' ? 'id' : 'en';
  const b = req.body || {};
  const saved = guardrails;
  if (Number.isFinite(Number(b.autoApproveLimit))) guardrails = { autoApproveLimit: Number(b.autoApproveLimit), categoryCaps: (b.categoryCaps && typeof b.categoryCaps === 'object') ? b.categoryCaps : saved.categoryCaps };
  const out = checkGuardrails(b.totalUSD, b.category, lang);
  guardrails = saved;
  res.json(out);
});

// Delivery Watch: PayPal Tracking API + auto dispute draft.
// Add a tracker to a vault entry's capture, read its status, and scan
// for overdue deliveries (7+ days without a DELIVERED update).
app.post('/api/tracking/add', async (req, res) => {
  const lang = (req.body || {}).lang === 'id' ? 'id' : 'en';
  const b = req.body || {};
  const entry = b.vaultId ? vaultEntries.get(b.vaultId) : null;
  if (!entry) return res.status(404).json({ error: t(lang, 'disputeNotFound') });
  const captureId = (entry.paypal && entry.paypal.captureId) || null;
  if (!captureId) return res.status(400).json({ error: 'This entry has no PayPal capture to track.' });
  const trackingNumber = String(b.trackingNumber || ('SHOPPAL-' + entry.id.slice(-6) + '-' + String(Date.now()).slice(-4))).slice(0, 40);
  const carrier = String(b.carrier || 'FEDEX').slice(0, 20);
  try {
    const out = await paypalFetch('/v1/shipping/trackers', 'POST', { trackers: [{ transaction_id: captureId, tracking_number: trackingNumber, status: 'SHIPPED', carrier }] });
    const tid = (out.tracker_identifiers && out.tracker_identifiers[0]) || {};
    entry.tracking = { captureId, trackingNumber, carrier, trackerId: (captureId + '-' + trackingNumber), status: 'SHIPPED', addedAt: new Date().toISOString() };
    saveVaultEntry(entry);
    res.json({ vaultId: entry.id, trackerId: entry.tracking.trackerId, status: 'SHIPPED', carrier, trackingNumber });
  } catch (err) {
    res.status(err.status || 502).json({ error: err.message, paypalName: err.paypalName || null });
  }
});
app.get('/api/tracking/status', async (req, res) => {
  const lang = req.query.lang === 'id' ? 'id' : 'en';
  const entry = req.query.vaultId ? vaultEntries.get(req.query.vaultId) : null;
  if (!entry) return res.status(404).json({ error: t(lang, 'disputeNotFound') });
  if (!entry.tracking || !entry.tracking.trackerId) return res.json({ vaultId: entry.id, hasTracker: false });
  try {
    const tr = await paypalFetch('/v1/shipping/trackers/' + encodeURIComponent(entry.tracking.trackerId), 'GET');
    const status = (tr.tracker && tr.tracker.status) || tr.status || entry.tracking.status || 'UNKNOWN';
    entry.tracking.status = status;
    entry.tracking.lastCheckedAt = new Date().toISOString();
    saveVaultEntry(entry);
    res.json({ vaultId: entry.id, hasTracker: true, trackerId: entry.tracking.trackerId, status, carrier: entry.tracking.carrier, trackingNumber: entry.tracking.trackingNumber });
  } catch (err) {
    res.status(err.status || 502).json({ error: err.message, paypalName: err.paypalName || null });
  }
});
app.get('/api/delivery-watch', async (req, res) => {
  const lang = req.query.lang === 'id' ? 'id' : 'en';
  const now = Date.now();
  const items = [];
  for (const e of vaultEntries.values()) {
    const bought = new Date((e.paypal && e.paypal.createTime) || e.createdAt || Date.now()).getTime();
    const days = Math.max(0, Math.floor((now - bought) / 86400000));
    const status = (e.tracking && e.tracking.status) || 'NO_TRACKER';
    const overdue = status !== 'DELIVERED' && days >= 7;
    const item = { vaultId: e.id, product: (e.product && e.product.name) || e.id, days, status, overdue, hasTracker: !!(e.tracking && e.tracking.trackerId) };
    if (overdue) {
      const sim = await simulateDispute({ vaultId: e.id, disputeType: 'not_received', lang });
      item.autoDraft = sim && !sim.error ? { winChance: sim.winChance, label: sim.label, missingProof: sim.missingProof } : null;
    }
    items.push(item);
  }
  items.sort((a, b) => (b.overdue - a.overdue) || (b.days - a.days));
  res.json({ items });
});

// FX Optimizer: live mid-market rate + PayPal's ~3.5% conversion markup.
// Uses the free exchangerate-api (no key); a stored rate table is the
// fallback when the live rate is unreachable. PayPal's markup is a
// published fact (3-4%), not a live quote, and is labelled as such.
const FX_FALLBACK = { IDR: 16250, EUR: 0.92, GBP: 0.79, SGD: 1.34, USD: 1 };
let fxCache = { at: 0, rates: null };
async function fxRate(currency) {
  const cur = String(currency || 'USD').toUpperCase();
  if (cur === 'USD') return { rate: 1, live: true };
  const now = Date.now();
  if (fxCache.rates && now - fxCache.at < 60000) {
    const r = fxCache.rates[cur];
    if (r) return { rate: r, live: true };
  }
  try {
    const r = await fetch('https://api.exchangerate-api.com/v4/latest/USD', { signal: AbortSignal.timeout(8000) });
    const j = await r.json();
    if (j && j.rates && j.rates[cur]) {
      fxCache = { at: now, rates: j.rates };
      return { rate: j.rates[cur], live: true };
    }
  } catch (e) { /* fall through to the stored rate */ }
  return { rate: FX_FALLBACK[cur] || null, live: false };
}
app.post('/api/fx-compare', async (req, res) => {
  const lang = (req.body || {}).lang === 'id' ? 'id' : 'en';
  const b = req.body || {};
  const amount = Number(b.amountUSD);
  const currency = String(b.currency || 'IDR').toUpperCase();
  if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ error: 'amountUSD must be a positive number.' });
  const r = await fxRate(currency);
  if (!r.rate) return res.status(400).json({ error: 'Unsupported currency: ' + currency });
  const mid = amount * r.rate;
  const markup = 0.035;
  const paypalTotal = mid * (1 + markup);
  res.json({ currency, amountUSD: amount, rate: r.rate, live: r.live, midConverted: Math.round(mid * 100) / 100, paypalTotal: Math.round(paypalTotal * 100) / 100, markupPct: 3.5, cheaper: 'USD', note: t(lang, 'fxNote') });
});
// Expense Dashboard: spending by category, from the Proof Vault.
// (PayPal's Transaction Search API is not enabled for this app, so the
// dashboard reads the vault, which holds every real sandbox capture.)
app.get('/api/expenses', (req, res) => {
  const ym = new Date().toISOString().slice(0, 7);
  const byCategory = {};
  let total = 0;
  let monthTotal = 0;
  let count = 0;
  for (const e of vaultEntries.values()) {
    const t = (e.paypal && e.paypal.createTime) || e.createdAt || '';
    const amt = Number((e.totalCost && e.totalCost.total) || (e.product && e.product.priceUSD) || 0);
    const cat = (e.product && e.product.category) || 'Other';
    total += amt;
    count++;
    if (t.slice(0, 7) === ym) monthTotal += amt;
    if (!byCategory[cat]) byCategory[cat] = { category: cat, total: 0, count: 0 };
    byCategory[cat].total += amt;
    byCategory[cat].count++;
  }
  const rows = Object.values(byCategory).map((r) => ({ category: r.category, total: Math.round(r.total * 100) / 100, count: r.count })).sort((a, b) => b.total - a.total);
  res.json({ total: Math.round(total * 100) / 100, monthTotal: Math.round(monthTotal * 100) / 100, count, byCategory: rows });
});

// Price Watch: a simulated price feed for the demo catalog.
// The catalog has fixed prices, so a sniper needs a feed; this one is a
// labelled simulation (random walk, biased down so a target is reachable
// in a demo). A triggered watch starts the normal checkout flow.
const priceWatches = new Map();
const simPrices = new Map();
function simPrice(productId) {
  const p = productsById.get(productId);
  if (!p) return null;
  if (!simPrices.has(productId)) simPrices.set(productId, p.priceUSD);
  return simPrices.get(productId);
}
function driftPrice(productId) {
  const p = productsById.get(productId);
  if (!p) return null;
  let cur = simPrice(productId);
  const drift = (Math.random() * 0.06 - 0.04);
  cur = Math.max(p.priceUSD * 0.8, Math.min(p.priceUSD * 1.1, cur * (1 + drift)));
  cur = Math.round(cur * 100) / 100;
  simPrices.set(productId, cur);
  return cur;
}
// Shared price-watch logic for the price-watch routes AND the Pay Agent.
function createPriceWatch(product, targetPrice) {
  const id = 'pw-' + Date.now().toString(36) + Math.floor(Math.random() * 1000);
  const w = { id, productId: product.id, productName: product.name, category: product.category, basePrice: product.priceUSD, targetPrice, currentPrice: simPrice(product.id), status: 'watching', createdAt: new Date().toISOString() };
  if (w.currentPrice <= targetPrice) w.status = 'triggered';
  priceWatches.set(id, w);
  return w;
}
function checkPriceWatch(watchId) {
  const w = watchId ? priceWatches.get(watchId) : null;
  if (!w) return null;
  if (w.status !== 'triggered') {
    w.currentPrice = driftPrice(w.productId);
    if (w.currentPrice <= w.targetPrice) w.status = 'triggered';
  }
  return w;
}
app.post('/api/price-watch', (req, res) => {
  const lang = (req.body || {}).lang === 'id' ? 'id' : 'en';
  const b = req.body || {};
  const product = b.productId ? productsById.get(b.productId) : null;
  const target = Number(b.targetPrice);
  if (!product) return res.status(400).json({ error: 'Unknown productId.' });
  if (!Number.isFinite(target) || target <= 0) return res.status(400).json({ error: 'targetPrice must be a positive number.' });
  res.json(createPriceWatch(product, target));
});
app.get('/api/price-watches', (req, res) => {
  res.json({ watches: [...priceWatches.values()].sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '')) });
});
app.post('/api/price-watch/check', (req, res) => {
  const b = req.body || {};
  const w = checkPriceWatch(b.watchId);
  if (!w) return res.status(404).json({ error: 'Unknown watchId.' });
  res.json(w);
});
// Split Bill: work out each share and write the message to send.
// The money itself is collected in the PayPal app (request money): the
// Invoicing API returns 403 and Payouts returns 404 for this sandbox
// app, so no PayPal money-request API is called here. Labelled honestly.
app.post('/api/split-bill', (req, res) => {
  const lang = (req.body || {}).lang === 'id' ? 'id' : 'en';
  const b = req.body || {};
  const product = b.productId ? productsById.get(b.productId) : null;
  const entry = b.vaultId ? vaultEntries.get(b.vaultId) : null;
  const total = Number(b.totalUSD) || (entry ? Number((entry.totalCost && entry.totalCost.total) || 0) : 0) || (product ? Number(product.priceUSD) : 0);
  const name = (entry && entry.product && entry.product.name) || (product && product.name) || 'item';
  const friends = String(b.friends || '').split(/\n/).map((x) => x.trim()).filter(Boolean).slice(0, 10);
  if (!total || total <= 0) return res.status(400).json({ error: 'No amount to split. Pick a product or a vault entry first.' });
  if (!friends.length) return res.status(400).json({ error: t(lang, 'sbNoFriends') });
  const people = friends.length + 1;
  const share = Math.round((total / people) * 100) / 100;
  const lines = friends.map((f) => '- ' + f + ': $' + share.toFixed(2)).join('\n');
  const message = (lang === 'id'
    ? 'Hai, patungan ' + name + ' ya, total $' + total.toFixed(2) + ', bagian tiap orang $' + share.toFixed(2) + ' (termasuk aku).\n' + lines + '\nBayar via PayPal ya, aku request money dari aplikasi.'
    : 'Hi, splitting ' + name + ' (' + '$' + total.toFixed(2) + ' total), each share is $' + share.toFixed(2) + ' (including me).\n' + lines + '\nPlease pay via PayPal, I will request it from the app.');
  res.json({ product: name, total: Math.round(total * 100) / 100, people, share, friends, message, note: t(lang, 'sbIntro') });
});

// Split Payment Link: the Invoicing API is 403 for this sandbox app, so a
// split bill is collected with the Orders API v2 instead. The server works
// out each person's share and creates a separate PayPal Sandbox order for
// that share, with its own approveUrl, so each friend gets a payment link.
// The user pays their own share through the normal checkout.
app.post('/api/split-payment-link', async (req, res) => {
  const lang = (req.body || {}).lang === 'id' ? 'id' : 'en';
  const b = req.body || {};
  const product = b.productId ? productsById.get(b.productId) : null;
  const entry = b.vaultId ? vaultEntries.get(b.vaultId) : null;
  const total = Number(b.totalUSD) || (entry ? Number((entry.totalCost && entry.totalCost.total) || 0) : 0) || (product ? Number(product.priceUSD) : 0);
  const name = (entry && entry.product && entry.product.name) || (product && product.name) || 'item';
  const friends = (Array.isArray(b.friends) ? b.friends : String(b.friends || '').split(/\n/)).map((x) => String(x).trim()).filter(Boolean).slice(0, 10);
  if (!total || total <= 0) return res.status(400).json({ error: 'No amount to split. Pick a product or a vault entry first.' });
  if (!friends.length) return res.status(400).json({ error: t(lang, 'sbNoFriends') });
  const people = friends.length + 1;
  // Integer-cents split: each friend's order is the share rounded to the
  // nearest cent (e.g. $59.99 / 3 = $20.00 per friend). The initiator's own
  // share absorbs the leftover cents so the exact total still adds up:
  // initiatorShare = total - (friends x share). Both are extra info fields;
  // the existing share/total/people fields are unchanged.
  const totalCents = Math.round(total * 100);
  const shareCents = Math.round(totalCents / people);
  const share = shareCents / 100;
  const initiatorShare = ((totalCents - friends.length * shareCents) / 100).toFixed(2);
  const exactTotalVerified = (totalCents / 100).toFixed(2);
  const baseUrl = req.protocol + '://' + req.get('host');
  const links = [];
  for (const friend of friends) {
    try {
      const order = await createSplitPaymentOrder(share, name, baseUrl);
      links.push({ friend, orderId: order.orderId, approveUrl: order.approveUrl, amountUSD: share, status: order.status });
    } catch (err) {
      links.push({ friend, amountUSD: share, error: err.message || String(err.status || 502) });
    }
  }
  res.json({
    productId: product ? product.id : null,
    product: name,
    total: Math.round(total * 100) / 100,
    people,
    share,
    initiatorShare,
    exactTotalVerified,
    friends,
    links,
    note: t(lang, 'splNote'),
  });
});

// PayPal token status (no token value is returned): used by the MCP
// get_access_token tool to confirm sandbox auth is working.
app.get('/api/paypal/token-status', async (req, res) => {
  try {
    await getPayPalAccessToken();
    res.json({
      ok: true,
      sandbox: true,
      tokenType: 'Bearer',
      expiresInSeconds: Math.max(0, Math.floor((cachedTokenExpiresAt - Date.now()) / 1000)),
    });
  } catch (err) {
    res.status(err.status || 502).json({ ok: false, error: err.message });
  }
});

// Evidence Pack: a standalone printable HTML proof page, returned as JSON
// { html } so the Worker (JSON-only responses) can serve it.
app.get('/api/evidence', (req, res) => {
  const lang = req.query.lang === 'id' ? 'id' : 'en';
  const entry = req.query.vaultId ? vaultEntries.get(req.query.vaultId) : null;
  if (!entry) return res.status(404).json({ error: t(lang, 'evNotFound') });
  res.json({ vaultId: entry.id, html: evidenceHtml(entry, lang) });
});

// Check a Link: paste any product URL, get a verdict from its public
// metadata (title, price, image) + price vs the demo catalog median.
app.post('/api/check-link', async (req, res) => {
  const lang = (req.body || {}).lang === 'id' ? 'id' : 'en';
  const result = await checkLink((req.body || {}).url, lang);
  if (result.error && !result.domain) return res.status(400).json({ error: result.error });
  res.json(result);
});

// Deadline Tracker: 180-day filing + 20-day escalation + 30-day return.
// From a Proof Vault entry (vaultId) or a product (sellerId + productId,
// purchase assumed today).
app.get('/api/deadlines', (req, res) => {
  const lang = req.query.lang === 'id' ? 'id' : 'en';
  const entry = req.query.vaultId ? vaultEntries.get(req.query.vaultId) : null;
  const product = req.query.productId ? productsById.get(req.query.productId) : null;
  const seller = product ? sellersById.get(product.sellerId) : null;
  if (entry) {
    const filedAt = req.query.disputeFiledAt || entry.disputeDraftAt || null;
    return res.json({
      vaultId: entry.id,
      product: entry.product?.name || null,
      deadlines: calculateDeadlines(
        entry.paypal?.createTime || entry.createdAt,
        !!entry.seller?.returnPolicy,
        filedAt,
        lang
      ),
    });
  }
  if (product && seller) {
    return res.json({
      productId: product.id,
      product: product.name,
      prePurchase: true,
      deadlines: calculateDeadlines(new Date().toISOString(), seller.hasReturnPolicy, null, lang),
    });
  }
  return res.status(404).json({ error: t(lang, 'dlNotFound') });
});

// Hold Release Checklist: the steps that release a PayPal hold early,
// pre-ticked from the seller's data, with the estimated release time.
app.post('/api/hold-checklist', (req, res) => {
  const lang = (req.body || {}).lang === 'id' ? 'id' : 'en';
  const seller = sellersById.get((req.body || {}).sellerId);
  const product = productsById.get((req.body || {}).productId);
  const result = buildHoldChecklist(seller, product, lang);
  if (result.error) return res.status(400).json({ error: result.error });
  res.json(result);
});

// Import Cost: duty + VAT/GST for a cross-border purchase, per
// destination country. Rates are the public parcel rules (estimate).
app.post('/api/import-cost', (req, res) => {
  const lang = (req.body || {}).lang === 'id' ? 'id' : 'en';
  const result = calculateImportCost((req.body || {}).priceUSD, (req.body || {}).country, lang);
  if (result.error) return res.status(400).json({ error: result.error });
  res.json(result);
});

// Phishing Check: paste a message claiming to be from PayPal, get a
// verdict (rule-based signals + an AI review when Vyce is available).
app.post('/api/phishing-check', async (req, res) => {
  const lang = (req.body || {}).lang === 'id' ? 'id' : 'en';
  const result = await checkPhishing((req.body || {}).text, lang);
  if (result.error) return res.status(400).json({ error: result.error });
  res.json(result);
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

module.exports = app;

// Vercel imports the app from api/index.js; running node directly listens.
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`ShopPal v2 listening on http://localhost:${PORT} (mode: ${PAYPAL_MODE})`);
  });
}
