// One-off: verify the Etsy adapter against a local mock of the
// findAllListingsActive response shape. Usage: node test_etsy_mock.js
const http = require('http');

const MOCK = {
  count: 3,
  results: [
    {
      listing_id: 123456789,
      title: 'Handmade ceramic mug',
      price: { amount: 2500, divisor: 100, currency_code: 'USD' },
      url: 'https://www.etsy.com/listing/123456789/handmade-ceramic-mug',
      images: [{ url_570xN: 'https://i.etsystatic.com/1/il_570xN.1.jpg', url_fullxfull: 'https://i.etsystatic.com/1/il_fullxfull.1.jpg' }],
      shop_id: 98765,
      quantity: 5,
      state: 'active',
      type: 'physical',
    },
    {
      listing_id: 222222222,
      title: 'Vintage leather wallet',
      price: { amount: 4500, divisor: 100, currency_code: 'EUR' },
      url: 'https://www.etsy.com/listing/222222222/vintage-leather-wallet',
      images: [],
      shop_id: 11111,
      quantity: 2,
      state: 'active',
      type: 'physical',
    },
    {
      listing_id: 333333333,
      title: 'Digital planner PDF',
      price: { amount: 500, divisor: 100, currency_code: 'USD' },
      url: 'https://www.etsy.com/listing/333333333/digital-planner-pdf',
      images: [{ url_570xN: 'https://i.etsystatic.com/3/il_570xN.3.jpg' }],
      shop_id: 55555,
      quantity: 99,
      state: 'active',
      type: 'download',
    },
  ],
};

let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log('PASS', name); }
  else { fail++; console.log('FAIL', name, JSON.stringify(detail)); }
}

const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://localhost');
  if (u.pathname === '/v3/application/listings/active' && req.headers['x-api-key'] === 'keystring:shared_secret') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(MOCK));
  } else {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Invalid API key.' }));
  }
});

server.listen(3999, async () => {
  process.env.ETSY_API_BASE = 'http://localhost:3999';
  process.env.ETSY_API_KEY = 'keystring:shared_secret';
  const etsy = require('./marketplace/etsy');
  check('etsy isConfigured with key', etsy.isConfigured() === true);
  const listings = await etsy.searchEtsy('mug', { limit: 8 });
  check('etsy returns 2 USD listings (EUR filtered)', Array.isArray(listings) && listings.length === 2, listings);
  const mug = listings.find((l) => l.itemId === '123456789');
  check('etsy mug priceUSD 25', mug && mug.priceUSD === 25, mug);
  check('etsy mug marketplace Etsy', mug && mug.marketplace === 'Etsy', mug);
  check('etsy mug image 570xN', mug && mug.image === 'https://i.etsystatic.com/1/il_570xN.1.jpg', mug);
  check('etsy mug seller Shop 98765', mug && mug.sellerName === 'Shop 98765', mug);
  check('etsy mug hasShipping true', mug && mug.hasShipping === true, mug);
  check('etsy mug feedback null', mug && mug.sellerFeedbackPercentage === null, mug);
  check('etsy mug itemUrl', mug && mug.itemUrl === 'https://www.etsy.com/listing/123456789/handmade-ceramic-mug', mug);
  const pdf = listings.find((l) => l.itemId === '333333333');
  check('etsy download priceUSD 5', pdf && pdf.priceUSD === 5, pdf);
  check('etsy download hasShipping false', pdf && pdf.hasShipping === false, pdf);
  // No key -> null (unconfigured path).
  delete process.env.ETSY_API_KEY;
  delete require.cache[require.resolve('./marketplace/etsy')];
  const etsy2 = require('./marketplace/etsy');
  check('etsy isConfigured false without key', etsy2.isConfigured() === false);
  check('etsy searchEtsy null without key', (await etsy2.searchEtsy('mug')) === null);
  server.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
});
