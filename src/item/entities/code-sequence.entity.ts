import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Per-prefix counter behind the human-readable labels. Rows are locked
 * pessimistically when a block of codes is drawn, so two operators minting
 * identities at the same moment cannot be handed the same label.
 */
@Entity('code_sequences')
export class CodeSequence {
  @PrimaryGeneratedColumn()
  id: number;

  @Index({ unique: true })
  @Column({ nullable: false })
  prefix: string;

  @Column({ name: 'next_value', type: 'bigint', default: 1 })
  nextValue: string;
}
