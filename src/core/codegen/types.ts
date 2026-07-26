import type { ProtocolDefinition } from '../model';

export type CodeTarget = 'c' | 'scapy' | 'rust' | 'wireshark-lua' | 'go';

export interface GeneratedProtocolCode {
  code: string;
  filename: string;
  mimeType: string;
  warnings: string[];
}

export type GenerateProtocolCode = (
  definition: ProtocolDefinition,
  target: CodeTarget,
) => GeneratedProtocolCode;
