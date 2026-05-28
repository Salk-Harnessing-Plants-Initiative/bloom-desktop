const collator = new Intl.Collator(undefined, { numeric: true });

export function naturalCompare(a: string, b: string): number {
  return collator.compare(a, b);
}
