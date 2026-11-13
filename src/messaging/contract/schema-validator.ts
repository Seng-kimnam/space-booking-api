import { Injectable } from '@nestjs/common';
import Ajv2020 from 'ajv/dist/2020';
import type { ErrorObject, ValidateFunction } from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import { CONTRACT, envelopeV1 } from './schemas';

/** A message we can never process (bad JSON, wrong sender, schema mismatch): DLQ, no retry. */
export class PoisonMessageError extends Error {
  override readonly name = 'PoisonMessageError';
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const describe = (errors: ErrorObject[] | null | undefined): string =>
  (errors ?? [])
    .slice(0, 5)
    .map((e) => `${e.instancePath || '/'} ${e.message ?? 'invalid'}`)
    .join('; ');

/** Compiled once at startup from schemas.ts. */
@Injectable()
export class SchemaValidator {
  private readonly envelope: ValidateFunction;
  private readonly data = new Map<string, ValidateFunction>();

  constructor() {
    const ajv = new Ajv2020({ allErrors: false, strict: false });
    addFormats(ajv);
    this.envelope = ajv.compile(envelopeV1);
    for (const entry of CONTRACT) {
      const compiled = ajv.getSchema(entry.schema.$id) ?? ajv.compile(entry.schema);
      this.data.set(`${entry.routingKey}@${entry.version}`, compiled);
    }
  }

  /** Throws PoisonMessageError when the body isn't a valid envelope. */
  assertEnvelope(body: unknown): void {
    if (!this.envelope(body))
      throw new PoisonMessageError('INVALID_ENVELOPE', describe(this.envelope.errors));
  }

  /** True if the contract defines this type and version. */
  knows(type: string, version: number): boolean {
    return this.data.has(`${type}@${version}`);
  }

  /** Throws PoisonMessageError when `data` doesn't match the schema of `type` v`version`. */
  assertData(type: string, version: number, data: unknown): void {
    const validate = this.data.get(`${type}@${version}`);
    if (!validate) throw new PoisonMessageError('UNKNOWN_VERSION', `${type} v${version} is not in the contract`);
    if (!validate(data)) throw new PoisonMessageError('INVALID_DATA', describe(validate.errors));
  }
}
