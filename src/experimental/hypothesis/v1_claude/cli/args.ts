/** Minimal `--key=value` / `--flag` parsing shared by every CLI in this track. */
export const argValue = (args: readonly string[], key: string): string | undefined =>
  args.find((value) => value.startsWith(`--${key}=`))?.slice(key.length + 3);

/** Every value of a repeatable option, in order (`--source=a --source=b`). */
export const argValues = (args: readonly string[], key: string): string[] =>
  args.flatMap((value) => (value.startsWith(`--${key}=`) ? [value.slice(key.length + 3)] : []));

export const hasFlag = (args: readonly string[], flag: string): boolean => args.includes(`--${flag}`);
