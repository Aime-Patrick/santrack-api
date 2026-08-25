import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Organization } from '../../organization/entities/organization.entity';

/**
 * A mark a business files products under.
 *
 * Held against the organization rather than the category, because one
 * manufacturer's marks routinely cross categories — Bralirwa brews Primus and
 * bottles Fanta Orange, beer and soft drink, one business. Filed by category
 * that list would split into unrelated halves, and a brand entering a new
 * category would become a second record. Which brands appear under a category
 * is read off the products, which already carry both facts.
 *
 * `organization` is not an assertion of who owns the mark in law: Bralirwa
 * produces Fanta under licence and Heineken belongs to its parent. It records
 * which business may file products under it here.
 */
@Entity('brands')
@Index('idx_brand_org', ['organizationId'])
@Index('idx_brand_org_code', ['organizationId', 'code'], { unique: true })
export class Brand {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => Organization, { nullable: false, eager: true })
  @JoinColumn({ name: 'organization_id' })
  organization: Organization;

  @Column({ name: 'organization_id', nullable: false })
  organizationId: number;

  /**
   * The machine name, derived from the display name.
   *
   * Unique per organization, and the reason "Mützig" and "Mutzig" cannot both
   * exist in one list: both fold to MUTZIG.
   */
  @Column({ nullable: false })
  code: string;

  @Column({ nullable: false })
  name: string;

  /**
   * Withdrawn brands stay readable, matching how a ProductCategory retires — a
   * product filed under a discontinued mark still has to say what it was sold
   * as.
   */
  @Column({ default: true })
  active: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
