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
import { Organization } from './organization.entity';

/**
 * A real operational site: a plant, a depot, a works.
 *
 * Deliberately not the same thing as a Location. A location is a place stock
 * sits - a bay, a dock, a shelf - and there are many of them inside one site. A
 * facility is the site itself: the thing a regulator authorises, inspects and
 * names in a recall notice. Hanging an authorisation off a row that might be a
 * shelf would be wrong (DR-02, DR-05).
 *
 * Inyange runs Masaka and Nyagatare; Bralirwa runs Gisenyi and Kicukiro. Until
 * this existed, neither could answer which plant made a given batch - the first
 * question asked in a recall, and the one that decides how much stock has to be
 * withdrawn.
 */
@Entity('facilities')
@Index('idx_facility_org', ['organization'])
export class Facility {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => Organization, { nullable: false, eager: true })
  @JoinColumn({ name: 'organization_id' })
  organization: Organization;

  @Column({ name: 'organization_id', nullable: false })
  organizationId: number;

  @Column({ nullable: false })
  name: string;

  /**
   * The site's own reference - FAC-000001. Generated, not typed, for the same
   * reason a location code is: it exists to be printed and scanned, and two
   * sites answering to one code would misroute production.
   */
  @Index({ unique: true })
  @Column({ type: 'varchar', nullable: true, update: false })
  code: string | null;

  @Column({ type: 'varchar', nullable: true })
  address: string | null;

  @Column({ type: 'varchar', nullable: true })
  province: string | null;

  @Column({ type: 'varchar', nullable: true })
  district: string | null;

  @Column({ type: 'varchar', nullable: true })
  sector: string | null;

  @Column({ type: 'varchar', nullable: true })
  cell: string | null;

  @Column({ type: 'varchar', nullable: true })
  village: string | null;

  @Column({ name: 'business_center', type: 'varchar', nullable: true })
  businessCenter: string | null;

  @Column({ name: 'gps_coordinates', type: 'jsonb', nullable: true })
  gpsCoordinates: { lat: number; lng: number } | null;

  @Column({ name: 'land_upi', type: 'varchar', nullable: true })
  landUpi: string | null;

  @Column({ name: 'ownership_type', type: 'varchar', nullable: true, default: 'OWNED' })
  ownershipType: string | null;

  @Column({ name: 'lease_contract_expiry', type: 'date', nullable: true })
  leaseContractExpiry: string | null;

  @Column({ default: true })
  active: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
