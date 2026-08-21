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

/**
 * The canonical taxonomy of what SANTRACK's products are.
 *
 * Deliberately owned by the platform, not by a regulator (DR-05). A category is
 * a description of goods, and two authorities can legitimately classify the same
 * physical product differently - if the taxonomy belonged to one of them, a
 * manufacturer's product would have to sit in two mutually exclusive schemes.
 * Regulatory requirements will later attach *to* categories without owning them.
 *
 * Replaces the free-text `Product.category` string, where "Dairy", "DAIRY" and
 * "dairy" were three separate regulatory universes and nothing prevented a
 * fourth.
 */
@Entity('product_categories')
export class ProductCategory {
  @PrimaryGeneratedColumn()
  id: number;

  /** Stable machine name, upper case. What integrations and rules refer to. */
  @Index({ unique: true })
  @Column({ nullable: false })
  code: string;

  @Column({ nullable: false })
  name: string;

  /**
   * The broader category this sits under - Food > Dairy > Yogurt.
   *
   * Taxonomy and navigation only. A requirement placed on Dairy does **not**
   * automatically reach Yogurt: inheriting a legal obligation down a tree is an
   * assertion the platform is not entitled to make on an authority's behalf. If
   * a rule is ever meant to cover a subtree, that becomes an explicit property
   * of the requirement, decided then (DR-05).
   */
  @ManyToOne(() => ProductCategory, { nullable: true, eager: false })
  @JoinColumn({ name: 'parent_id' })
  parent: ProductCategory | null;

  @Column({ name: 'parent_id', type: 'int', nullable: true })
  parentId: number | null;

  /**
   * Withdrawn categories stay readable so historical products still describe
   * themselves, matching how LicenseCategory retires.
   */
  @Column({ default: true })
  active: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
