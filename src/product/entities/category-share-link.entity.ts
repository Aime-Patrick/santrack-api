import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Organization } from '../../organization/entities/organization.entity';
import { User } from '../../auth/entities/user.entity';
import { ProductCategory } from './product-category.entity';

/**
 * A public, rotatable share link for one organization's view of a category.
 *
 * The QR encodes `${appPublicUrl}/c/{token}`. Rotating mints a new UUID and
 * deactivates the previous row so printed codes stop resolving immediately.
 */
@Entity('category_share_links')
@Index('uq_category_share_link_token', ['token'], { unique: true })
export class CategoryShareLink {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => ProductCategory, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'category_id' })
  category: ProductCategory;

  @Column({ name: 'category_id', type: 'int' })
  categoryId: number;

  @ManyToOne(() => Organization, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organization_id' })
  organization: Organization;

  @Column({ name: 'organization_id', type: 'int' })
  organizationId: number;

  /** Opaque UUID. Public lookup key — never sequential category ids. */
  @Column({ type: 'uuid' })
  token: string;

  @Column({ default: true })
  active: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @Column({ name: 'rotated_at', type: 'timestamptz', nullable: true })
  rotatedAt: Date | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'created_by_user_id' })
  createdBy: User | null;

  @Column({ name: 'created_by_user_id', type: 'int', nullable: true })
  createdByUserId: number | null;
}
