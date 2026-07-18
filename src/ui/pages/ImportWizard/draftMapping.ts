import type { FieldType } from '../../../core/model';
import type { DraftField } from '../../../import/draft';
import type { ProseField } from '../../../import/fieldList';
import type { Claim } from './constants';

/**
 * Pure transforms between the wizard's editable state and the shapes the
 * import core expects. Kept framework-free so the mapping rules are unit
 * testable without rendering the wizard.
 */

/** Seed the review table from a prose "Name: N bits" field list. */
export function proseToDraftFields(prose: ProseField[]): DraftField[] {
  return prose.map((p, i) => ({
    id: `field${i}`,
    name: p.name,
    bitLength: p.bits,
    type: 'uint' as FieldType,
    variable: false,
    flags: [],
    inference: 'from prose field list',
  }));
}

/**
 * Turn the metadata form's encapsulation rows into definition claims: drop
 * rows with no namespace, and treat a blank value as an opaque claim
 * (`undefined`) rather than the number 0.
 */
export function claimsToEncapsulations(
  claims: Claim[],
): { namespaceId: string; value: number | undefined }[] {
  return claims
    .filter((c) => c.namespaceId)
    .map((c) => ({
      namespaceId: c.namespaceId,
      value: c.value.trim() === '' ? undefined : Number(c.value),
    }));
}
