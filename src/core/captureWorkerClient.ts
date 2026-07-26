import type { Capture } from './capture';
import { UnsupportedLinkTypeError, openCaptureFile } from './capture';
import { CaptureReadError, type CaptureReadLimits } from './captureFile';
import type { Registry } from './registry';
import type {
  ParseCaptureWorkerRequest,
  ParseCaptureWorkerResponse,
} from '../workers/captureWorker';
import { withCaptureProfile, type CaptureProfile } from './captureProfile';

export interface CaptureAsyncProfile {
  requestDispatchMilliseconds: number;
  workerProcessingMilliseconds: number;
  responseDispatchMilliseconds: number;
  core: CaptureProfile;
}

export interface ParseCaptureAsyncOptions {
  data: Uint8Array;
  registry: Registry;
  fileName: string;
  limits?: CaptureReadLimits;
  onProgress?: (processed: number, total: number) => void;
  onProfile?: (profile: CaptureAsyncProfile) => void;
}

/**
 * Offload capture parsing and record dissection to a background Web Worker.
 *
 * In environments where Web Workers are unavailable or restricted (such as
 * unit tests or locked-down contexts), this transparently falls back to
 * synchronous parsing on the main thread so all functionality continues to work.
 */
export async function parseCaptureAsync(
  options: ParseCaptureAsyncOptions,
): Promise<Capture> {
  const { data, registry, fileName, limits, onProgress, onProfile } = options;

  const runFallback = (): Capture => {
    if (!onProfile) return openCaptureFile(data, registry, fileName, limits, onProgress);
    const started = performance.now();
    const profiled = withCaptureProfile(() =>
      openCaptureFile(data, registry, fileName, limits, onProgress),
    );
    onProfile({
      requestDispatchMilliseconds: 0,
      workerProcessingMilliseconds: performance.now() - started,
      responseDispatchMilliseconds: 0,
      core: profiled.profile,
    });
    return profiled.result;
  };

  if (typeof Worker !== 'undefined') {
    try {
      const requestedAt = performance.timeOrigin + performance.now();
      return await new Promise<Capture>((resolve, reject) => {
        const worker = new Worker(
          new URL('../workers/captureWorker.ts', import.meta.url),
          { type: 'module' },
        );

        const customProtocols = registry
          .all()
          .filter((p) => p.source === 'custom');

        const message: ParseCaptureWorkerRequest = {
          bytes: data,
          fileName,
          limits,
          customProtocols,
          ...(onProfile ? { profile: { requestedAt } } : {}),
        };
        const packets: Capture['packets'] = [];

        worker.onmessage = (
          event: MessageEvent<ParseCaptureWorkerResponse>,
        ) => {
          if (event.origin && self.location?.origin && event.origin !== self.location.origin) {
            return;
          }
          const res = event.data;
          if (res.type === 'progress') {
            onProgress?.(res.processed, res.total);
          } else if (res.type === 'packets') {
            if (res.start !== packets.length) {
              worker.terminate();
              reject(new Error(`Capture worker sent packet batch ${res.start} after ${packets.length}.`));
              return;
            }
            packets.push(...res.packets);
          } else if (res.type === 'complete') {
            worker.terminate();
            if (packets.length !== res.packetCount) {
              reject(
                new Error(
                  `Capture worker completed with ${res.packetCount} packets after sending ${packets.length}.`,
                ),
              );
              return;
            }
            if (onProfile && res.profile) {
              const receivedAt = performance.timeOrigin + performance.now();
              onProfile({
                requestDispatchMilliseconds:
                  res.profile.processingCompletedAt -
                  res.profile.workerProcessingMilliseconds -
                  requestedAt,
                workerProcessingMilliseconds: res.profile.workerProcessingMilliseconds,
                responseDispatchMilliseconds: receivedAt - res.profile.processingCompletedAt,
                core: res.profile.core,
              });
            }
            resolve({ ...res.capture, packets });
          } else if (res.type === 'error') {
            worker.terminate();
            if (res.errorType === 'CaptureReadError') {
              reject(new CaptureReadError(res.message));
            } else if (res.errorType === 'UnsupportedLinkTypeError') {
              reject(new UnsupportedLinkTypeError(res.message));
            } else {
              reject(new Error(res.message));
            }
          }
        };

        worker.onerror = () => {
          worker.terminate();
          // Fallback to synchronous execution if worker thread crashes or fails
          try {
            resolve(runFallback());
          } catch (fallbackErr) {
            reject(fallbackErr);
          }
        };

        // Pass buffer (cloned/posted safely across worker boundary)
        worker.postMessage(message);
      });
    } catch {
      // Fallback if Worker constructor throws
      return runFallback();
    }
  }

  return runFallback();
}
