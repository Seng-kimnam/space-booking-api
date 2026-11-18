import type { Request } from 'express';
import type { ApiClientScope } from './api-key';

/** The calling system, set by ApiKeyGuard. Never contains the key or its hash. */
export interface AuthApiClient {
  id: string;
  name: string;
  scopes: ApiClientScope[];
}

export type ApiClientRequest = Request & { apiClient?: AuthApiClient };
