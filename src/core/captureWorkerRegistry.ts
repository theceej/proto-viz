import type { ProtocolDefinition } from './model';
import { createBuiltinRegistry } from '../protocols';

export function createCaptureWorkerRegistry(customProtocols?: ProtocolDefinition[]) {
  return createBuiltinRegistry(customProtocols);
}
