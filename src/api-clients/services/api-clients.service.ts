import { ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { isPgError, PG_UNIQUE_VIOLATION } from '../../common/utils/db-errors';
import { appConfig } from '../../configuration/app.config';
import { digestsEqual, generateApiKey, hashSecret, parseApiKey } from '../api-key';
import type { ApiClientScope } from '../api-key';
import {
  ApiClientPageResponseDto,
  ApiClientWithKeyResponseDto,
  CreateApiClientDto,
  toApiClientResponse,
  UpdateApiClientDto,
  ApiClientResponseDto,
} from '../dto/api-client.dto';
import { ApiClient } from '../entities/api-client.entity';
import type { AuthApiClient } from '../types';

/**
 * Integrating systems that call our REST API with an API key. Keys are shown
 * once and stored as sha256 only (AGENTS.md section 6.8). Admin writes are
 * logged by id and name, never with the key.
 */
@Injectable()
export class ApiClientsService {
  private readonly logger = new Logger(ApiClientsService.name);

  constructor(
    @InjectRepository(ApiClient) private readonly clients: Repository<ApiClient>,
    @Inject(appConfig.KEY) private readonly app: ConfigType<typeof appConfig>,
  ) {}

  async create(dto: CreateApiClientDto): Promise<ApiClientWithKeyResponseDto> {
    const key = generateApiKey(this.keyEnv());
    const client = await this.save(
      this.clients.create({
        name: dto.name,
        scopes: dto.scopes,
        keyPrefix: key.prefix,
        apiKeyHash: key.hash,
      }),
    );
    this.logger.log(`API client created: id=${client.id} name=${client.name} scopes=${client.scopes.join(',')}`);
    return { ...toApiClientResponse(client), apiKey: key.key };
  }

  async list(query: PaginationQueryDto): Promise<ApiClientPageResponseDto> {
    const [rows, total] = await this.clients.findAndCount({
      order: { name: 'ASC', id: 'ASC' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    });
    return { items: rows.map(toApiClientResponse), page: query.page, limit: query.limit, total };
  }

  async get(id: string): Promise<ApiClientResponseDto> {
    return toApiClientResponse(await this.find(id));
  }

  async update(id: string, dto: UpdateApiClientDto): Promise<ApiClientResponseDto> {
    const client = await this.find(id);
    if (dto.name !== undefined) client.name = dto.name;
    if (dto.scopes !== undefined) client.scopes = dto.scopes;
    if (dto.isActive !== undefined) client.isActive = dto.isActive;
    const saved = await this.save(client);
    const changed = Object.keys(dto).filter((k) => dto[k as keyof UpdateApiClientDto] !== undefined);
    this.logger.log(`API client updated: id=${id} fields=${changed.join(',') || 'none'}`);
    return toApiClientResponse(saved);
  }

  /**
   * New key, effective immediately: the old one stops working now.
   * shortcut: no grace period; that needs previous_key_hash/previous_key_expires_at
   * columns (service-authentication.md section 2.1, "Rotation").
   */
  async rotateKey(id: string): Promise<ApiClientWithKeyResponseDto> {
    const client = await this.find(id);
    const key = generateApiKey(this.keyEnv());
    client.keyPrefix = key.prefix;
    client.apiKeyHash = key.hash;
    const saved = await this.save(client);
    this.logger.log(`API client key rotated: id=${id}`);
    return { ...toApiClientResponse(saved), apiKey: key.key };
  }

  /**
   * The active client owning `rawKey`, or null. One answer for every failure
   * (malformed, unknown prefix, wrong secret, inactive), so callers can't probe.
   */
  async authenticate(rawKey: unknown): Promise<AuthApiClient | null> {
    const parsed = parseApiKey(rawKey);
    if (!parsed) return null;
    // key_prefix has no unique index (48 random bits per key): compare against every match.
    const candidates = await this.clients.find({
      where: { keyPrefix: parsed.prefix, isActive: true },
    });
    const digest = hashSecret(parsed.secret);
    const client = candidates.find((c) => digestsEqual(digest, c.apiKeyHash));
    if (!client) return null;
    await this.touch(client.id);
    return { id: client.id, name: client.name, scopes: client.scopes as ApiClientScope[] };
  }

  /** last_used_at, at most once a minute per client (no write per request). */
  private async touch(id: string): Promise<void> {
    await this.clients
      .createQueryBuilder()
      .update(ApiClient)
      .set({ lastUsedAt: () => 'now()' })
      .where('id = :id', { id })
      .andWhere("(last_used_at IS NULL OR last_used_at < now() - interval '1 minute')")
      .execute();
  }

  private keyEnv(): 'live' | 'test' {
    return this.app.nodeEnv === 'production' ? 'live' : 'test';
  }

  private async find(id: string): Promise<ApiClient> {
    const client = await this.clients.findOneBy({ id });
    if (!client) throw new NotFoundException('API client not found');
    return client;
  }

  private async save(client: ApiClient): Promise<ApiClient> {
    try {
      return await this.clients.save(client);
    } catch (err) {
      if (isPgError(err, PG_UNIQUE_VIOLATION, 'api_clients_name_uk'))
        throw new ConflictException('An API client with this name already exists');
      throw err;
    }
  }
}
