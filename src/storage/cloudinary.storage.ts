import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { v2 as cloudinary, UploadApiResponse } from 'cloudinary';
import { randomUUID } from 'node:crypto';
import { extname } from 'node:path';
import { NotFoundEntityException } from '../common/errors';
import { PutObject, StorageProvider, StoredObject } from './storage.provider';

/**
 * Cloudinary-backed storage.
 *
 * Keys are opaque strings of the form `resourceType:publicId` so get / delete /
 * signedUrl can recover both halves. Callers must never parse them - they are
 * an implementation detail of this adapter, the same way a local path is for
 * LocalDiskStorage.
 *
 * Uploads use resource_type "auto" so PDFs land as raw and images as image
 * without the caller caring. Objects are uploaded as type "authenticated" so
 * they are not world-readable; signedUrl issues a short-lived download link.
 */
@Injectable()
export class CloudinaryStorage implements StorageProvider {
  private readonly logger = new Logger(CloudinaryStorage.name);
  private readonly folderPrefix: string;

  constructor(config: ConfigService) {
    const cloudName = config.get<string>('storage.cloudinary.cloudName') ?? '';
    const apiKey = config.get<string>('storage.cloudinary.apiKey') ?? '';
    const apiSecret = config.get<string>('storage.cloudinary.apiSecret') ?? '';

    if (!cloudName || !apiKey || !apiSecret) {
      throw new Error(
        'STORAGE_DRIVER=cloudinary requires CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET',
      );
    }

    cloudinary.config({
      cloud_name: cloudName,
      api_key: apiKey,
      api_secret: apiSecret,
      secure: true,
    });

    this.folderPrefix = sanitiseFolder(
      config.get<string>('storage.cloudinary.folder') ?? 'santrack',
    );
  }

  async put(input: PutObject): Promise<StoredObject> {
    const folder = `${this.folderPrefix}/${sanitiseFolder(input.folder)}`;
    const publicId = `${folder}/${randomUUID()}`;
    const format = formatFromFilename(input.filename);

    const result = await uploadBuffer(input.content, {
      public_id: publicId,
      resource_type: 'auto',
      type: 'authenticated',
      ...(format ? { format } : {}),
    });

    const key = encodeKey(result.resource_type, result.public_id);

    return {
      key,
      size: input.content.byteLength,
      contentType: input.contentType,
    };
  }

  async get(key: string): Promise<Buffer> {
    const { resourceType, publicId } = decodeKey(key);
    const url = cloudinary.url(publicId, {
      resource_type: resourceType,
      type: 'authenticated',
      sign_url: true,
      secure: true,
      // Long enough for a single server-side fetch; not handed to browsers.
      expires_at: Math.floor(Date.now() / 1000) + 60,
    });

    let response: Response;
    try {
      response = await fetch(url);
    } catch (error) {
      this.logger.warn(`Cloudinary fetch failed for ${key}: ${(error as Error).message}`);
      throw new NotFoundEntityException('Stored file', key);
    }

    if (!response.ok) {
      throw new NotFoundEntityException('Stored file', key);
    }

    return Buffer.from(await response.arrayBuffer());
  }

  async delete(key: string): Promise<void> {
    const { resourceType, publicId } = decodeKey(key);

    try {
      await cloudinary.uploader.destroy(publicId, {
        resource_type: resourceType,
        type: 'authenticated',
        invalidate: true,
      });
    } catch (error) {
      this.logger.warn(`Could not remove ${key}: ${(error as Error).message}`);
    }
  }

  async signedUrl(key: string, expiresInSeconds: number): Promise<string | null> {
    const { resourceType, publicId } = decodeKey(key);
    const ttl = Math.max(1, Math.floor(expiresInSeconds));

    return cloudinary.url(publicId, {
      resource_type: resourceType,
      type: 'authenticated',
      sign_url: true,
      secure: true,
      expires_at: Math.floor(Date.now() / 1000) + ttl,
    });
  }
}

function uploadBuffer(
  content: Buffer,
  options: Record<string, unknown>,
): Promise<UploadApiResponse> {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(options, (error, result) => {
      if (error || !result) {
        reject(error ?? new Error('Cloudinary upload returned no result'));
        return;
      }
      resolve(result);
    });
    stream.end(content);
  });
}

function encodeKey(resourceType: string, publicId: string): string {
  return `${resourceType}:${publicId}`;
}

function decodeKey(key: string): { resourceType: string; publicId: string } {
  const separator = key.indexOf(':');
  if (separator <= 0 || separator === key.length - 1) {
    throw new NotFoundEntityException('Stored file', key);
  }
  return {
    resourceType: key.slice(0, separator),
    publicId: key.slice(separator + 1),
  };
}

function sanitiseFolder(folder: string): string {
  const cleaned = folder
    .split('/')
    .map((segment) => segment.replace(/[^A-Za-z0-9_-]/g, ''))
    .filter(Boolean)
    .join('/');
  return cleaned.length > 0 ? cleaned : 'misc';
}

function formatFromFilename(filename: string): string | undefined {
  const ext = extname(filename).toLowerCase().replace(/^\./, '');
  return /^[a-z0-9]{1,8}$/.test(ext) ? ext : undefined;
}
