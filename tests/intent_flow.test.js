// Intent-handling tests: conversational follow-ups must NOT trigger a
// generic product search.
// Runs against a local server.js instance on port 3000 (start with: node server.js).
// Usage: node tests/intent_flow.test.js
//
// Scenario (the bug this file locks in):
//   A user splits a product with friends ("patungan headphone p01 sama
//   Budi dan Sari"), then follows up with a short phrase that names no
//   product — "lanjut checkout bagian saya" / "beli bagian saya".
//   Before this fix, the phrase carried no product/category intent, so the
//   frontend sent it to /api/ask and the user got a generic catalog
//   search. After the fix, the frontend routes it to /api/agent with the
//   active product (the split session first, then the last search
//   results), and the agent checks out that product.
//
// Cases:
//   1. Active State Continuity: split p01 with Budi + Sari, then
//      "lanjut checkout bagian saya" / "beli bagian saya" with the split
//      session → a PayPal order for the user's own share ($19.99), for
//      product p01, and NO `products` array (no catalog search).
//   2. Context Preservation: the same phrases with only `context`
//      (lastResults) and no split → the first context product is checked
//      out (p01: over the $20 limit, so 403 + GUARDRAIL_TRIGGERED +
//      pendingOrder; p11: under the limit, so 200 + order).
//   3. Fallback Safety: the same phrases with NO context and NO split →
//      the agent asks which product to check out; it creates NO order and
//      returns NO product list (it must not guess and must not dump the
//      catalog).
//   4. Control: GET /api/ask with the same phrase returns a generic
//      product list — proving /api/ask is the wrong route for these
//      phrases, and the agent path is the one that must handle them.
//   5. Regression: a normal buy ("beli headphone p01") still goes through
//      the guardrail (403 + pendingOrder), unchanged.
//
// How the active product reaches the server (read this before changing
// the test): the server is stateless; the client owns the conversation
// state and sends it with the request — `context` (the product IDs the
// chat last showed) and `lastSplit` (the active split session
// {productId, share, initiatorShare, total, friends}). The server
// validates every ID against the catalog before use. The test sends
// those fields exactly the way the frontend does.
//
// The orders created here are PayPal Sandbox orders in CREATED state;
// they are never captured, so no money moves.
const BASE = 'http://localhost:3000';

