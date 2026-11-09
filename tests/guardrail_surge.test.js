// Integration test: Simulated Price Surge vs the $20 Budget Guardrail.
// Runs against a local server.js instance on port 3000 (start with: node server.js).
// Usage: node tests/guardrail_surge.test.js
//
// Scenario:
//   1. Product search: headphones via /api/ask; the guardrail boundary is
//      established with the spec figures ($18.50 passes, $22.00 triggers).
//   2. Initial checkout success: the agent buys the cheapest item (p11,
//      total $16.74) -> HTTP 200 + a PayPal sandbox order (SUCCESS).
//   3. Simulated price surge: the same checkout total jumps $18.50 -> $25.00;
//      the guardrail now triggers.
//   4. Guardrail enforcement: the agent tries to buy an over-limit item
//      (p01, total $65.57) -> HTTP 403 + status GUARDRAIL_TRIGGERED +
//      needsApproval + pendingOrder, and NO PayPal order is created.
//   5. Manual confirmation: retrying with approved:true + approvedOrder
//      creates the order (HTTP 200) — the 403 is a confirmation gate,
//      not a permanent block.
//
// How the surge is simulated (read this before changing the test):
// the demo catalog price is fixed, so a price cannot change in place.
// The surge is simulated the way the agent sees it — as the checkout
// total the guardrail evaluates. Step 3 submits the surged total
// ($25.00) to the same /api/guardrails/check the agent runs at checkout
// time; step 4 proves the agent blocks an over-limit checkout with 403
// and creates no order. The exact spec figures ($18.50 / $22.00 /
// $25.00) are used wherever the architecture takes a total as input;
// the agent checkouts use the real catalog products that straddle the
// limit (p11 $16.74 under, p01 $65.57 over).
//
// The orders created here are PayPal Sandbox orders in CREATED state;
// they are never captured, so no money moves. That is intentional:
// the test proves the guardrail blocks BEFORE any capture.
const BASE = 'http://localhost:3000';

