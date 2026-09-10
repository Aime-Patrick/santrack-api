import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Announcement, AnnouncementCategory } from '../entities/announcement.entity';

export interface AnnouncementListItem {
  id: number;
  title: string;
  excerpt: string;
  category: AnnouncementCategory;
  author: string;
  readTime: string | null;
  slug: string;
  published: boolean;
  publishedAt: string | null;
  createdAt: string;
  /** Name of the organization that posted it; null = platform team. */
  organizationName: string | null;
}

export interface CreateAnnouncementDto {
  title: string;
  excerpt: string;
  body?: string;
  category: AnnouncementCategory;
  author: string;
  readTime?: string;
  slug: string;
  published?: boolean;
  publishedAt?: string;
}

export interface UpdateAnnouncementDto {
  title?: string;
  excerpt?: string;
  body?: string;
  category?: AnnouncementCategory;
  author?: string;
  readTime?: string;
  slug?: string;
}

@Injectable()
export class AnnouncementService {
  constructor(
    @InjectRepository(Announcement)
    private readonly repo: Repository<Announcement>,
  ) {}

  private toListItem(a: Announcement): AnnouncementListItem {
    return {
      id: a.id,
      title: a.title,
      excerpt: a.excerpt,
      category: a.category,
      author: a.author,
      readTime: a.readTime,
      slug: a.slug,
      published: a.published,
      publishedAt: a.publishedAt ? a.publishedAt.toISOString() : null,
      createdAt: a.createdAt.toISOString(),
      organizationName: a.organizationName,
    };
  }

  /** Public: published announcements only, newest first. */
  async listPublished(category?: AnnouncementCategory): Promise<AnnouncementListItem[]> {
    const qb = this.repo
      .createQueryBuilder('a')
      .where('a.published = TRUE')
      .orderBy('a.published_at', 'DESC');

    if (category) {
      qb.andWhere('a.category = :category', { category });
    }

    const rows = await qb.getMany();
    return rows.map((a) => this.toListItem(a));
  }

  /** Admin: ALL announcements (including drafts), newest first. */
  async listAll(): Promise<AnnouncementListItem[]> {
    const rows = await this.repo.find({ order: { createdAt: 'DESC' } });
    return rows.map((a) => this.toListItem(a));
  }

  /**
   * Create a new announcement on behalf of a user and their organization.
   * organizationId/organizationName are null when the platform operator posts.
   */
  async create(
    dto: CreateAnnouncementDto,
    actorId: number,
    organizationId: number | null,
    organizationName: string | null,
  ): Promise<Announcement> {
    const entity = this.repo.create({
      ...dto,
      createdById: actorId,
      organizationId,
      organizationName,
      publishedAt: dto.publishedAt
        ? new Date(dto.publishedAt)
        : dto.published
          ? new Date()
          : null,
    });
    return this.repo.save(entity);
  }

  /** Publish or unpublish. */
  async setPublished(id: number, published: boolean): Promise<void> {
    await this.repo.update(id, {
      published,
      publishedAt: published ? new Date() : undefined,
    });
  }

  /** Update editable fields of an announcement. */
  async update(id: number, dto: UpdateAnnouncementDto): Promise<AnnouncementListItem> {
    const existing = await this.repo.findOneBy({ id });
    if (!existing) throw new NotFoundException(`Announcement ${id} not found`);
    Object.assign(existing, dto);
    const saved = await this.repo.save(existing);
    return this.toListItem(saved);
  }

  /** Permanently delete an announcement. */
  async remove(id: number): Promise<void> {
    const existing = await this.repo.findOneBy({ id });
    if (!existing) throw new NotFoundException(`Announcement ${id} not found`);
    await this.repo.remove(existing);
  }
}
