// End-to-end walk of sales-order fulfilment, both destinations.
//
// A customer record is scoped to the seller, so `customers.organization_id` is
// the seller's own organization and never the buyer's. What decides where the
// goods go is `buyerOrganization`:
//
//   set    -> the buyer is a business on the platform. Fulfilment raises a
//             transfer, with a line per identity, that the buyer confirms.
//   null   -> the buyer is off-platform. Nobody downstream can confirm a
//             receipt, so the goods leave the chain: fulfilment is a sale.
//
// Both paths are checked here, along with the receipt that closes the first.

const BASE = (process.env.API_BASE ?? 'http://localhost:8081') + '/api';
const stamp = Date.now();

let failures = 0;

async function call(method, path, { token, body } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let json;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { status: res.status, body: json };
}

function check(label, condition, detail) {
  if (condition) {
    console.log(`  PASS  ${label}`);
  } else {
    failures++;
    console.log(`  FAIL  ${label}${detail !== undefined ? ' -> ' + JSON.stringify(detail) : ''}`);
  }
}

async function onboard(label, type) {
  const email = `${label}-${stamp}@example.com`;
  const reg = await call('POST', '/auth/register', {
    body: { email, password: 'Passw0rd!', fullName: `${label} admin` },
  });
  const org = await call('POST', '/organizations', {
    token: reg.body.token, body: { name: `${label} ${stamp}`, type },
  });
  const login = await call('POST', '/auth/login', { body: { email, password: 'Passw0rd!' } });
  return { token: login.body?.token ?? reg.body.token, orgId: org.body?.id };
}

