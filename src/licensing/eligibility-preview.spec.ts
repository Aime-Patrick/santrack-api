import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';

import { ProductionEligibilityController } from './controllers/production-eligibility.controller';
import { EligibilityQueryDto } from './dto/eligibility.dto';
import { EligibilityCheckCode } from './eligibility';

/**
 * DR-07 WU-5: the preview endpoint.
 *
 * It renders and it does not decide. The row-count proof that it writes nothing
 * (DR §24 invariant 11) is an integration check against a running API and a
 * real database; what is held here is the narrower rule that made that
 * invariant necessary — the controller reaches the eligibility service and
 * nothing else, and hands back what it was given without touching the verdict.
 */
describe('the eligibility preview endpoint', () => {
  const ORG = { id: 7, name: 'Acme Dairy' } as never;

  const result = {
    eligible: false,
    blocking: false,
    enforcementMode: 'ADVISORY' as const,
    evaluatedAt: new Date('2026-08-21T09:00:00Z'),
    checks: [
      {
        code: EligibilityCheckCode.ORGANIZATION_LICENCE,
        status: 'FAIL' as const,
        message: 'No licence.',
      },
    ],
    reliedOn: { licenseIds: [], licenseNumbers: [], categoryCodes: [] },
    rulesetVersion: 'DR07-MVP-1',
  };

  function harness() {
    const evaluate = jest.fn().mockResolvedValue(result);
    const controller = new ProductionEligibilityController({ evaluate } as never);
    return { controller, evaluate };
  }

  it('passes the question through, naming the caller organization itself', async () => {
    // The organization comes from the token, never from the query string: a
    // client that could name the organization could ask about somebody else's.
    const { controller, evaluate } = harness();

    await controller.preview(ORG, {
      productId: 100,
      facilityId: 11,
      quantity: 500,
      date: '2026-09-01',
    });

    expect(evaluate).toHaveBeenCalledWith({
      organizationId: 7,
      facilityId: 11,
      productId: 100,
      requestedQuantity: 500,
      requestedDate: '2026-09-01',
    });
  });

  it('leaves the verdict exactly as the service computed it', async () => {
    // A verdict recomputed on the way out is a second implementation of the
    // rule, and two implementations of a regulatory rule is how they disagree.
    const { controller } = harness();

    const rendered = await controller.preview(ORG, { productId: 100, quantity: 1 });

    expect(rendered).toBe(result);
    expect(rendered.eligible).toBe(false);
    expect(rendered.blocking).toBe(false);
  });

  it('treats an unnamed site and an unnamed date as unnamed, not as zero', async () => {
    const { controller, evaluate } = harness();

    await controller.preview(ORG, { productId: 100, quantity: 1 });

    expect(evaluate.mock.calls[0][0].facilityId).toBeNull();
    expect(evaluate.mock.calls[0][0].requestedDate).toBeNull();
  });

  describe('the query it accepts', () => {
    const parse = (query: Record<string, string>) =>
      validate(plainToInstance(EligibilityQueryDto, query));

    it('converts the numbers a query string delivers as text', async () => {
      const dto = plainToInstance(EligibilityQueryDto, {
        productId: '100',
        facilityId: '11',
        quantity: '500',
      });
      expect(await validate(dto)).toEqual([]);
      expect(dto.productId).toBe(100);
      expect(dto.facilityId).toBe(11);
      expect(dto.quantity).toBe(500);
    });

    it('answers a half-filled form: site and date are optional', async () => {
      expect(await parse({ productId: '100', quantity: '1' })).toEqual([]);
    });

    it('refuses a run of nothing', async () => {
      const errors = await parse({ productId: '100', quantity: '0' });
      expect(errors).toHaveLength(1);
    });

    it('refuses a product that is not a number', async () => {
      const errors = await parse({ productId: 'all', quantity: '1' });
      expect(errors.map((error) => error.property)).toContain('productId');
    });
  });
});
