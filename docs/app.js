// ShopPal v2 — static demo for GitHub Pages. Same 7-step flow as the
// Node.js server, running fully in the browser: risk score and total cost
// use the same rule formulas as server.js; checkout uses the official
// PayPal JS SDK (Sandbox); Proof Vault lives in localStorage.
// No secrets here — the Client ID in index.html is a public identifier.
(function () {
  'use strict';

  // Demo catalog (same data as data/catalog.json)
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
  var selected = null; // { product, seller, risk, cost }
  var lastVaultId = null;
  var paypalRenderToken = 0;

  var $ = function (id) { return document.getElementById(id); };
  var money = function (n) { return '$' + Number(n).toFixed(2); };

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
    reasons.push(components.profile < 60 ? 'This seller account is new or its profile is incomplete.' : 'This seller has an established, complete profile.');
    reasons.push(components.history < 60 ? 'This seller has a high dispute rate compared with other sellers.' : 'This seller has a low dispute rate across many transactions.');
    if (components.price < 60) reasons.push('This price is far below the category median — a common scam pattern.');
    else if (components.tracking < 60) reasons.push('This seller does not offer tracking or a clear return policy.');
    else reasons.push('The price is fair for this category, with tracking and returns offered.');
    var recommendation = label === 'Safe'
      ? 'Safe to proceed with PayPal Goods & Services.'
      : label === 'Caution'
        ? 'Proceed with caution. Use PayPal Goods & Services — never Friends & Family.'
        : 'Risky. Consider an alternative seller before paying.';
    return { score: total, label: label, components: components, reasons: reasons.slice(0, 3), recommendation: recommendation, aiAvailable: false, aiNote: 'AI explanation unavailable in the static demo — showing rule-based reasons.' };
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
    if (seller.disputeRate >= 5) { points += 40; reasons.push('Dispute rate is very high (' + seller.disputeRate + '%).'); }
    else if (seller.disputeRate >= 2) { points += 25; reasons.push('Dispute rate is above average (' + seller.disputeRate + '%).'); }
    else if (seller.disputeRate >= 1) { points += 10; reasons.push('Dispute rate is slightly above 1%.'); }
    if (seller.accountAgeYears < 0.5) { points += 25; reasons.push('Seller account is less than 6 months old.'); }
    else if (seller.accountAgeYears < 1.5) { points += 15; reasons.push('Seller account is less than 18 months old.'); }
    else if (seller.accountAgeYears < 3) { points += 5; reasons.push('Seller account is less than 3 years old.'); }
    if (seller.totalTransactions < 50) { points += 15; reasons.push('Very few completed transactions (' + seller.totalTransactions + ').'); }
    else if (seller.totalTransactions < 1000) { points += 5; reasons.push('Relatively few completed transactions.'); }
    var median = product.referencePriceUSD;
    if (median && median > 0) {
      var below = 1 - product.priceUSD / median;
      if (below >= 0.5) { points += 15; reasons.push('Price is 50% or more below the category median.'); }
      else if (below >= 0.2) { points += 5; reasons.push('Price is notably below the category median.'); }
    }
    if (!seller.hasTracking) { points += 5; reasons.push('No tracking offered, so delivery is harder to prove.'); }
    var score = Math.min(points, 100);
    var label = score < 25 ? 'Low' : score < 60 ? 'Moderate' : 'High';
    var chance = label === 'Low' ? 'under 5%' : label === 'Moderate' ? '5–20%' : 'over 20%';
    return {
      score: score,
      label: label,
      chance: chance + ' (estimate)',
      reasons: reasons.length ? reasons : ['No hold-risk signals in this seller pattern.'],
      tip: label === 'Low'
        ? 'Funds usually clear on the normal schedule for this pattern.'
        : 'Ask the seller to upload tracking promptly, and keep the order total close to the seller’s usual range.'
    };
  }

  // Ask parser: category + max budget out of plain language, matches
  // ranked safest first.
  var ASK_SYNONYMS = {
    headphones: ['headphone', 'earbud', 'earphone', 'headset', 'audio'],
    smartwatch: ['smartwatch', 'watch'],
    keyboard: ['keyboard'],
    speaker: ['speaker', 'bluetooth'],
    charger: ['charger', 'cable', 'power', 'gan', 'adapter']
  };
  function parseAsk(query) {
    var q = String(query || '').toLowerCase();
    var budgetMatch = q.match(/(?:under|below|less than|max|up to|budget)\s*\$?\s*(\d+(?:\.\d{1,2})?)|\$\s*(\d+(?:\.\d{1,2})?)/);
    var maxPrice = budgetMatch ? Number(budgetMatch[1] || budgetMatch[2]) : null;
    var category = null;
    for (var cat in ASK_SYNONYMS) {
      if (ASK_SYNONYMS[cat].some(function (w) { return q.includes(w); })) { category = cat; break; }
    }
    var matches = CATALOG.products.slice();
    if (category) {
      var want = category.charAt(0).toUpperCase() + category.slice(1);
      matches = matches.filter(function (p) { return p.category === want; });
    }
    if (maxPrice !== null) matches = matches.filter(function (p) { return p.priceUSD <= maxPrice; });
    matches.sort(function (a, b) {
      return calculateRiskScore(sellerOf(b), b).score - calculateRiskScore(sellerOf(a), a).score;
    });
    return { category: category, maxPrice: maxPrice, matches: matches };
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

  function renderCatalog(products) {
    var grid = $('catalog');
    grid.innerHTML = '';
    products.forEach(function (p) {
      var seller = sellerOf(p);
      var card = document.createElement('button');
      card.type = 'button';
      card.className = 'product-card';
      card.innerHTML = '<strong>' + p.name + '</strong><br>' + money(p.priceUSD) + ' · ' + p.category + '<br>Seller: ' + seller.name + ' (' + seller.riskProfile + ')';
      card.addEventListener('click', function () { selectProduct(p); });
      grid.appendChild(card);
    });
  }

  function selectProduct(product) {
    var seller = sellerOf(product);
    selected = { product: product, seller: seller, risk: calculateRiskScore(seller, product), cost: null };
    renderRisk();
    refreshCost();
    $('approve').checked = false;
    $('checkout-status').textContent = '';
    renderPayPalButton();
    document.getElementById('step-2').scrollIntoView({ behavior: 'smooth' });
  }

  function renderRisk() {
    var r = selected.risk;
    var zone = r.label.toLowerCase();
    $('risk').innerHTML =
      '<p><strong>' + selected.seller.name + '</strong> — Risk Score <span class="score score-' + zone + '">' + r.score + '/100 · ' + r.label + '</span></p>' +
      '<ul>' + r.reasons.map(function (reason) { return '<li>' + reason + '</li>'; }).join('') + '</ul>' +
      '<p><strong>Recommendation:</strong> ' + r.recommendation + '</p>' +
      '<p class="hint">Profile ' + r.components.profile + ' · History ' + r.components.history +
      ' · Price ' + r.components.price + ' · Tracking ' + r.components.tracking + ' · ' + r.aiNote + '</p>';
    renderHoldRisk();
  }

  function renderHoldRisk() {
    var box = $('hold-risk');
    if (!box || !selected) return;
    var h = calculateHoldRisk(selected.seller, selected.product);
    var zone = h.label === 'Low' ? 'safe' : h.label === 'Moderate' ? 'caution' : 'risky';
    box.innerHTML =
      '<p><strong>Hold Predictor</strong> — hold risk <span class="score score-' + zone + '">' + h.label + ' · ' + h.chance + '</span></p>' +
      '<ul>' + h.reasons.map(function (reason) { return '<li>' + reason + '</li>'; }).join('') + '</ul>' +
      '<p>' + h.tip + '</p>' +
      '<p class="hint">Estimate from public hold patterns, not a PayPal decision.</p>';
  }

  function refreshCost() {
    if (!selected) return;
    selected.cost = calculateTotalCost(
      selected.product.priceUSD,
      $('opt-international').checked,
      $('opt-conversion').checked
    );
    var c = selected.cost;
    $('cost').innerHTML =
      '<table>' +
      '<tr><td>Item price</td><td>' + money(c.itemPrice) + '</td></tr>' +
      '<tr><td>PayPal Checkout fee (3.49% + $0.49)</td><td>' + money(c.paypalFee) + '</td></tr>' +
      '<tr><td>International fee (1.5%)</td><td>' + money(c.internationalFee) + '</td></tr>' +
      '<tr><td>Currency conversion spread (~3.5%, estimated)</td><td>' + money(c.conversionSpread) + '</td></tr>' +
      '<tr><td><strong>Total (estimated)</strong></td><td><strong>' + money(c.total) + '</strong></td></tr>' +
      '</table>';
    renderTroubleCosts(c);
    renderPayPalButton();
  }

  function renderTroubleCosts(c) {
    var box = $('trouble-costs');
    if (!box) return;
    var t = TROUBLE_COSTS;
    var refundLine = c.itemPrice < 12
      ? 'Micropayments rate (4.99% + $0.09) would be cheaper for this item than the standard Checkout rate.'
      : 'For items under $12, the Micropayments rate (4.99% + $0.09) is cheaper than the standard Checkout rate.';
    box.innerHTML =
      '<p><strong>If something goes wrong</strong></p>' +
      '<ul>' +
      '<li>Chargeback: $' + t.chargebackUSD + ' per case, on top of the lost sale.</li>' +
      '<li>Dispute through PayPal: $' + t.disputeStandardUSD + ' ($' + t.disputeHighVolumeUSD + ' for high-volume sellers).</li>' +
      '<li>Refund: the original fee is not returned, so a refunded order still costs the fee.</li>' +
      '<li>Instant transfer to your bank: ' + t.instantTransferPct + '% (min $' + t.instantTransferMinUSD + '); standard transfer is free but takes 1–3 days.</li>' +
      '<li>' + refundLine + '</li>' +
      '</ul>' +
      '<p><strong>Buyer Protection:</strong> ' + t.protection + '</p>' +
      '<p class="hint">' + t.note + '</p>';
  }

  // PayPal JS SDK checkout (Sandbox, client-side)
  function renderPayPalButton() {
    var container = $('paypal-button-container');
    if (!selected || !window.paypal) {
      if (!window.paypal) container.innerHTML = '<p class="hint">PayPal SDK failed to load. Check your connection and reload.</p>';
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
        if (!$('approve').checked) {
          $('checkout-status').textContent = 'Please tick the approval checkbox in Step 4 first.';
          return actions.reject();
        }
        return actions.resolve();
      },
      createOrder: function (data, actions) {
        if (token !== paypalRenderToken) return Promise.reject(new Error('Selection changed.'));
        $('checkout-status').textContent = 'Creating PayPal order…';
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
        $('checkout-status').textContent = 'PayPal approved order ' + data.orderID + ' — capturing…';
        return actions.order.capture().then(function (details) {
          if (token !== paypalRenderToken) return;
          var capture = (details.purchase_units && details.purchase_units[0] && details.purchase_units[0].payments && details.purchase_units[0].payments.captures && details.purchase_units[0].payments.captures[0]) || null;
          if (!details || details.status !== 'COMPLETED' || !capture) {
            $('checkout-status').textContent = 'Capture did not complete (status: ' + (details && details.status) + '). Nothing was saved to the Proof Vault.';
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
          $('checkout-status').textContent = 'Payment captured: ' + capture.id;
          $('success').innerHTML =
            '<p><strong>Success — paid ' + money(entry.totalCost.total) + ' via PayPal Sandbox.</strong> Order ' + data.orderID +
            ' · Capture ' + capture.id + ' · status ' + capture.status + '</p>' +
            '<p>Proof was saved to the Proof Vault automatically (this browser).</p>';
          refreshVault();
        });
      },
      onCancel: function () {
        $('checkout-status').textContent = 'Checkout was cancelled in PayPal. No payment was made.';
      },
      onError: function (err) {
        $('checkout-status').textContent = 'PayPal checkout error: ' + (err && err.message ? err.message : err);
      }
    }).render('#paypal-button-container');
  }

  function refreshVault() {
    var entries = loadVault();
    var vault = $('vault');
    if (!entries.length) {
      vault.innerHTML = '<p>No Proof Vault entries yet. Complete a successful checkout to save proof automatically.</p>';
      $('dispute-btn').disabled = true;
    } else {
      lastVaultId = entries[0].id;
      $('dispute-btn').disabled = false;
      vault.innerHTML = entries.map(function (e) {
        return '<p><strong>' + (e.product && e.product.name || e.id) + '</strong> — ' +
          (e.paypal && e.paypal.status || 'unknown') + ' · Order ' + (e.paypal && e.paypal.orderId || '—') + '</p>';
      }).join('');
    }
    renderSubscriptions(entries);
  }

  function renderSubscriptions(entries) {
    var box = $('subscriptions');
    if (!box) return;
    var patterns = findSubscriptions(entries);
    if (!patterns.length) {
      box.innerHTML = '<p><strong>Subscription Watcher</strong></p><p>No recurring purchases detected yet. Buy the same product twice and it shows up here with the total you have spent on it.</p>';
      return;
    }
    box.innerHTML =
      '<p><strong>Subscription Watcher</strong> — recurring purchases found</p>' +
      patterns.map(function (p) {
        return '<p>' + p.productName + ' — bought ' + p.purchases + '×, total spent ' + money(p.totalSpent) +
          ', last purchase ' + (p.lastPurchase ? p.lastPurchase.slice(0, 10) : '—') + '</p>';
      }).join('');
  }

  function bindEvents() {
    $('ask-btn').addEventListener('click', function () {
      var q = $('ask').value.trim();
      if (!q) return;
      var parsed = parseAsk(q);
      var products = parsed.matches.length ? parsed.matches : CATALOG.products;
      renderCatalog(products);
      var understood = [];
      if (parsed.category) understood.push(parsed.category);
      if (parsed.maxPrice !== null) understood.push('under $' + parsed.maxPrice);
      $('catalog').insertAdjacentHTML('beforeend',
        '<p class="hint">Understood: ' + (understood.length ? understood.join(', ') : 'no category or budget found') +
        ' — ' + (parsed.matches.length ? 'Matches sorted safest first.' : 'No exact match in the demo catalog — showing all 10 demo products.') + '</p>');
    });
    $('opt-international').addEventListener('change', refreshCost);
    $('opt-conversion').addEventListener('change', refreshCost);
    $('approve').addEventListener('change', function (e) {
      if (e.target.checked && selected) renderPayPalButton();
    });
    $('vault-refresh').addEventListener('click', refreshVault);
    $('dispute-btn').addEventListener('click', function () {
      if (!lastVaultId) return;
      var entry = loadVault().find(function (e) { return e.id === lastVaultId; });
      var box = $('dispute-draft');
      box.classList.remove('hidden');
      if (!entry) { box.textContent = 'Proof Vault entry not found. Save a successful checkout first.'; return; }
      var missing = [];
      if (!entry.paypal || !entry.paypal.captureId) missing.push('capture ID');
      if (!entry.seller || !entry.seller.tracking) missing.push('tracking proof');
      var readiness = missing.length === 0 ? 100 : 70;
      box.innerHTML =
        '<p><strong>Simulated dispute draft</strong> — readiness ' + readiness + '/100</p>' +
        '<p>Dispute response draft (simulated, factual only): Order ' + (entry.paypal && entry.paypal.orderId || 'unknown') + ' for ' +
        (entry.product && entry.product.name || 'the product') + ' ($' + (entry.totalCost && entry.totalCost.total != null ? entry.totalCost.total : entry.product && entry.product.priceUSD || 'unknown') + ') ' +
        'was paid via PayPal Sandbox and captured as ' + (entry.paypal && entry.paypal.status || 'unknown') + '. ' +
        'Seller: ' + (entry.seller && entry.seller.name || 'unknown') +
        ' (risk score ' + (entry.riskScore && entry.riskScore.score != null ? entry.riskScore.score : 'unknown') + ' at checkout). ' +
        'Proof is attached in the Proof Vault entry ' + entry.id + '.</p>' +
        (missing.length ? '<p>Still missing: ' + missing.join(', ') + '</p>' : '<p>No proof missing.</p>');
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    bindEvents();
    renderCatalog(CATALOG.products);
    refreshVault();
    if (!window.paypal) {
      $('checkout-status').textContent = 'PayPal SDK did not load yet — it loads from paypal.com; check your connection and reload the page.';
    }
  });
})();
