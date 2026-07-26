import type { ProtocolDefinition } from '../model';
import { generateC, generateGo, generateLua, generateRust, generateScapy } from './generators';
import { interpretProtocol } from './interpret';
import type { CodeTarget, GeneratedProtocolCode } from './types';

export type { CodeTarget, GeneratedProtocolCode } from './types';

export function generateProtocolCode(
  definition: ProtocolDefinition,
  target: CodeTarget,
): GeneratedProtocolCode {
  const protocol = interpretProtocol(definition);
  switch (target) {
    case 'c': return generateC(protocol);
    case 'scapy': return generateScapy(protocol);
    case 'rust': return generateRust(protocol);
    case 'wireshark-lua': return generateLua(protocol);
    case 'go': return generateGo(protocol);
  }
}
