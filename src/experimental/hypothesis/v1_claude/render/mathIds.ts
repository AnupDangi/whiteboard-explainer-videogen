/** Shared formula-part SVG id generation; dependency-free for browser rendering. */
export const partGroupId = (elementId: string, i: number) => `${elementId}-p${i}`;
