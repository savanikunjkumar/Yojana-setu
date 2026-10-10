import { ArgumentMetadata, BadRequestException, PipeTransform } from '@nestjs/common';
import type { ZodType, ZodTypeDef } from 'zod';

/**
 * Validates request payloads against the Zod schemas exported by @sih/shared,
 * so the API and the browser enforce byte-identical rules.
 *
 * The schema's input type is `unknown` rather than its output type: schemas with
 * `.default()` accept a narrower payload than they produce, and the pipe's job is
 * precisely to turn an untrusted body into the parsed output type.
 */
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodType<T, ZodTypeDef, unknown>) {}

  transform(value: unknown, _metadata: ArgumentMetadata): T {
    const result = this.schema.safeParse(value);

    if (!result.success) {
      throw new BadRequestException({
        message: 'Request validation failed',
        issues: result.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      });
    }

    return result.data;
  }
}
