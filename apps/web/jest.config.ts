import nextJest from 'next/jest.js';
import { config as baseConfig } from '@repo/jest-config/base';

/**
 * Composed here rather than re-exporting `@repo/jest-config/next`: this package
 * is ESM, so that module's default export arrives wrapped and Jest rejects it
 * as an unknown `default` option. `next/jest` also has to be called with this
 * app as its directory so it picks up the right SWC and path settings.
 */
const createJestConfig = nextJest({ dir: './' });

export default createJestConfig({
  ...baseConfig,
  moduleFileExtensions: [...baseConfig.moduleFileExtensions, 'jsx', 'tsx'],
});
