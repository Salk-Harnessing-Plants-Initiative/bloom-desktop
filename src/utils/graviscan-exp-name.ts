/**
 * GraviScan experiment names as they appear in scan folder and file names,
 * and the rule that keeps file-name markers out of them.
 *
 * A file is named `{exp}_wave{N}_st_{time}_et_{time}_cy{N}_{system}_Sc{K}_{plate}.tif`.
 * A person or script that splits the name on its markers would be misled by
 * an experiment called `Plot_st_2` or `Trial_cy1`, so new GraviScan
 * experiments may not use those words. They are also at most 20 characters,
 * so the whole name goes into file names rather than a cut version.
 */

/**
 * Longest experiment name kept in folder and file names (rig rule). New
 * GraviScan names may not be longer; older, longer names are cut to it.
 */
export const EXP_NAME_MAX_CHARS = 20;

/** Name used when the experiment has no name (rig rule). */
export const EXP_NAME_FALLBACK = 'scan';

/**
 * Experiment name as used in folder and file names: every character outside
 * A-Z a-z 0-9 becomes `_`, cut to 20 characters, `scan` when there is none.
 */
export function sanitizeExpName(name: string | null | undefined): string {
  return (name || EXP_NAME_FALLBACK)
    .replace(/[^a-zA-Z0-9]/g, '_')
    .slice(0, EXP_NAME_MAX_CHARS);
}

interface FileNameMarker {
  pattern: RegExp;
  /** What the marker stands for in a file name, for the message. */
  meaning: string;
}

const FILE_NAME_MARKERS: readonly FileNameMarker[] = [
  { pattern: /^st$/i, meaning: 'file names use "_st_" for the start time' },
  { pattern: /^et$/i, meaning: 'file names use "_et_" for the scan end time' },
  {
    pattern: /^wave\d+$/i,
    meaning:
      'the wave is chosen separately and file names already include it ("_wave20_")',
  },
  { pattern: /^cy\d+$/i, meaning: 'file names use "_cy1_" for the cycle' },
  {
    pattern: /^sc\d+$/i,
    meaning: 'file names use "_Sc1_" for the scanner position',
  },
];

export interface FoundMarker {
  /** The word as it appears in the cleaned name. */
  word: string;
  meaning: string;
}

/**
 * First word of the cleaned name (split on `_`) that is a file-name marker,
 * or null. Checks only what goes into the file name: the cleaned
 * 20-character form.
 */
export function findFileNameMarker(name: string): FoundMarker | null {
  for (const word of sanitizeExpName(name).split('_')) {
    const marker = FILE_NAME_MARKERS.find((m) => m.pattern.test(word));
    if (marker) return { word, meaning: marker.meaning };
  }
  return null;
}

/**
 * Message for a GraviScan experiment name that breaks the rule, or null.
 * New names are at most 20 characters, so the whole name goes into file
 * names and nothing is ever cut; then no marker word.
 */
export function graviscanExpNameError(name: string): string | null {
  const length = name.trim().length;
  if (length > EXP_NAME_MAX_CHARS) {
    return (
      `A GraviScan experiment name can be at most ${EXP_NAME_MAX_CHARS} ` +
      `characters, because it goes into every scan's file name (this one has ` +
      `${length}). Please shorten it.`
    );
  }
  const found = findFileNameMarker(name);
  if (!found) return null;
  return (
    `"${found.word}" can't be a word on its own in a GraviScan experiment ` +
    `name: ${found.meaning}. Please choose another name.`
  );
}
