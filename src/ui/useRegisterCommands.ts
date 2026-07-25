import { useEffect } from 'react';
import { useCommandStore, type Command } from '../store/commandStore';

/**
 * Register a batch of palette commands for the lifetime of the calling
 * component. Pass a memoized `commands` array so this only re-registers when
 * the commands actually change.
 */
export function useRegisterCommands(owner: string, commands: Command[]): void {
  const register = useCommandStore((s) => s.register);
  const unregister = useCommandStore((s) => s.unregister);
  useEffect(() => {
    register(owner, commands);
    return () => unregister(owner);
  }, [owner, commands, register, unregister]);
}
