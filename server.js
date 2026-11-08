// ShopPal v2 — PayPal AI Hackathon. Sandbox only, no real money.
// Express + static frontend. PayPal: JS SDK (client) + REST API (server).
// AI: one server function (Vyce API / DeepSeek) that rewrites the
// rule-based risk reasons in plain language; it never changes the score.
// Secrets come from env vars only. Nothing secret is logged or returned
// to the browser — the PayPal Client ID is the only credential the
// browser ever sees (via /api/config).

require('dotenv').config();
const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
// Behind Render / any proxy, req.protocol and req.get('host') must reflect
// the public URL — needed for the PayPal return/cancel URLs.
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

// AI explanations. The rule-based reasons come first (deterministic,
// auditable). If VYCE_API_KEY is set, the Vyce API (default model
// deepseek-v4.1) rewrites them in plain language only. No key, or a
// failed call, falls back to the rule-based reasons.
async function explainScore(components, label) {
  // Rule-based explanation — deterministic, auditable, works offline.
  const reasons = [];
  if (components.profile < 60) {
    reasons.push('This seller account is new or its profile is incomplete.');
  } else {
    reasons.push('This seller has an established, complete profile.');
  }
  if (components.history < 60) {
    reasons.push('This seller has a high dispute rate compared with other sellers.');
  } else {
    reasons.push('This seller has a low dispute rate across many transactions.');
  }
  if (components.price < 60) {
    reasons.push('This price is far below the category median — a common scam pattern.');
  } else if (components.tracking < 60) {
    reasons.push('This seller does not offer tracking or a clear return policy.');
  } else {
    reasons.push('The price is fair for this category, with tracking and returns offered.');
  }
  const recommendation =
    label === 'Safe'
      ? 'Safe to proceed with PayPal Goods & Services.'
      : label === 'Caution'
        ? 'Proceed with caution. Use PayPal Goods & Services — never Friends & Family.'
        : 'Risky. Consider an alternative seller before paying.';
  const fallback = {
    reasons: reasons.slice(0, 3),
    recommendation,
    aiAvailable: false,
    aiNote: 'AI explanation unavailable — showing rule-based reasons.',
  };
  const apiKey = process.env.VYCE_API_KEY;
  if (!apiKey) return fallback;
  const baseUrl = (process.env.VYCE_API_BASE || 'https://vyceai.com/v1').replace(/\/$/, '');
  const model = process.env.VYCE_MODEL || 'deepseek-v4.1';
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
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
              'Return exactly 3 lines, one reason per line, no numbering, no extra text.',
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
      aiNote: 'Explanation rewritten by AI (Vyce); the numeric score is rule-based and unchanged.',
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
function scoreMarketplaceListing(listing, allListings) {
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
      ? 'This marketplace does not share this seller’s feedback percentage.'
      : fb >= 99
        ? 'This seller has ' + fb + '% positive feedback on eBay.'
        : 'This seller has ' + fb + '% positive feedback on eBay — below the 99%+ that careful buyers look for.'
  );
  reasons.push(
    price < 60
      ? 'This price is far below the median of this search — a common scam pattern.'
      : 'This price is close to the median of this search.'
  );
  reasons.push(
    listing.returnsAccepted
      ? 'The listing accepts returns.'
      : 'The listing does not say it accepts returns.'
  );
  const saferThan = (allListings || []).filter(
    (l) => l !== listing && scoreMarketplaceListingShallow(l, allListings) < total
  ).length;
  const warning =
    price < 60 && (fb === null || fb < 98)
      ? 'Too-good-to-be-true pattern: a price far below the median from a seller without strong feedback. This is the most common scam shape.'
      : null;
  const checklist =
    label === 'Safe'
      ? [
          'Pay with PayPal Goods & Services (not Friends & Family).',
          'Save the tracking number when the seller ships.',
          'Keep the Proof Vault entry — it is saved automatically.',
        ]
      : label === 'Caution'
        ? [
            'Pay only with PayPal Goods & Services.',
            'Ask the seller for tracking before the money clears.',
            'If the seller asks you to pay outside the marketplace, stop — that voids Buyer Protection.',
          ]
        : [
            'Do not pay this seller if you can avoid it.',
            'If you still proceed, use Goods & Services only — never Friends & Family.',
            'Screenshot the listing before paying; you will need it for a dispute.',
          ];
  return {
    score: total,
    label,
    components,
    reasons: reasons.slice(0, 3),
    recommendation:
      label === 'Safe'
        ? 'Safe to proceed with PayPal Goods & Services.'
        : label === 'Caution'
          ? 'Proceed with caution. Use PayPal Goods & Services — never Friends & Family.'
          : 'Risky. Consider another listing before paying.',
    comparison: 'Safer than ' + saferThan + ' of ' + (allListings || []).length + ' listings in this search.',
    warning,
    checklist,
    aiAvailable: false,
    aiNote: 'Marketplace scores use marketplace signals; account age is not shared by eBay, so it scores neutral.',
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
function holdRiskForMarketplaceListing(listing, allListings) {
  const fb = listing.sellerFeedbackPercentage;
  let points = 0;
  const reasons = [];
  if (fb === null || fb === undefined) {
    points += 10;
    reasons.push('No feedback percentage shared for this seller.');
  } else if (fb < 98) {
    points += 40;
    reasons.push('Seller feedback is ' + fb + '% — below 98%.');
  } else if (fb < 99) {
    points += 25;
    reasons.push('Seller feedback is ' + fb + '% — below 99%.');
  } else if (fb < 99.5) {
    points += 10;
    reasons.push('Seller feedback is ' + fb + '%.');
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
      reasons.push('Price is 50% or more below the median of this search.');
    } else if (below >= 0.2) {
      points += 5;
      reasons.push('Price is notably below the median of this search.');
    }
  }
  if (!listing.returnsAccepted) {
    points += 5;
    reasons.push('No returns accepted, so a dispute is harder to win.');
  }
  const score = Math.min(points, 100);
  const label = score < 25 ? 'Low' : score < 60 ? 'Moderate' : 'High';
  return {
    score,
    label,
    chance: (label === 'Low' ? 'under 5%' : label === 'Moderate' ? '5–20%' : 'over 20%') + ' (estimate)',
    reasons: reasons.length ? reasons : ['No hold-risk signals in this listing.'],
    tip:
      label === 'Low'
        ? 'Funds usually clear on the normal schedule for this pattern.'
        : 'Ask the seller to upload tracking promptly, and keep the order total close to the seller’s usual range.',
  };
}

// Total Cost. Public rates: PayPal Checkout 3.49% + $0.49, international
// 1.5%, conversion spread ~3.5% (estimate).
function calculateTotalCost(priceUSD, international, currencyConversion) {
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
    troubleCosts: TROUBLE_COSTS,
    note: 'Estimated fees. PayPal Checkout 3.49% + $0.49, international 1.5%, conversion spread ~3.5%.',
  };
}