const GUARDRAIL_LIMIT = 20;
const UNDER_TOTAL = 18.50; // spec figure: passes the $20 guardrail
const OVER_TOTAL = 22.00; // spec figure: triggers the $20 guardrail
const SURGED_TOTAL = 25.00; // spec figure: the price after the surge

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

    // ---------- 1. Product search & initial state ----------
    // Headphones search returns the catalog headphones.
    let r = await get('/api/ask?q=' + encodeURIComponent('headphones') + '&lang=en');
    check('ask headphones 200', r.status === 200, r.data);
    check('ask headphones returns products', Array.isArray(r.data.products) && r.data.products.length > 0, r.data.products);
    check(
      'ask headphones are all Headphones',
      Array.isArray(r.data.products) && r.data.products.every((p) => p.category === 'Headphones'),
      (r.data.products || []).map((p) => p.id + ':' + p.category)
    );
    // The boundary, with the spec's exact figures: $18.50 passes, $22.00 triggers.
    r = await post('/api/guardrails/check', { totalUSD: UNDER_TOTAL, category: 'Headphones', lang: 'en' });
    check('$18.50 passes the $20 guardrail', r.status === 200 && r.data.needsApproval === false && Array.isArray(r.data.reasons) && r.data.reasons.length === 0, r.data);
    r = await post('/api/guardrails/check', { totalUSD: OVER_TOTAL, category: 'Headphones', lang: 'en' });
    check('$22.00 triggers the $20 guardrail', r.status === 200 && r.data.needsApproval === true && Array.isArray(r.data.reasons) && r.data.reasons.length > 0, r.data);
    r = await post('/api/guardrails/check', { totalUSD: GUARDRAIL_LIMIT, category: 'Headphones', lang: 'en' });
    check('exactly $20 still auto-ok (limit is exclusive)', r.status === 200 && r.data.needsApproval === false, r.data);

    // ---------- 2. Initial checkout success (under the limit) ----------
    // The agent buys the cheapest item (p11 Echo Mini, $14.99, total $16.74).
    // Under $20, so the guardrail passes and a real PayPal sandbox order is created.
    r = await post('/api/agent', { message: 'beli barang termurah', lang: 'id' });
    check('checkout under $20 returns 200 SUCCESS', r.status === 200, r.data);
    check('checkout under $20 creates a PayPal order', Boolean(r.data.order && r.data.order.orderId && r.data.order.approveUrl), r.data.order);
    check('checkout under $20 total is $16.74', r.data.order && r.data.order.totalUSD === 16.74, r.data.order);
    check('checkout under $20 needs no approval', r.data.needsApproval !== true && r.data.status !== 'GUARDRAIL_TRIGGERED', r.data);
    check('checkout under $20 order is CREATED (not captured)', r.data.order && r.data.order.status === 'CREATED', r.data.order);

    // ---------- 3. Simulated price surge: $18.50 -> $25.00 ----------
    // The same checkout that passed at $18.50 now totals $25.00 after the surge.
    // p11 itself still totals $16.74 (the catalog price did not move); the
    // surge is the total the guardrail would evaluate if the price had risen.
    r = await post('/api/guardrails/check', { totalUSD: 16.74, category: 'Speaker', lang: 'en' });
    check('p11 total $16.74 still passes before the surge', r.status === 200 && r.data.needsApproval === false, r.data);
    r = await post('/api/guardrails/check', { totalUSD: SURGED_TOTAL, category: 'Headphones', lang: 'en' });
    check('surged total $25.00 triggers the guardrail', r.status === 200 && r.data.needsApproval === true && Array.isArray(r.data.reasons) && r.data.reasons.length > 0, r.data);
    check(
      'surge reason names the $20 limit',
      typeof (r.data.reasons || [])[0] === 'string' && /\$20/.test(r.data.reasons[0]),
      r.data.reasons
    );

    // ---------- 4. Guardrail enforcement: checkout after the surge -> 403 ----------
    // The agent tries to buy p01 (total $65.57, over the limit). The agent
    // must refuse with 403 + GUARDRAIL_TRIGGERED and create NO PayPal order.
    r = await post('/api/agent', { message: 'beli headphone p01', lang: 'id' });
    check('checkout over $20 returns 403', r.status === 403, { status: r.status, data: r.data });
    check('checkout over $20 status is GUARDRAIL_TRIGGERED', r.data.status === 'GUARDRAIL_TRIGGERED', r.data);
    check('checkout over $20 needsApproval is true', r.data.needsApproval === true, r.data);
    check(
      'checkout over $20 keeps a pending order',
      Boolean(r.data.pendingOrder) && r.data.pendingOrder.productId === 'p01' && r.data.pendingOrder.totalUSD === 65.57,
      r.data.pendingOrder
    );
    check('checkout over $20 creates NO PayPal order', !r.data.order, r.data.order);
    check(
      'checkout over $20 reply explains the block',
      typeof r.data.reply === 'string' && r.data.reply.length > 0,
      r.data.reply
    );

    // ---------- 5. Manual confirmation: the 403 is a gate, not a block ----------
    // The user confirms in the chat (Approve), the agent retries with
    // approved:true, and the order is created (HTTP 200).
    r = await post('/api/agent', {
      message: 'beli headphone p01',
      lang: 'id',
      approved: true,
      approvedOrder: { productId: 'p01', totalUSD: 65.57 },
    });
    check('manual approval retry returns 200', r.status === 200, r.data);
    check('manual approval creates the order', Boolean(r.data.order && r.data.order.orderId && r.data.order.approveUrl), r.data.order);
    check('manual approval order total is $65.57', r.data.order && r.data.order.totalUSD === 65.57, r.data.order);
    check('manual approval needs no further approval', r.data.needsApproval !== true && r.data.status !== 'GUARDRAIL_TRIGGERED', r.data);
  } finally {
    // ---------- Teardown: restore the guardrail limit ----------
    if (originalLimit !== null) {
      await post('/api/guardrails', { autoApproveLimit: originalLimit }).catch(() => {});
    }
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exitCode = fail ? 1 : 0;
})();
