/**
 * Typed view over the environment. Everything the application needs to run is
 * read here once, so no module reaches into process.env on its own.
 */
export interface AppConfig {
  port: number;
  db: {
    host: string;
    port: number;
    name: string;
    user: string;
    password: string;
  };
  jwt: {
    secret: string;
    expiresIn: string;
  };
  corsOrigins: string[];
  /** Browser origin used in invite / reset links (defaults to first CORS origin). */
  appPublicUrl: string;
  /** Reverse-proxy hops to trust when deriving the client IP. 0 = direct. */
  trustProxyHops: number;
  /** Per-address ceilings on the unauthenticated routes. limit 0 disables. */
  rateLimits: Record<string, { limit: number; windowMs: number }>;
  maintenance: {
    /** How far ahead the nightly sweep warns about expiring stock. */
    nearExpiryDays: number;
  };
  licensing: {
    /** off | advisory | strict. See EnforcementMode for why advisory wins. */
    enforcement: string;
    /** Days a provisional licence runs before it must be applied for properly. */
    provisionalDays: number;
  };
  storage: {
    driver: string;
    localRoot: string;
    /**
     * Only read when `driver` is `cloudinary`. Every field defaults to an
     * empty string rather than being optional, so a half-configured driver
     * fails at boot with a named missing credential instead of at the first
     * upload with a 401 from someone else's API.
     */
    cloudinary: {
      cloudName: string;
      apiKey: string;
      apiSecret: string;
      folder: string;
    };
  };
  redis: {
    /** Present when REDIS_URL is set (managed Redis / Render Key Value). */
    url?: string;
    host: string;
    port: number;
  };
  email: {
    provider: string;
    smtpHost: string;
    smtpPort: number;
    smtpUser: string;
    smtpPass: string;
    from: string;
  };
}

export default (): AppConfig => ({
  port: parseInt(process.env.PORT ?? '8081', 10),
  db: {
    host: process.env.DB_HOST ?? 'localhost',
    port: parseInt(process.env.DB_PORT ?? '5433', 10),
    name: process.env.DB_NAME ?? 'stock_manager',
    user: process.env.DB_USER ?? 'stock',
    password: process.env.DB_PASSWORD ?? 'stock_dev',
  },
  jwt: {
    secret: requireSecret(),
    expiresIn: process.env.JWT_EXPIRES_IN ?? '24h',
  },
  corsOrigins: (process.env.CORS_ORIGINS ?? 'http://localhost:3000')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
  appPublicUrl:
    process.env.APP_PUBLIC_URL ??
    (process.env.CORS_ORIGINS ?? 'http://localhost:3000')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean)[0] ??
    'http://localhost:3000',
  trustProxyHops: parseInt(process.env.TRUST_PROXY_HOPS ?? '0', 10),
  maintenance: {
    nearExpiryDays: parseInt(process.env.NEAR_EXPIRY_DAYS ?? '30', 10),
  },
  licensing: {
    // Advisory by default: the proposal asks the regulator to see and act on
    // non-compliance, not for the platform to stop the factory line.
    enforcement: (process.env.LICENSING_ENFORCEMENT ?? 'advisory').toLowerCase(),
    provisionalDays: parseInt(process.env.LICENSING_PROVISIONAL_DAYS ?? '90', 10),
  },
  rateLimits: {
    // A person mistyping a password a few times, plus a client that retries,
    // must not lock themselves out; a script guessing passwords must not get
    // far. Twenty in a quarter of an hour sits between those.
    login: {
      limit: parseInt(process.env.RATE_LIMIT_LOGIN ?? '20', 10),
      windowMs: parseInt(process.env.RATE_LIMIT_LOGIN_WINDOW_MS ?? String(15 * 60 * 1000), 10),
    },
    register: {
      limit: parseInt(process.env.RATE_LIMIT_REGISTER ?? '20', 10),
      windowMs: parseInt(process.env.RATE_LIMIT_REGISTER_WINDOW_MS ?? String(60 * 60 * 1000), 10),
    },
    // Deliberately loose. Consumers scanning a shelf arrive behind carrier NAT
    // in their thousands from a single address, so a tight per-IP ceiling here
    // blocks real shoppers long before it inconveniences anyone enumerating
    // codes - and the QR token is a UUID, which is what actually makes
    // enumeration hopeless.
    verify: {
      limit: parseInt(process.env.RATE_LIMIT_VERIFY ?? '300', 10),
      windowMs: parseInt(process.env.RATE_LIMIT_VERIFY_WINDOW_MS ?? '60000', 10),
    },
  },
  storage: {
    driver: process.env.STORAGE_DRIVER ?? 'local',
    localRoot: process.env.STORAGE_LOCAL_ROOT ?? './var/uploads',
    cloudinary: {
      cloudName: process.env.CLOUDINARY_CLOUD_NAME ?? '',
      apiKey: process.env.CLOUDINARY_API_KEY ?? '',
      apiSecret: process.env.CLOUDINARY_API_SECRET ?? '',
      folder: process.env.CLOUDINARY_FOLDER ?? 'santrack',
    },
  },
  redis: {
    /** Full URL when provided (Render Key Value). Takes precedence over host/port. */
    url: process.env.REDIS_URL?.trim() || undefined,
    host: process.env.REDIS_HOST ?? 'localhost',
    port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
  },
  email: {
    provider: process.env.EMAIL_PROVIDER ?? 'smtp',
    smtpHost: process.env.SMTP_HOST ?? 'localhost',
    smtpPort: parseInt(process.env.SMTP_PORT ?? '1025', 10),
    smtpUser: process.env.SMTP_USER ?? '',
    smtpPass: process.env.SMTP_PASS ?? '',
    from: process.env.EMAIL_FROM ?? 'noreply@santrack.rw',
  },
});

/**
 * The signing secret has no safe default. A weak or missing secret lets anyone
 * mint tokens for any organization, so the application refuses to start
 * rather than come up in a state that only looks secure.
 */
function requireSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error(
      'JWT_SECRET must be set to at least 32 characters. Refusing to start.',
    );
  }
  return secret;
}
