/**
 * Single source of truth for the app's display/product name. Read from
 * package.json's `productName` field rather than duplicating the literal
 * across forge.config.ts and the packaging verification scripts, so a
 * future rename can't silently diverge between them.
 */

import packageJson from '../package.json';

export const PRODUCT_NAME: string = packageJson.productName;
