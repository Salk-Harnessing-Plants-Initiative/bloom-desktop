/**
 * The Accessions page's search over plant mappings: which accession files hold a plant
 * whose barcode or accession name contains the typed text, ignoring case, and how
 * many of their plants match. File names are matched in the page; the mappings are
 * here because only an opened file's mappings are loaded there.
 */

import type { IpcMain } from 'electron';
import type { DatabaseResponse } from '../types/database';
import type { AccessionFileMatch } from '../types/accession-search';

/** Longer text is refused: no barcode or accession name is anywhere near this long. */
export const MAX_SEARCH_LENGTH = 200;

/**
 * One grouped query; the text is a parameter. SQLite's LIKE ignores ASCII case, and
 * ESCAPE makes %, _ and \ in the text match themselves.
 */
const MATCHING_FILES_SQL = `
SELECT "accession_file_id", COUNT(*) AS "matching_plants"
FROM "PlantAccessionMappings"
WHERE "plant_barcode" LIKE ? ESCAPE '\\'
   OR "accession_name" LIKE ? ESCAPE '\\'
GROUP BY "accession_file_id"`;

/** The part of the Prisma client used here, so tests can pass a fake. */
export interface AccessionSearchDbLike {
  $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): Promise<T>;
}

interface MatchRow {
  accession_file_id: string;
  matching_plants: number | bigint;
}

/** `text` as a LIKE pattern matching it anywhere, with its wildcards taken literally. */
export function containsPattern(text: string): string {
  return `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

export async function searchAccessionFiles(
  deps: { db: AccessionSearchDbLike },
  textInput: unknown
): Promise<DatabaseResponse<AccessionFileMatch[]>> {
  if (typeof textInput !== 'string') {
    return { success: false, error: 'search must be a string' };
  }
  const text = textInput.trim();
  if (text === '') return { success: true, data: [] };
  if (text.length > MAX_SEARCH_LENGTH) {
    return {
      success: false,
      error: `search must be at most ${MAX_SEARCH_LENGTH} characters`,
    };
  }
  try {
    const pattern = containsPattern(text);
    const rows = await deps.db.$queryRawUnsafe<MatchRow[]>(
      MATCHING_FILES_SQL,
      pattern,
      pattern
    );
    return {
      success: true,
      data: rows.map((r) => ({
        accession_file_id: r.accession_file_id,
        matching_plants: Number(r.matching_plants),
      })),
    };
  } catch (error) {
    console.error('[AccessionSearch]', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

export function registerAccessionSearchHandlers(deps: {
  ipcMain: Pick<IpcMain, 'handle'>;
  db: AccessionSearchDbLike;
}): void {
  deps.ipcMain.handle('db:accessions:search', (_event, text: unknown) =>
    searchAccessionFiles(deps, text)
  );
}
