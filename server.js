// ShopPal v2 — Day 0 skeleton.
// PayPal AI Hackathon. Sandbox only. No real money.
// The agent never pays without explicit user approval.
//
// Stack: Node.js (>= 20) + Express + static frontend.
// PayPal: JS SDK (client) + REST API (server). AI: one server function
// (Gemini free tier, with a rule-based fallback when the key is absent).
// Storage: JSON file for the catalog, JSON files in data/vault/ for proofs.
//
// SECURITY: secrets come only from environment variables. This file never
// logs PAYPAL_CLIENT_SECRET or GEMINI_API_KEY, and never returns them in
// any API response. The PayPal Client ID is a public identifier and is the
// only PayPal credential ever sent to the browser (via /api/config).

require('dotenv').config();
const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const PAYPAL_MODE = process.env.PAYPAL_MODE || 'sandbox';
const PAYPAL_API_BASE =
  process.env.PAYPAL_API_BASE || 'https://api-m.sandbox.paypal.com';

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ---------------------------------------------------------------------------
// Data: demo catalog (10 products, 3 sellers)
// ---------------------------------------------------------------------------
const catalogPath = path.join(__dirname, 'data', 'catalog.json');
const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
const sellersById = new Map(catalog.sellers.map((s) => [s.id, s]));
const productsById = new Map(catalog.products.map((p) => [p.id, p]));

// ---------------------------------------------------------------------------
// AI: one server function for explanations.
// Rule-based reasons are always produced. A Gemini call is a Day 2 task:
// TODO (Day 2): if process.env.GEMINI_API_KEY is set, call the Gemini API
//   to rewrite the 3 rule-based reasons into plain language. The model must
//   never change the numeric score. If the call fails or the key is absent,
//   return the rule-based reasons with aiAvailable: false.
// ---------------------------------------------------------------------------
function explainScore(components, label) {
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
  return {
    reasons: reasons.slice(0, 3),
    recommendation,
    aiAvailable: false,
    aiNote: 'AI explanation unavailable — showing rule-based reasons.',
  };
}

// ---------------------------------------------------------------------------
// Risk Score (0-100, higher = safer). Weights from the spec:
// profile age/completeness 25, transaction/dispute history 35,
// price fairness vs. median 20, tracking/return policy 20.
// Zones: 80-100 Safe, 50-79 Caution, 0-49 Risky.
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// Total Cost (open, estimated). Public rates from the project research.
// PayPal Checkout 3.49% + $0.49, international 1.5%,
// currency conversion spread ~3.5% (estimate).
// ---------------------------------------------------------------------------
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
    note: 'Estimated fees. PayPal Checkout 3.49% + $0.49, international 1.5%, conversion spread ~3.5%.',
  };
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', service: 'shoppal-v2', mode: PAYPAL_MODE });
});

app.get('/api/config', (req, res) => {
  // Only the public Client ID is ever sent to the browser. Never the secret.
  res.json({
    paypalClientId: process.env.PAYPAL_CLIENT_ID || null,
    paypalMode: PAYPAL_MODE,
    hasGeminiKey: Boolean(process.env.GEMINI_API_KEY),
  });
});

app.get('/api/catalog', (req, res) => {
  res.json(catalog);
});

app.post('/api/risk-score', (req, res) => {
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
  const explanation = explainScore(components, label);
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

// --- PayPal stubs (Day 1) -------------------------------------------------
// These return 501 with a clear TODO. They read env vars to fail fast when
// credentials are missing, but never log or return secret values.
function paypalNotImplemented(res, action) {
  const configured = Boolean(
    process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET
  );
  return res.status(501).json({
    error: 'not_implemented',
    action,
    paypalConfigured: configured,
    message:
      'TODO (Day 1): implement this with the PayPal Sandbox REST API ' +
      `(${PAYPAL_API_BASE}). ` +
      (configured
        ? 'PayPal sandbox credentials are present in the environment.'
        : 'Set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET in your local .env first.'),
  });
}

app.post('/api/paypal/token', (req, res) => {
  // TODO (Day 1): POST /v1/oauth2/token with Basic auth (client ID + secret),
  // grant_type=client_credentials. Server-side only.
  return paypalNotImplemented(res, 'paypal-token');
});

app.post('/api/paypal/create-order', (req, res) => {
  // TODO (Day 1): POST /v2/checkout/orders with intent CAPTURE and the
  // approved total from /api/total-cost. Amount must match the total the
  // user approved — never create an order for a different amount.
  return paypalNotImplemented(res, 'create-order');
});

app.post('/api/paypal/capture-order', (req, res) => {
  // TODO (Day 1): POST /v2/checkout/orders/{orderId}/capture, then verify
  // with GET /v2/payments/captures/{captureId} before saving a Proof Vault
  // entry. Only a COMPLETED capture may be saved as successful.
  return paypalNotImplemented(res, 'capture-order');
});

// --- Proof Vault -----------------------------------------------------------
app.get('/api/vault', (req, res) => {
  const vaultDir = path.join(__dirname, 'data', 'vault');
  const entries = fs
    .readdirSync(vaultDir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(fs.readFileSync(path.join(vaultDir, f), 'utf8')))
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  res.json({ entries });
});

app.post('/api/dispute/draft', (req, res) => {
  // Simulated dispute draft, built only from a saved Proof Vault entry.
  // Clearly labelled as a simulation — never presented as a real dispute.
  const { vaultId } = req.body || {};
  const vaultDir = path.join(__dirname, 'data', 'vault');
  const file = path.join(vaultDir, `${vaultId}.json`);
  if (!vaultId || !fs.existsSync(file)) {
    return res.status(404).json({
      error: 'Proof Vault entry not found. Save a successful checkout first.',
    });
  }
  const entry = JSON.parse(fs.readFileSync(file, 'utf8'));
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

// Fallback: serve the frontend for any other route.
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  // Never log secrets here.
  console.log(`ShopPal v2 listening on http://localhost:${PORT} (mode: ${PAYPAL_MODE})`);
});
