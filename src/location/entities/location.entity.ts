import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Facility } from '../../organization/entities/facility.entity';
import { Organization } from '../../organization/entities/organization.entity';
import { LocationType } from '../location-type.enum';

/** A physical place belonging to one organization. */
@Entity('locations')
@Index('idx_location_org', ['organization'])
export class Location {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => Organization, { nullable: false, eager: true })
  @JoinColumn({ name: 'organization_id' })
  organization: Organization;

  @Column({ nullable: false })
  name: string;

  /**
   * The scannable label on the bay, dock or shelf - LOC-000001.
   *
   * A warehouse does not pick its locations out of a dropdown; every place
   * that can hold stock has a barcode stuck to it, and the operator scans the
   * shelf they are standing at. Without a code there is nothing to print and
   * nothing to scan, so every movement meant reading a list of place names on
   * a screen while holding a carton.
   *
   * Globally unique so a scan is unambiguous: a scanner cannot tell which
   * organization's shelf it is looking at, and two businesses both using
   * "LOC-000001" would resolve to each other's premises.
   */
  @Index({ unique: true })
  @Column({ type: 'varchar', nullable: true, update: false })
  code: string | null;

  @Column({ type: 'enum', enum: LocationType, nullable: false })
  type: LocationType;

  @Column({ type: 'varchar', nullable: true })
  address: string | null;

  @Column({ default: true })
  active: boolean;

  /**
   * The site this belongs to (DR-02). Nullable: a business with no plant is not
   * forced to invent one, and historic rows were backfilled to their
   * organization's main site.
   */
  @ManyToOne(() => Facility, { nullable: true, eager: true })
  @JoinColumn({ name: 'facility_id' })
  facility: Facility | null;

  @Column({ name: 'facility_id', type: 'int', nullable: true })
  facilityId: number | null;

}
