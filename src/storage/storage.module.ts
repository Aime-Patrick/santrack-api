import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CloudinaryStorage } from './cloudinary.storage';
import { LocalDiskStorage } from './local-disk.storage';
import { STORAGE_PROVIDER, StorageProvider } from './storage.provider';

/**
 * The one place that decides where files go.
 *
 * Drivers: local (default) and cloudinary. Licensing never names a concrete
 * provider - flip STORAGE_DRIVER and restart.
 */
@Global()
@Module({
  providers: [
    {
      provide: STORAGE_PROVIDER,
      inject: [ConfigService],
      useFactory: (config: ConfigService): StorageProvider => {
        const driver = config.get<string>('storage.driver') ?? 'local';

        switch (driver) {
          case 'local':
            return new LocalDiskStorage(config);
          case 'cloudinary':
            return new CloudinaryStorage(config);
          default:
            // Failing at boot rather than at the first upload: a typo in
            // STORAGE_DRIVER should not surface as a broken licence
            // application three days into a pilot.
            throw new Error(
              `Unknown STORAGE_DRIVER "${driver}". Known drivers: local, cloudinary.`,
            );
        }
      },
    },
  ],
  exports: [STORAGE_PROVIDER],
})
export class StorageModule {}
