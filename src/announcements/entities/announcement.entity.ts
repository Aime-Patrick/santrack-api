import {
  Column,
  CreateDateColumn,
  Entity,
  ManyToOne,
  JoinColumn,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Organization } from '../../organization/entities/organization.entity';
import { User } from '../../auth/entities/user.entity';

export enum AnnouncementCategory {
  RELEASE = 'RELEASE',
  REGULATORY = 'REGULATORY',
  INDUSTRY_NEWS = 'INDUSTRY_NEWS',
  STANDARD = 'STANDARD',
}

/**
 * A public-facing announcement shown on the /updates landing page.
 * Published by platform admins; read publicly without authentication.
 */
@Entity('announcements')
export class Announcement {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 300 })
  title: string;

  @Column({ type: 'varchar', length: 1000 })
  excerpt: string;

  /** Full body in Markdown. Rendered on the detail page. */
  @Column({ name: 'body', type: 'text', nullable: true })
  body: string | null;

  @Column({
    type: 'enum',
    enum: AnnouncementCategory,
    default: AnnouncementCategory.RELEASE,
  })
  category: AnnouncementCategory;

  @Column({ type: 'varchar', length: 150 })
  author: string;

  /** Approximate reading time shown to readers, e.g. "3 min read". */
  @Column({ name: 'read_time', type: 'varchar', length: 30, nullable: true })
  readTime: string | null;

  /** Slug used in the URL, e.g. "gs1-digital-link-rollout". Unique. */
  @Column({ type: 'varchar', length: 200, unique: true })
  slug: string;

  /** False = draft; True = live on the public page. */
  @Column({ name: 'published', type: 'boolean', default: false })
  published: boolean;

  /** When the announcement was publicly released. Defaults to created_at. */
  @Column({ name: 'published_at', type: 'timestamptz', nullable: true })
  publishedAt: Date | null;

  /**
   * The organization that posted this announcement (null = platform operator).
   * Shown on the card so readers know whether it is a regulatory notice,
   * an authority advisory, or a platform release note.
   */
  @Column({ name: 'organization_id', type: 'integer', nullable: true })
  organizationId: number | null;

  @ManyToOne(() => Organization, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'organization_id' })
  organization: Organization | null;

  /** Denormalized org name so the public list endpoint is a single query. */
  @Column({ name: 'organization_name', type: 'varchar', length: 200, nullable: true })
  organizationName: string | null;

  /** Who created this record (for the admin trail). */
  @Column({ name: 'created_by_id', type: 'integer', nullable: true })
  createdById: number | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'created_by_id' })
  createdBy: User | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
