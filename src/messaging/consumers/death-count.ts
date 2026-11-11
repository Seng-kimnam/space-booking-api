/**
 * How many times the broker dead-lettered this message out of `queue` after a
 * consumer reject, from the x-death header it maintains. The consumer's attempt
 * number is this + 1.
 */
export function deathCount(headers: Record<string, unknown> | undefined, queue: string): number {
  const deaths = headers?.['x-death'];
  if (!Array.isArray(deaths)) return 0;
  let total = 0;
  for (const d of deaths as { queue?: unknown; reason?: unknown; count?: unknown }[]) {
    if (d?.queue === queue && d?.reason === 'rejected') {
      const n = typeof d.count === 'number' ? d.count : Number(d.count);
      if (Number.isFinite(n)) total += n;
    }
  }
  return total;
}
