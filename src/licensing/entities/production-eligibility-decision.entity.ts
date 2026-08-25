import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from '../../auth/entities/user.entity';
import { Facility } from '../../organization/entities/facility.entity';
import { Organization } from '../../organization/entities/organization.entity';
import { Product } from '../../product/entities/product.entity';
import { EligibilityCheck } from '../eligibility';

/**
 * Why one production run was permitted, recorded at the moment it was permitted
 * (DR-07 §5 M2).
 *
 * Append-only, for the same reason `TraceabilityEvent` and `LicenseEvent` are:
 * if a regulator ever asks why a run went ahead, the answer has to be the
 * verdict that was actually reached — not today's rules re-run against today's
 * licences, which is a reconstruction wearing a record's clothes. Nothing in
 * the codebase updates or deletes one of these rows (DR §24 invariants 15, 16).
 *
 * It stores the *authoritative* evaluation, the one taken inside
 * `ProductionService.create()`. The preview the Start Production screen shows is
 * advisory and is never stored: a licence can lapse between the two, and it is
 * the second that decided.
 *
 * The whole check list is kept, not a summary. A verdict without its reasons
 * cannot be defended, and the two inert checks are part of the shape so a
 * decision taken today still reads the same way once they go live.
 */
@Entity('production_eligibility_decisions')
@Index('idx_ped_organization', ['organization'])
@Index('idx_ped_product', ['product'])
export class ProductionEligibilityDecision {
  /** bigserial: one row per production order, forever, never reused. */
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @ManyToOne(() => Organization, { nullable: false })
  @JoinColumn({ name: 'organization_id' })
  organization: Organization;

  @Column({ name: 'organization_id', type: 'int', nullable: false })
  organizationId: number;

  /** The site the run was for. Null where the business has none (DR-02). */
  @ManyToOne(() => Facility, { nullable: true })
  @JoinColumn({ name: 'facility_id' })
  facility: Facility | null;

  @Column({ name: 'facility_id', type: 'int', nullable: true })
  facilityId: number | null;

  @ManyToOne(() => Product, { nullable: false })
  @JoinColumn({ name: 'product_id' })
  product: Product;

  @Column({ name: 'product_id', type: 'int', nullable: false })
  productId: number;

  @Column({ name: 'requested_quantity', type: 'int', nullable: false })
  requestedQuantity: number;

  /**
   * The day the run was *for*, which is what licence validity was judged
   * against — not the day the decision was taken.
   */
  @Column({ name: 'requested_date', type: 'date', nullable: false })
  requestedDate: string;

  /** The regulatory verdict. Computed identically in all three modes. */
  @Column({ type: 'boolean', nullable: false })
  eligible: boolean;

  /** Whether creation was actually refused, which depends on the mode. */
  @Column({ type: 'boolean', nullable: false })
  blocking: boolean;

  /**
   * The mode in force when this was decided, stored because it is the
   * difference between "we permitted this" and "we noticed and permitted it
   * anyway". Changing the deployment setting later must not rewrite the past.
   */
  @Column({ name: 'enforcement_mode', type: 'varchar', length: 16, nullable: false })
  enforcementMode: string;

  /** All eight checks, in order, exactly as they were returned. */
  @Column({ type: 'jsonb', nullable: false })
  checks: EligibilityCheck[];

  /**
   * Licence ids, numbers and category codes together. Ids alone stop being an
   * audit record the moment a `LicenseCategory` is deactivated.
   */
  @Column({ name: 'relied_on', type: 'jsonb', nullable: false })
  reliedOn: {
    licenseIds: number[];
    licenseNumbers: string[];
    categoryCodes: string[];
  };

  @Column({ name: 'ruleset_version', type: 'varchar', length: 64, nullable: false })
  rulesetVersion: string;

  @CreateDateColumn({ name: 'evaluated_at', type: 'timestamptz' })
  evaluatedAt: Date;

  /** Who was starting the run. Null for anything the platform decided alone. */
  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'evaluated_by_id' })
  evaluatedBy: User | null;
}
