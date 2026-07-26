import { describe, expect, it } from 'vitest';
import type { ProtocolDefinition } from './model';
import { createCaptureWorkerRegistry } from './captureWorkerRegistry';

describe('createCaptureWorkerRegistry', () => {
  it('keeps built-in protocols and enum tables when custom protocols are supplied', () => {
    const custom: ProtocolDefinition = {
      id: 'worker-custom',
      name: 'Worker custom',
      layerHint: 'application',
      fields: [],
      providesNamespaces: [],
      encapsulations: [],
      source: 'custom',
    };

    const registry = createCaptureWorkerRegistry([custom]);

    expect(registry.get('worker-custom')).toBe(custom);
    expect(registry.get('ipv4')?.source).toBe('builtin');
    expect(registry.getEnum('ip-proto')?.values[6]).toBe('TCP');
  });
});
