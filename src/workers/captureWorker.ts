import { openCaptureFile, UnsupportedLinkTypeError } from '../core/capture';
import { CaptureReadError, type CaptureReadLimits } from '../core/captureFile';
import { createBuiltinRegistry } from '../protocols';
import { createRegistry } from '../core/registry';
import type { ProtocolDefinition } from '../core/model';

export interface ParseCaptureWorkerRequest {
  bytes: Uint8Array;
  fileName: string;
  limits?: CaptureReadLimits;
  customProtocols?: ProtocolDefinition[];
}

export type ParseCaptureWorkerResponse =
  | { type: 'progress'; processed: number; total: number }
  | { type: 'complete'; capture: ReturnType<typeof openCaptureFile> }
  | { type: 'error'; message: string; errorType?: string };

self.onmessage = (event: MessageEvent<ParseCaptureWorkerRequest>) => {
  // CodeQL security compliance: verify message origin if present
  if (event.origin && self.location?.origin && event.origin !== self.location.origin) {
    return;
  }
  const { bytes, fileName, limits, customProtocols } = event.data;
  try {
    const builtinRegistry = createBuiltinRegistry();
    const registry =
      customProtocols && customProtocols.length > 0
        ? createRegistry([...builtinRegistry.all(), ...customProtocols])
        : builtinRegistry;

    const capture = openCaptureFile(
      bytes,
      registry,
      fileName,
      limits,
      (processed, total) => {
        self.postMessage({
          type: 'progress',
          processed,
          total,
        } satisfies ParseCaptureWorkerResponse);
      },
    );

    self.postMessage({ type: 'complete', capture } satisfies ParseCaptureWorkerResponse);
  } catch (err: unknown) {
    const error = err as Error;
    const errorType =
      error instanceof CaptureReadError
        ? 'CaptureReadError'
        : error instanceof UnsupportedLinkTypeError
          ? 'UnsupportedLinkTypeError'
          : error.name;

    self.postMessage({
      type: 'error',
      message: error.message || 'Unknown error parsing capture file',
      errorType,
    } satisfies ParseCaptureWorkerResponse);
  }
};
