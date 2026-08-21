/**
 * Where uploaded files live.
 *
 * Licence certificates start on local disk because the pilot runs on one box,
 * but they will not stay there: the moment SANTRACK serves several
 * organizations from more than one instance, local disk stops working. So
 * nothing in the application ever touches the filesystem directly - callers
 * see this interface, and swapping in Cloudinary or S3 is writing one adapter
 * and changing one binding in StorageModule.
 *
 * Keys are opaque strings the provider hands back. Callers store the key and
 * ask for it again; they must never construct one or assume it is a path.
 */
export interface StorageProvider {
  /** Stores bytes and returns the key needed to read them back. */
  put(input: PutObject): Promise<StoredObject>;

  /** Reads an object back. Throws if the key is unknown. */
  get(key: string): Promise<Buffer>;

  /**
   * Removes an object. Succeeds silently when the key is already gone, so
   * cleaning up a half-finished upload is safe to retry.
   */
  delete(key: string): Promise<void>;

  /**
   * A URL the browser can fetch directly, when the backing store offers one.
   *
   * Local disk does not, so it returns null and the caller streams the bytes
   * through the API instead. Cloudinary and S3 return a time-limited signed
   * URL, which is what makes them worth moving to - certificates stop passing
   * through the application at all.
   */
  signedUrl(key: string, expiresInSeconds: number): Promise<string | null>;
}

export interface PutObject {
  /** Logical grouping, e.g. "licences/42". Providers may use it in the key. */
  folder: string;
  /** Original filename, for the download prompt. Never trusted as a path. */
  filename: string;
  contentType: string;
  content: Buffer;
}

export interface StoredObject {
  key: string;
  size: number;
  contentType: string;
}

/** Injection token. Bound to a concrete provider in StorageModule. */
export const STORAGE_PROVIDER = Symbol('STORAGE_PROVIDER');
