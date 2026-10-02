// Chrome reads an unused title as the description; '' stops it repeating the name (KAN-345).
export function silenceRepeatedTitle(
  title: string | undefined,
  name: string | undefined
): '' | undefined {
  return title !== undefined && name?.startsWith(title) ? '' : undefined;
}
