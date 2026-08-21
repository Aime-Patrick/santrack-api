import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { OrganizationType } from '../organization-type.enum';

/** A participating business or entity in the traceability chain. */
@Entity('organizations')
export class Organization {
  @PrimaryGeneratedColumn()
  id: number;

  @Index({ unique: true })
  @Column({ nullable: false })
  name: string;

  @Column({ type: 'enum', enum: OrganizationType, nullable: false })
  type: OrganizationType;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  /** Regulators read across organization boundaries (proposal section 12). */
  isRegulator(): boolean {
    return this.type === OrganizationType.REGULATOR;
  }
}
