import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { SequenceService } from '../../common/sequence.service';

/**
 * Mints the human-readable labels printed next to the QR. The QR payload
 * itself is an opaque token and is what the system keys on; these codes exist
 * so people can read them, say them aloud and type them into a search box.
 *
 * Format follows the technical proposal, section 6.2: ST-<PREFIX>-000245.
 */
@Injectable()
export class ItemCodeGenerator {
  constructor(private readonly sequences: SequenceService) {}

  async nextCodes(
    manager: EntityManager,
    rawPrefix: string | null,
    count: number,
  ): Promise<string[]> {
    const prefix = normalise(rawPrefix);
    const values = await this.sequences.nextBlock(manager, prefix, count);
    return values.map((n) => `ST-${prefix}-${String(n).padStart(6, '0')}`);
  }

  async nextCode(manager: EntityManager, rawPrefix: string | null): Promise<string> {
    const [code] = await this.nextCodes(manager, rawPrefix, 1);
    return code;
  }
}

/** Keeps prefixes to a short alphanumeric token so labels stay scannable. */
export function normalise(rawPrefix: string | null): string {
  if (!rawPrefix) {
    return 'ITM';
  }
  const cleaned = rawPrefix.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return cleaned.length === 0 ? 'ITM' : cleaned.slice(0, 4);
}
