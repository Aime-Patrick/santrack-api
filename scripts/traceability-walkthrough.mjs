// End-to-end walk of the MVP path from the architecture doc, section 15:
// Manufacturer -> Warehouse -> Retailer -> Consumer, then a batch recall.
const BASE = (process.env.API_BASE ?? "http://localhost:8081") + "/api";
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

async function onboard(name, type) {
  const email = `${name.toLowerCase()}-${stamp}@example.com`;
  const reg = await call('POST', '/auth/register', {
    body: { email, password: 'Passw0rd!', fullName: `${name} Admin` },
  });
  if (reg.status !== 201) throw new Error(`register ${name}: ${JSON.stringify(reg)}`);
  const token = reg.body.token;

  const org = await call('POST', '/organizations', {
    token, body: { name: `${name} ${stamp}`, type },
  });
  if (org.status !== 201) throw new Error(`org ${name}: ${JSON.stringify(org)}`);

  // Re-login so the token carries the organization if it is embedded there.
  const login = await call('POST', '/auth/login', { body: { email, password: 'Passw0rd!' } });
  return { token: login.body?.token ?? token, orgId: org.body.id, name };
}

async function main() {
  console.log('\n=== 1. Onboarding the three parties ===');
  const maker = await onboard('Maker', 'MANUFACTURER');
  const depot = await onboard('Depot', 'WAREHOUSE');
  const shop = await onboard('Shop', 'RETAILER');
  console.log(`  maker=${maker.orgId} depot=${depot.orgId} shop=${shop.orgId}`);

  const makerLoc = (await call('POST', '/locations', {
    token: maker.token, body: { name: 'Assembly Line', type: 'FACTORY' },
  })).body;
  const depotLoc = (await call('POST', '/locations', {
    token: depot.token, body: { name: 'Main Warehouse', type: 'WAREHOUSE' },
  })).body;
  const shopLoc = (await call('POST', '/locations', {
    token: shop.token, body: { name: 'High Street', type: 'SHOP' },
  })).body;
  check('locations created', makerLoc?.id && depotLoc?.id && shopLoc?.id);

  console.log('\n=== 2. Catalog and batch ===');
  const category = (await call('POST', '/product-categories', {
    token: maker.token, body: { name: `Demo Goods ${stamp}`, code: `DEMO-${stamp}` },
  })).body;
  check('category created', !!category?.id, category);
  const product = (await call('POST', '/products', {
    token: maker.token,
    body: { name: 'ThinkPad T14', sku: `LPT-${stamp}`, categoryId: category.id },
  })).body;
  const batch = (await call('POST', '/batches', {
    token: maker.token,
    body: {
      productId: product.id, batchCode: `BT-${stamp}`,
      manufacturedOn: '2026-08-01', expiresOn: '2030-01-01',
    },
  })).body;
  check('batch created with manufacturer', batch?.manufacturerId === maker.orgId, batch);

  console.log('\n=== 3. Manufacturing 20 permanent identities ===');
  const units = (await call('POST', '/items/units', {
    token: maker.token,
    body: { productId: product.id, batchId: batch.id, count: 20, locationId: makerLoc.id },
  })).body;
  check('20 units minted', units?.length === 20, units?.length);
  check('QR identities are unique', new Set(units.map(u => u.qrCode)).size === 20);
  check('human codes are sequential', /-\d{6}$/.test(units[0].code), units[0]?.code);

  console.log('\n=== 4. Packing into two boxes ===');
  const boxA = (await call('POST', '/items/packages', {
    token: maker.token,
    body: { packageType: 'BOX', productId: product.id, batchId: batch.id, locationId: makerLoc.id },
  })).body;
  const boxB = (await call('POST', '/items/packages', {
    token: maker.token,
    body: { packageType: 'BOX', productId: product.id, batchId: batch.id, locationId: makerLoc.id },
  })).body;
  check('boxes start SEALED', boxA?.sealState === 'SEALED' && boxB?.sealState === 'SEALED');

  const packA = await call('POST', `/items/${boxA.qrCode}/pack`, {
    token: maker.token, body: { childQrCodes: units.slice(0, 10).map(u => u.qrCode) },
  });
  const packB = await call('POST', `/items/${boxB.qrCode}/pack`, {
    token: maker.token, body: { childQrCodes: units.slice(10, 20).map(u => u.qrCode) },
  });
  check('box A holds 10', packA.body?.remainingCount === 10, packA.body?.remainingCount);
  check('box A quantity rolled up', packA.body?.container?.quantity === 10, packA.body?.container);
  check('box B holds 10', packB.body?.remainingCount === 10);

  const doublePack = await call('POST', `/items/${boxB.qrCode}/pack`, {
    token: maker.token, body: { childQrCodes: [units[0].qrCode] },
  });
  check('rule 10: a unit cannot sit in two boxes', doublePack.status === 409, doublePack.body);

  console.log('\n=== 5. Manufacturer -> Warehouse ===');
  const dispatch1 = await call('POST', '/transfers', {
    token: maker.token,
    body: {
      destinationOrganizationId: depot.orgId,
      sourceLocationId: makerLoc.id,
      itemQrCodes: [boxA.qrCode, boxB.qrCode],
    },
  });
  check('dispatch created', dispatch1.status === 201, dispatch1.body);

  const inTransit = (await call('GET', `/items/${units[0].qrCode}`, { token: maker.token })).body;
  check('rule 7: units inside a dispatched box move with it',
        inTransit?.status === 'IN_TRANSIT', inTransit?.status);

  const soldTooEarly = await call('POST', '/sales', {
    token: maker.token,
    body: { type: 'CONSUMER', consumerRef: 'x', itemQrCodes: [boxA.qrCode] },
  });
  check('goods in transit cannot be sold', soldTooEarly.status === 409, soldTooEarly.body);

  const recv1 = await call('POST', `/transfers/${dispatch1.body.id}/receive`, {
    token: depot.token, body: { destinationLocationId: depotLoc.id },
  });
  check('warehouse confirmed receipt', recv1.body?.status === 'RECEIVED', recv1.body?.status);

  const afterReceive = (await call('GET', `/items/${units[0].qrCode}`, { token: depot.token })).body;
  check('custody moved to the warehouse', afterReceive?.holderId === depot.orgId, afterReceive);
  check('nested unit followed to the new location',
        afterReceive?.locationName === 'Main Warehouse', afterReceive?.locationName);

  console.log('\n=== 6. Warehouse -> Retailer (box A only) ===');
  const dispatch2 = await call('POST', '/transfers', {
    token: depot.token,
    body: {
      destinationOrganizationId: shop.orgId,
      sourceLocationId: depotLoc.id,
      itemQrCodes: [boxA.qrCode],
    },
  });
  await call('POST', `/transfers/${dispatch2.body.id}/receive`, {
    token: shop.token, body: { destinationLocationId: shopLoc.id },
  });

  const depotStock = (await call('GET', '/inventory', { token: depot.token })).body;
  check('warehouse left holding 10 units', depotStock?.[0]?.availableUnits === 10, depotStock);

  console.log('\n=== 7. Retailer opens the box and sells one laptop ===');
  const opened = (await call('POST', `/items/${boxA.qrCode}/open`, { token: shop.token })).body;
  check('box A is OPEN', opened?.sealState === 'OPEN', opened?.sealState);

  const target = units[0];
  const removed = await call('POST', `/items/${boxA.qrCode}/remove`, {
    token: shop.token, body: { childQrCode: target.qrCode },
  });
  check('9 laptops remain in the box', removed.body?.remainingCount === 9, removed.body?.remainingCount);
  check('the removed one is still on record', removed.body?.removedCount === 1);
  check('rule 8: the box keeps its identity', removed.body?.container?.code === boxA.code);

  const sale = await call('POST', '/sales', {
    token: shop.token,
    body: {
      type: 'CONSUMER',
      consumerRef: '+250788000111',
      sellerLocationId: shopLoc.id,
      itemQrCodes: [target.qrCode],
      totalAmount: '1200',
    },
  });
  check('consumer sale recorded', sale.status === 201, sale.body);

  const sold = (await call('GET', `/items/${target.qrCode}`, { token: shop.token })).body;
  check('unit is SOLD', sold?.status === 'SOLD', sold?.status);
  check('seller can see the consumer reference', sold?.consumerRef === '+250788000111');

  const outsiderView = (await call('GET', `/items/${target.qrCode}`, { token: depot.token })).body;
  check('another business cannot see the consumer', outsiderView?.consumerRef === null,
        outsiderView?.consumerRef);

  const resell = await call('POST', '/sales', {
    token: shop.token,
    body: { type: 'CONSUMER', consumerRef: 'someone-else', itemQrCodes: [target.qrCode] },
  });
  check('a sold unit cannot be sold again', resell.status === 409, resell.body);

  console.log('\n=== 8. The timeline - the question the product exists to answer ===');
  const trace = (await call('GET', `/trace/${target.qrCode}`, { token: shop.token })).body;
  const types = trace?.events?.map(e => e.type) ?? [];
  console.log('  timeline:', types.join(' -> '));
  for (const expected of ['MANUFACTURED', 'PACKAGED', 'DISPATCHED', 'RECEIVED',
                          'PACKAGE_OPENED', 'UNIT_REMOVED', 'SOLD']) {
    check(`timeline contains ${expected}`, types.includes(expected));
  }
  check('the box journey is inherited by the unit',
        trace.events.some(e => e.viaContainer === boxA.code), trace.events.slice(0, 3));
  check('origin names the manufacturer', trace?.origin?.manufacturerName?.startsWith('Maker'),
        trace?.origin);

  console.log('\n=== 9. Public verification (no account) ===');
  const verify = (await call('GET', `/verify/${target.qrCode}`)).body;
  check('public scan confirms authenticity', verify?.known === true, verify);
  check('public scan hides the holder', verify?.holderName === undefined);
  check('public scan reports the verdict', typeof verify?.verdict === 'string', verify?.verdict);
  console.log('  verdict:', verify?.verdict);

  const bogus = (await call('GET', '/verify/not-a-real-code')).body;
  check('unknown codes are reported as unverified', bogus?.known === false);

  console.log('\n=== 10. Batch recall ===');
  const impactBefore = (await call('GET', `/recalls/batches/${batch.id}/impact`, {
    token: maker.token,
  })).body;
  check('impact sees all 22 identities before recall',
        impactBefore?.totalIdentities === 22, impactBefore?.totalIdentities);

  const notMine = await call('POST', '/recalls', {
    token: shop.token, body: { batchId: batch.id, reason: 'not my batch' },
  });
  check('only the manufacturer or a regulator can recall', notMine.status === 409, notMine.body);

  const recall = await call('POST', '/recalls', {
    token: maker.token, body: { batchId: batch.id, reason: 'Battery defect' },
  });
  check('recall issued', recall.status === 201, recall.body);
  check('sold units counted separately', recall.body?.soldToConsumers === 1,
        recall.body?.soldToConsumers);
  check('remaining stock is recoverable', recall.body?.recoverable === 21,
        recall.body?.recoverable);
  console.log('  holders affected:',
              recall.body?.holders?.map(h => `${h.organizationName}:${h.status}=${h.count}`).join(', '));

  const blockedSale = await call('POST', '/sales', {
    token: depot.token,
    body: { type: 'BUSINESS', buyerOrganizationId: shop.orgId, itemQrCodes: [boxB.qrCode] },
  });
  check('rule 11: recalled stock cannot be sold', blockedSale.status === 409, blockedSale.body);

  const verifyAfter = (await call('GET', `/verify/${target.qrCode}`)).body;
  check('a consumer scanning the sold unit is now warned', verifyAfter?.recalled === true);
  console.log('  verdict:', verifyAfter?.verdict);

  console.log('\n=== 11. Destruction closes the lifecycle ===');
  const destroyed = await call('POST', `/items/${boxB.qrCode}/lifecycle`, {
    token: depot.token, body: { action: 'DESTROY', reason: 'Recall disposal' },
  });
  check('box B destroyed', destroyed.body?.status === 'DESTROYED', destroyed.body);
  const insideDestroyed = (await call('GET', `/items/${units[15].qrCode}`, { token: depot.token })).body;
  check('its contents are destroyed with it', insideDestroyed?.status === 'DESTROYED',
        insideDestroyed?.status);

  console.log('\n=== 12. Offline replay safety ===');
  const clientEventId = `device-1-op-${stamp}`;
  const first = await call('POST', '/items/units', {
    token: maker.token,
    body: {
      productId: product.id, count: 1, locationId: makerLoc.id,
      meta: { clientEventId, deviceId: 'device-1', occurredAt: '2026-08-18T08:00:00Z' },
    },
  });
  const replay = await call('POST', '/items/units', {
    token: maker.token,
    body: {
      productId: product.id, count: 1, locationId: makerLoc.id,
      meta: { clientEventId, deviceId: 'device-1', occurredAt: '2026-08-18T08:00:00Z' },
    },
  });
  check('rule 12: a replayed client event id is rejected, not duplicated',
        first.status === 201 && replay.status === 409,
        { first: first.status, replay: replay.status });
  check('the replay response tells the client which event already applied',
        replay.body?.originalEventId !== undefined &&
        replay.body?.clientEventId === clientEventId, replay.body);

  console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(e => { console.error('SCRIPT ERROR:', e); process.exit(2); });
