// ShopPal v2 — 7-step demo flow, chat UI. No secrets here; the PayPal
// client ID comes from /api/config at runtime.
(function () {
  'use strict';

  var catalog = null;
  var selected = null; // { product, seller, risk, cost }
  var lastVaultId = null;

  var $ = function (id) { return document.getElementById(id); };
  var money = function (n) { return '$' + Number(n).toFixed(2); };
  var chatEl = null;

  async function loadConfig() {
    try {
      const res = await fetch('/api/config');
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
    const res = await fetch('/api/catalog');
    catalog = await res.json();
  }

  function sellerOf(product) {
    return catalog.sellers.find((s) => s.id === product.sellerId);
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
    var old = chatEl.querySelectorAll('[data-step]');
    for (var i = 0; i < old.length; i++) old[i].remove();
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
      card.addEventListener('click', function () { selectProduct(p); });
      grid.appendChild(card);
    });
  }

  function greet() {
    addBubble('agent',
      '<p>Hi, I’m ShopPal — your AI shopping agent. Tell me what you’re looking for, and I’ll check the seller, show you the real total (fees included), and keep your proof if you pay.</p>' +
      '<p>Everything here runs on PayPal Sandbox, so no real money moves.</p>' +
      '<div class="chips">' +
      '<button type="button" class="chip" data-q="headphones under $60">Headphones under $60</button>' +
      '<button type="button" class="chip" data-q="smartwatch">Smartwatch</button>' +
      '<button type="button" class="chip" data-q="keyboard">Keyboard</button>' +
      '</div>' +
      '<p class="hint">Or pick any product below.</p>' +
      '<div class="cards" id="catalog"></div>');
    renderCatalogInto($('catalog'), catalog.products);
    var chips = chatEl.querySelectorAll('.chip');
    for (var i = 0; i < chips.length; i++) {
      chips[i].addEventListener('click', function () {
        $('ask').value = this.getAttribute('data-q');
        sendAsk();
      });
    }
  }

  async function sendAsk() {
    var q = $('ask').value.trim();
    if (!q || !catalog) return;
    $('ask').value = '';
    userBubble(q);
    var res = await fetch('/api/ask?q=' + encodeURIComponent(q));
    var data = await res.json();
    var products = data.products || catalog.products;
    var understood = [];
    if (data.understood && data.understood.category) understood.push(data.understood.category);
    if (data.understood && data.understood.maxPrice !== null && data.understood.maxPrice !== undefined) understood.push('under $' + data.understood.maxPrice);
    addBubble('agent',
      '<p>Understood: ' + (understood.length ? understood.join(', ') : 'no category or budget found') +
      ' — ' + (data.understood ? data.understood.note : '') + '</p>' +
      '<div class="cards" id="catalog"></div>');
    renderCatalogInto($('catalog'), products);
  }

  async function selectProduct(product) {
    var seller = sellerOf(product);
    selected = { product: product, seller: seller, risk: null, cost: null };
    clearSteps();
    userBubble(product.name + ' — ' + money(product.priceUSD));

    var riskRes = await fetch('/api/risk-score', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sellerId: seller.id, productId: product.id }),
    });
    selected.risk = await riskRes.json();
    showRisk();
    await showHold();
    await showCost();
    showCheckout();
  }

  function showRisk() {
    var r = selected.risk;
    var zone = r.label.toLowerCase();
    addBubble('agent',
      '<p><strong>' + selected.seller.name + '</strong> — Risk Score <span class="score score-' + zone + '">' + r.score + '/100 · ' + r.label + '</span></p>' +
      '<ul>' + r.reasons.map((reason) => '<li>' + reason + '</li>').join('') + '</ul>' +
      '<p><strong>Recommendation:</strong> ' + r.recommendation + '</p>' +
      '<p class="hint">Profile ' + r.components.profile + ' · History ' + r.components.history +
      ' · Price ' + r.components.price + ' · Tracking ' + r.components.tracking +
      (r.aiAvailable ? '' : ' · ' + (r.aiNote || 'AI explanation unavailable.')) + '</p>',
      'risk');
  }

  async function showHold() {
    var res = await fetch('/api/hold-risk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sellerId: selected.seller.id, productId: selected.product.id }),
    });
    var h = await res.json();
    if (!res.ok) return;
    var zone = h.label === 'Low' ? 'safe' : h.label === 'Moderate' ? 'caution' : 'risky';
    addBubble('agent',
      '<p><strong>Hold Predictor</strong> — hold risk <span class="score score-' + zone + '">' + h.label + ' · ' + h.chance + '</span></p>' +
      '<ul>' + h.reasons.map((reason) => '<li>' + reason + '</li>').join('') + '</ul>' +
      '<p>' + h.tip + '</p>' +
      '<p class="hint">Estimate from public hold patterns, not a PayPal decision.</p>',
      'hold');
  }

  async function showCost() {
    var res = await fetch('/api/total-cost', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ priceUSD: selected.product.priceUSD, international: true, currencyConversion: true }),
    });
    selected.cost = await res.json();
    var c = selected.cost;
    var t = c.troubleCosts || {};
    var refundLine = c.itemPrice < 12
      ? 'Micropayments rate (4.99% + $0.09) would be cheaper for this item than the standard Checkout rate.'
      : 'For items under $12, the Micropayments rate (4.99% + $0.09) is cheaper than the standard Checkout rate.';
    addBubble('agent',
      '<p><strong>Honest total (estimated)</strong></p>' +
      '<table>' +
      '<tr><td>Item price</td><td>' + money(c.itemPrice) + '</td></tr>' +
      '<tr><td>PayPal Checkout fee (3.49% + $0.49)</td><td>' + money(c.paypalFee) + '</td></tr>' +
      '<tr><td>International fee (1.5%)</td><td>' + money(c.internationalFee) + '</td></tr>' +
      '<tr><td>Currency conversion spread (~3.5%, estimated)</td><td>' + money(c.conversionSpread) + '</td></tr>' +
      '<tr><td><strong>Total (estimated)</strong></td><td><strong>' + money(c.total) + '</strong></td></tr>' +
      '</table>' +
      '<div class="card"><p><strong>If something goes wrong</strong></p>' +
      '<ul>' +
      '<li>Chargeback: $' + (t.chargebackUSD || 20) + ' per case, on top of the lost sale.</li>' +
      '<li>Dispute through PayPal: $' + (t.disputeStandardUSD || 15) + ' ($' + (t.disputeHighVolumeUSD || 30) + ' for high-volume sellers).</li>' +
      '<li>Refund: the original fee is not returned, so a refunded order still costs the fee.</li>' +
      '<li>Instant transfer to your bank: ' + (t.instantTransferPct || 1.5) + '% (min $' + (t.instantTransferMinUSD || 0.5) + '); standard transfer is free but takes 1–3 days.</li>' +
      '<li>' + refundLine + '</li>' +
      '</ul>' +
      '<p><strong>Buyer Protection:</strong> ' + (t.protection || 'PayPal Buyer Protection covers Goods & Services payments. Friends & Family payments are not covered.') + '</p>' +
      '<p class="hint">' + (t.note || 'Public PayPal merchant fee schedule (US, Oct 2026). Estimates, not a quote.') + '</p></div>',
      'cost');
  }

  function showCheckout() {
    var bubble = addBubble('agent',
      '<p><strong>Ready to pay?</strong> I never pay without your approval.</p>' +
      '<p><label><input id="approve" type="checkbox"> I reviewed the risk score and total cost, and I approve this payment.</label></p>' +
      '<button id="checkout-btn" type="button" disabled>Pay with PayPal Sandbox</button>' +
      '<p id="checkout-status"></p>' +
      '<p class="hint">Use a PayPal Sandbox buyer account to approve. No real money is involved.</p>',
      'checkout');
    bubble.querySelector('#approve').addEventListener('change', (e) => {
      bubble.querySelector('#checkout-btn').disabled = !(e.target.checked && selected);
    });
    bubble.querySelector('#checkout-btn').addEventListener('click', startCheckout);
  }

  async function startCheckout() {
    if (!selected || !$('approve') || !$('approve').checked) return;
    $('checkout-status').textContent = 'Creating PayPal order…';
    var res = await fetch('/api/paypal/create-order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        productId: selected.product.id,
        totalUSD: selected.cost ? selected.cost.total : selected.product.priceUSD,
        international: true,
        currencyConversion: true,
      }),
    });
    var data = await res.json();
    if (!res.ok) {
      $('checkout-status').textContent = 'Could not create the PayPal order: ' + (data.error || res.status);
      return;
    }
    $('checkout-status').innerHTML =
      'Order created: <strong>' + data.orderId + '</strong> — total ' + money(data.totalUSD) + '. ' +
      'Approve it in PayPal Sandbox, then you will be sent back here to capture it.';
    addBubble('agent',
      '<p><a href="' + data.approveUrl + '" target="_blank" rel="noopener">Approve this order in PayPal Sandbox (opens in a new tab)</a></p>' +
      '<p class="hint">Use a PayPal sandbox buyer account to approve. No real money is involved.</p>');
    if (data.approveUrl) window.open(data.approveUrl, '_blank', 'noopener');
  }

  async function showVault() {
    var old = chatEl.querySelector('[data-step="vault"]');
    if (old) old.remove();
    var res = await fetch('/api/vault');
    var data = await res.json();
    var body = '';
    if (!data.entries || data.entries.length === 0) {
      body = '<p>No Proof Vault entries yet. Complete a successful checkout to save proof automatically.</p>';
    } else {
      lastVaultId = data.entries[0].id;
      body = data.entries.map((e) =>
        '<p><strong>' + (e.product?.name || e.id) + '</strong> — ' +
        (e.paypal?.status || 'unknown') + ' · Order ' + (e.paypal?.orderId || '—') + '</p>'
      ).join('');
    }
    var subs = '';
    try {
      var sres = await fetch('/api/subscriptions');
      var sdata = await sres.json();
      if (!sdata.patterns || !sdata.patterns.length) {
        subs = '<p><strong>Subscription Watcher</strong></p><p>No recurring purchases detected yet. Buy the same product twice and it shows up here with the total you have spent on it.</p>';
      } else {
        subs = '<p><strong>Subscription Watcher</strong> — recurring purchases found</p>' +
          sdata.patterns.map((p) =>
            '<p>' + p.productName + ' — bought ' + p.purchases + '×, total spent ' + money(p.totalSpent) +
            ', last purchase ' + (p.lastPurchase ? p.lastPurchase.slice(0, 10) : '—') + '</p>'
          ).join('');
      }
    } catch (e) {
      subs = '<p>Subscription Watcher unavailable.</p>';
    }
    var bubble = addBubble('agent',
      '<p><strong>Proof Vault</strong></p>' + body +
      '<div class="card">' + subs + '</div>' +
      '<p><button id="vault-refresh" type="button">Refresh Vault</button> ' +
      '<button id="dispute-btn" type="button"' + (data.entries && data.entries.length ? '' : ' disabled') + '>Simulate Dispute</button></p>' +
      '<div id="dispute-draft" class="card hidden"></div>',
      'vault');
    bubble.querySelector('#vault-refresh').addEventListener('click', function () { showVault(); });
    bubble.querySelector('#dispute-btn').addEventListener('click', async function () {
      if (!lastVaultId) return;
      var res = await fetch('/api/dispute/draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vaultId: lastVaultId }),
      });
      var d = await res.json();
      var box = $('dispute-draft');
      if (!box) return;
      box.classList.remove('hidden');
      if (!res.ok) {
        box.textContent = d.error || 'Could not generate a dispute draft.';
        return;
      }
      box.innerHTML =
        '<p><strong>Simulated dispute draft</strong> — readiness ' + d.readinessScore + '/100</p>' +
        '<p>' + d.draft + '</p>' +
        (d.missingProof && d.missingProof.length
          ? '<p>Still missing: ' + d.missingProof.join(', ') + '</p>'
          : '<p>No proof missing.</p>');
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
      addBubble('agent', '<p>Checkout was cancelled in PayPal. No payment was made.</p>');
    } else if (params.get('approved') === '1' && params.get('token')) {
      var orderId = params.get('token');
      addBubble('agent', '<p>PayPal approved order ' + orderId + ' — capturing…</p>');
      var res = await fetch('/api/paypal/capture-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId }),
      });
      var data = await res.json();
      if (!res.ok) {
        addBubble('agent', '<p>Capture failed: ' + (data.error || res.status) + '</p>');
        return;
      }
      addBubble('agent',
        '<p><strong>Success — payment captured.</strong> Order ' + data.orderId +
        ' · Capture ' + data.captureId + ' · status ' + data.status + '</p>' +
        '<p>Proof was saved to the Proof Vault automatically.</p>',
        'success');
      await showVault();
      window.history.replaceState({}, '', window.location.pathname);
    }
  });
})();
