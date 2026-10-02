/** Free-text fields are display text: over the schema limit they are cut at a word boundary instead of failing the lesson. */
export function clampText(value: unknown, max: number): unknown {
  if (typeof value !== 'string' || value.length <= max) return value;
  const cut = value.slice(0, max);
  const at = cut.lastIndexOf(' ');
  return (at > max * 0.6 ? cut.slice(0, at) : cut).replace(/[\s,;:]+$/u, '');
}
