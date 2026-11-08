import { SetMetadata } from '@nestjs/common';

/** Opts a route out of the global JWT guard (docs/project-structure.md section 5). */
export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
