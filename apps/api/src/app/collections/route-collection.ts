import {
  createParamDecorator,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  NotFoundException,
  type PipeTransform,
} from '@nestjs/common';
import { type Collection, CollectionNotFoundError, openCollection, ReadOnlyCollectionError } from '@simoncodes-ca/core';
import { ConfigService } from '../config/config.service';

export interface RouteCollectionOptions {
  readonly writable?: boolean;
}

interface RouteCollectionRef {
  readonly name: string;
  readonly writable: boolean;
}

export function routeCollectionRef(
  options: RouteCollectionOptions,
  request: { method: string; params: Record<string, string | undefined> },
): RouteCollectionRef {
  return { name: request.params.collectionName ?? '', writable: options.writable ?? request.method !== 'GET' };
}

export const RouteCollection = (options: RouteCollectionOptions = {}) =>
  createParamDecorator((data: RouteCollectionOptions, context: ExecutionContext): RouteCollectionRef => {
    const request = context.switchToHttp().getRequest<{ method: string; params: Record<string, string | undefined> }>();
    return routeCollectionRef(data, request);
  })(options, RouteCollectionPipe);

@Injectable()
export class RouteCollectionPipe implements PipeTransform<RouteCollectionRef, Collection> {
  readonly #configService: ConfigService;

  constructor(configService: ConfigService) {
    this.#configService = configService;
  }

  transform({ name, writable }: RouteCollectionRef): Collection {
    try {
      return openCollection(this.#configService.getConfig(), name, { writable });
    } catch (error) {
      if (error instanceof CollectionNotFoundError) throw new NotFoundException(`Collection "${name}" not found`);
      if (error instanceof ReadOnlyCollectionError) throw new ForbiddenException(error.message);
      throw error;
    }
  }
}
