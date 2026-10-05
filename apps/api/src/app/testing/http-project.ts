import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { type AddResourceParams, addResource, type LingoTrackerConfig, openCollection } from '@simoncodes-ca/core';
import { AppModule } from '../app.module';
import { ConfigService } from '../config/config.service';

/** Full Nest module and real disk/core, with only the served project root overridden. */
export class HttpProject {
  readonly root = realpathSync(mkdtempSync(join(tmpdir(), 'lingo-api-http-')));
  config: LingoTrackerConfig = {
    exportFolder: 'dist/export',
    importFolder: 'dist/import',
    baseLocale: 'en',
    locales: ['en', 'fr-ca', 'es'],
    collections: {
      'test-collection': { translationsFolder: join(this.root, 'translations/test') },
      'old-name': { translationsFolder: join(this.root, 'translations/old') },
      'My%Collection': { translationsFolder: join(this.root, 'translations/percent') },
      'My Collection': { translationsFolder: join(this.root, 'translations/space') },
      'My%20Collection': { translationsFolder: join(this.root, 'translations/encoded') },
      vendor: { translationsFolder: join(this.root, 'translations/vendor'), readOnly: true },
    },
  };
  app: INestApplication | undefined;
  private server: Server | undefined;

  configure(): void {
    this.write('.lingo-tracker.json', JSON.stringify(this.config));
  }
  write(path: string, contents: string): void {
    const absolute = join(this.root, path);
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, contents);
  }
  read(path: string): string {
    return readFileSync(join(this.root, path), 'utf8');
  }
  json(path: string): unknown {
    return JSON.parse(this.read(path));
  }
  exists(path: string): boolean {
    return existsSync(join(this.root, path));
  }
  collection(name = 'test-collection') {
    return openCollection(this.config, name, { cwd: this.root, writable: true });
  }
  async seed(key: string, baseValue = 'OK', extra: Partial<AddResourceParams> = {}, name = 'test-collection') {
    return addResource(this.collection(name), { key, baseValue, ...extra });
  }
  async start(): Promise<void> {
    this.configure();
    for (const entry of Object.values(this.config.collections ?? {}))
      mkdirSync(entry.translationsFolder, { recursive: true });
    const root = this.root;
    class ProjectConfigService extends ConfigService {
      override get projectRoot(): string {
        return root;
      }
    }
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ConfigService)
      .useValue(new ProjectConfigService())
      .compile();
    this.app = moduleRef.createNestApplication({ logger: false });
    // supertest is not installed; use the existing specs' ephemeral HTTP transport.
    await this.app.listen(0);
    this.server = this.app.getHttpServer() as Server;
  }
  async request<T = Record<string, unknown>>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<{ status: number; body: T }> {
    const address = this.server?.address() as AddressInfo | null;
    if (!address) throw new Error('HTTP server has no address');
    const response = await fetch(`http://localhost:${address.port}${path}`, {
      method,
      ...(body !== undefined && { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
    });
    if (!response.headers.get('content-type')?.includes('application/json')) {
      throw new Error(`Expected a JSON HTTP response from ${path}`);
    }
    return { status: response.status, body: (await response.json()) as T };
  }
  async close(): Promise<void> {
    try {
      await this.app?.close();
    } finally {
      rmSync(this.root, { recursive: true, force: true });
    }
  }
}
