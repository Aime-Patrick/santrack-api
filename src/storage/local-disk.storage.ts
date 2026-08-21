import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { NotFoundEntityException } from '../common/errors';
import { PutObject, StorageProvider, StoredObject } from './storage.provider';

/**
 * Files on the local filesystem. Good enough for a single-instance pilot and
 * nothing beyond it - see StorageProvider for why that is a deliberate stop.
 */
@Injectable()
export class LocalDiskStorage implements StorageProvider {
  private readonly logger = new Logger(LocalDiskStorage.name);
  private readonly root: string;

  constructor(config: ConfigService) {
    this.root = resolve(config.get<string>('storage.localRoot') ?? './var/uploads');
  }

  async put(input: PutObject): Promise<StoredObject> {
    // The stored name is generated, never taken from the upload. A filename
    // arriving over HTTP is attacker-controlled: "../../.env" is a valid
    // string, and joining it to a root directory is how uploads become
    // arbitrary file writes.
    const key = `${sanitiseFolder(input.folder)}/${randomUUID()}${safeExtension(input.filename)}`;
    const target = this.absolute(key);

    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, input.content);

    return {
      key,
      size: input.content.byteLength,
      contentType: input.contentType,
    };
  }

  async get(key: string): Promise<Buffer> {
    try {
      return await readFile(this.absolute(key));
    } catch {
      throw new NotFoundEntityException('Stored file', key);
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await rm(this.absolute(key), { force: true });
    } catch (error) {
      // Deleting an object that is already gone is the desired end state, so
      // it is logged rather than raised - a failed cleanup must not fail the
      // operation that triggered it.
      this.logger.warn(`Could not remove ${key}: ${(error as Error).message}`);
    }
  }

  /** Local disk has no public URL; callers stream the bytes through the API. */
  async signedUrl(): Promise<string | null> {
    return null;
  }

  /**
   * Resolves a key inside the storage root and refuses anything that escapes
   * it, however the key was built.
   */
  private absolute(key: string): string {
    const target = resolve(join(this.root, key));
    if (target !== this.root && !target.startsWith(this.root + sep)) {
      throw new NotFoundEntityException('Stored file', key);
    }
    return target;
  }
}

function sanitiseFolder(folder: string): string {
  const cleaned = folder
    .split('/')
    .map((segment) => segment.replace(/[^A-Za-z0-9_-]/g, ''))
    .filter(Boolean)
    .join('/');
  return cleaned.length > 0 ? cleaned : 'misc';
}

/** Keeps a recognisable suffix without trusting the rest of the name. */
function safeExtension(filename: string): string {
  const ext = extname(filename).toLowerCase();
  return /^\.[a-z0-9]{1,8}$/.test(ext) ? ext : '';
}
