import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { VehicleType } from '../logistics.enums';
import { Transporter } from './transporter.entity';

/** A vehicle a transporter can put on a route. */
@Entity('vehicles')
@Unique('uk_vehicle_transporter_registration', ['transporter', 'registrationNumber'])
@Index('idx_vehicle_transporter', ['transporter'])
export class Vehicle {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => Transporter, { nullable: false, eager: true })
  @JoinColumn({ name: 'transporter_id' })
  transporter: Transporter;

  /** Number plate as printed on the vehicle. */
  @Column({ name: 'registration_number', nullable: false })
  registrationNumber: string;

  @Column({ type: 'enum', enum: VehicleType, default: VehicleType.TRUCK })
  type: VehicleType;

  /** Numeric capacity column: TypeORM returns it as a string, callers convert. */
  @Column({ type: 'numeric', precision: 10, scale: 2, nullable: true })
  capacity: string | null;

  @Column({ default: true })
  active: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}