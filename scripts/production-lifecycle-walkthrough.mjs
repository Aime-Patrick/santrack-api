// End-to-end walk of the canonical manufacturing lifecycle (Phase 3):
// Production Order → Start → Issue Materials → Complete → QC → Register Units
//
// This exercises: batch creation at order creation, batch status transitions
// (ACTIVE → PENDING_QC → APPROVED), batch-level traceability events,
// the registerUnits gate (permitsIdentityAssignment + cumulative cap),
// and the timeline merge (viaBatch).

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

async function main() {
  // ------------------------------------------------------------------
  // 1. Onboard a manufacturer
  // ------------------------------------------------------------------
  console.log('\n=== 1. Onboard manufacturer ===');
  const email = `mfg-${stamp}@example.com`;
  const reg = await call('POST', '/auth/register', {
    body: { email, password: 'Passw0rd!', fullName: 'Mfg Admin' },
  });
  check('register', reg.status === 201, reg.body);
  const token = reg.body.token;

  const org = await call('POST', '/organizations', {
    token, body: { name: `MfgCo ${stamp}`, type: 'MANUFACTURER' },
  });
  check('org created', org.status === 201, org.body);
  const orgId = org.body.id;

  // Re-login
  const login = await call('POST', '/auth/login', { body: { email, password: 'Passw0rd!' } });
  const t = login.body?.token ?? token;

  const loc = (await call('POST', '/locations', {
    token: t, body: { name: 'Factory Floor', type: 'FACTORY' },
  })).body;
  check('location created', loc?.id, loc);

  // ------------------------------------------------------------------
  // 2. Create a product
  // ------------------------------------------------------------------
  console.log('\n=== 2. Create product ===');
  const category = (await call('POST', '/product-categories', {
    token: t, body: { name: `Widgets ${stamp}`, code: `WGT-${stamp}` },
  })).body;
  check('category created', !!category?.id, category);
  const product = (await call('POST', '/products', {
    token: t, body: { name: 'Widget X', sku: `WGX-${stamp}`, categoryId: category.id },
  })).body;
  check('product created', product?.id, product);

  // ------------------------------------------------------------------
  // 3. Create a production order — batch is created as ACTIVE
  // ------------------------------------------------------------------
  console.log('\n=== 3. Create production order (batch = ACTIVE) ===');
  const order = (await call('POST', '/production-orders', {
    token: t,
    body: { productId: product.id, plannedQuantity: 50 },
  })).body;
  check('order created', order?.id, order?.orderNumber);
  check('order status is PLANNED', order?.status === 'PLANNED', order?.status);
  check('batch created at order creation', order?.batchId !== null, order?.batchId);
  check('batch code matches order number', order?.batchCode === order?.orderNumber, {
    batchCode: order?.batchCode, orderNumber: order?.orderNumber,
  });

  // Verify batch is ACTIVE (permits identity assignment before QC)
  const batchRes = await call('GET', `/batches/${order.batchId}`, { token: t });
  const batchBefore = batchRes.body;
  check('batch starts ACTIVE', batchRes.status === 200 && batchBefore?.status === 'ACTIVE', batchRes.status === 200 ? batchBefore?.status : batchRes.status);

  // ------------------------------------------------------------------
  // 4. Start production — emits PRODUCTION_STARTED
  // ------------------------------------------------------------------
  console.log('\n=== 4. Start production ===');
  const started = (await call('POST', `/production-orders/${order.id}/start`, {
    token: t, body: { notes: 'Shift 1 begins' },
  })).body;
  check('order is IN_PROGRESS', started?.status === 'IN_PROGRESS', started?.status);
  check('startedAt is set', started?.startedAt !== null);

  // ------------------------------------------------------------------
  // 5. Issue materials — emits MATERIAL_ISSUED
  // ------------------------------------------------------------------
  console.log('\n=== 5. Issue materials ===');
  // First create a raw material
  const material = (await call('POST', '/raw-materials', {
    token: t,
    body: { name: 'Steel Sheet', code: `STL-${stamp}`, unitOfMeasure: 'kg', unitCost: 5.5 },
  })).body;
  check('raw material created', material?.id, material);

  // Allocate then issue
  const allocated = await call('POST', `/production-orders/${order.id}/materials/allocate`, {
    token: t, body: { materials: [{ materialId: material.id, quantity: 100 }] },
  });
  check('materials allocated', allocated.status === 200, { status: allocated.status, body: allocated.body, materialId: material.id });

  const issued = await call('POST', `/production-orders/${order.id}/materials/issue`, {
    token: t, body: { materials: [{ materialId: material.id, quantity: 80 }] },
  });
  check('materials issued', issued.status === 200, issued.body?.status);

  // ------------------------------------------------------------------
  // 6. Complete production — batch moves to PENDING_QC, emits PRODUCTION_COMPLETED
  // ------------------------------------------------------------------
  console.log('\n=== 6. Complete production (batch → PENDING_QC) ===');
  const completed = (await call('POST', `/production-orders/${order.id}/complete`, {
    token: t, body: { producedQuantity: 50, expiresOn: '2030-12-31' },
  })).body;
  check('order is COMPLETED', completed?.status === 'COMPLETED', completed?.status);
  check('producedQuantity recorded', completed?.producedQuantity === 50, completed?.producedQuantity);

  // Verify batch moved to PENDING_QC
  const batchAfterComplete = (await call('GET', `/batches/${order.batchId}`, { token: t })).body;
  check('batch is PENDING_QC after completion', batchAfterComplete?.status === 'PENDING_QC',
    batchAfterComplete?.status);

  // The lot is opened when the order is planned, so it carries no dates until
  // something is actually made. Completion is that moment. Items copy
  // expiresOn from the batch when they are registered, so a lot that finishes
  // undated produces stock that can never expire and a public scan that
  // cannot say when the product was made.
  check('batch dated at completion', /^\d{4}-\d{2}-\d{2}$/.test(batchAfterComplete?.manufacturedOn ?? ''),
    batchAfterComplete?.manufacturedOn);
  check('shelf date applied to the lot', batchAfterComplete?.expiresOn === '2030-12-31',
    batchAfterComplete?.expiresOn);

  // ------------------------------------------------------------------
  // 7. Attempt to register units while batch is PENDING_QC — should fail
  // ------------------------------------------------------------------
  console.log('\n=== 7. Gate: registerUnits blocked while PENDING_QC ===');
  const tooEarly = await call('POST', '/items/units', {
    token: t,
    body: { productId: product.id, batchId: order.batchId, count: 5, locationId: loc.id },
  });
  check('registerUnits refused before QC approval', tooEarly.status === 409, tooEarly.body?.message);

  // ------------------------------------------------------------------
  // 8. QC inspection — APPROVED, batch moves to APPROVED
  // ------------------------------------------------------------------
  console.log('\n=== 8. QC inspection → APPROVED ===');
  const inspection = (await call('POST', '/quality-inspections', {
    token: t,
    body: {
      productionOrderId: order.id,
      result: 'APPROVED',
      notes: 'All 50 units pass visual and functional checks',
    },
  })).body;
  check('inspection recorded', inspection?.id, inspection?.result);

  // Verify batch moved to APPROVED
  const batchAfterQC = (await call('GET', `/batches/${order.batchId}`, { token: t })).body;
  check('batch is APPROVED after QC', batchAfterQC?.status === 'APPROVED', batchAfterQC?.status);
  check('batch has statusReason', batchAfterQC?.statusReason?.includes('APPROVED'), batchAfterQC?.statusReason);
  check('batch has previousStatus = PENDING_QC', batchAfterQC?.previousStatus === 'PENDING_QC',
    batchAfterQC?.previousStatus);

  // ------------------------------------------------------------------
  // 9. Register units — now allowed, cumulative cap enforced
  // ------------------------------------------------------------------
  console.log('\n=== 9. Register 30 units (within cap of 50) ===');
  const units1 = (await call('POST', '/items/units', {
    token: t,
    body: { productId: product.id, batchId: order.batchId, count: 30, locationId: loc.id },
  })).body;
  check('30 units registered', Array.isArray(units1) && units1.length === 30, units1?.length);
  check('all have batch link', units1.every(u => u.batchId === order.batchId), units1[0]?.batchId);

  console.log('\n=== 9b. Register 20 more (exactly hits cap of 50) ===');
  const units2 = (await call('POST', '/items/units', {
    token: t,
    body: { productId: product.id, batchId: order.batchId, count: 20, locationId: loc.id },
  })).body;
  check('20 more registered (total 50)', Array.isArray(units2) && units2.length === 20, units2?.length);

  // ------------------------------------------------------------------
  // 10. Cumulative cap — attempt to exceed should fail
  // ------------------------------------------------------------------
  console.log('\n=== 10. Cumulative cap: 51st unit refused ===');
  const overCap = await call('POST', '/items/units', {
    token: t,
    body: { productId: product.id, batchId: order.batchId, count: 1, locationId: loc.id },
  });
  check('registerUnits refused when cap exceeded', overCap.status === 409, overCap.body?.message);
  check('error mentions produced quantity', overCap.body?.message?.includes('50'),
    overCap.body?.message);

  // ------------------------------------------------------------------
  // 11. Attempt to re-inspect — blocked because batch is already APPROVED
  //     and no events have moved it out of APPROVED
  // ------------------------------------------------------------------
  console.log('\n=== 11. Re-inspection on APPROVED batch ===');
  const reinspect = await call('POST', '/quality-inspections', {
    token: t,
    body: { productionOrderId: order.id, result: 'REJECTED', notes: 'Second guess' },
  });
  // permitsInspection(APPROVED) = true, but no circulation events exist,
  // so re-inspection IS allowed (rejection is not terminal).
  check('re-inspection allowed on APPROVED batch', reinspect.status === 201, reinspect.body?.status);

  // The batch should now be REJECTED
  const batchAfterReinspect = (await call('GET', `/batches/${order.batchId}`, { token: t })).body;
  check('batch is REJECTED after re-inspection', batchAfterReinspect?.status === 'REJECTED',
    batchAfterReinspect?.status);
  check('previousStatus restored to APPROVED', batchAfterReinspect?.previousStatus === 'APPROVED',
    batchAfterReinspect?.previousStatus);

  // ------------------------------------------------------------------
  // 12. Attempt to register more units while REJECTED — should fail
  // ------------------------------------------------------------------
  console.log('\n=== 12. Gate: registerUnits blocked while REJECTED ===');
  const rejected = await call('POST', '/items/units', {
    token: t,
    body: { productId: product.id, batchId: order.batchId, count: 1, locationId: loc.id },
  });
  check('registerUnits refused while REJECTED', rejected.status === 409, rejected.body?.message);

  // ------------------------------------------------------------------
  // 13. Re-approve after rework
  // ------------------------------------------------------------------
  console.log('\n=== 13. Re-approve after rework ===');
  const reapprove = await call('POST', '/quality-inspections', {
    token: t,
    body: { productionOrderId: order.id, result: 'APPROVED', notes: 'Fixed and re-tested' },
  });
  check('re-approval succeeds', reapprove.status === 201, reapprove.body?.result);

  const batchReapproved = (await call('GET', `/batches/${order.batchId}`, { token: t })).body;
  check('batch back to APPROVED', batchReapproved?.status === 'APPROVED', batchReapproved?.status);

  // ------------------------------------------------------------------
  // 14. Register remaining 0 units (cap is 50, already registered 50)
  // ------------------------------------------------------------------
  console.log('\n=== 14. Cap still enforced after re-approval ===');
  const stillCapped = await call('POST', '/items/units', {
    token: t,
    body: { productId: product.id, batchId: order.batchId, count: 1, locationId: loc.id },
  });
  check('still cannot exceed cap after re-approval', stillCapped.status === 409, stillCapped.body?.message);

  // ------------------------------------------------------------------
  // 15. Timeline — batch-level events appear via viaBatch
  // ------------------------------------------------------------------
  console.log('\n=== 15. Timeline includes batch-level events ===');
  const firstUnit = units1[0];
  const trace = (await call('GET', `/trace/${firstUnit.qrCode}`, { token: t })).body;
  const types = trace?.events?.map(e => e.type) ?? [];
  console.log('  timeline:', types.join(' -> '));

  check('timeline contains MANUFACTURED', types.includes('MANUFACTURED'));
  check('timeline contains PRODUCTION_STARTED via batch', types.includes('PRODUCTION_STARTED'),
    types.filter(t => t.includes('PRODUCTION')));
  check('timeline contains PRODUCTION_COMPLETED via batch', types.includes('PRODUCTION_COMPLETED'));
  check('timeline contains QC_INSPECTED via batch', types.includes('QC_INSPECTED'));
  check('timeline contains BATCH_APPROVED via batch', types.includes('BATCH_APPROVED'));

  // Check viaBatch is set on batch-level entries
  const batchEntries = trace.events.filter(e => e.viaBatch !== null);
  check('batch-level entries have viaBatch', batchEntries.length > 0, batchEntries.length);
  check('viaBatch matches order number', batchEntries[0]?.viaBatch === order.orderNumber,
    batchEntries[0]?.viaBatch);

  // ------------------------------------------------------------------
  // 16. Amend produced quantity — should work on completed order
  // ------------------------------------------------------------------
  console.log('\n=== 16. Amend produced quantity ===');
  // First re-complete to get back to COMPLETED status
  // Actually, the order is still COMPLETED (QC doesn't change order status)
  const amend = await call('POST', `/production-orders/${order.id}/amend-quantity`, {
    token: t,
    body: { newQuantity: 55, reason: 'Found 5 more units during final count' },
  });
  check('amendment succeeds', amend.status === 200, amend.body?.status);
  check('producedQuantity updated to 55', amend.body?.producedQuantity === 55, amend.body?.producedQuantity);

  // But we have 50 registered — amendment cannot go below registered count
  const badAmend = await call('POST', `/production-orders/${order.id}/amend-quantity`, {
    token: t,
    body: { newQuantity: 40, reason: 'Try to go below registered' },
  });
  check('amendment refused when below registered count', badAmend.status === 409, badAmend.body?.message);

  // ------------------------------------------------------------------
  // 17. Compliance metric — unregistered products
  // ------------------------------------------------------------------
  console.log('\n=== 17. Compliance metric ===');
  const compliance = (await call('GET', '/analytics/compliance', { token: t })).body;
  check('compliance returns unregisteredProducts', compliance?.unregisteredProducts !== undefined,
    compliance?.unregisteredProducts);
  // 55 produced - 50 registered = 5 unregistered
  check('unregisteredProducts is 5 (produced 55 - registered 50)',
    compliance?.unregisteredProducts === 5, compliance?.unregisteredProducts);

  // ------------------------------------------------------------------
  console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(e => { console.error('SCRIPT ERROR:', e); process.exit(2); });
