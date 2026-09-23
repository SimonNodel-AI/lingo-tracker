import { Logger, Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { BundleJobService } from './bundles/bundle-job.service';
import { BundlesController } from './bundles/bundles.controller';
import { CollectionIndex } from './cache/collection-index.service';
import { CollectionsController } from './collections/collections.controller';
import { FoldersController } from './collections/folders/folders.controller';
import { LocalesController } from './collections/locales/locales.controller';
import { ResourcesController } from './collections/resources/resources.controller';
import { ConfigController } from './config/config.controller';
import { ConfigService } from './config/config.service';
import { LingoTrackerExceptionFilter } from './errors/lingo-tracker-exception.filter';
import { TranslationJobService } from './translation-job/translation-job.service';

@Module({
  imports: [],
  controllers: [
    AppController,
    ConfigController,
    CollectionsController,
    ResourcesController,
    FoldersController,
    LocalesController,
    BundlesController,
  ],
  providers: [
    AppService,
    ConfigService,
    CollectionIndex,
    TranslationJobService,
    BundleJobService,
    Logger,
    { provide: APP_FILTER, useClass: LingoTrackerExceptionFilter },
  ],
})
export class AppModule {
  constructor() {
    Logger.log(`Lingo Tracker app is running in: ${__dirname}`);
  }
}
