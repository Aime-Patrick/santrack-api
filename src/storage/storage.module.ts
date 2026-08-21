import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LocalDiskStorage } from './local-disk.storage';
import { STORAGE_PROVIDER, StorageProvider } from './storage.provider';

/**
 * The one place that decides where files go.
 *
 * Adding Cloudinary later is: write CloudinaryStorage implementing
 * StorageProvider, add a case to the switch, set STORAGE_DRIVER=cloudinary.
 * No licensing code changes, because nothing outside this module names a
 * concrete provider.
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
          default:
            // Failing at boot rather than at the first upload: a typo in
            // STORAGE_DRIVER should not surface as a broken licence
            // application three days into a pilot.
            throw new Error(
              `Unknown STORAGE_DRIVER "${driver}". Known drivers: local.`,
            );
        }
      },
    },
  ],
  exports: [STORAGE_PROVIDER],
})
export class StorageModule {}