async function main() {
  console.log('\n=== 1. Onboard a seller and a registered buyer ===');
  const seller = await onboard('seller', 'DISTRIBUTOR');
  const buyer = await onboard('buyer', 'RETAILER');
  check('seller onboarded', !!seller.orgId, seller);
  check('buyer onboarded', !!buyer.orgId, buyer);

  const sellerLoc = (await call('POST', '/locations', {
    token: seller.token, body: { name: 'Seller Depot', type: 'WAREHOUSE' },
  })).body;
  const buyerLoc = (await call('POST', '/locations', {
    token: buyer.token, body: { name: 'Buyer Shop', type: 'SHOP' },
  })).body;
  check('locations created', !!sellerLoc?.id && !!buyerLoc?.id);

  console.log('\n=== 2. Stock to sell ===');
  const category = (await call('POST', '/product-categories', {
    token: seller.token, body: { name: `Kettles ${stamp}`, code: `KTL-CAT-${stamp}` },
  })).body;
  check('category created', !!category?.id, category);
  const product = (await call('POST', '/products', {
    token: seller.token,
    body: { name: 'Kettle K2', sku: `KTL-${stamp}`, categoryId: category.id },
  })).body;
  const batch = (await call('POST', '/batches', {
    token: seller.token,
    body: {
      productId: product.id, batchCode: `BT-${stamp}`,
      manufacturedOn: '2026-08-01', expiresOn: '2030-01-01',
    },
  })).body;
  const units = (await call('POST', '/items/units', {
    token: seller.token,
    body: { productId: product.id, batchId: batch.id, count: 6, locationId: sellerLoc.id },
  })).body;
  check('6 units in stock', units?.length === 6, units?.length);

  console.log('\n=== 3. Two customers, one on the platform and one not ===');
  const registered = (await call('POST', '/commerce/customers', {
    token: seller.token,
    body: {
      name: 'Buyer Ltd', type: 'BUSINESS', buyerOrganizationId: buyer.orgId,
    },
  })).body;
  check('registered customer links to the buying organization',
    registered?.buyerOrganizationId === buyer.orgId, registered);

  const walkIn = (await call('POST', '/commerce/customers', {
    token: seller.token, body: { name: 'Corner Shop', type: 'BUSINESS' },
  })).body;
  check('off-platform customer has no buying organization',
    walkIn?.buyerOrganizationId === null, walkIn);

  // A customer pointing at the seller would make fulfilment a transfer from an
  // organization to itself, which nobody could ever confirm.
  const selfCustomer = await call('POST', '/commerce/customers', {
    token: seller.token,
    body: { name: 'Myself', type: 'BUSINESS', buyerOrganizationId: seller.orgId },
  });
  check('a customer cannot be the seller itself',
    selfCustomer.status === 409, selfCustomer.body?.message ?? selfCustomer.status);

  console.log('\n=== 4. Order to the registered buyer → transfer ===');
  const orderA = (await call('POST', '/commerce/orders', {
    token: seller.token,
    body: {
      customerId: registered.id,
      lines: [{ productId: product.id, quantity: '3', unitPrice: '400' }],
    },
  })).body;
  check('order placed', orderA?.status === 'PLACED', orderA);

  const confirmA = await call('POST', `/commerce/orders/${orderA.id}/confirm`, { token: seller.token });
  check('order confirmed and stock reserved', confirmA.body?.status === 'CONFIRMED', confirmA.body);

  const fulfilA = await call('POST', `/commerce/orders/${orderA.id}/fulfil`, { token: seller.token });
  check('order fulfilled', fulfilA.body?.status === 'FULFILLED', fulfilA.body);
  check('fulfilment raised a transfer', typeof fulfilA.body?.transferId === 'number', fulfilA.body);
  check('and not a sale', fulfilA.body?.saleId === null, fulfilA.body);

  const dispatched = (await call('GET', `/items/${units[0].qrCode}`, { token: seller.token })).body;
  check('reserved goods are now IN_TRANSIT', dispatched?.status === 'IN_TRANSIT', dispatched?.status);

  // The receipt is the point of the whole exercise: it is what a transfer with
  // no lines, or one addressed back to the sender, could never reach.
  const receipt = await call('POST', `/transfers/${fulfilA.body.transferId}/receive`, {
    token: buyer.token, body: { destinationLocationId: buyerLoc.id },
  });
  check('the buyer can receive the fulfilment transfer',
    receipt.status === 200 || receipt.status === 201, receipt.body);
  check('transfer closes as RECEIVED', receipt.body?.status === 'RECEIVED', receipt.body?.status);
  check('it carried the reserved identities', receipt.body?.lineCount === 3, receipt.body?.lineCount);

  const held = (await call('GET', `/items/${units[0].qrCode}`, { token: buyer.token })).body;
  check('custody moved to the buyer', held?.holderId === buyer.orgId, held);
  check('and the goods are sellable again', held?.status === 'ACTIVE', held?.status);

  console.log('\n=== 5. Order to the off-platform customer → sale ===');
  const orderB = (await call('POST', '/commerce/orders', {
    token: seller.token,
    body: {
      customerId: walkIn.id,
      lines: [{ productId: product.id, quantity: '2', unitPrice: '400' }],
    },
  })).body;
  await call('POST', `/commerce/orders/${orderB.id}/confirm`, { token: seller.token });

  const fulfilB = await call('POST', `/commerce/orders/${orderB.id}/fulfil`, { token: seller.token });
  check('order fulfilled', fulfilB.body?.status === 'FULFILLED', fulfilB.body);
  check('fulfilment recorded a sale', typeof fulfilB.body?.saleId === 'number', fulfilB.body);
  check('and raised no transfer', fulfilB.body?.transferId === null, fulfilB.body);

  // FEFO decides which identities each order took, so ask the goods rather
  // than assuming an ordering.
  const states = [];
  for (const unit of units) {
    const row = (await call('GET', `/items/${unit.qrCode}`, { token: seller.token })).body;
    states.push({ qrCode: unit.qrCode, status: row?.status ?? row?.message });
  }
  const soldUnits = states.filter((s) => s.status === 'SOLD');
  check('two identities left the chain as SOLD', soldUnits.length === 2, states);

  const scan = await call('GET', `/verify/${soldUnits[0]?.qrCode}`);
  check('a public scan reports the sale', /sold/i.test(scan.body?.verdict ?? ''), scan.body);

  console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
