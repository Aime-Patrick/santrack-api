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
import { Transporter } from './transporter.entity';

/** A driver a transporter can put on a route. */
@Entity('drivers')
@Unique('uk_driver_transporter_license', ['transporter', 'licenseNumber'])
@Index('idx_driver_transporter', ['transporter'])
export class Driver {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => Transporter, { nullable: false, eager: true })
  @JoinColumn({ name: 'transporter_id' })
  transporter: Transporter;

  @Column({ nullable: false })
  name: string;

  @Column({ name: 'license_number', type: 'varchar', nullable: true })
  licenseNumber: string | null;

  @Column({ type: 'varchar', nullable: true })
  phone: string | null;

  @Column({ default: true })
  active: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}