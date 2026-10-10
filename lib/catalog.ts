import 'server-only';
// This module is only imported by server routes. Do not expose the full vocabulary to a client component.
import rawCatalog from '../data/catalog.json';
import type { Catalog } from './types';
export const catalog = rawCatalog as Catalog;
