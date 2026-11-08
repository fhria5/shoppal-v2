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

  // eBay titles are external content — escape before injecting into HTML.
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
  // Checkout is a PayPal Sandbox simulation — it never buys the eBay item.
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
    userBubble(l.title + ' — ' + money(l.priceUSD) + ' (eBay)');
    showRisk();
    showHold();
    showCost();
    showCheckout();
  }

  function greet() {
    addBubble('agent',
      '<p>Hi, I’m ShopPal — your AI shopping agent. Tell me what you’re looking for, and I’ll check the seller, show you the real total (fees included), and keep your proof if you pay.</p>' +
      '<p>Everything here runs on PayPal Sandbox, so no real money moves.</p>' +
      '<p class="hint">The server version can also search real eBay listings when EBAY_APP_ID + EBAY_CERT_ID are set in .env (free eBay developer keys) — otherwise I search the 10-product demo catalog.</p>' +
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
    clearSteps();
    var typing = showTyping();
    var res = await fetch('/api/ask?q=' + encodeURIComponent(q));
    var data = await res.json();
    var products = data.products || catalog.products;
    var understood = [];
    if (data.understood && data.understood.category) understood.push(data.understood.category);
    if (data.understood && data.understood.maxPrice !== null && data.understood.maxPrice !== undefined) understood.push('under $' + data.understood.maxPrice);
    if (data.understood && data.understood.cheapest) understood.push('cheapest first');
    addBubble('agent',
      '<p>Understood: ' + (understood.length ? understood.join(', ') : 'no category or budget found') +
      ' — ' + (data.understood ? data.understood.note : '') + '</p>' +
      '<div class="cards" id="catalog"></div>');
    renderCatalogInto($('catalog'), products);
    // Real marketplace search (eBay), same query. Runs after the demo
    // catalog reply so the Ask answer never waits on the marketplace.
    try {
      var mpParams = new URLSearchParams({ q });
      if (data.understood && data.understood.maxPrice !== null && data.understood.maxPrice !== undefined) mpParams.set('maxPrice', data.understood.maxPrice);
      if (data.understood && data.understood.cheapest) mpParams.set('cheapest', 'true');
      var mpRes = await fetch('/api/marketplace/search?' + mpParams.toString());
      var mp = await mpRes.json();
      if (mp.configured && mp.listings && mp.listings.length) {
        hideTyping(typing);
        addBubble('agent',
          '<p><strong>Real listings · eBay</strong></p>' +
          '<p class="hint">' + (mp.note || '') + '</p>' +
          '<div class="cards" id="marketplace"></div>');
        renderMarketplaceInto($('marketplace'), mp.listings);
        return;
      }
      if (mp.configured) {
        hideTyping(typing);
        addBubble('agent', '<p class="hint">No eBay listings found for that search.</p>');
        return;
      }
    } catch (e) {
      // Marketplace search is a bonus — a failure never breaks the Ask flow.
    }
    hideTyping(typing);
  }

  async function selectProduct(product) {
    var seller = sellerOf(product);
    selected = { product: product, seller: seller, risk: null, cost: null };
    clearSteps();
    userBubble(product.name + ' — ' + money(product.priceUSD));
    var typing = showTyping();

    var riskRes = await fetch('/api/risk-score', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sellerId: seller.id, productId: product.id }),
    });
    selected.risk = await riskRes.json();
    showRisk();
    await showHold();
    await showCost();
    hideTyping(typing);
    showCheckout();
  }

  function showRisk() {
    var r = selected.risk;
    var zone = r.label.toLowerCase();
    var extra = '';
    if (r.comparison) extra += '<p>' + r.comparison + '</p>';
    if (r.warning) extra += '<p><strong>Watch out:</strong> ' + r.warning + '</p>';
    if (r.checklist && r.checklist.length) {
      extra += '<p><strong>Before you pay:</strong></p><ul>' +
        r.checklist.map((c) => '<li>' + c + '</li>').join('') + '</ul>';
    }
    addBubble('agent',
      '<p><strong>' + selected.seller.name + '</strong> — Risk Score <span class="score score-' + zone + '">' + r.score + '/100 · ' + r.label + '</span></p>' +
      '<ul>' + r.reasons.map((reason) => '<li>' + reason + '</li>').join('') + '</ul>' +
      '<p><strong>Recommendation:</strong> ' + r.recommendation + '</p>' +
      extra +
      '<p class="hint">Profile ' + r.components.profile + ' · History ' + r.components.history +
      ' · Price ' + r.components.price + ' · Tracking ' + r.components.tracking +
      (r.aiAvailable ? '' : ' · ' + (r.aiNote || 'AI explanation unavailable.')) + '</p>',
      'risk');
  }

  async function showHold() {
    // Marketplace listings already carry their hold estimate from search.
    var h = selected.holdRisk || null;
    if (!h) {
      var res = await fetch('/api/hold-risk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sellerId: selected.seller.id, productId: selected.product.id }),
      });
      h = await res.json();
      if (!res.ok) return;
    }
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
    var simNote = selected.marketplace
      ? '<p><strong>Sandbox simulation:</strong> this creates a PayPal Sandbox order for the listing total. It does <strong>not</strong> buy the eBay item — it proves the total and saves the proof.</p>'
      : '';
    var bubble = addBubble('agent',
      '<p><strong>Ready to pay?</strong> I never pay without your approval.</p>' +
      simNote +
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
    var res = await fetch('/api/paypal/create-order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
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
        (e.paypal?.status || 'unknown') + ' · Order ' + (e.paypal?.orderId || '—') +
        (e.marketplace ? ' · ' + e.marketplace.name + ' (simulation)' : '') + '</p>'
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
