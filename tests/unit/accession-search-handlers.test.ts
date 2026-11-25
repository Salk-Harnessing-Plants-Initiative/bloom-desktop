/**
 * Unit tests: which accession files hold a plant whose barcode or accession name
 * contains the search, for the Accessions page.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  containsPattern,
  MAX_SEARCH_LENGTH,
  registerAccessionSearchHandlers,
  searchAccessionFiles,
} from '../../src/main/accession-search-handlers';

const dbReturning = (rows: unknown[]) => ({
  $queryRawUnsafe: vi.fn().mockResolvedValue(rows),
});

describe('containsPattern', () => {
  it('matches the text anywhere, with %, _ and \\ taken literally', () => {
    expect(containsPattern('stl-003')).toBe('%stl-003%');
    expect(containsPattern('a_1')).toBe('%a\\_1%');
    expect(containsPattern('50%')).toBe('%50\\%%');
    expect(containsPattern('a\\b')).toBe('%a\\\\b%');
  });
});

describe('searchAccessionFiles', () => {
  it('returns each matching file with its count of matching plants as a number', async () => {
    const db = dbReturning([
      { accession_file_id: 'stl', matching_plants: BigInt(4) },
      { accession_file_id: 'kcs', matching_plants: 1 },
    ]);
    expect(await searchAccessionFiles({ db }, '  Col-0 ')).toEqual({
      success: true,
      data: [
        { accession_file_id: 'stl', matching_plants: 4 },
        { accession_file_id: 'kcs', matching_plants: 1 },
      ],
    });
    // Barcode and accession name, the trimmed text as a parameter, not in the SQL.
    const [sql, barcode, accession] = db.$queryRawUnsafe.mock.calls[0];
    expect(sql).toMatch(/"plant_barcode" LIKE \? ESCAPE/);
    expect(sql).toMatch(/"accession_name" LIKE \? ESCAPE/);
    expect(sql).not.toContain('Col-0');
    expect([barcode, accession]).toEqual(['%Col-0%', '%Col-0%']);
  });

  it('returns nothing for blank text, without reading', async () => {
    const db = dbReturning([]);
    expect(await searchAccessionFiles({ db }, '   ')).toEqual({
      success: true,
      data: [],
    });
    expect(db.$queryRawUnsafe).not.toHaveBeenCalled();
  });

  it('refuses anything but a string, or text that is too long, without reading', async () => {
    const db = dbReturning([]);
    for (const bad of [undefined, null, 5, { text: 'x' }]) {
      expect(await searchAccessionFiles({ db }, bad)).toEqual({
        success: false,
        error: 'search must be a string',
      });
    }
    expect(
      (await searchAccessionFiles({ db }, 'x'.repeat(MAX_SEARCH_LENGTH + 1)))
        .success
    ).toBe(false);
    expect(db.$queryRawUnsafe).not.toHaveBeenCalled();
  });

  it('reports a database error', async () => {
    const db = {
      $queryRawUnsafe: vi
        .fn()
        .mockRejectedValue(new Error('database is locked')),
    };
    expect(await searchAccessionFiles({ db }, 'stl')).toEqual({
      success: false,
      error: 'database is locked',
    });
  });
});

describe('registerAccessionSearchHandlers', () => {
  it('registers db:accessions:search', async () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    registerAccessionSearchHandlers({
      ipcMain: {
        handle: (channel: string, fn: (...args: unknown[]) => unknown) => {
          handlers.set(channel, fn);
        },
      } as never,
      db: dbReturning([{ accession_file_id: 'stl', matching_plants: 2 }]),
    });
    expect(await handlers.get('db:accessions:search')!({}, 'stl')).toEqual({
      success: true,
      data: [{ accession_file_id: 'stl', matching_plants: 2 }],
    });
  });
});
