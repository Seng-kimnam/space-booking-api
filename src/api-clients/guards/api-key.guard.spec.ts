import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { ApiClientsService } from '../services/api-clients.service';
import type { ApiClientRequest, AuthApiClient } from '../types';
import { ApiKeyGuard } from './api-key.guard';

const lms: AuthApiClient = { id: 'c1', name: 'LMS', scopes: ['places:read'] };

function run(opts: { client: AuthApiClient | null; required?: string[]; header?: string }) {
  const request = {
    method: 'GET',
    path: '/api/v1/integrations/library/places/1',
    headers: opts.header === undefined ? {} : { 'x-api-key': opts.header },
  } as unknown as ApiClientRequest;
  const authenticate = jest.fn(async () => opts.client);
  const reflector = { getAllAndOverride: () => opts.required } as unknown as Reflector;
  const guard = new ApiKeyGuard({ authenticate } as unknown as ApiClientsService, reflector);
  const ctx = {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => undefined,
    getClass: () => undefined,
  } as unknown as ExecutionContext;
  return { result: guard.canActivate(ctx), request, authenticate };
}

describe('ApiKeyGuard', () => {
  it('lets a client with the required scope through and attaches it', async () => {
    const { result, request, authenticate } = run({ client: lms, required: ['places:read'], header: 'k' });
    await expect(result).resolves.toBe(true);
    expect(request.apiClient).toEqual(lms);
    expect(authenticate).toHaveBeenCalledWith('k');
  });

  it('401s an unknown, missing or invalid key with one message', async () => {
    const { result } = run({ client: null, required: ['places:read'] });
    await expect(result).rejects.toThrow(UnauthorizedException);
    await expect(result).rejects.toThrow('Invalid API key');
  });

  it('403s a valid key without the scope', async () => {
    const { result, request } = run({ client: lms, required: ['bookings:write'], header: 'k' });
    await expect(result).rejects.toThrow(ForbiddenException);
    expect(request.apiClient).toBeUndefined();
  });
});
