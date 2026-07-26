import type { Capture } from './capture';
import { UnsupportedLinkTypeError, openCaptureFile } from './capture';
import { CaptureReadError, type CaptureReadLimits } from './captureFile';
import type { Registry } from './registry';
import type {
  ParseCaptureWorkerRequest,
  ParseCaptureWorkerResponse,
} from '../workers/captureWorker';

export interface ParseCaptureAsyncOptions {
  data: Uint8Array;
  registry: Registry;
  fileName: string;
  limits?: CaptureReadLimits;
  onProgress?: (processed: number, total: number) => void;
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
  const { data, registry, fileName, limits, onProgress } = options;

  if (typeof Worker !== 'undefined') {
    try {
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
        };

        worker.onmessage = (
          event: MessageEvent<ParseCaptureWorkerResponse>,
        ) => {
          if (event.origin && self.location?.origin && event.origin !== self.location.origin) {
            return;
          }
          const res = event.data;
          if (res.type === 'progress') {
            onProgress?.(res.processed, res.total);
          } else if (res.type === 'complete') {
            worker.terminate();
            resolve(res.capture);
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
            resolve(openCaptureFile(data, registry, fileName, limits, onProgress));
          } catch (fallbackErr) {
            reject(fallbackErr);
          }
        };

        // Pass buffer (cloned/posted safely across worker boundary)
        worker.postMessage(message);
      });
    } catch {
      // Fallback if Worker constructor throws
      return openCaptureFile(data, registry, fileName, limits, onProgress);
    }
  }

  return openCaptureFile(data, registry, fileName, limits, onProgress);
}
