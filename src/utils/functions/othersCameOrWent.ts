/**
 * KAN-992. Whether, from `before` to `after` (stored session ids, in order),
 * sessions only came or went around `id`: the lists differ, `id` is in both,
 * and among the sessions in both it keeps its place. A session arriving from
 * another page or device, or one deleted elsewhere, changes `id`'s index
 * without moving it against anything that was there.
 *
 * False when nothing came or went, when `id` is new or gone, and when `id`
 * moved past a session that stayed (an edit sends a session to the top, a
 * sort, another session moving past it).
 */
export function othersCameOrWent(
  before: readonly string[],
  after: readonly string[],
  id: string
): boolean {
  const kept = new Set(after);
  const both = before.filter((x) => kept.has(x));
  if (both.length === before.length && before.length === after.length) {
    return false;
  }
  const was = new Set(before);
  const place = both.indexOf(id);
  return place !== -1 && after.filter((x) => was.has(x)).indexOf(id) === place;
}
