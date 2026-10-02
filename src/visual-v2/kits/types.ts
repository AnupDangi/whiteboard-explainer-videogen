import type { z } from 'zod';
import type { PrimitiveVisual } from '../../shared/types.js';
import type { Rect } from './geometry.js';

/**
 * A mechanism kit (V2 plan Phase 6): a generic, parametrised drawing with named slots. The writer chooses a kit and its
 * semantic parameters; the kit owns every coordinate. Kits are topic-free: nothing here knows any lesson subject, only that a stack has an ordered column of slots and a compartment has zones separated by a boundary.
 */
export interface KitLayoutInput<P> {
  id: string;
  params: P;
  label?: string;
  rect: Rect;
  /** Slots the scene needs at once (largest number of simultaneous children). */
  capacity: number;
  /** For zoned kits: largest simultaneous children per zone. */
  zoneCapacity: Record<string, number>;
}

export interface KitGeometry {
  /** The kit's own drawing, in canvas coordinates. */
  frame: PrimitiveVisual;
  /** Where the child at `index` of `zone` sits. Slots never overlap and always lie inside the kit's rect. */
  slotRect(zone: string | undefined, index: number): Rect;
  /** Slots this layout provides (per zone for zoned kits). */
  slotCount(zone: string | undefined): number;
}

export interface KitDef<P> {
  name: string;
  paramsSchema: z.ZodType<P>;
  /** Zone names this kit exposes for the given params (empty for unzoned kits). */
  zones(params: P): string[];
  /** The size the kit wants when it has the region to itself (the layout may scale it down). */
  preferredSize(params: P, capacity: number): { w: number; h: number };
  layout(input: KitLayoutInput<P>): KitGeometry;
}
