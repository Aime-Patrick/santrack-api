import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { User } from '../../auth/entities/user.entity';
import { RegulatoryAuthority } from './regulatory-authority.entity';

/**
 * An operational desk inside a licensing authority (e.g. Surveillance,
 * Licensing). Cases can be assigned to a team; members get the work queue
 * and notifications. Replaces the free-text `authority.teams` jsonb list.
 */
@Entity('regulatory_teams')
@Unique('uk_regulatory_team_authority_name', ['authority', 'name'])
@Index('idx_regulatory_team_authority', ['authority'])
export class RegulatoryTeam {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => RegulatoryAuthority, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'authority_id' })
  authority: RegulatoryAuthority;

  @Column({ type: 'varchar', length: 100 })
  name: string;

  @Column({ type: 'boolean', default: true })
  active: boolean;

  /**
   * Soft cap on open (non-closed/resolved) cases assigned to this desk.
   * Null means unlimited.
   */
  @Column({ name: 'max_open_cases', type: 'int', nullable: true })
  maxOpenCases: number | null;

  @OneToMany(() => RegulatoryTeamMember, (member) => member.team)
  members: RegulatoryTeamMember[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}

/**
 * Links an authority org user to a team. `isLeader` marks the accountable
 * officer for that desk (at most one leader per team in the service layer).
 */
@Entity('regulatory_team_members')
@Unique('uk_regulatory_team_member', ['team', 'user'])
@Index('idx_regulatory_team_member_user', ['user'])
export class RegulatoryTeamMember {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => RegulatoryTeam, (team) => team.members, {
    nullable: false,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'team_id' })
  team: RegulatoryTeam;

  @ManyToOne(() => User, { nullable: false, eager: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ name: 'is_leader', type: 'boolean', default: false })
  isLeader: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
