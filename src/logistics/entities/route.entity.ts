import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Location } from '../../location/entities/location.entity';
import { Organization } from '../../organization/entities/organization.entity';

/**
 * A named, reusable connection between two of the organization's locations.
 * Routes are what make the expected travel time and distance answerable on a
 * shipment without asking a driver to estimate.
 */
@Entity('routes')
@Index('idx_route_org', ['organization'])
export class Route {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => Organization, { nullable: false, eager: true })
  @JoinColumn({ name: 'organization_id' })
  organization: Organization;

  @Column({ nullable: false })
  name: string;

  @ManyToOne(() => Location, { nullable: false, eager: true })
  @JoinColumn({ name: 'source_location_id' })
  sourceLocation: Location;

  @ManyToOne(() => Location, { nullable: false, eager: true })
  @JoinColumn({ name: 'destination_location_id' })
  destinationLocation: Location;

  /** Numeric columns: TypeORM returns them as strings, callers convert. */
  @Column({ name: 'distance_km', type: 'numeric', precision: 8, scale: 2, nullable: true })
  distanceKm: string | null;

  @Column({ name: 'expected_hours', type: 'numeric', precision: 5, scale: 2, nullable: true })
  expectedHours: string | null;

  @Column({ default: true })
  active: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}