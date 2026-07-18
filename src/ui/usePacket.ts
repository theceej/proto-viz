import { useMemo } from 'react';
import { useLibraryStore } from '../store/libraryStore';
import { useStackStore } from '../store/stackStore';
import { serializeStack, type SerializedPacket } from '../core/serialize';
import { validateStack, type ValidationIssue } from '../core/validate';
import type { StackInstance } from '../core/model';
import type { Registry } from '../core/registry';

export interface PacketState {
  stack: StackInstance;
  registry: Registry;
  packet: SerializedPacket | null;
  serializeError: string | null;
  validation: ValidationIssue[];
}

/** Serialized packet + validation, recomputed whenever the stack changes. */
export function usePacket(): PacketState {
  const layers = useStackStore((s) => s.layers);
  const trailingPayload = useStackStore((s) => s.trailingPayload);
  const registry = useLibraryStore((s) => s.registry);

  return useMemo(() => {
    const stack: StackInstance = { layers, trailingPayload };
    let packet: SerializedPacket | null = null;
    let serializeError: string | null = null;
    if (layers.length > 0) {
      try {
        packet = serializeStack(stack, registry);
      } catch (e) {
        serializeError = (e as Error).message;
      }
    }
    const validation = validateStack(stack, registry, packet ?? undefined);
    return { stack, registry, packet, serializeError, validation };
  }, [layers, trailingPayload, registry]);
}