const GUARDRAIL_LIMIT = 20;

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
  let originalLimit = null;
  try {
    // ---------- Setup: pin the guardrail at $20 for this scenario ----------
    const before = await get('/api/guardrails');
    check('guardrails readable', before.status === 200 && Number.isFinite(before.data.autoApproveLimit), before.data);
    originalLimit = before.data.autoApproveLimit;
    const set = await post('/api/guardrails', { autoApproveLimit: GUARDRAIL_LIMIT });
    check('guardrail pinned at $20', set.status === 200 && set.data.autoApproveLimit === GUARDRAIL_LIMIT, set.data);

    // ---------- 1. Active State Continuity: split p01, then continue ----------
    // Split p01 (item price $59.99) with Budi + Sari: 3 people, $20.00
    // per friend, the initiator's own share $19.99.
    let r = await post('/api/agent', { message: 'patungan headphone p01 sama Budi dan Sari', lang: 'id' });
    check('split p01 returns 200', r.status === 200, r.data);
    check('split p01 has a splitPayment', Boolean(r.data.splitPayment && r.data.splitPayment.links), r.data.splitPayment);
    check('split p01 productId is p01', r.data.splitPayment && r.data.splitPayment.productId === 'p01', r.data.splitPayment);
    check('split p01 share is $20.00', r.data.splitPayment && r.data.splitPayment.share === 20, r.data.splitPayment);
    check('split p01 initiatorShare is $19.99', r.data.splitPayment && r.data.splitPayment.initiatorShare === '19.99', r.data.splitPayment);
    check('split p01 creates 2 friend links', r.data.splitPayment && Array.isArray(r.data.splitPayment.links) && r.data.splitPayment.links.length === 2, r.data.splitPayment && r.data.splitPayment.links);
    const lastSplit = r.data.splitPayment;
    check('split p01 reply names the product and the $20 share', typeof r.data.reply === 'string' && r.data.reply.includes('Aurora Wireless Headphones') && r.data.reply.includes('$20'), r.data.reply);

    // Regression (10 Nov 2026): the same split WITHOUT a category word
    // ("split p01 with Budi and Sari") used to fall through the
    // agentFallback hasIntent gate and answer with the generic reply.
    // The split branch must resolve the product by ID.
    r = await post('/api/agent', { message: 'split p01 with Budi and Sari', lang: 'en' });
    check('split p01 without category returns 200', r.status === 200, r.data);
    check('split p01 without category has a splitPayment', Boolean(r.data.splitPayment && r.data.splitPayment.links), r.data.splitPayment);
    check('split p01 without category productId is p01', r.data.splitPayment && r.data.splitPayment.productId === 'p01', r.data.splitPayment);
    check('split p01 without category share is $20.00', r.data.splitPayment && r.data.splitPayment.share === 20, r.data.splitPayment);
    check('split p01 without category creates 2 friend links', r.data.splitPayment && Array.isArray(r.data.splitPayment.links) && r.data.splitPayment.links.length === 2, r.data.splitPayment && r.data.splitPayment.links);

    // Edge cases: an unknown ID must NOT silently split p01, and a split
    // with no product at all must ask which product instead of guessing.
    r = await post('/api/agent', { message: 'split p99 with Budi and Sari', lang: 'en' });
    check('split p99 does not create a splitPayment', !r.data.splitPayment, r.data.splitPayment);
    check('split p99 says no matching product', typeof r.data.reply === 'string' && r.data.reply.includes('could not find a matching product'), r.data.reply);
    r = await post('/api/agent', { message: 'split with Budi and Sari', lang: 'en' });
    check('split with no product does not create a splitPayment', !r.data.splitPayment, r.data.splitPayment);
    check('split with no product asks which product', typeof r.data.reply === 'string' && r.data.reply.includes('Which product do you want to split'), r.data.reply);

    // "Lanjut checkout bagian saya" with the split session: the agent must
    // check out the user's own share ($19.99) of p01 — not search.
    r = await post('/api/agent', { message: 'lanjut checkout bagian saya', lang: 'id', lastSplit });
    check('continuation "lanjut checkout bagian saya" returns 200', r.status === 200, r.data);
    check('continuation creates an order for the share', Boolean(r.data.order && r.data.order.orderId && r.data.order.approveUrl), r.data.order);
    check('continuation order total is the share $19.99', r.data.order && r.data.order.totalUSD === 19.99, r.data.order);
    check('continuation order is for p01', r.data.order && r.data.order.productId === 'p01', r.data.order);
    check('continuation order is marked a share checkout', r.data.order && r.data.order.shareCheckout === true, r.data.order);
    check('continuation does NOT return a product list', !('products' in r.data), Object.keys(r.data));
    check('continuation steps include create_order', Array.isArray(r.data.steps) && r.data.steps.some((s) => s.action === 'create_order'), r.data.steps);

    // The other phrasing, "beli bagian saya", with the same split session.
    r = await post('/api/agent', { message: 'beli bagian saya', lang: 'id', lastSplit });
    check('continuation "beli bagian saya" returns 200', r.status === 200, r.data);
    check('continuation "beli bagian saya" orders the $19.99 share', Boolean(r.data.order) && r.data.order.totalUSD === 19.99 && r.data.order.productId === 'p01', r.data.order);
    check('continuation "beli bagian saya" is not a search', !('products' in r.data), Object.keys(r.data));

    // Approving a share checkout must still charge the share, not the
    // full total: retry the continuation as an approved pending order.
    r = await post('/api/agent', {
      message: 'lanjut checkout bagian saya',
      lang: 'id',
      approved: true,
      approvedOrder: { productId: 'p01', totalUSD: 19.99, shareCheckout: true },
    });
    check('approved share retry returns 200', r.status === 200, r.data);
    check('approved share retry still totals $19.99', Boolean(r.data.order) && r.data.order.totalUSD === 19.99, r.data.order);

    // ---------- 2. Context Preservation: no split, only lastResults ----------
    // "lanjut checkout" with context [p01, p02, p03]: resolves to p01
    // (first in context). p01 totals $65.57 > $20, so the guardrail must
    // block it with 403 + pendingOrder — proving it ran the checkout flow
    // for p01 instead of a generic search.
    r = await post('/api/agent', { message: 'lanjut checkout', lang: 'id', context: ['p01', 'p02', 'p03'] });
    check('context-only continuation returns 403', r.status === 403, { status: r.status, data: r.data });
    check('context-only continuation is GUARDRAIL_TRIGGERED', r.data.status === 'GUARDRAIL_TRIGGERED', r.data);
    check('context-only continuation pending order is p01', Boolean(r.data.pendingOrder) && r.data.pendingOrder.productId === 'p01', r.data.pendingOrder);
    check('context-only continuation pending total is $65.57', r.data.pendingOrder && r.data.pendingOrder.totalUSD === 65.57, r.data.pendingOrder);
    check('context-only continuation creates NO order', !r.data.order, r.data.order);
    check('context-only continuation is not a search', !('products' in r.data), Object.keys(r.data));

    // The same phrase with only the cheap product in context: under the
    // limit, so the order is created straight away.
    r = await post('/api/agent', { message: 'beli bagian saya', lang: 'id', context: ['p11'] });
    check('context p11 continuation returns 200', r.status === 200, r.data);
    check('context p11 continuation orders p11 ($16.74)', Boolean(r.data.order) && r.data.order.productId === 'p11' && r.data.order.totalUSD === 16.74, r.data.order);
    check('context p11 continuation is not a share checkout', r.data.order && r.data.order.shareCheckout === false, r.data.order);

    // A forged context ID must resolve to nothing, never to a purchase.
    r = await post('/api/agent', { message: 'lanjut checkout', lang: 'id', context: ['p99', 'nope'] });
    check('forged context asks which product (no purchase)', r.status === 200 && !r.data.order && !('products' in r.data) && typeof r.data.reply === 'string' && /Produk mana/.test(r.data.reply), r.data);

    // ---------- 3. Fallback Safety: no context, no split ----------
    r = await post('/api/agent', { message: 'lanjut checkout bagian saya', lang: 'id' });
    check('no-context continuation returns 200', r.status === 200, r.data);
    check('no-context continuation asks which product', typeof r.data.reply === 'string' && /Produk mana/.test(r.data.reply), r.data.reply);
    check('no-context continuation creates NO order', !r.data.order, r.data.order);
    check('no-context continuation returns NO product list', !('products' in r.data), Object.keys(r.data));

    // ---------- 4. Control: /api/ask IS the generic search ----------
    // The same phrase sent to /api/ask returns a product list — this is
    // the old broken behavior. The agent path above must never do this.
    r = await get('/api/ask?q=' + encodeURIComponent('lanjut checkout bagian saya') + '&lang=id');
    check('control: /api/ask returns a generic product list', r.status === 200 && Array.isArray(r.data.products) && r.data.products.length > 0, r.data.products && r.data.products.length);

    // ---------- 5. Regression: a normal buy still hits the guardrail ----------
    r = await post('/api/agent', { message: 'beli headphone p01', lang: 'id' });
    check('regression: normal buy p01 is 403 + pendingOrder', r.status === 403 && r.data.status === 'GUARDRAIL_TRIGGERED' && Boolean(r.data.pendingOrder) && r.data.pendingOrder.productId === 'p01', r.data);
  } finally {
    // ---------- Teardown: restore the guardrail limit ----------
    if (originalLimit !== null) {
      await post('/api/guardrails', { autoApproveLimit: originalLimit }).catch(() => {});
    }
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exitCode = fail ? 1 : 0;
})();