// Hold Predictor. Rule-based estimate of how likely PayPal is to hold
// this seller's funds, from public hold patterns (new account, high
// dispute rate, few transactions, price far below median, no tracking).
// This is an estimate from patterns, not a PayPal decision.
function calculateHoldRisk(seller, product) {
  const reasons = [];
  let points = 0;
  if (seller.disputeRate >= 5) { points += 40; reasons.push('Dispute rate is very high (' + seller.disputeRate + '%).'); }
  else if (seller.disputeRate >= 2) { points += 25; reasons.push('Dispute rate is above average (' + seller.disputeRate + '%).'); }
  else if (seller.disputeRate >= 1) { points += 10; reasons.push('Dispute rate is slightly above 1%.'); }
  if (seller.accountAgeYears < 0.5) { points += 25; reasons.push('Seller account is less than 6 months old.'); }
  else if (seller.accountAgeYears < 1.5) { points += 15; reasons.push('Seller account is less than 18 months old.'); }
  else if (seller.accountAgeYears < 3) { points += 5; reasons.push('Seller account is less than 3 years old.'); }
  if (seller.totalTransactions < 50) { points += 15; reasons.push('Very few completed transactions (' + seller.totalTransactions + ').'); }
  else if (seller.totalTransactions < 1000) { points += 5; reasons.push('Relatively few completed transactions.'); }
  const median = product.referencePriceUSD;
  if (median && median > 0) {
    const below = 1 - product.priceUSD / median;
    if (below >= 0.5) { points += 15; reasons.push('Price is 50% or more below the category median.'); }
    else if (below >= 0.2) { points += 5; reasons.push('Price is notably below the category median.'); }
  }
  if (!seller.hasTracking) { points += 5; reasons.push('No tracking offered, so delivery is harder to prove.'); }
  const score = Math.min(points, 100);
  const label = score < 25 ? 'Low' : score < 60 ? 'Moderate' : 'High';
  const chance = label === 'Low' ? 'under 5%' : label === 'Moderate' ? '5–20%' : 'over 20%';
  return {
    score,
    label,
    chance: chance + ' (estimate)',
    reasons: reasons.length ? reasons : ['No hold-risk signals in this seller pattern.'],
    tip: label === 'Low'
      ? 'Funds usually clear on the normal schedule for this pattern.'
      : 'Ask the seller to upload tracking promptly, and keep the order total close to the seller’s usual range.',
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
function applyIntent(intent, contextProducts) {
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
    ? 'No exact match in the demo catalog — showing all 10 demo products.'
    : intent.cheapest
      ? 'Matches sorted cheapest first.'
      : intent.best
        ? 'Best match first (safest, then cheapest).'
        : 'Matches sorted safest first.';
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
function parseAsk(query, contextProducts) {
  return applyIntent(parseAskRegex(query), contextProducts);
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
    const timer = setTimeout(() => controller.abort(), 8000);
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
              '"terbaik"/"rekomendasi" means best=true. "yang pertama" means selectFirst=true — the buyer wants the first result shown before.',
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
function riskExtras(seller, product, score, label, components) {
  const saferThan = catalog.products.filter(
    (p) => calculateRiskScore(sellersById.get(p.sellerId), p).score < score
  ).length;
  const comparison = 'Safer than ' + saferThan + ' of ' + catalog.products.length + ' demo listings.';
  const warning =
    components.price < 60 && (seller.disputeRate >= 2 || label === 'Risky')
      ? 'Too-good-to-be-true pattern: a price far below the median from a seller with a high dispute rate. This is the most common scam shape in the demo.'
      : null;
  const checklist =
    label === 'Safe'
      ? [
          'Pay with PayPal Goods & Services (not Friends & Family).',
          'Save the tracking number when the seller ships.',
          'Keep the Proof Vault entry — it is saved automatically.',
        ]
      : label === 'Caution'
        ? [
            'Pay only with PayPal Goods & Services.',
            'Ask the seller for tracking before the money clears.',
            'If the seller asks you to pay outside PayPal, stop — that voids Buyer Protection.',
          ]
        : [
            'Do not pay this seller if you can avoid it.',
            'If you still proceed, use Goods & Services only — never Friends & Family.',
            'Screenshot the listing and the chat before paying; you will need them for a dispute.',
          ];
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
// schedule, Oct 2026). Estimates — the exact fee depends on the account.
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
  res.json({ status: 'ok', service: 'shoppal-v2', mode: PAYPAL_MODE });
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
  const explanation = await explainScore(components, label);
  const extras = riskExtras(seller, product, score, label, components);
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
  try {
    const breakdown = calculateTotalCost(
      priceUSD,
      international !== false,
      currencyConversion !== false
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
    ...calculateHoldRisk(seller, product),
  });
});

app.get('/api/ask', async (req, res) => {
  const q = req.query.q || '';
  // Follow-up context: the product IDs the chat last showed, so "yang
  // termurah" / "yang pertama" can refer to them.
  const ctxIds = String(req.query.context || '').split(',').filter(Boolean);
  const ctxProducts = ctxIds
    .map((id) => productsById.get(id))
    .filter(Boolean);
  // AI first when the Vyce key is set; regex fallback otherwise.
  const aiIntent = await parseAskWithVyce(q);
  const intent = aiIntent || parseAskRegex(q);
  const result = applyIntent(intent, ctxProducts);
  res.json({
    query: q,
    understood: { ...result.understood, aiParsed: Boolean(aiIntent) },
    products: result.products,
    selectFirst: result.selectFirst,
  });
});

// Real marketplace search (eBay Browse API). Returns real listings with a
// ShopPal risk score attached. Without eBay keys it says so plainly and
// returns no listings — the UI then shows the demo catalog only.
app.get('/api/marketplace/search', async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) return res.status(400).json({ error: 'q is required.' });
  if (!ebay.isConfigured()) {
    return res.json({
      configured: false,
      source: null,
      listings: [],
      note: 'Real marketplace search needs free eBay developer keys. Add EBAY_APP_ID and EBAY_CERT_ID to .env (developer.ebay.com) — no keys, no real listings.',
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
      risk: scoreMarketplaceListing(l, listings),
      holdRisk: holdRiskForMarketplaceListing(l, listings),
    }));
    res.json({
      configured: true,
      source: 'eBay',
      listings: scored,
      note: 'Real eBay listings (Browse API). Prices in USD; risk scores use marketplace signals — feedback %, price vs this search’s median, returns and shipping.',
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

// PayPal. Server-side only — the secret never leaves this file: no logging
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
// Proof Vault entry for a real listing, not just a demo catalog product.
const marketplaceOrders = new Map();
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

app.post('/api/paypal/token', async (req, res) => {
  // The token value itself is never returned to the browser.
  try {
    await getPayPalAccessToken();
    res.json({ ok: true, configured: true, mode: PAYPAL_MODE });
  } catch (err) {
    res.status(err.status || 502).json({ ok: false, error: err.message });
  }
});

app.post('/api/paypal/create-order', async (req, res) => {
  try {
    const { productId, totalUSD, international, currencyConversion } = req.body || {};
    // Marketplace checkout (e.g. a real eBay listing): the item comes from
    // the search result, not the demo catalog. The PayPal order below is a
    // SANDBOX SIMULATION of paying that listing's total — it does not buy
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
    // The order amount has to match the total the user approved in step 3.
    const expected = calculateTotalCost(
      product.priceUSD,
      international !== false,
      currencyConversion !== false
    );
    const approved = Number(totalUSD);
    if (!Number.isFinite(approved) || Math.abs(approved - expected.total) > 0.01) {
      return res.status(400).json({
        error: `Total mismatch: approved $${approved} does not match the calculated total $${expected.total}.`,
      });
    }
    const order = await paypalFetch('/v2/checkout/orders', 'POST', {
      intent: 'CAPTURE',
      purchase_units: [
        {
          reference_id: product.id,
          description: marketplaceDetails
            ? `${product.name} — ShopPal v2 marketplace simulation (PayPal Sandbox, does not buy the eBay item)`
            : `${product.name} — ShopPal v2 demo (PayPal Sandbox)`,
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
        return_url: `${req.protocol}://${req.get('host')}/?approved=1`,
        cancel_url: `${req.protocol}://${req.get('host')}/?cancelled=1`,
      },
    });
    const approveUrl =
      (order.links || []).find((l) => l.rel === 'approve')?.href || null;
    if (marketplaceDetails) marketplaceOrders.set(order.id, marketplaceDetails);
    res.status(201).json({
      orderId: order.id,
      status: order.status,
      approveUrl,
      totalUSD: expected.total,
      productId: product.id,
      marketplace: marketplaceDetails ? marketplaceDetails.marketplace : null,
    });
  } catch (err) {
    res.status(err.status || 502).json({ error: err.message, paypalName: err.paypalName || null });
  }
});

app.post('/api/paypal/capture-order', async (req, res) => {
  try {
    const { orderId } = req.body || {};
    if (!orderId) return res.status(400).json({ error: 'orderId is required.' });
    const captured = await paypalFetch(`/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, 'POST', {});
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
        ? 'Sandbox simulation — this PayPal order did not buy the eBay item. It proves the total and saves the proof.'
        : null,
      totalCost: {
        total: Number(amount.value),
        currency: amount.currency_code || 'USD',
      },
      paypal: {
        orderId,
        captureId: verifiedCapture.id,
        status: verifiedCapture.status,
        payerEmail: captured?.payer?.email_address || null,
        createTime: verifiedCapture.create_time || null,
        updateTime: verifiedCapture.update_time || null,
      },
    };
    saveVaultEntry(entry);
    res.json({ orderId, captureId: verifiedCapture.id, status: 'COMPLETED', vaultId: entry.id, entry });
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
  const entry = vaultId ? vaultEntries.get(vaultId) : null;
  if (!entry) {
    return res.status(404).json({
      error: 'Proof Vault entry not found. Save a successful checkout first.',
    });
  }
  const missing = [];
  if (!entry.paypal || !entry.paypal.captureId) missing.push('capture ID');
  if (!entry.seller || !entry.seller.tracking) missing.push('tracking proof');
  res.json({
    simulated: true,
    vaultId: entry.id,
    readinessScore: missing.length === 0 ? 100 : 70,
    missingProof: missing,
    draft:
      `Dispute response draft (simulated, factual only): ` +
      `Order ${entry.paypal?.orderId || 'unknown'} for ` +
      `${entry.product?.name || 'the product'} ($${entry.totalCost?.total ?? entry.product?.priceUSD ?? 'unknown'}) ` +
      `was paid via PayPal Sandbox and captured as ` +
      `${entry.paypal?.status || 'unknown'}. ` +
      `Seller: ${entry.seller?.name || 'unknown'} ` +
      `(risk score ${entry.riskScore?.score ?? 'unknown'} at checkout). ` +
      `Proof is attached in the Proof Vault entry ${entry.id}.`,
  });
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
