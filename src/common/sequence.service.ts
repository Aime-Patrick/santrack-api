import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { CodeSequence } from '../item/entities/code-sequence.entity';

/**
 * Gap-free counters, one per named prefix.
 *
 * The row is locked for update while a block is drawn, so two operators acting
 * at the same moment cannot be handed the same number. That matters for both
 * things built on it: a duplicate printed label puts two physical items under
 * one identity, and a duplicate licence number makes two authorisations
 * indistinguishable on paper.
 */
@Injectable()
export class SequenceService {
  /** Draws `count` consecutive values and advances the counter past them. */
  async nextBlock(
    manager: EntityManager,
    prefix: string,
    count: number,
  ): Promise<number[]> {
    let sequence = await manager.findOne(CodeSequence, {
      where: { prefix },
      lock: { mode: 'pessimistic_write' },
    });

    if (!sequence) {
      // Two callers can race to create the same prefix; the unique index
      // decides, and the loser re-reads what the winner inserted.
      try {
        sequence = await manager.save(
          manager.create(CodeSequence, { prefix, nextValue: '1' }),
        );
      } catch {
        sequence = await manager.findOneOrFail(CodeSequence, {
          where: { prefix },
          lock: { mode: 'pessimistic_write' },
        });
      }
    }

    const start = parseInt(sequence.nextValue, 10);
    sequence.nextValue = String(start + count);
    await manager.save(CodeSequence, sequence);

    return Array.from({ length: count }, (_, i) => start + i);
  }

  async next(manager: EntityManager, prefix: string): Promise<number> {
    const [value] = await this.nextBlock(manager, prefix, 1);
    return value;
  }
}
