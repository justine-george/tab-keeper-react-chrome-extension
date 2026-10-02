/**
 * The aria-description for a control whose tooltip may repeat its name.
 * Chrome reads a title it did not use for the name as the description, so an
 * empty one stops it saying again what the name already starts with
 * (KAN-345). Undefined when the tooltip adds something.
 */
export function silenceRepeatedTitle(
  title: string | undefined,
  name: string | undefined
): '' | undefined {
  return title !== undefined && name?.startsWith(title) ? '' : undefined;
}
