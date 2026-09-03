import type { ValidationReference } from './M5ReferenceData';

/**
 * Engineering-derived references that transform a published test procedure into
 * the simulator's procedure without changing the vehicle physics.
 *
 * Car and Driver reports that its acceleration results omit a 1-foot rollout of
 * 0.2 s. The simulator's quarter-mile clock starts at true zero speed, so the
 * comparable engineering target is the published 10.9 s plus that 0.2 s rollout.
 * This is deliberately not labelled a hard measurement because it is a procedure
 * conversion rather than a separately measured true-start quarter mile.
 */
export const M5_DERIVED_REFERENCE_DATA: Record<string, ValidationReference> = {
  cd_quarter_mile_true_start: {
    metric: 'quarterMileTrueStartSec',
    label: 'Quarter mile — true standing start (rollout-adjusted)',
    unit: 's',
    target: 11.1,
    min: 10.9,
    max: 11.3,
    referenceClass: 'engineering-plausibility',
    vehicleConfiguration: '2025 BMW M5 sedan, C/D test car',
    tireConfiguration: 'Hankook Ventus S1 Evo Z',
    testConditions: 'Simulator true standing start; derived by adding C/D published 0.2 s rollout omission to its 10.9 s quarter-mile result',
    source: 'Derived from Car and Driver instrumented result and published rollout convention',
    sourceUrl: 'https://www.caranddriver.com/reviews/a64524571/2025-bmw-m5-test/',
    sourceDate: '2025-04-22',
    confidence: 'medium',
    notes: 'Keep the published 10.9 s result separately as the hard C/D rollout-convention measurement. This 11.1 s target exists only to compare with the simulator clock that starts at zero vehicle speed.',
  },
};

export function findM5DerivedReference(metric: string): ValidationReference | undefined {
  return Object.values(M5_DERIVED_REFERENCE_DATA).find((reference) => reference.metric === metric);
}
