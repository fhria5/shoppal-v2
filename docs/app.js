// ShopPal v2: static demo for GitHub Pages, chat UI.
// Same 7-step flow as the Node.js server, running fully in the browser:
// risk score and total cost use the same rule formulas as server.js;
// checkout uses the official PayPal JS SDK (Sandbox); Proof Vault lives
// in localStorage. No secrets here, the Client ID in index.html is
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
    Charger: './images/charger.jpg',
    Mouse: './images/mouse.jpg',
    Earbuds: './images/earbuds.jpg',
    Webcam: './images/webcam.jpg',
    'Power Bank': './images/powerbank.jpg'
  };
  var CATALOG = {
    products: [
      { id: 'p01', image: 'images/p01.jpg', name: 'Aurora Wireless Headphones', priceUSD: 59.99, referencePriceUSD: 59.99, category: 'Headphones', sellerId: 'seller-safe' },
      { id: 'p02', image: 'images/p02.jpg', name: 'Aurora Wireless Headphones', priceUSD: 54.99, referencePriceUSD: 59.99, category: 'Headphones', sellerId: 'seller-caution' },
      { id: 'p03', image: 'images/p03.jpg', name: 'Aurora Wireless Headphones', priceUSD: 29.99, referencePriceUSD: 59.99, category: 'Headphones', sellerId: 'seller-risky' },
      { id: 'p04', image: 'images/p04.jpg', name: 'Pulse Smartwatch Series 5', priceUSD: 89.00, referencePriceUSD: 89.00, category: 'Smartwatch', sellerId: 'seller-safe' },
      { id: 'p05', image: 'images/p05.jpg', name: 'Pulse Smartwatch Series 5', priceUSD: 44.00, referencePriceUSD: 89.00, category: 'Smartwatch', sellerId: 'seller-risky' },
      { id: 'p06', image: 'images/p06.jpg', name: 'Nova Mechanical Keyboard', priceUSD: 79.00, referencePriceUSD: 79.00, category: 'Keyboard', sellerId: 'seller-safe' },
      { id: 'p07', image: 'images/p07.jpg', name: 'Nova Mechanical Keyboard', priceUSD: 69.00, referencePriceUSD: 79.00, category: 'Keyboard', sellerId: 'seller-caution' },
      { id: 'p08', image: 'images/p08.jpg', name: 'Echo Bluetooth Speaker', priceUSD: 39.99, referencePriceUSD: 39.99, category: 'Speaker', sellerId: 'seller-safe' },
      { id: 'p09', image: 'images/p09.jpg', name: 'Echo Bluetooth Speaker', priceUSD: 19.99, referencePriceUSD: 39.99, category: 'Speaker', sellerId: 'seller-risky' },
      { id: 'p10', image: 'images/p10.jpg', name: 'Volt 65W GaN Charger', priceUSD: 24.99, referencePriceUSD: 24.99, category: 'Charger', sellerId: 'seller-caution' },
      { id: 'p11', image: 'images/p11.jpg', name: 'Echo Mini Bluetooth Speaker', priceUSD: 14.99, referencePriceUSD: 19.99, category: 'Speaker', sellerId: 'seller-safe' },
      { id: 'p12', image: 'images/p12.jpg', name: 'Aurora Wireless Mouse', priceUSD: 34.99, referencePriceUSD: 34.99, category: 'Mouse', sellerId: 'seller-safe' },
      { id: 'p13', image: 'images/p13.jpg', name: 'Aurora Wireless Mouse', priceUSD: 29.99, referencePriceUSD: 34.99, category: 'Mouse', sellerId: 'seller-caution' },
      { id: 'p14', image: 'images/p14.jpg', name: 'Aurora Wireless Mouse', priceUSD: 16.99, referencePriceUSD: 34.99, category: 'Mouse', sellerId: 'seller-risky' },
      { id: 'p15', image: 'images/p15.jpg', name: 'Aurora True Wireless Earbuds', priceUSD: 49.99, referencePriceUSD: 49.99, category: 'Earbuds', sellerId: 'seller-safe' },
      { id: 'p16', image: 'images/p16.jpg', name: 'Aurora True Wireless Earbuds', priceUSD: 19.99, referencePriceUSD: 49.99, category: 'Earbuds', sellerId: 'seller-risky' },
      { id: 'p17', image: 'images/p17.jpg', name: 'Aurora 1080p Webcam', priceUSD: 45.99, referencePriceUSD: 45.99, category: 'Webcam', sellerId: 'seller-safe' },
      { id: 'p18', image: 'images/p18.jpg', name: 'Aurora 1080p Webcam', priceUSD: 32.99, referencePriceUSD: 45.99, category: 'Webcam', sellerId: 'seller-caution' },
      { id: 'p19', image: 'images/p19.jpg', name: 'Echo 20000mAh Power Bank', priceUSD: 24.99, referencePriceUSD: 24.99, category: 'Power Bank', sellerId: 'seller-safe' },
      { id: 'p20', image: 'images/p20.jpg', name: 'Echo 20000mAh Power Bank', priceUSD: 18.99, referencePriceUSD: 24.99, category: 'Power Bank', sellerId: 'seller-caution' },
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
  var lastResults = null; // products the last Ask reply showed, follow-ups ("yang termurah") refer to these
  var lastSplit = null; // the active split session {productId, share, initiatorShare, total, friends}, if any
  var sending = false; // true while a request is in flight (replaces disabling the input, so it keeps focus)

  // Bilingual replies (Dwibahasa). The agent answers in the language the
  // buyer types: Indonesian when the message has Indonesian words, English
  // otherwise (English is the demo's default, Devpost requires English
  // materials). The greeting stays English (it renders before any input).
  // The demo is English-only: there is no language choice, so lang
  // never changes. (The server still answers in Indonesian when asked
  // through the API; the client simply always asks in English.)
  var lang = 'en';
  function fmt(template, vars) {
    return String(template).replace(/\{(\w+)\}/g, function (_, k) { return vars[k] !== undefined ? vars[k] : '{' + k + '}'; });
  }
  function t(key) {
    var dict = STR[lang] || STR.en;
    return dict[key] !== undefined ? dict[key] : STR.en[key];
  }
  // HTML escaping (was missing in the static demo; the agent, check-link
  // and dispute renderers already called it, so those paths threw).
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function labelText(label) { return t('label' + label); }
  function holdLabelText(label) { return t('hold' + label); }
  var STR = {
    en: {
      understood: 'Understood:', noCategory: 'no category or budget found',
      under: 'under $', fromSeller: 'from {seller} only', withReturns: 'with returns', withTracking: 'with tracking',
      cheapestFirst: 'cheapest first', bestFirst: 'best match first',
      noteCheapest: 'Matches sorted cheapest first.', noteBest: 'Best match first (safest, then cheapest).',
      noteSafest: 'Matches sorted safest first.', noteNoMatch: 'No exact match in the demo catalog, showing all 20 demo products.',
      riskScore: 'Risk Score', labelSafe: 'Safe', labelCaution: 'Caution', labelRisky: 'Risky',
      recommendation: 'Recommendation:', watchOut: 'Watch out:', beforeYouPay: 'Before you pay:',
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
      aiNoteStatic: 'AI explanation unavailable in the static demo, showing rule-based reasons.',
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
      checkoutHint: 'Pay with the gold PayPal button above. Approve with a PayPal Sandbox Personal (buyer) account, no real money is involved. The order total is exactly the total shown above.',
      sdkFailed: 'PayPal SDK failed to load. Check your connection and reload.',
      tickFirst: 'Please tick the approval checkbox first.', creatingOrder: 'Creating PayPal order…',
      agentSteps: 'What the agent did', agentApprove: 'Approve and pay with PayPal', agentPendingApproval: 'Pending Human Approval (Guardrail Triggered)', agentReject: 'Reject',
      calloutWhy: 'This order is above the $20.00 auto-approve limit, so the agent stopped here for your approval.',
      toastCopyLink: 'Payment link for {name} copied', toastCopyJson: 'Dispute JSON copied', toastApproved: 'Order approved', toastRejected: 'Order rejected - left unpaid',
      openPayPal: 'Open PayPal Sandbox', copyLink: 'Copy link', copied: '✓ Copied!', copyJson: 'Copy JSON',
      loadingAgent: 'Agent is working…', trackingAdded: 'Tracking added',
      agentFailed: 'The agent could not finish that. Please try again.',
      agentPayLink: 'Approve this order in PayPal Sandbox (opens in a new tab)',
      agentPayHint: 'Use a PayPal sandbox buyer account to approve. No real money is involved.',
      approvedCapturing: 'PayPal approved order {id}, capturing…',
      captureFailed: 'Capture did not complete (status: {status}). Nothing was saved to the Proof Vault.',
      paymentCaptured: 'Payment captured: {id}',
      successTitle: 'Success, paid {total} via PayPal Sandbox.',
      successProof: 'Proof was saved to the Proof Vault automatically (this browser).',
      checkoutCancelled: 'Checkout was cancelled in PayPal. No payment was made.',
      checkoutError: 'PayPal checkout error: {msg}',
      vaultEmpty: 'No Proof Vault entries yet. Complete a successful checkout to save proof automatically.',
      vaultIntro: 'Every completed checkout saves its receipt, capture proof, and risk score here, so a dispute is one tap away.', sampleTitle: 'Sample Proof', sampleHint: 'A real Sandbox capture from our own test run. See exactly what the vault saves, before you buy anything.', sampleView: 'View Sample Proof', vaultLimitsTitle: 'Your limits',
      subsTitle: 'Subscription Watcher',
      subsEmpty: 'No recurring purchases detected yet. Buy the same product twice and it shows up here with the total you have spent on it.',
      subsFound: 'recurring purchases found',
      subsLine: '{name}, bought {n}×, total spent {total}, last purchase {date}',
      refreshVault: 'Refresh Vault', disputeBtn: 'Draft a dispute',
      vaultShow: 'Show vault tools ▾', vaultHide: 'Hide vault tools ▴',
      disputeNotFound: 'Proof Vault entry not found. Save a successful checkout first.',
      refundBtn: 'Refund (Sandbox)', refundConfirm: 'Confirm refund?', refundTitle: 'Refund',
      refundSuccess: 'Refund {id}, {status}, {amount}.', refundFailed: 'Refund failed: {msg}',
      refundAlready: 'Already refunded.', orderStatusBtn: 'Check live status',
      orderStatusTitle: 'Live order status (PayPal)',
      orderStatusFailed: 'Could not check the order status: {msg}',
      simBtn: 'Dispute win chance', simTitle: 'Dispute simulation', simPayloadTitle: 'Dispute payload (PayPal Disputes API format, simulated)',
      simWinChance: 'Win chance: {n}%', simMissing: 'Missing proof: {list}',
      simFailed: 'Could not simulate the dispute: {msg}',
      simPreNote: 'Pre-purchase simulation, what your case would look like if you buy now.',
      simStrong: 'Strong case', simModerate: 'Moderate case', simWeak: 'Weak case',
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
      simAlreadyRefunded: 'This capture was already refunded, there is nothing left to dispute.',
      evBtn: 'Download Evidence Pack',
      evFailed: 'Could not build the evidence pack: {msg}',
      evTitle: 'ShopPal Evidence Pack',
      dlBtn: 'Deadlines', dlTitle: 'Deadlines',
      dlFailed: 'Could not load the deadlines: {msg}',
      dlLeft: '{days} days left', dlOverdue: '{days} days overdue',
      dlToday: 'Due today', dlExpired: 'Expired',
      dlNoReturn: 'Seller has no return policy', dlNoDispute: 'No dispute filed yet',
      dlFiling: 'Dispute filing deadline', dlEscalation: 'Escalation deadline (dispute → claim)',
      dlReturn: 'Return deadline',
      clTitle: 'Link check', clFailed: 'Could not check that link: {msg}',
      clKnown: 'Known marketplace', clUnknown: 'Unknown domain',
      clNoPrice: 'No price found on the page',
      linkHint: 'Or paste any product link, I will check the seller and the price from the page (live server).',
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
      browseCatalog: 'Browse catalog', hideCatalog: 'Hide catalog',
      cmpSafer: 'Safer pick', cmpCheaper: 'Cheapest',
      cmpVerdictBoth: 'Safer and cheapest: {safer} ({score}/100).',
      cmpVerdictSplit: 'Safer: {safer} ({score}/100). Cheapest: {cheaper} ({price}, saves {saves}).',
      cmpPick: 'Pick two products to compare.',
      bestDealTitle: 'Best deal', bestDealVerdict: 'Best deal',
      bestDealRunner: 'Also worth a look', bestDealNone: 'No deal found for that search.',
      bestDealBuy: 'Buy this deal', compareTitle: 'Compare sources', compareOverall: 'Best overall',
      viewOnEbay: 'View on eBay',
      simNote: 'Sandbox simulation: this creates a PayPal Sandbox order for the listing total. It does <strong>not</strong> buy the {mp} item, it proves the total and saves the proof.',
      saveBtn: 'Save to wishlist', savedMsg: 'Saved to your wishlist.',
      watchesTitle: 'My price watches', noWatches: 'No price watches yet. Watch a price from an eBay listing in the live demo.',
      dropBadge: 'PRICE DROP', goneBadge: 'GONE', currentPrice: 'Current:', watchTarget: 'Target:',
      removeBtn: 'Remove', checkPricesBtn: 'Check prices now', checkedMsg: 'Prices checked. No drops below target.',
      wishlistTitle: 'My wishlist', noWishlist: 'Wishlist is empty. Save a product from its checkout step.',
      dealBadge: 'DEAL', savedPrice: 'Saved at:',
      cmpSelected: '{n}/2 selected', cmpCompareBtn: 'Compare', cmpClear: 'Clear',
      budTitle: 'Monthly budget', budSet: 'Set monthly budget (USD)', budHint: 'ShopPal warns you when your spending this month passes this amount.',
      budSave: 'Save', budSpent: 'Spent this month: {spent} of {budget} ({pct}%)',
      budLeft: '{left} left this month.', budOver: 'Over budget by {over} this month.',
      budWarn: 'This purchase would take you over your monthly budget ({spent} of {budget} spent).',
      budNoBudget: 'No monthly budget set.',
      grTitle: 'Smart Guardrails', grIntro: 'The agent auto-pays only under your limit. Above it, it asks you first, so a hallucination can never buy something expensive.',
      grLimit: 'Auto-approve up to (USD)', grSave: 'Save guardrails', grSaved: 'Guardrails saved.', grHint: 'Orders above the limit wait for your approval first. Change it anytime in Settings.',
      grNeedApproval: 'Needs your approval', grAboveLimit: 'This purchase ({total}) is above your auto-approve limit ({limit}).',
      grApprove: 'Approve and pay', grReject: 'Reject this purchase',
      grApproved: 'Approved, capturing payment...', grRejected: 'Purchase rejected. The PayPal order was not captured and will expire.',
      grAutoOk: 'Under your auto-approve limit, capturing...',
      setTitle: 'Settings', setClose: 'Close settings', setOpen: 'Open settings',
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
      disputeTitle: 'Simulated dispute draft', disputeReadiness: 'readiness {n}/100',
      disputeBody: 'Dispute response draft (simulated, factual only): Order {order} for {product} ({total}) was paid via PayPal Sandbox and captured as {status}. Seller: {seller} (risk score {score} at checkout). Proof is attached in the Proof Vault entry {id}.',
      disputeMissing: 'Still missing: {list}', disputeNone: 'No proof missing.',
      sdkNotLoaded: 'PayPal SDK did not load yet, it loads from paypal.com; check your connection and reload the page if the PayPal button never appears.'
    },
  };
  var lastVaultId = null;
  var paypalRenderToken = 0;
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

  // ---------- Smart Guardrails (local mirror of the server rules) ----------
  var GUARDRAILS_KEY = 'shoppal-guardrails';
  var CATEGORIES = ['Headphones', 'Smartwatch', 'Keyboard', 'Speaker', 'Charger', 'Mouse', 'Earbuds', 'Webcam', 'Power Bank'];
  function getGuardrails() {
    try {
      var g = JSON.parse(localStorage.getItem(GUARDRAILS_KEY) || 'null');
      if (g && typeof g === 'object') return { autoApproveLimit: Number(g.autoApproveLimit) || 20 };
    } catch (e) { /* fall through to defaults */ }
    return { autoApproveLimit: 20 };
  }
  function saveGuardrailsLocal(g) {
    try { localStorage.setItem(GUARDRAILS_KEY, JSON.stringify(g)); } catch (e) { /* private mode */ }
  }

  // Session id: one random id per browser, kept in localStorage. It is
  // sent with every wishlist / watch read-write so the server only returns
  // this browser's own entries. Same key as the live demo, so both demos
  // on this origin share one wishlist and one watch list.
  function getSessionId() {
    try {
      var s = localStorage.getItem('shoppal-session');
      if (!s) {
        s = (window.crypto && crypto.randomUUID)
          ? crypto.randomUUID()
          : ('s-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10));
        localStorage.setItem('shoppal-session', s);
      }
      return s;
    } catch (e) { return 'no-session'; }
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
      '<section class="set-section"><h3>' + t('budTitle') + '</h3>' +
      '<p class="hint">' + t('budHint') + '</p>' +
      '<p class="set-row"><input id="set-budget-input" type="number" min="1" step="1" placeholder="' + t('budSet') + '" value="' + (budget || '') + '"> ' +
      '<button id="set-budget-save" type="button">' + t('budSave') + '</button></p><p class="set-status" id="set-budget-status"></p></section>' +
      '<section class="set-section"><h3>' + t('grTitle') + '</h3>' +
      '<p class="hint">' + t('grIntro') + '</p>' +
      '<label class="set-label" for="set-gr-limit">' + t('grLimit') + '</label>' +
      '<p class="set-row"><input id="set-gr-limit" type="number" min="0" step="1" value="' + gr.autoApproveLimit + '"> ' +
      '<button id="set-gr-save" type="button">' + t('grSave') + '</button></p><p class="set-status" id="set-gr-status"></p></section>' +
      '<section class="set-section"><h3>' + t('setData') + '</h3>' +
      '<p><button id="set-clear-chat" type="button" class="btn-secondary">' + t('setClearChat') + '</button> <span id="set-clear-status"></span></p>' +
      '<p class="hint">' + t('setClearHint') + '</p></section>';
    body.querySelector('#set-budget-save').addEventListener('click', function () {
      var v = Number(body.querySelector('#set-budget-input').value);
      if (v > 0) setBudget(v);
      var st = $('set-budget-status');
      if (st) st.textContent = t('budSaved');
      refreshVaultSummary();
    });
    body.querySelector('#set-gr-save').addEventListener('click', async function () {
      var limit = Number(body.querySelector('#set-gr-limit').value);
      var g = { autoApproveLimit: (Number.isFinite(limit) && limit >= 0) ? limit : 20 };
      saveGuardrailsLocal(g);
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
  function checkGuardrailsLocal(totalUSD, category) {
    var g = getGuardrails();
    var reasons = [];
    if (totalUSD > g.autoApproveLimit) reasons.push(fmt(t('grAboveLimit'), { total: money(totalUSD), limit: money(g.autoApproveLimit) }));
    return { needsApproval: reasons.length > 0, reasons: reasons };
  }

  // ---------- Import Cost (local mirror of the server rules) ----------
  var IMPORT_RULES = {
    ID: { name: 'Indonesia', currency: 'USD', deMinimis: 3, dutyRate: 0.075, vatRate: 0.11, vatLabel: 'PPN' },
    US: { name: 'United States', currency: 'USD', deMinimis: 800, dutyRate: 0.02, vatRate: 0, vatLabel: 'VAT' },
    EU: { name: 'European Union (Germany)', currency: 'EUR', deMinimis: 150, dutyRate: 0, vatRate: 0.19, vatLabel: 'VAT' },
    UK: { name: 'United Kingdom', currency: 'GBP', deMinimis: 135, dutyRate: 0, vatRate: 0.20, vatLabel: 'VAT' },
    SG: { name: 'Singapore', currency: 'SGD', deMinimis: 400, dutyRate: 0, vatRate: 0.09, vatLabel: 'GST' },
  };

  function calculateImportCostLocal(priceUSD, countryCode) {
    var rule = IMPORT_RULES[countryCode];
    if (!rule || !priceUSD || priceUSD <= 0) return null;
    var dutyFree = priceUSD <= rule.deMinimis;
    var duty = dutyFree ? 0 : Math.round(priceUSD * rule.dutyRate * 100) / 100;
    var vat = Math.round((priceUSD + duty) * rule.vatRate * 100) / 100;
    var total = Math.round((duty + vat) * 100) / 100;
    return {
      countryName: rule.name, currency: rule.currency, duty: duty,
      dutyRate: Math.round(rule.dutyRate * 1000) / 10, vat: vat,
      vatRate: Math.round(rule.vatRate * 1000) / 10, vatLabel: rule.vatLabel,
      total: total, deMinimis: rule.deMinimis, deMinimisApplies: dutyFree,
    };
  }

  // ---------- Phishing Check (rule-based mirror; the live server adds AI) ----------
  var PAYPAL_DOMAINS = ['paypal.com', 'paypal.me', 'paypalobjects.com', 'paypal-communication.com'];
  var PHISH_URGENCY = [
    'urgent', 'immediately', 'account will be closed', 'account suspended', 'verify now',
    'verify your account', 'limited time', 'act now', 'final notice', 'security alert',
    'segera', 'akun akan ditutup', 'akun ditangguhkan', 'verifikasi sekarang', 'segera verifikasi',
    'waktu terbatas', 'peringatan keamanan', 'pemberitahuan terakhir',
  ];
  var PHISH_GENERIC = ['dear customer', 'dear user', 'dear member', 'pelanggan yang terhormat', 'pengguna yang terhormat'];

  function looksLikePaypal(host) {
    var norm = String(host || '').toLowerCase()
      .replace(/1/g, 'l').replace(/0/g, 'o').replace(/\|/g, 'l')
      .replace(/[^a-z]/g, '');
    return norm.indexOf('paypal') !== -1;
  }

  function checkPhishingLocal(text) {
    var input = String(text || '').trim();
    if (!input) return null;
    var signals = [];
    var score = 100;
    var urls = [];
    var re = /https?:\/\/[^\s<>"')\]]+/gi;
    var m;
    while ((m = re.exec(input)) !== null) urls.push(m[0]);
    var lower = input.toLowerCase();
    if (!urls.length) {
      signals.push({ points: 0, note: t('phNoLink') });
    } else {
      var badDomain = null;
      var goodDomain = false;
      for (var i = 0; i < urls.length; i++) {
        var host = '';
        try { host = new URL(urls[i]).hostname.toLowerCase().replace(/^www\./, ''); } catch (e) { continue; }
        var isPaypal = PAYPAL_DOMAINS.some(function (d) { return host === d || host.endsWith('.' + d); });
        if (isPaypal) goodDomain = true;
        else if (looksLikePaypal(host)) badDomain = host;
      }
      if (badDomain) {
        score -= 50;
        signals.push({ points: -50, note: fmt(t('phDomainBad'), { domain: badDomain }) });
      } else if (goodDomain) {
        signals.push({ points: 0, note: t('phDomainOk') });
      } else {
        score -= 15;
        signals.push({ points: -15, note: t('phNoPaypalLink') });
      }
    }
    for (var j = 0; j < PHISH_URGENCY.length; j++) {
      if (lower.indexOf(PHISH_URGENCY[j]) !== -1) {
        score -= 20;
        signals.push({ points: -20, note: fmt(t('phUrgency'), { word: PHISH_URGENCY[j] }) });
        break;
      }
    }
    if (/password|otp|one-time|kode otp|nomor kartu|card number|cvv|pin/i.test(input) &&
        /verif|confirm|masukkan|enter|send|kirim/i.test(input)) {
      score -= 30;
      signals.push({ points: -30, note: t('phAsksSecret') });
    }
    for (var k = 0; k < PHISH_GENERIC.length; k++) {
      if (lower.indexOf(PHISH_GENERIC[k]) !== -1) {
        score -= 10;
        signals.push({ points: -10, note: fmt(t('phGeneric'), { word: PHISH_GENERIC[k] }) });
        break;
      }
    }
    if (/paypal/i.test(input) && urls.length) {
      var hasReal = urls.some(function (u) {
        try {
          var h = new URL(u).hostname.toLowerCase().replace(/^www\./, '');
          return PAYPAL_DOMAINS.some(function (d) { return h === d || h.endsWith('.' + d); });
        } catch (e) { return false; }
      });
      var hasLookalike = urls.some(function (u) {
        try { return looksLikePaypal(new URL(u).hostname); } catch (e) { return false; }
      });
      if (!hasReal && hasLookalike) {
        score -= 20;
        signals.push({ points: -20, note: t('phMismatch') });
      }
    }
    score = Math.max(0, Math.min(100, score));
    var label = score >= 80 ? t('phLegit') : score >= 50 ? t('phSuspicious') : t('phLikely');
    return { score: score, label: label, signals: signals, aiReview: null, aiAvailable: false, note: t('phNote') };
  }

  function phishBubble(ph) {
    var zone = ph.score >= 80 ? 'safe' : ph.score >= 50 ? 'caution' : 'risky';
    var body = '<p><strong>' + t('phTitle') + '</strong>, <span class="score score-' + zone + '">' + ph.score + '/100 · ' + ph.label + '</span></p>';
    if (ph.signals && ph.signals.length) {
      body += '<ul>' + ph.signals.map(function (s) {
        return '<li>' + (s.points > 0 ? '+' : '') + s.points + ', ' + s.note + '</li>';
      }).join('') + '</ul>';
    }
    if (ph.aiReview) body += '<p class="hint">' + ph.aiReview + '</p>';
    if (ph.note) body += '<p class="hint">' + ph.note + '</p>';
    return body;
  }

  // ---------- Hold Release Checklist (local mirror of the server rules) ----------
  function buildHoldChecklistLocal(seller, product) {
    if (!seller || !product) return null;
    var hold = calculateHoldRisk(seller, product);
    var currentDays = hold.label === 'Low' ? 0 : hold.label === 'Moderate' ? 7 : 21;
    var steps = [
      { id: 'tracking', title: t('hrcStepTracking'), detail: t('hrcStepTrackingDetail'), done: Boolean(seller.hasTracking), savesDays: 18 },
      { id: 'shipped', title: t('hrcStepShipped'), detail: t('hrcStepShippedDetail'), done: false, savesDays: 14 },
      { id: 'buyer', title: t('hrcStepBuyer'), detail: t('hrcStepBuyerDetail'), done: false, savesDays: 20 },
      { id: 'proof', title: t('hrcStepProof'), detail: t('hrcStepProofDetail'), done: false, savesDays: 0 },
      { id: 'shipFast', title: t('hrcStepShipFast'), detail: t('hrcStepShipFastDetail'), done: false, savesDays: 0 },
      { id: 'disputes', title: t('hrcStepDisputes'), detail: t('hrcStepDisputesDetail'), done: Number(seller.disputeRate || 0) < 1, savesDays: 0 },
    ];
    return { holdLabel: hold.label, holdChance: hold.chance, currentDays: currentDays, steps: steps, note: t('hrcNote') };
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

  // Dispute Win Simulator (rule-based mirror of the server endpoint, the
  // static demo has no server vault, so it simulates from the local entry).
  function simulateLocal(opts) {
    var type = ['not_received', 'not_as_described', 'unauthorized'].indexOf(opts.disputeType) >= 0 ? opts.disputeType : 'not_received';
    var entry = opts.vaultId ? loadVault().find(function (e) { return e.id === opts.vaultId; }) : null;
    var product = opts.productId ? CATALOG.products.find(function (p) { return p.id === opts.productId; }) : null;
    var seller = null;
    if (entry && entry.seller && entry.seller.id) seller = CATALOG.sellers.find(function (s) { return s.id === entry.seller.id; }) || null;
    if (!seller && product) seller = sellerOf(product);
    if (!entry && !product) return { error: t('disputeNotFound') };
    var isVault = !!entry;
    var hasTracking = isVault ? !!(entry.seller && entry.seller.tracking) : !!(seller && seller.hasTracking);
    var hasReturns = isVault ? !!(entry.seller && entry.seller.returnPolicy) : !!(seller && seller.hasReturnPolicy);
    var disputeRate = seller ? seller.disputeRate : null;
    var refunded = isVault && entry.paypal && entry.paypal.refund && entry.paypal.refund.status === 'COMPLETED';
    var purchaseISO = isVault ? (entry.paypal && entry.paypal.createTime || entry.createdAt) : new Date().toISOString();
    var daysSince = Math.max(0, Math.floor((Date.now() - new Date(purchaseISO).getTime()) / 86400000));
    var filingDaysLeft = 180 - daysSince;
    var tooLate = filingDaysLeft < 0;
    var components = [];
    var chance = 50;
    if (isVault) { chance += 15; components.push({ points: 15, note: t('simCaptureOk') }); }
    else { chance += 10; components.push({ points: 10, note: t('simCapturePlanned') }); }
    if (hasTracking) { chance += 10; components.push({ points: 10, note: t('simTrackingYes') }); }
    else components.push({ points: 0, note: t('simTrackingNo') });
    if (hasReturns) { chance += 5; components.push({ points: 5, note: t('simReturnsYes') }); }
    else components.push({ points: 0, note: t('simReturnsNo') });
    if (disputeRate !== null && disputeRate !== undefined) {
      if (disputeRate >= 2) { chance += 10; components.push({ points: 10, note: fmt(t('simDisputeRateHigh'), { rate: disputeRate }) }); }
      else { chance += 5; components.push({ points: 5, note: fmt(t('simDisputeRateLow'), { rate: disputeRate }) }); }
    }
    if (tooLate) { chance -= 40; components.push({ points: -40, note: t('simExpiredWindow') }); }
    else { chance += 10; components.push({ points: 10, note: fmt(t('simWithinWindow'), { days: filingDaysLeft }) }); }
    if (type === 'unauthorized') { chance += 10; components.push({ points: 10, note: t('simTypeUnauthorized') }); }
    else if (type === 'not_received') { chance += 5; components.push({ points: 5, note: t('simTypeNotReceived') }); }
    else components.push({ points: 0, note: t('simTypeNotDescribed') });
    if (refunded) { chance -= 45; components.push({ points: -45, note: t('simAlreadyRefunded') }); }
    chance = Math.max(5, Math.min(95, chance));
    var label = chance >= 70 ? t('simStrong') : chance >= 40 ? t('simModerate') : t('simWeak');
    var missingProof = [];
    if (!hasTracking) missingProof.push(t('simMissingTracking'));
    if (type === 'not_as_described') missingProof.push(t('simMissingPhotos'));
    if (!hasReturns) missingProof.push(t('simMissingPolicy'));
    if (isVault) missingProof.push(t('simMissingChat'));
    if (type === 'unauthorized') missingProof.push(t('simMissingReport'));
    var recommendation = tooLate ? t('simRecTooLate')
      : refunded ? t('simAlreadyRefunded')
      : chance >= 70 ? t('simRecStrong')
      : chance >= 40 ? t('simRecModerate')
      : t('simRecWeak');
    // Local mirror of the server's disputePayload (same PayPal Disputes API
    // shape, clearly a simulation - no real ticket is opened).
    var reasonMap = {
      not_received: 'MERCHANDISE_OR_SERVICE_NOT_RECEIVED',
      not_as_described: 'MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED',
      unauthorized: 'UNAUTHORIZED_TRANSACTION',
    };
    var amountUSD = isVault
      ? (entry.total || (entry.paypal && entry.paypal.amount && entry.paypal.amount.value) || 0)
      : (product ? calculateTotalCost(product.priceUSD, true, true, lang).total : 0);
    var captureId = isVault ? (entry.paypal && entry.paypal.captureId || null) : null;
    var orderId = isVault ? entry.id : ('SIM-' + (product ? product.id.toUpperCase() : 'P'));
    var nowISO = new Date().toISOString();
    var disputePayload = {
      dispute_id: 'PP-D-' + (product ? product.id.toUpperCase() : (entry ? entry.id.slice(-6).toUpperCase() : 'SIM')) + '-' + Date.now().toString(36).toUpperCase(),
      create_time: nowISO,
      update_time: nowISO,
      reason: reasonMap[type] || reasonMap.not_received,
      status: 'OPEN',
      dispute_amount: { currency_code: 'USD', value: Number(amountUSD).toFixed(2) },
      dispute_life_cycle_stage: 'INQUIRY',
      disputed_transactions: [{
        buyer_transaction_id: captureId,
        seller_transaction_id: captureId,
        create_time: purchaseISO,
        transaction_status: isVault ? 'COMPLETED' : 'NOT_COMPLETED',
        gross_amount: { currency_code: 'USD', value: Number(amountUSD).toFixed(2) },
        invoice_number: orderId,
      }],
      seller: { name: seller ? seller.name : '' },
      messages: [],
      outcome: null,
    };
    return {
      simulated: true, prePurchase: !isVault,
      vaultId: entry ? entry.id : null,
      product: isVault ? (entry.product && entry.product.name) : (product && product.name),
      disputeType: type, winChance: chance, label: label,
      components: components, missingProof: missingProof,
      recommendation: recommendation, filingDaysLeft: filingDaysLeft,
      note: !isVault ? t('simPreNote') : null,
      disputePayload: disputePayload,
    };
  }

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
      html += '<ul>' + d.components.map(function (c) {
        return '<li>' + (c.points > 0 ? '+' : '') + c.points + ', ' + c.note + '</li>';
      }).join('') + '</ul>';
    }
    if (d.missingProof && d.missingProof.length) {
      html += '<p>' + fmt(t('simMissing'), { list: d.missingProof.join(', ') }) + '</p>';
    }
    if (d.recommendation) html += '<p><strong>' + t('recommendation') + '</strong> ' + d.recommendation + '</p>';
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

  // Deadline Tracker (rule-based mirror of the server endpoint).
  function deadlineStatusLocal(daysLeft) {
    if (daysLeft < 0) return { daysLeft: daysLeft, status: 'expired' };
    if (daysLeft <= 7) return { daysLeft: daysLeft, status: 'urgent' };
    if (daysLeft <= 30) return { daysLeft: daysLeft, status: 'soon' };
    return { daysLeft: daysLeft, status: 'ok' };
  }
  function calculateDeadlinesLocal(purchaseISO, hasReturnPolicy, disputeFiledISO) {
    var now = new Date();
    var purchase = new Date(purchaseISO);
    var out = [];
    if (!isNaN(purchase.getTime())) {
      // Days left counts whole days since the purchase, so a deadline set
      // 180 days out still reads "180 days left" right after buying.
      var daysSince = Math.max(0, Math.floor((now.getTime() - purchase.getTime()) / 86400000));
      var filingDue = new Date(purchase.getTime() + 180 * 86400000);
      var f = deadlineStatusLocal(180 - daysSince);
      out.push({ type: 'filing', label: t('dlFiling'), dueDate: filingDue.toISOString(), daysLeft: f.daysLeft, status: f.status });
      if (hasReturnPolicy) {
        var returnDue = new Date(purchase.getTime() + 30 * 86400000);
        var r = deadlineStatusLocal(30 - daysSince);
        out.push({ type: 'return', label: t('dlReturn'), dueDate: returnDue.toISOString(), daysLeft: r.daysLeft, status: r.status });
      } else {
        out.push({ type: 'return', label: t('dlReturn'), dueDate: null, daysLeft: null, status: 'none', note: t('dlNoReturn') });
      }
    }
    if (disputeFiledISO) {
      var filed = new Date(disputeFiledISO);
      if (!isNaN(filed.getTime())) {
        var daysSinceFiled = Math.max(0, Math.floor((now.getTime() - filed.getTime()) / 86400000));
        var escDue = new Date(filed.getTime() + 20 * 86400000);
        var e = deadlineStatusLocal(20 - daysSinceFiled);
        out.push({ type: 'escalation', label: t('dlEscalation'), dueDate: escDue.toISOString(), daysLeft: e.daysLeft, status: e.status });
      }
    } else {
      out.push({ type: 'escalation', label: t('dlEscalation'), dueDate: null, daysLeft: null, status: 'none', note: t('dlNoDispute') });
    }
    return out;
  }
  function renderDeadlinesHtml(deadlines) {
    return '<p><strong>' + t('dlTitle') + '</strong></p>' +
      '<ul>' + deadlines.map(function (dl) {
        var when;
        if (dl.status === 'none') when = dl.note || t('dlNoReturn');
        else if (dl.status === 'expired') when = t('dlExpired') + ', ' + fmt(t('dlOverdue'), { days: -dl.daysLeft });
        else if (dl.daysLeft === 0) when = t('dlToday');
        else when = fmt(t('dlLeft'), { days: dl.daysLeft });
        return '<li><strong>' + dl.label + '</strong>, ' + when +
          (dl.dueDate ? ' (' + dl.dueDate.slice(0, 10) + ')' : '') + '</li>';
      }).join('') + '</ul>';
  }

  // Evidence Pack (printable HTML, built locally from the vault entry).
  function evidenceHtmlLocal(entry) {
    var esc = function (s) {
      return String(s === null || s === undefined ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    };
    var row = function (k, v) { return '<tr><th>' + esc(k) + '</th><td>' + esc(v) + '</td></tr>'; };
    var refund = entry.paypal && entry.paypal.refund;
    return '<!DOCTYPE html><html lang="' + lang + '"><head><meta charset="utf-8">' +
      '<title>' + esc(t('evTitle')) + ', ' + esc(entry.id) + '</title>' +
      '<style>body{font-family:system-ui,sans-serif;max-width:720px;margin:32px auto;padding:0 20px;color:#1a2233}' +
      'h1{font-size:22px}h2{font-size:16px;margin-top:28px;border-bottom:2px solid #111111;padding-bottom:4px}' +
      'table{border-collapse:collapse;width:100%}th,td{text-align:left;padding:8px 10px;border-bottom:1px solid #e5e7eb;vertical-align:top}' +
      'th{width:200px;color:#475569}.note{font-size:13px;color:#64748b;margin-top:28px}' +
      'button{background:#111111;color:#fff;border:0;padding:10px 18px;border-radius:8px;font-size:15px;cursor:pointer}' +
      '@media print{button{display:none}}</style></head><body>' +
      '<h1>' + esc(t('evTitle')) + '</h1>' +
      '<p>ShopPal v2 · ' + esc(entry.id) + ' · ' + esc(entry.createdAt || '') + '</p>' +
      '<button onclick="window.print()">Print / Save as PDF</button>' +
      '<h2>Order / Capture</h2><table>' +
      row('Order ID', entry.paypal && entry.paypal.orderId || entry.id) +
      row('Capture ID', entry.paypal && entry.paypal.captureId || '') +
      row('Capture status', entry.paypal && entry.paypal.status || '') +
      row('Payer', entry.paypal && entry.paypal.payerEmail || '') +
      row('Total paid', '$' + (entry.totalCost && entry.totalCost.total != null ? entry.totalCost.total : entry.product && entry.product.priceUSD || '') + ' ' + (entry.totalCost && entry.totalCost.currency || 'USD')) +
      (refund ? row('Refund', refund.id + ', ' + (refund.status || '') + ', $' + refund.amount) : '') +
      '</table>' +
      '<h2>Product / Seller</h2><table>' +
      row('Product', entry.product && entry.product.name || '') +
      row('Category', entry.product && entry.product.category || '') +
      row('Price', '$' + (entry.product && entry.product.priceUSD != null ? entry.product.priceUSD : '')) +
      row('Seller', entry.seller && entry.seller.name || '') +
      row('Risk Score', entry.riskScore ? entry.riskScore.score + ' / 100 (' + entry.riskScore.label + ')' : '') +
      '</table>' +
      '<h2>Timeline</h2><table>' +
      row('Purchase / capture', entry.paypal && entry.paypal.createTime || entry.createdAt || '') +
      row('Capture verified', entry.paypal && entry.paypal.updateTime || '') +
      (refund ? row('Refund ' + (refund.status || ''), refund.createTime || '') : '') +
      '</table>' +
      '<p class="note">ShopPal v2 (PayPal AI Hackathon). Sandbox proof only, no real money moved. Print this page to PDF to attach it to a PayPal dispute.</p>' +
      '</body></html>';
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
      clone.querySelectorAll('[data-step="greeting"], [data-step="catalog"], [data-step="vault"], [data-step="checkout"], .typing, .skeleton-msg, .catalog-toggle').forEach(function (el) { el.remove(); });
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
        if (ctx && CATALOG) {
          var ids = JSON.parse(ctx);
          if (Array.isArray(ids)) {
            lastResults = ids.map(function (id) { return CATALOG.products.find(function (p) { return p.id === id; }); }).filter(Boolean);
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
    return addBubble('user', '<p>' + escapeHtml(text) + '</p>');
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
    // Re-enable the composer once the last typing indicator is gone.
    if (chatEl && !chatEl.querySelector('.typing')) {
      var btn = $('ask-btn');
      var input = $('ask');
      if (btn) btn.disabled = false;
      if (input) { input.disabled = false; input.focus(); }
      sending = false;
    }
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
      '<img src="' + (p.image || IMAGE[p.category]) + '" alt="' + p.name + '">' +
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
    // Catalog starts collapsed behind a toggle (the greeting used to show
    // all 20 cards at once). Cards render lazily on first expand, so the
    // photos don't load until the user actually wants to browse.
    var catalogBubble = addBubble('agent',
      '<div id="compare-bar" class="card hidden"></div>' +
      '<div class="cards" id="catalog"></div>',
      'catalog');
    catalogBubble.classList.add('hidden');
    var catalogToggle = document.createElement('button');
    catalogToggle.type = 'button';
    catalogToggle.id = 'catalog-toggle';
    catalogToggle.className = 'catalog-toggle';
    catalogToggle.innerHTML = '<span class="cat-label">' + t('browseCatalog') + ' (' + CATALOG.products.length + ')</span>' +
      '<svg class="chev" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>';
    chatEl.insertBefore(catalogToggle, catalogBubble);
    var catalogRendered = false;
    var setCatalogOpen = function (open) {
      if (open && !catalogRendered) {
        renderCatalogInto($('catalog'), CATALOG.products);
        catalogRendered = true;
      }
      catalogBubble.classList.toggle('hidden', !open);
      catalogToggle.classList.toggle('open', open);
      catalogToggle.querySelector('.cat-label').textContent = (open ? t('hideCatalog') : t('browseCatalog')) + ' (' + CATALOG.products.length + ')';
      if (open) scrollChat();
    };
    catalogToggle.addEventListener('click', function () {
      setCatalogOpen(catalogBubble.classList.contains('hidden'));
    });
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
      if (compareMode) setCatalogOpen(true);
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

  function renderCompare() {
    if (compareList.length !== 2) return;
    var rows = compareList.map(function (p) {
      var seller = sellerOf(p);
      return {
        product: p, seller: seller,
        risk: calculateRiskScore(seller, p),
        hold: calculateHoldRisk(seller, p),
        cost: calculateTotalCost(p.priceUSD, true, true),
      };
    });
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
        '<img src="' + (r.product.image || IMAGE[r.product.category]) + '" alt="' + r.product.name + '">' +
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
  // agent on the live server, which runs the whole flow (search, score,
  // total, guardrails, PayPal order) and only asks the user to approve.
  // Everything else keeps the local Ask flow below.
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
    var html = '<p><strong>' + t('grTitle') + '</strong></p>' +
      '<p>' + t('grIntro') + '</p>' +
      '<ul>' +
      '<li>' + t('grLimit') + ': <strong>' + money(g.autoApproveLimit) + '</strong></li>' +
      '<li>' + t('budTitle') + ': <strong>' + (budget ? money(Number(budget)) : t('budNoBudget')) + '</strong></li>' +
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
    // A share order that arrives IN THE SAME response as the split (the
    // model checked the user's share out while splitting) must NOT clear
    // the session: the split is still active and the user has not checked
    // out yet. Only a standalone share checkout clears it.
    if (ag.order && ag.order.shareCheckout && !ag.splitPayment) {
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
        '<p><strong>Order ' + escapeHtml(ag.order.orderId) + '</strong>, total ' + money(ag.order.totalUSD) + '.</p>' +
        '<p><a href="' + ag.order.approveUrl + '" target="_blank" rel="noopener">' + t('agentPayLink') + '</a></p>' +
        '<p class="hint">' + t('agentPayHint') + '</p>');
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
      approveBtn.addEventListener('click', function () {
        setBusy(approveBtn, true, t('loadingAgent'));
        if (rejectBtn) rejectBtn.disabled = true;
        var typing2 = showTyping();
        fetch(WORKER_API + '/api/agent', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: q, lang: lang, guardrails: getGuardrails(), approved: true, approvedOrder: ag.pendingOrder }),
        }).then(function (r2) { return r2.json().then(function (ag2) { return { ok: r2.ok, ag2: ag2 }; }); })
          .then(function (out) {
            hideTyping(typing2);
            setBusy(approveBtn, false);
            if (out.ok) { showToast(t('toastApproved'), 'success'); renderAgentResult(out.ag2, q); }
            else addBubble('agent', '<p>' + escapeHtml(out.ag2.error || 'error') + '</p>');
            scrollChat();
          })
          .catch(function () {
            hideTyping(typing2);
            setBusy(approveBtn, false);
            if (rejectBtn) rejectBtn.disabled = false;
            addBubble('agent', '<p>' + t('agentFailed') + '</p>');
            scrollChat();
          });
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

  // One-tap buy from a product card: send "buy <id>" straight to the
  // agent, which buys that exact product (deterministic server bypass).
  function buyProduct(p) {
    $('ask').value = 'buy ' + p.id;
    sendAsk();
  }

  // Best Deal / Compare / Wishlist / eBay watch: the same features as the
  // live demo, backed by the Worker. A catalog pick opens the static
  // demo's own checkout; a marketplace pick buys through the Worker
  // (Sandbox simulation, labelled in the UI).
  function renderBestDeal(d) {
    if (!d.pick) {
      addBubble('agent', '<p><strong>' + t('bestDealTitle') + '</strong></p><p>' + t('bestDealNone') + '</p>');
      return;
    }
    var p = d.pick;
    var zone = (p.riskLabel || 'Caution').toLowerCase();
    var html = '<p><strong>' + t('bestDealVerdict') + '</strong> · ' + escapeHtml(p.title) + '</p>' +
      '<p>' + escapeHtml(d.verdict || '') + '</p>' +
      '<p><span class="score score-' + zone + '">' + p.riskScore + '/100 · ' + p.riskLabel + '</span> · ' + p.source + ' · ' + escapeHtml(p.sellerName) + '</p>' +
      '<p><strong>' + t('honestTotal') + '</strong><span class="verdict-total">' + money(p.totalUSD) + '</span> <span class="hint">(' + t('itemPrice') + ' ' + money(p.priceUSD) + ')</span></p>' +
      '<p class="hint">' + escapeHtml(d.reason || '') + '</p>' +
      '<p><button type="button" class="btn-primary" id="bestdeal-buy">' + t('bestDealBuy') + '</button></p>';
    if (d.runnersUp && d.runnersUp.length) {
      html += '<p><strong>' + t('bestDealRunner') + '</strong></p><ul>' +
        d.runnersUp.map(function (r) {
          var rz = (r.riskLabel || 'Caution').toLowerCase();
          return '<li>' + escapeHtml(r.title) + ' · ' + money(r.totalUSD) + ' all-in · ' + r.source +
            ' · <span class="score score-' + rz + '">' + r.riskScore + '/100</span></li>';
        }).join('') + '</ul>';
    }
    var bubble = addBubble('agent', html);
    bubble.classList.add('verdict-hero');
    var buyBtn = bubble.querySelector('#bestdeal-buy');
    if (buyBtn) buyBtn.addEventListener('click', function () { openDealCandidate(p); });
  }
  function renderCompare(d) {
    var entries = Object.keys(d.perSource || {}).map(function (src) { return d.perSource[src]; });
    if (!entries.length) {
      addBubble('agent', '<p><strong>' + t('compareTitle') + '</strong></p><p>' + t('bestDealNone') + '</p>');
      return;
    }
    var overallId = d.overallPick ? (d.overallPick.kind + ':' + d.overallPick.id) : null;
    var html = '<p><strong>' + t('compareTitle') + '</strong></p>' +
      entries.map(function (c) {
        var zone = (c.riskLabel || 'Caution').toLowerCase();
        var isOverall = overallId && (c.kind + ':' + c.id) === overallId;
        return '<p>' + (isOverall ? '<span class="best-badge">' + t('compareOverall') + '</span> ' : '') +
          '<strong>' + escapeHtml(c.source) + '</strong> · ' + escapeHtml(c.title) + '<br>' +
          money(c.priceUSD) + ' · ' + money(c.totalUSD) + ' all-in · ' + escapeHtml(c.sellerName) + '<br>' +
          '<span class="score score-' + zone + '">' + c.riskScore + '/100 · ' + c.riskLabel + '</span></p>';
      }).join('') +
      '<p><button type="button" class="btn-primary" id="compare-buy">' + t('bestDealBuy') + '</button></p>';
    var bubble = addBubble('agent', html);
    var buyBtn = bubble.querySelector('#compare-buy');
    if (buyBtn && d.overallPick) buyBtn.addEventListener('click', function () { openDealCandidate(d.overallPick); });
    else if (buyBtn) buyBtn.remove();
  }
  // Open a deal candidate: a catalog product goes through the static
  // demo's own checkout; a marketplace listing buys through the Worker.
  function openDealCandidate(c) {
    if (!c) return;
    if (c.kind === 'catalog') {
      var p = CATALOG.products.find(function (x) { return x.id === c.id; });
      if (p) selectProduct(p);
      return;
    }
    buyMarketplaceDeal(c);
  }
  // Buy a marketplace listing through the Worker: creates a PayPal Sandbox
  // order for the listing total (a simulation, labelled), then opens the
  // PayPal approval page, the same as the agent does.
  async function buyMarketplaceDeal(c) {
    var body = {
      marketplace: {
        marketplace: c.source || 'eBay', itemId: c.id, title: c.title,
        priceUSD: c.priceUSD, itemUrl: c.itemUrl || null, image: c.image || null,
        sellerName: c.sellerName || 'Unknown seller',
        riskScore: { score: c.riskScore, label: c.riskLabel },
      },
      totalUSD: c.totalUSD, international: true, currencyConversion: true,
    };
    try {
      var res = await fetch(WORKER_API + '/api/paypal/create-order', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      var data = await res.json();
      if (!res.ok) {
        addBubble('agent', '<p>' + escapeHtml(data.error || String(res.status)) + '</p>');
        return;
      }
      var link = c.itemUrl ? '<p><a href="' + escapeHtml(c.itemUrl) + '" target="_blank" rel="noopener">' + t('viewOnEbay') + '</a></p>' : '';
      addBubble('agent',
        '<p><strong>' + escapeHtml(c.title) + '</strong>, ' + money(data.totalUSD) + '</p>' +
        '<p>' + fmt(t('simNote'), { mp: c.source || 'eBay' }) + '</p>' + link +
        '<p><a href="' + data.approveUrl + '" target="_blank" rel="noopener">' + t('agentPayLink') + '</a></p>' +
        '<p class="hint">' + t('agentPayHint') + '</p>');
      if (data.approveUrl) window.open(data.approveUrl, '_blank', 'noopener');
    } catch (e) { addBubble('agent', '<p>' + t('agentFailed') + '</p>'); }
  }
  // Save the currently selected catalog product to the wishlist.
  async function saveSelectedToWishlist() {
    if (!selected || !selected.product) return;
    var p = selected.product;
    try {
      var res = await fetch(WORKER_API + '/api/wishlist', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: p.name, priceUSD: p.priceUSD, productId: p.id, source: 'Catalog', session: getSessionId() }),
      });
      var data = await res.json();
      addBubble('agent', '<p>' + escapeHtml(data.note || t('savedMsg')) + '</p>');
    } catch (e) { addBubble('agent', '<p>' + t('agentFailed') + '</p>'); }
  }
  // List the user's eBay price watches, with a live refresh button.
  async function listWatches() {
    try {
      var res = await fetch(WORKER_API + '/api/ebay-watch?session=' + encodeURIComponent(getSessionId()));
      var data = await res.json();
      var watches = data.watches || [];
      if (!watches.length) {
        addBubble('agent', '<p><strong>' + t('watchesTitle') + '</strong></p><p>' + t('noWatches') + '</p>');
        return;
      }
      var html = '<p><strong>' + t('watchesTitle') + '</strong></p>' +
        watches.map(function (w) {
          var badge = w.status === 'drop' ? ' <span class="score score-safe">' + t('dropBadge') + '</span>'
            : w.status === 'gone' ? ' <span class="score score-risky">' + t('goneBadge') + '</span>' : '';
          return '<p>' + escapeHtml(w.title) + badge + '<br>' +
            t('currentPrice') + ' ' + money(w.lastPriceUSD) + ' · ' + t('watchTarget') + money(w.targetUSD) + '<br>' +
            '<button type="button" class="btn-secondary" data-unwatch="' + w.id + '">' + t('removeBtn') + '</button></p>';
        }).join('') +
        '<p><button type="button" class="btn-primary" id="check-watches-btn">' + t('checkPricesBtn') + '</button></p>';
      var bubble = addBubble('agent', html);
      bubble.querySelectorAll('[data-unwatch]').forEach(function (btn) {
        btn.addEventListener('click', async function () {
          await fetch(WORKER_API + '/api/ebay-watch/delete?session=' + encodeURIComponent(getSessionId()), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: btn.getAttribute('data-unwatch') }) });
          bubble.remove();
          listWatches();
        });
      });
      var checkBtn = bubble.querySelector('#check-watches-btn');
      if (checkBtn) checkBtn.addEventListener('click', async function () {
        checkBtn.disabled = true;
        var r = await fetch(WORKER_API + '/api/ebay-watch/check?session=' + encodeURIComponent(getSessionId()), { method: 'POST' });
        var d2 = await r.json();
        bubble.remove();
        var drops = (d2.watches || []).filter(function (w) { return w.status === 'drop'; });
        var msg = drops.length
          ? drops.map(function (w) { return escapeHtml(w.note || ''); }).join('<br>')
          : t('checkedMsg');
        addBubble('agent', '<p>' + msg + '</p>');
        listWatches();
      });
    } catch (e) { addBubble('agent', '<p>' + t('agentFailed') + '</p>'); }
  }
  // List the wishlist, flagging items whose live price dropped below the
  // price they were saved at (a deal). eBay items are refreshed live.
  async function listWishlist() {
    try {
      var res = await fetch(WORKER_API + '/api/wishlist?session=' + encodeURIComponent(getSessionId()));
      var data = await res.json();
      var items = data.items || [];
      if (!items.length) {
        addBubble('agent', '<p><strong>' + t('wishlistTitle') + '</strong></p><p>' + t('noWishlist') + '</p>');
        return;
      }
      var live = {};
      try {
        var wr = await fetch(WORKER_API + '/api/ebay-watch?session=' + encodeURIComponent(getSessionId()));
        var wd = await wr.json();
        (wd.watches || []).forEach(function (w) { live[w.itemId] = w.lastPriceUSD; });
      } catch (e) { /* live refresh is a bonus */ }
      var html = '<p><strong>' + t('wishlistTitle') + '</strong></p>' +
        items.map(function (it) {
          var current = (it.itemId && live[it.itemId] !== undefined) ? live[it.itemId] : it.priceUSD;
          var isDeal = current < it.savedPriceUSD;
          var badge = isDeal ? ' <span class="score score-safe">' + t('dealBadge') + '</span>' : '';
          return '<p>' + escapeHtml(it.title) + badge + '<br>' +
            t('savedPrice') + ' ' + money(it.savedPriceUSD) + ' · ' + t('currentPrice') + ' ' + money(current) + ' · ' + escapeHtml(it.source) + '<br>' +
            '<button type="button" class="btn-secondary" data-unwish="' + it.id + '">' + t('removeBtn') + '</button></p>';
        }).join('');
      var bubble = addBubble('agent', html);
      bubble.querySelectorAll('[data-unwish]').forEach(function (btn) {
        btn.addEventListener('click', async function () {
          await fetch(WORKER_API + '/api/wishlist/delete?session=' + encodeURIComponent(getSessionId()), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: btn.getAttribute('data-unwish') }) });
          bubble.remove();
          listWishlist();
        });
      });
    } catch (e) { addBubble('agent', '<p>' + t('agentFailed') + '</p>'); }
  }

  function sendAsk() {
    var q = $('ask').value.trim();
    if (!q || sending) return;
    // Keep the keyboard open on mobile: focus the input synchronously,
    // inside the tap/keypress gesture, before the async work starts.
    $('ask').focus();
    sending = true;
    // Disable only the send button while the agent works (prevents
    // double-submit); the input stays enabled so it keeps focus, and the
    // cursor returns to it when the reply lands (see hideTyping).
    var btn = $('ask-btn');
    btn.disabled = true;
    $('ask').value = '';
    userBubble(q);
    clearSteps();
    var typing = showTyping();
    // Phishing mode: the input holds a suspicious message, not a search.
    // The live server adds an AI review; the local rule-based check is the
    // fallback when the server cannot be reached.
    if (phishingMode) {
      phishingMode = false;
      $('ask').placeholder = 'Ask ShopPal…';
      fetch(WORKER_API + '/api/phishing-check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: q, lang: lang }),
      }).then(function (res) { return res.json().then(function (ph) { return { ok: res.ok, ph: ph }; }); })
        .then(function (out) {
          hideTyping(typing);
          if (!out.ok || out.ph.error) {
            var local = checkPhishingLocal(q);
            addBubble('agent', local ? phishBubble(local) : '<p>' + t('phEmpty') + '</p>');
            return;
          }
          addBubble('agent', phishBubble(out.ph));
        })
        .catch(function () {
          hideTyping(typing);
          var local = checkPhishingLocal(q);
          addBubble('agent', local ? phishBubble(local) : '<p>' + t('phEmpty') + '</p>');
        });
      return;
    }
    // A pasted product link goes to the link checker on the live server
    // (the static demo cannot fetch other sites from the browser).
    if (/^https?:\/\/\S+/i.test(q)) {
      fetch(WORKER_API + '/api/check-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: q, lang: lang }),
      }).then(function (res) { return res.json().then(function (cl) { return { ok: res.ok, cl: cl, status: res.status }; }); })
        .then(function (out) {
          hideTyping(typing);
          var cl = out.cl;
          if (!out.ok) {
            addBubble('agent', '<p>' + fmt(t('clFailed'), { msg: cl.error || out.status }) + '</p>');
            return;
          }
          var clZone = (cl.label || 'Caution').toLowerCase();
          var clBody = '<p><strong>' + t('clTitle') + '</strong>, ' + (cl.domain || '') +
            ' · <span class="score score-' + clZone + '">' + (cl.score !== undefined ? cl.score + '/100 · ' : '') + labelText(cl.label) + '</span></p>';
          if (cl.title) clBody += '<p><strong>' + escapeHtml(cl.title) + '</strong>' +
            (cl.priceUSD ? ', ' + money(cl.priceUSD) : ' · ' + t('clNoPrice')) + '</p>';
          if (cl.image) clBody += '<p><img src="' + cl.image + '" alt="" style="width:220px;max-width:100%;aspect-ratio:4/3;object-fit:cover;border-radius:8px"></p>';
          if (cl.reasons && cl.reasons.length) {
            clBody += '<ul>' + cl.reasons.map(function (r) { return '<li>' + r + '</li>'; }).join('') + '</ul>';
          }
          if (cl.totalCost) {
            clBody += '<p><strong>' + t('honestTotal') + '</strong>, ' + money(cl.totalCost.total) + '</p>';
          }
          if (cl.note) clBody += '<p class="hint">' + cl.note + '</p>';
          addBubble('agent', clBody);
        })
        .catch(function (e) {
          hideTyping(typing);
          addBubble('agent', '<p>' + fmt(t('clFailed'), { msg: String(e && e.message || e) }) + '</p>');
        });
      return;
    }
    // "Check my budget guardrail limit": a settings question, answered from
    // local guardrail state - never a product search.
    if (isGuardrailStatus(q)) {
      hideTyping(typing);
      showGuardrailStatus();
      return;
    }
    // Best deal / compare / watches / wishlist: deterministic Worker
    // calls, answered here so the static demo shows the same features as
    // the live demo. The query words are stripped before the search.
    var lowerQ = q.toLowerCase();
    var isBestDeal = /\bbest deal\b|\bdeal terbaik\b|\bpenawaran terbaik\b|\bcheapest safe\b|\bpaling worth\b/.test(lowerQ);
    var isCompareSrc = /\bcompare\b|\bbandingkan\b|\bbanding\b/.test(lowerQ);
    var isWatches = /\bmy watches\b|\bpantauan\b|\bprice watch\b/.test(lowerQ);
    var isWishlist = /\bwishlist\b|\bmy wishlist\b/.test(lowerQ);
    if (isBestDeal || isCompareSrc || isWatches || isWishlist) {
      var dealQ = q.replace(/\b(best deal|deal terbaik|penawaran terbaik|cheapest safe|paling worth it|compare|bandingkan|banding)\b/gi, '').trim();
      if (isBestDeal) {
        fetch(WORKER_API + '/api/best-deal?' + new URLSearchParams({ q: dealQ || q, lang: lang }).toString())
          .then(function (res) { return res.json(); })
          .then(function (d) { hideTyping(typing); renderBestDeal(d); })
          .catch(function () { hideTyping(typing); addBubble('agent', '<p>' + t('agentFailed') + '</p>'); });
      } else if (isCompareSrc) {
        fetch(WORKER_API + '/api/compare?' + new URLSearchParams({ q: dealQ || q, lang: lang }).toString())
          .then(function (res) { return res.json(); })
          .then(function (d) { hideTyping(typing); renderCompare(d); })
          .catch(function () { hideTyping(typing); addBubble('agent', '<p>' + t('agentFailed') + '</p>'); });
      } else if (isWatches) {
        hideTyping(typing);
        listWatches();
      } else {
        hideTyping(typing);
        listWishlist();
      }
      return;
    }
    // Pay Agent: buying goals go to the agent on the live server.
    if (isBuyGoal(q)) {
      // The agent resolves checkout continuations ("lanjut checkout
      // bagian saya") against the active product: the split session
      // first, then the last search results. Both are sent here; the
      // server validates the IDs against the catalog before use.
      var agBody = { message: q, lang: lang, guardrails: getGuardrails() };
      if (lastResults && lastResults.length) agBody.context = lastResults.map(function (p) { return p.id; });
      if (lastSplit && lastSplit.productId) agBody.lastSplit = lastSplit;
      fetch(WORKER_API + '/api/agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(agBody),
      }).then(function (res) { return res.json().then(function (ag) { return { ok: res.ok, ag: ag, status: res.status }; }); })
        .then(function (out) {
          hideTyping(typing);
          // 403 + needsApproval is the guardrail contract, not an error:
          // render the Approve / Reject callout instead of an error bubble.
          if (!out.ok && !out.ag.needsApproval) {
            addBubble('agent', '<p>' + escapeHtml(out.ag.error || String(out.status)) + '</p>');
            return;
          }
          renderAgentResult(out.ag, q);
        })
        .catch(function () {
          hideTyping(typing);
          addBubble('agent', '<p>' + t('agentFailed') + '</p>');
        });
      return;
    }
    // Local Ask: the search is instant, so a short delay lets the
    // skeleton loader show (it replaces the typing dots here, since it
    // previews the results layout). Removed as soon as results render.
    // The typing element is removed directly (not via hideTyping) so the
    // composer stays disabled until the results are in.
    if (typing && typing.remove) typing.remove();
    var skelId = showSkeletonLoader(chatEl);
    setTimeout(function () {
      removeSkeletonLoader(skelId);
      hideTyping(typing);
      var parsed = parseAsk(q, lastResults);
      var products = parsed.products;
      lastResults = products;
      saveChatContext();
      // "yang pertama" picks the first result shown, go straight to it.
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
      var resultsBubble = addBubble('agent',
        '<p>' + t('understood') + ' ' + (understood.length ? understood.join(', ') : t('noCategory')) +
        ', ' + u.note + '</p>' +
        '<div class="cards"></div>');
      renderCatalogInto(resultsBubble.querySelector('.cards'), products);
    }, 500);
  }

  function selectProduct(product) {
    var seller = sellerOf(product);
    selected = { product: product, seller: seller, risk: calculateRiskScore(seller, product), cost: null };
    clearSteps();
    userBubble(product.name + ', ' + money(product.priceUSD));
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
    var bubble = addBubble('agent',
      '<div class="feature-head"><span class="feature-title">' + t('riskScore') + '</span></div>' +
      '<p><strong>' + selected.seller.name + '</strong></p>' +
      '<div class="feature-metric">' + r.score + '<span class="feature-metric-sub">/100</span> <span class="score score-' + zone + '">' + labelText(r.label) + '</span></div>' +
      '<ul>' + r.reasons.map(function (reason) { return '<li>' + reason + '</li>'; }).join('') + '</ul>' +
      '<p><strong>' + t('recommendation') + '</strong> ' + r.recommendation + '</p>' +
      extra +
      '<p class="hint">Profile ' + r.components.profile + ' · History ' + r.components.history +
      ' · Price ' + r.components.price + ' · Tracking ' + r.components.tracking + ' · ' + r.aiNote + '</p>' +
      '<p><button id="pre-sim-btn" type="button">' + t('simBtn') + '</button></p>' +
      '<div id="pre-sim" class="card hidden"></div>' +
      '<p class="set-row"><input id="pw-target" type="number" min="1" step="0.01" placeholder="' + t('pwTarget') + '"> ' +
      '<button id="pw-watch-btn" type="button" class="btn-secondary">' + t('pwWatch') + '</button> <span id="pw-status"></span></p>' +
      '<p class="hint">' + t('pwSimNote') + '</p>',
      'risk');
    // Price Watch creation (via the Worker).
    $('pw-watch-btn').addEventListener('click', async function () {
      var target = Number($('pw-target').value);
      var st = $('pw-status');
      if (!target || target <= 0) { if (st) st.textContent = t('pwTarget'); return; }
      try {
        var res = await fetch(WORKER_API + '/api/price-watch', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ productId: selected.product.id, targetPrice: target, lang: lang }) });
        var d = await res.json();
        if (st) st.textContent = res.ok ? (t('pwWatching') + ': ' + money(d.currentPrice) + ' → ' + money(d.targetPrice)) : (d.error || res.status);
      } catch (e) { if (st) st.textContent = String(e && e.message || e); }
    });
    // Pre-purchase dispute simulation (rule-based, local, no server).
    $('pre-sim-btn').addEventListener('click', function () {
      var box = $('pre-sim');
      if (!box) return;
      box.classList.remove('hidden');
      var d = simulateLocal({ sellerId: selected.seller.id, productId: selected.product.id });
      if (d.error) {
        box.textContent = fmt(t('simFailed'), { msg: d.error });
        return;
      }
      box.innerHTML = renderSimHtml(d);
      wireSimCopy(box, d);
      scrollChat();
    });
  }

  function showHold() {
    var h = calculateHoldRisk(selected.seller, selected.product);
    var zone = h.label === 'Low' ? 'safe' : h.label === 'Moderate' ? 'caution' : 'risky';
    var bubble = addBubble('agent',
      '<div class="feature-head"><span class="feature-title">' + t('holdTitle') + '</span></div>' +
      '<p><span class="score score-' + zone + '">' + holdLabelText(h.label) + ' · ' + h.chance + '</span></p>' +
      '<ul>' + h.reasons.map(function (reason) { return '<li>' + reason + '</li>'; }).join('') + '</ul>' +
      '<p>' + h.tip + '</p>' +
      '<p class="hint">' + t('holdHint') + '</p>' +
      '<p><button id="hrc-btn" type="button">' + t('hrcBtn') + '</button></p>' +
      '<div id="hrc-box" class="card hidden"></div>',
      'hold');
    // Hold Release Checklist (rule-based, local, no server).
    $('hrc-btn').addEventListener('click', function () {
      var box = $('hrc-box');
      if (!box) return;
      box.classList.remove('hidden');
      var d = buildHoldChecklistLocal(selected.seller, selected.product);
      if (!d) {
        box.textContent = t('hrcNotFound');
        return;
      }
      renderHoldChecklist(box, d);
      scrollChat();
    });
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
        var res = await fetch(WORKER_API + '/api/fx-compare', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ amountUSD: totalUSD, currency: cur, lang: lang }) });
        var d = await res.json();
        if (!res.ok || !d.rate) { if (out) out.textContent = t('fxUnavailable'); return; }
        if (out) out.innerHTML = t('fxMidRate') + ': ' + d.rate + ' · ' + t('fxPaypalTotal') + ': ' + d.paypalTotal.toLocaleString() + ' ' + d.currency + (d.live ? '' : ' (' + t('fxUnavailable') + ')');
      } catch (e) { if (out) out.textContent = t('fxUnavailable'); }
    };
    box.querySelector('#fx-cur').addEventListener('change', run);
    run();
  }
  function showCost() {
    selected.cost = calculateTotalCost(selected.product.priceUSD, true, true);
    var c = selected.cost;
    var tc = TROUBLE_COSTS;
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
      '<li>' + fmt(t('chargeback'), { n: tc.chargebackUSD }) + '</li>' +
      '<li>' + fmt(t('disputeFee'), { a: tc.disputeStandardUSD, b: tc.disputeHighVolumeUSD }) + '</li>' +
      '<li>' + t('refundLine') + '</li>' +
      '<li>' + fmt(t('instantLine'), { pct: tc.instantTransferPct, min: tc.instantTransferMinUSD }) + '</li>' +
      '<li>' + refundLine + '</li>' +
      '</ul>' +
      '<p><strong>' + t('protectionLabel') + '</strong> ' + t('protection') + '</p>' +
      '<p class="hint">' + t('troubleNote') + '</p></div>',
      'cost');
    // Import cost for the selected destination country (local estimate).
    renderFx(c.total, 'fx-box');
    $('import-country').addEventListener('change', function () {
      var box = $('import-cost');
      if (!box) return;
      var country = this.value;
      if (!country) {
        box.innerHTML = '';
        return;
      }
      var d = calculateImportCostLocal(selected.product.priceUSD, country);
      if (!d) {
        box.textContent = t('impNotFound');
        return;
      }
      box.innerHTML = '<table>' +
        '<tr><td>' + fmt(t('impDuty'), { rate: d.dutyRate }) + '</td><td>' + money(d.duty) + '</td></tr>' +
        '<tr><td>' + fmt(t('impVat'), { rate: d.vatRate }) + ' (' + d.vatLabel + ')</td><td>' + money(d.vat) + '</td></tr>' +
        '<tr><td><strong>' + t('impTitle') + '</strong></td><td><strong>' + money(d.total) + '</strong></td></tr>' +
        '<tr class="total-row"><td><strong>' + t('totalEst') + ' + import</strong></td><td><strong>' + money(c.total + d.total) + '</strong></td></tr>' +
        '</table>' +
        '<p class="hint">' + t('impNote') + '</p>';
      scrollChat();
    });
  }

  function showCheckout() {
    var bubble = addBubble('agent',
      '<p><strong>' + t('readyToPay') + '</strong> ' + t('neverPay') + '</p>' +
      '<div id="budget-warn"></div>' +
      '<p><label><input id="approve" type="checkbox"> ' + t('approveLabel') + '</label></p>' +
      '<div id="paypal-button-container"></div>' +
      '<p><button id="save-wishlist-btn" type="button" class="btn-secondary">' + t('saveBtn') + '</button></p>' +
      '<p id="checkout-status"></p>' +
      '<p class="hint">' + t('checkoutHint') + ' <a href="https://developer.paypal.com/dashboard/accounts" target="_blank" rel="noopener">PayPal Sandbox Personal (buyer)</a></p>',
      'checkout');
    // Monthly budget warning from the local vault (this browser).
    var budget = getBudget();
    if (budget) {
      var entries = loadVault();
      var spent = monthSpend(entries);
      var total = selected && selected.cost ? selected.cost.total : (selected ? selected.product.priceUSD : 0);
      var warn = $('budget-warn');
      if (warn && spent + total > budget) {
        warn.innerHTML = '<p><strong>' + fmt(t('budWarn'), { spent: money(spent), budget: money(budget) }) + '</strong></p>';
      }
    }
    var approve = $('approve');
    approve.addEventListener('change', function () { renderPayPalButton(); });
    var saveBtn = $('save-wishlist-btn');
    if (saveBtn) saveBtn.addEventListener('click', saveSelectedToWishlist);
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
            description: product.name + ', ShopPal v2 demo (PayPal Sandbox)',
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
        // Smart Guardrails: the buyer approved in PayPal, but the agent
        // only captures when the purchase is under the user's rules.
        var doSdkCapture = function () {
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
        };
        var chk = checkGuardrailsLocal(total, product.category);
        if (!chk.needsApproval) return doSdkCapture();
        return new Promise(function (resolve) {
          var ab = addBubble('agent',
            '<p><strong>' + t('grNeedApproval') + '</strong></p>' +
            '<p>' + money(total) + ' · ' + product.category + '</p>' +
            '<ul>' + chk.reasons.map(function (r) { return '<li>' + r + '</li>'; }).join('') + '</ul>' +
            '<p><button id="gr-approve" type="button">' + t('grApprove') + '</button> ' +
            '<button id="gr-reject" type="button" class="btn-secondary">' + t('grReject') + '</button></p>');
          ab.querySelector('#gr-approve').addEventListener('click', function () {
            ab.querySelector('#gr-approve').disabled = true;
            ab.querySelector('#gr-reject').disabled = true;
            addBubble('agent', '<p>' + t('grApproved') + '</p>');
            resolve(doSdkCapture());
          });
          ab.querySelector('#gr-reject').addEventListener('click', function () {
            ab.querySelector('#gr-approve').disabled = true;
            ab.querySelector('#gr-reject').disabled = true;
            addBubble('agent', '<p>' + t('grRejected') + '</p>');
            resolve();
          });
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
  function showVault() {
    // The vault lives in its own modal now, not in the chat: render into
    // the modal body (hidden until the user opens it) and keep the header
    // badge in sync.
    var box = $('vault-body');
    if (!box) return;
    var entries = loadVault();
    var body = '';
    if (!entries.length) {
      body = '<p>' + t('vaultEmpty') + '</p>';
    } else {
      lastVaultId = entries[0].id;
      body = entries.map(function (e) {
        return '<p><strong>' + escapeHtml(e.product && e.product.name || e.id) + '</strong>, ' +
          escapeHtml(e.paypal && e.paypal.status || 'unknown') + ' · Order ' + escapeHtml(e.paypal && e.paypal.orderId || 'n/a') + '</p>';
      }).join('');
    }
    var vc = $('vault-count');
    if (vc) {
      vc.textContent = String(entries.length);
      vc.classList.toggle('hidden', entries.length === 0);
    }
    var patterns = findSubscriptions(entries);
    var subs = '';
    if (!patterns.length) {
      subs = '<p><strong>' + t('subsTitle') + '</strong></p><p>' + t('subsEmpty') + '</p>';
    } else {
      subs = '<p><strong>' + t('subsTitle') + '</strong>, ' + t('subsFound') + '</p>' +
        patterns.map(function (p) {
          return '<p>' + fmt(t('subsLine'), { name: p.productName, n: p.purchases, total: money(p.totalSpent), date: p.lastPurchase ? p.lastPurchase.slice(0, 10) : 'n/a' }) + '</p>';
        }).join('');
    }
    var budget = getBudget();
    var spent = monthSpend(entries);
    var gr = getGuardrails();
    var setHtml = '<div class="card"><p><strong>' + t('vaultLimitsTitle') + '</strong></p>' +
      '<p>' + (budget
        ? fmt(t('budSpent'), { spent: money(spent), budget: money(budget), pct: Math.round(spent / budget * 100) }) + ' ' +
          (spent > budget ? fmt(t('budOver'), { over: money(spent - budget) }) : fmt(t('budLeft'), { left: money(Math.round((budget - spent) * 100) / 100) }))
        : t('budNoBudget')) + '</p>' +
      '<p>' + fmt(t('setGrSummary'), { limit: money(gr.autoApproveLimit) }) + '</p>' +
      '<p><button id="vault-settings" type="button" class="btn-secondary">' + t('setOpen') + '</button></p></div>';
    var dwHtml = '<div class="card" id="dw-card"><p><strong>' + t('dwTitle') + '</strong></p><p class="hint">' + t('dwIntro') + '</p><p id="dw-body">…</p></div>';
    box.innerHTML =
      '<p class="hint">' + t('vaultIntro') + '</p>' + body +
      '<div class="card" id="sample-proof-card"><p><strong>' + t('sampleTitle') + '</strong> <span class="score score-safe">SAMPLE</span></p>' +
      '<p class="hint">' + t('sampleHint') + '</p>' +
      '<p><button id="sample-proof-btn" type="button" class="btn-secondary">' + t('sampleView') + '</button></p>' +
      '<div id="sample-proof-body" class="hidden"></div></div>' +
      '<div class="card">' + subs + '</div>' +
      setHtml +
      dwHtml +
      '<div class="card" id="ex-card"><p><strong>' + t('exTitle') + '</strong></p><p id="ex-body">…</p></div>' +
      '<div class="card" id="pw-card"><p><strong>' + t('pwTitle') + '</strong></p><p class="hint">' + t('pwIntro') + '</p><p id="pw-body">…</p></div>' +
      '<div class="card" id="sb-card"><p><strong>' + t('sbTitle') + '</strong></p><p class="hint">' + t('sbIntro') + '</p><p id="sb-body"></p></div>' +
      '<div class="vault-actions"><button id="vault-refresh" type="button" class="btn-secondary">' + t('refreshVault') + '</button> ' +
      '<button id="dispute-btn" type="button" class="btn-secondary"' + (entries.length ? '' : ' disabled') + '>' + t('disputeBtn') + '</button> ' +
      '<button id="sim-btn" type="button" class="btn-secondary"' + (entries.length ? '' : ' disabled') + '>' + t('simBtn') + '</button> ' +
      '<button id="evidence-btn" type="button" class="btn-secondary"' + (entries.length ? '' : ' disabled') + '>' + t('evBtn') + '</button> ' +
      '<button id="deadlines-btn" type="button" class="btn-secondary"' + (entries.length ? '' : ' disabled') + '>' + t('dlBtn') + '</button> ' +
      '<button id="refund-btn" type="button" class="btn-secondary"' + (entries.length ? '' : ' disabled') + '>' + t('refundBtn') + '</button> ' +
      '<button id="order-status-btn" type="button" class="btn-secondary"' + (entries.length ? '' : ' disabled') + '>' + t('orderStatusBtn') + '</button></div>' +
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
    // Delivery Watch (local mirror: overdue = 7+ days, no DELIVERED update).
    (function renderDwLocal() {
      var box = $('dw-body');
      if (!box) return;
      var entries = loadVault();
      if (!entries.length) { box.innerHTML = '<p>' + t('dwNoOrders') + '</p>'; return; }
      var now = Date.now();
      box.innerHTML = entries.slice(0, 3).map(function (e) {
        var bought = new Date((e.paypal && e.paypal.createTime) || e.createdAt || Date.now()).getTime();
        var days = Math.max(0, Math.floor((now - bought) / 86400000));
        var status = (e.tracking && e.tracking.status) || 'NO_TRACKER';
        var overdue = status !== 'DELIVERED' && days >= 7;
        var line = '<p><strong>' + (e.product && e.product.name || e.id) + '</strong> · ' + fmt(t('dwStatus'), { status: status }) + ', ' +
          (overdue ? fmt(t('dwOverdue'), { n: days }) : fmt(t('dwOnTime'), { n: days })) + '</p>';
        if (overdue) {
          var sim = simulateLocal({ vaultId: e.id, disputeType: 'not_received' });
          if (sim) line += '<p>' + t('dwDraftReady') + ' ' + t('simWinChance') + ': ' + sim.winChance + '%</p>';
        }
        return line;
      }).join('');
    })();
    // Expense dashboard (local vault totals by category).
    (function renderExLocal() {
      var box = $('ex-body');
      if (!box) return;
      var entries = loadVault();
      if (!entries.length) { box.innerHTML = '<p>' + t('exEmpty') + '</p>'; return; }
      var byCat = {};
      var total = 0;
      var now = new Date();
      var ym = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
      var monthTotal = 0;
      entries.forEach(function (e) {
        var amt = Number((e.totalCost && e.totalCost.total) || (e.product && e.product.priceUSD) || 0);
        var cat = (e.product && e.product.category) || 'Other';
        total += amt;
        var d = ((e.createdAt || (e.paypal && e.paypal.createTime) || '')).slice(0, 7);
        if (d === ym) monthTotal += amt;
        if (!byCat[cat]) byCat[cat] = { total: 0, count: 0 };
        byCat[cat].total += amt;
        byCat[cat].count++;
      });
      var rows = Object.keys(byCat).map(function (k) { return { category: k, total: byCat[k].total, count: byCat[k].count }; }).sort(function (a, b) { return b.total - a.total; });
      var max = Math.max.apply(null, rows.map(function (r) { return r.total; }).concat([1]));
      box.innerHTML = '<p><strong>' + t('exTotal') + ': ' + money(total) + '</strong> (' + money(monthTotal) + ' ' + t('exThisMonth') + ')</p>' +
        rows.map(function (r) {
          var pct = Math.round(r.total / max * 100);
          return '<p>' + r.category + ' · ' + money(r.total) + ' (' + r.count + ')</p><div style="background:#e5e5e5;border-radius:4px;height:8px"><div style="background:#111111;border-radius:4px;height:8px;width:' + pct + '%"></div></div>';
        }).join('');
    })();
    // Price Watch list via the Worker (simulated feed, labelled).
    var renderPw = async function () {
      var box = $('pw-body');
      if (!box) return;
      try {
        var pres = await fetch(WORKER_API + '/api/price-watches');
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
            await fetch(WORKER_API + '/api/price-watch/check', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ watchId: b.getAttribute('data-watch') }) });
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
    // Split Bill via the Worker (shares + message).
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
        if (selected && selected.product) body.productId = selected.product.id;
        try {
          var res = await fetch(WORKER_API + '/api/split-bill', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
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
              var r2 = await fetch(WORKER_API + '/api/split-payment-link', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
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
    $('dispute-btn').addEventListener('click', function () { showDisputeDraft(); });
    // Dispute simulation for the latest vault entry (rule-based, local).
    $('sim-btn').addEventListener('click', function () {
      if (!lastVaultId) return;
      var box = $('vault-tools');
      if (!box) return;
      box.classList.remove('hidden');
      var d = simulateLocal({ vaultId: lastVaultId });
      if (d.error) {
        box.textContent = fmt(t('simFailed'), { msg: d.error });
        return;
      }
      box.innerHTML = renderSimHtml(d);
      wireSimCopy(box, d);
      scrollChat();
    });
    // Evidence Pack: download a printable proof page built locally.
    $('evidence-btn').addEventListener('click', function () {
      if (!lastVaultId) return;
      var entry = loadVault().find(function (e) { return e.id === lastVaultId; });
      var box = $('vault-tools');
      if (!entry) {
        if (box) {
          box.classList.remove('hidden');
          box.textContent = fmt(t('evFailed'), { msg: t('disputeNotFound') });
        }
        return;
      }
      var blob = new Blob([evidenceHtmlLocal(entry)], { type: 'text/html' });
      var url = URL.createObjectURL(blob);
      window.open(url, '_blank', 'noopener');
      setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
    });
    // Deadline Tracker: 180-day filing + 20-day escalation + 30-day return.
    $('deadlines-btn').addEventListener('click', function () {
      if (!lastVaultId) return;
      var box = $('vault-tools');
      if (!box) return;
      box.classList.remove('hidden');
      var entry = loadVault().find(function (e) { return e.id === lastVaultId; });
      if (!entry) {
        box.textContent = fmt(t('dlFailed'), { msg: t('disputeNotFound') });
        return;
      }
      var deadlines = calculateDeadlinesLocal(
        entry.paypal && entry.paypal.createTime || entry.createdAt,
        !!(entry.seller && entry.seller.returnPolicy),
        entry.disputeDraftAt || null
      );
      box.innerHTML = renderDeadlinesHtml(deadlines);
      scrollChat();
    });
    // Refund the latest vault entry (full amount, PayPal Sandbox) via the
    // deployed Worker. Two clicks: the first arms the button.
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
      box.innerHTML = '<p><strong>' + t('refundTitle') + '</strong>, ' +
        fmt(t('refundSuccess'), { id: d.refundId || 'n/a', status: d.status || 'n/a', amount: money(d.amount) }) + '</p>';
      showVault();
      scrollChat();
    });
    // Live order status, re-verified with PayPal via the Worker.
    $('order-status-btn').addEventListener('click', async function () {
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
        '<p>Order ' + (d.orderId || 'n/a') + ', ' + (d.orderStatus || 'n/a') +
        ' · Capture ' + (d.captureId || 'n/a') + ', ' + (d.captureStatus || 'n/a') +
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
    // The draft date starts the 20-day escalation clock for the tracker.
    if (!entry.disputeDraftAt) {
      entry.disputeDraftAt = new Date().toISOString();
      var all = loadVault();
      var i = all.findIndex(function (e) { return e.id === lastVaultId; });
      if (i >= 0) {
        all[i].disputeDraftAt = entry.disputeDraftAt;
        try { localStorage.setItem(VAULT_KEY, JSON.stringify(all)); } catch (e) { /* storage unavailable */ }
      }
    }
    var missing = [];
    if (!entry.paypal || !entry.paypal.captureId) missing.push('capture ID');
    if (!entry.seller || !entry.seller.tracking) missing.push('tracking proof');
    var readiness = missing.length === 0 ? 100 : 70;
    box.innerHTML =
      '<p><strong>' + t('disputeTitle') + '</strong>, ' + fmt(t('disputeReadiness'), { n: readiness }) + '</p>' +
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
    setupChatHistoryObserver();
    $('ask-btn').addEventListener('click', sendAsk);
    $('ask').addEventListener('keydown', function (e) {
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
    document.querySelectorAll('.quick-chip, .feature-chip, .nav-btn[data-prompt]').forEach(function (chip) {
      chip.addEventListener('click', function () {
        var prompt = chip.getAttribute('data-prompt') || '';
        if (!prompt) return;
        $('ask').value = prompt;
        sendAsk();
      });
    });
    // Bottom navigation (mobile): Chat focuses the composer and scrolls
    // to the latest message; the other buttons send their prompt like
    // the Try chips. The tapped button becomes the active one.
    document.querySelectorAll('.nav-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        document.querySelectorAll('.nav-btn').forEach(function (b) { b.classList.remove('active'); b.removeAttribute('aria-current'); });
        btn.classList.add('active');
        btn.setAttribute('aria-current', 'page');
        if (btn.getAttribute('data-nav') === 'chat') {
          var input = $('ask');
          if (input) input.focus();
          var chatBox = $('chat');
          if (chatBox) chatBox.scrollTop = chatBox.scrollHeight;
        }
      });
    });
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
      var buyBtn = e.target.closest('.card-buy');
      if (buyBtn && !buyBtn._wired) {
        var pid = buyBtn.getAttribute('data-buy');
        if (pid && CATALOG) {
          var bp = CATALOG.products.find(function (x) { return x.id === pid; });
          if (bp) buyProduct(bp);
        }
        return;
      }
      var card = e.target.closest('.product-card');
      if (!card || card._wired) return;
      var pid = card.getAttribute('data-product');
      if (pid && CATALOG) {
        var p = CATALOG.products.find(function (x) { return x.id === pid; });
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
      }
    });
    greet();
    showVault();
    loadHealth();
    if (!window.paypal) {
      addBubble('agent', '<p class="hint">' + t('sdkNotLoaded') + '</p>');
    }
  });

  // Health badge: fetch /api/health from the live server once on load and
  // show the server, PayPal Sandbox and guardrail status in the header.
  async function loadHealth() {
    var badge = $('health-badge');
    var sideStatus = $('side-health');
    var sideGuard = $('side-guardrail');
    try {
      var t0 = performance.now();
      const res = await fetch(WORKER_API + '/api/health');
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
})();
