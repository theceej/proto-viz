import { openCaptureFile, UnsupportedLinkTypeError } from '../core/capture';
import { CaptureReadError, type CaptureReadLimits } from '../core/captureFile';
import { createCaptureWorkerRegistry } from '../core/captureWorkerRegistry';
import type { ProtocolDefinition } from '../core/model';
import { withCaptureProfile, type CaptureProfile } from '../core/captureProfile';
import type { Capture, CapturePacket } from '../core/capture';

const CAPTURE_PACKET_BATCH_SIZE = 250;

export interface ParseCaptureWorkerRequest {
  bytes: Uint8Array;
  fileName: string;
  limits?: CaptureReadLimits;
  customProtocols?: ProtocolDefinition[];
  profile?: { requestedAt: number };
}

export interface CaptureWorkerProfile {
  workerProcessingMilliseconds: number;
  processingCompletedAt: number;
  core: CaptureProfile;
}

export type ParseCaptureWorkerResponse =
  | { type: 'progress'; processed: number; total: number }
  | { type: 'packets'; start: number; packets: CapturePacket[] }
  | {
      type: 'complete';
      capture: Omit<Capture, 'packets'>;
      packetCount: number;
      profile?: CaptureWorkerProfile;
    }
  | { type: 'error'; message: string; errorType?: string };

self.onmessage = (event: MessageEvent<ParseCaptureWorkerRequest>) => {
  // CodeQL security compliance: verify message origin if present
  if (event.origin && self.location?.origin && event.origin !== self.location.origin) {
    return;
  }
  const processingStarted = performance.now();
  const { bytes, fileName, limits, customProtocols, profile } = event.data;
  try {
    const registry = createCaptureWorkerRegistry(customProtocols);

    const run = () =>
      openCaptureFile(bytes, registry, fileName, limits, (processed, total) => {
        self.postMessage({
          type: 'progress',
          processed,
          total,
        } satisfies ParseCaptureWorkerResponse);
      });
    const profiled = profile ? withCaptureProfile(run) : null;
    const capture = profiled ? profiled.result : run();

    const processingCompleted = performance.now();
    for (let start = 0; start < capture.packets.length; start += CAPTURE_PACKET_BATCH_SIZE) {
      self.postMessage({
        type: 'packets',
        start,
        packets: capture.packets.slice(start, start + CAPTURE_PACKET_BATCH_SIZE),
      } satisfies ParseCaptureWorkerResponse);
    }
    const { packets, ...captureMetadata } = capture;
    self.postMessage({
      type: 'complete',
      capture: captureMetadata,
      packetCount: packets.length,
      ...(profile && profiled
        ? {
            profile: {
              workerProcessingMilliseconds: processingCompleted - processingStarted,
              processingCompletedAt: performance.timeOrigin + processingCompleted,
              core: profiled.profile,
            },
          }
        : {}),
    } satisfies ParseCaptureWorkerResponse);
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
