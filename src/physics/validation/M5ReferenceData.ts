export type ValidationReferenceClass =
  | 'hard'
  | 'engineering-plausibility'
  | 'internal-regression';

export type ReferenceConfidence = 'high' | 'medium' | 'low';

export interface ValidationReference {
  metric: string;
  label: string;
  unit: string;
  target?: number;
  min?: number;
  max?: number;
  referenceClass: ValidationReferenceClass;
  vehicleConfiguration: string;
  tireConfiguration?: string;
  testConditions?: string;
  source: string;
  sourceUrl?: string;
  sourceDate?: string;
  confidence: ReferenceConfidence;
  notes?: string;
}

/**
 * Real-world references are deliberately data-only and separate from test logic.
 * A missing metric stays missing; validation code must report NO REFERENCE DATA
 * rather than inventing a number to make the simulator look correct.
 */
export const M5_REFERENCE_DATA: Record<string, ValidationReference> = {
  bmw_zero_to_100_kmh: {
    metric: 'zeroTo100KmhSec',
    label: '0–100 km/h',
    unit: 's',
    target: 3.5,
    min: 3.35,
    max: 3.65,
    referenceClass: 'hard',
    vehicleConfiguration: '2025 BMW M5 sedan, manufacturer specification',
    testConditions: 'BMW manufacturer acceleration specification; exact road/test conditions not published in the press kit',
    source: 'BMW Group PressClub Canada — The All-New 2025 BMW M5',
    sourceUrl: 'https://www.press.bmwgroup.com/canada/article/detail/T0443398EN/the-all-new-2025-bmw-m5?language=en',
    sourceDate: '2024-06-26',
    confidence: 'high',
    notes: 'BMW states 0–100 km/h in 3.5 s.',
  },
  cd_zero_to_60_mph: {
    metric: 'zeroTo60MphSec',
    label: '0–60 mph',
    unit: 's',
    target: 3.0,
    min: 2.85,
    max: 3.15,
    referenceClass: 'hard',
    vehicleConfiguration: '2025 BMW M5 sedan, C/D test car, carbon-ceramic brakes and carbon-fiber roof',
    tireConfiguration: 'Hankook Ventus S1 Evo Z, 285/40ZR20 front, 295/35ZR21 rear',
    testConditions: 'Car and Driver instrumented test; result omits 1-ft rollout of 0.2 s',
    source: 'Car and Driver — Tested: 2025 BMW M5 Is a Moonshot',
    sourceUrl: 'https://www.caranddriver.com/reviews/a64524571/2025-bmw-m5-test/',
    sourceDate: '2025-04-22',
    confidence: 'high',
    notes: 'Do not compare this number directly to a true-standing-start stopwatch without accounting for C/D rollout.',
  },
  cd_zero_to_60_mph_true_start: {
    metric: 'zeroTo60MphTrueStartSec',
    label: '0–60 mph true standing start (rollout-adjusted)',
    unit: 's',
    target: 3.2,
    min: 3.05,
    max: 3.35,
    referenceClass: 'engineering-plausibility',
    vehicleConfiguration: '2025 BMW M5 sedan, C/D test car',
    tireConfiguration: 'Hankook Ventus S1 Evo Z, 285/40ZR20 front, 295/35ZR21 rear',
    testConditions: 'C/D 3.0 s instrumented result plus the published 0.2 s 1-ft rollout omission',
    source: 'Derived from Car and Driver instrumented test metadata',
    sourceUrl: 'https://www.caranddriver.com/reviews/a64524571/2025-bmw-m5-test/',
    sourceDate: '2025-04-22',
    confidence: 'medium',
    notes: 'Useful for this simulator because validation timing starts at zero vehicle speed.',
  },
  cd_quarter_mile: {
    metric: 'quarterMileSec',
    label: 'Quarter mile',
    unit: 's',
    target: 10.9,
    min: 10.7,
    max: 11.1,
    referenceClass: 'hard',
    vehicleConfiguration: '2025 BMW M5 sedan, C/D test car',
    tireConfiguration: 'Hankook Ventus S1 Evo Z',
    testConditions: 'Car and Driver instrumented test; 1-ft rollout convention applies',
    source: 'Car and Driver — Tested: 2025 BMW M5 Is a Moonshot',
    sourceUrl: 'https://www.caranddriver.com/reviews/a64524571/2025-bmw-m5-test/',
    sourceDate: '2025-04-22',
    confidence: 'high',
  },
  cd_quarter_mile_trap: {
    metric: 'quarterMileTrapMph',
    label: 'Quarter-mile trap speed',
    unit: 'mph',
    target: 130,
    min: 128,
    max: 132,
    referenceClass: 'hard',
    vehicleConfiguration: '2025 BMW M5 sedan, C/D test car',
    tireConfiguration: 'Hankook Ventus S1 Evo Z',
    source: 'Car and Driver — Tested: 2025 BMW M5 Is a Moonshot',
    sourceUrl: 'https://www.caranddriver.com/reviews/a64524571/2025-bmw-m5-test/',
    sourceDate: '2025-04-22',
    confidence: 'high',
  },
  cd_braking_70_to_0: {
    metric: 'braking70To0MphFt',
    label: '70–0 mph braking',
    unit: 'ft',
    target: 157,
    min: 153,
    max: 161,
    referenceClass: 'hard',
    vehicleConfiguration: '2025 BMW M5 sedan, C/D test car with carbon-ceramic brakes',
    tireConfiguration: 'Hankook Ventus S1 Evo Z',
    testConditions: 'Car and Driver West Coast test surface; C/D notes facility surface differs from its Michigan facility',
    source: 'Car and Driver — Tested: 2025 BMW M5 Is a Moonshot',
    sourceUrl: 'https://www.caranddriver.com/reviews/a64524571/2025-bmw-m5-test/',
    sourceDate: '2025-04-22',
    confidence: 'high',
  },
  cd_braking_100_to_0: {
    metric: 'braking100To0MphFt',
    label: '100–0 mph braking',
    unit: 'ft',
    target: 324,
    min: 316,
    max: 332,
    referenceClass: 'hard',
    vehicleConfiguration: '2025 BMW M5 sedan, C/D test car with carbon-ceramic brakes',
    tireConfiguration: 'Hankook Ventus S1 Evo Z',
    testConditions: 'Car and Driver West Coast test surface',
    source: 'Car and Driver — Tested: 2025 BMW M5 Is a Moonshot',
    sourceUrl: 'https://www.caranddriver.com/reviews/a64524571/2025-bmw-m5-test/',
    sourceDate: '2025-04-22',
    confidence: 'high',
  },
  cd_skidpad: {
    metric: 'skidpadPeakG',
    label: '300-ft skidpad roadholding',
    unit: 'g',
    target: 0.98,
    min: 0.95,
    max: 1.01,
    referenceClass: 'hard',
    vehicleConfiguration: '2025 BMW M5 sedan, C/D test car',
    tireConfiguration: 'Hankook Ventus S1 Evo Z, 285/40ZR20 front, 295/35ZR21 rear',
    testConditions: '300-ft diameter skidpad (45.72 m radius)',
    source: 'Car and Driver — Tested: 2025 BMW M5 Is a Moonshot',
    sourceUrl: 'https://www.caranddriver.com/reviews/a64524571/2025-bmw-m5-test/',
    sourceDate: '2025-04-22',
    confidence: 'high',
  },
  cd_test_mass: {
    metric: 'testMassKg',
    label: 'C/D measured curb weight',
    unit: 'kg',
    target: 2381.81,
    min: 2370,
    max: 2394,
    referenceClass: 'hard',
    vehicleConfiguration: '2025 BMW M5 sedan, C/D test car with carbon-ceramic brakes and carbon-fiber roof',
    source: 'Car and Driver — Tested: 2025 BMW M5 Is a Moonshot',
    sourceUrl: 'https://www.caranddriver.com/reviews/a64524571/2025-bmw-m5-test/',
    sourceDate: '2025-04-22',
    confidence: 'high',
    notes: 'C/D measured 5,251 lb. This is intentionally different from BMW published curb weight of 5,390 lb.',
  },
  bmw_wheelbase: {
    metric: 'wheelbaseM',
    label: 'Wheelbase',
    unit: 'm',
    target: 3.006,
    min: 3.003,
    max: 3.009,
    referenceClass: 'hard',
    vehicleConfiguration: '2025 BMW M5 sedan',
    source: 'BMW Group PressClub Canada — The All-New 2025 BMW M5',
    sourceUrl: 'https://www.press.bmwgroup.com/canada/article/detail/T0443398EN/the-all-new-2025-bmw-m5?language=en',
    sourceDate: '2024-06-26',
    confidence: 'high',
  },
  bmw_front_track: {
    metric: 'frontTrackM',
    label: 'Front track',
    unit: 'm',
    target: 1.684,
    min: 1.682,
    max: 1.686,
    referenceClass: 'hard',
    vehicleConfiguration: '2025 BMW M5 sedan',
    source: 'BMW Group PressClub Canada — The All-New 2025 BMW M5',
    sourceUrl: 'https://www.press.bmwgroup.com/canada/article/detail/T0443398EN/the-all-new-2025-bmw-m5?language=en',
    sourceDate: '2024-06-26',
    confidence: 'high',
  },
  bmw_rear_track: {
    metric: 'rearTrackM',
    label: 'Rear track',
    unit: 'm',
    target: 1.660,
    min: 1.658,
    max: 1.662,
    referenceClass: 'hard',
    vehicleConfiguration: '2025 BMW M5 sedan',
    source: 'BMW Group PressClub Canada — The All-New 2025 BMW M5',
    sourceUrl: 'https://www.press.bmwgroup.com/canada/article/detail/T0443398EN/the-all-new-2025-bmw-m5?language=en',
    sourceDate: '2024-06-26',
    confidence: 'high',
  },
  bmw_steering_ratio: {
    metric: 'overallSteeringRatio',
    label: 'Overall steering ratio',
    unit: ':1',
    target: 14.2,
    min: 14.1,
    max: 14.3,
    referenceClass: 'hard',
    vehicleConfiguration: '2025 BMW M5 sedan',
    source: 'BMW Group PressClub USA — The All-New 2025 BMW M5',
    sourceUrl: 'https://www.press.bmwgroup.com/usa/article/detail/T0443395EN_US/the-all-new-2025-bmw-m5',
    sourceDate: '2024-06-26',
    confidence: 'high',
    notes: 'BMW also states the M Servotronic system uses a variable steering ratio; 14.2:1 is the published overall figure.',
  },
  bmw_turning_circle: {
    metric: 'turningCircleM',
    label: 'Turning circle',
    unit: 'm',
    target: 12.6,
    min: 12.5,
    max: 12.7,
    referenceClass: 'hard',
    vehicleConfiguration: '2025 BMW M5 sedan with Integral Active Steering',
    source: 'BMW Group PressClub Canada — The All-New 2025 BMW M5',
    sourceUrl: 'https://www.press.bmwgroup.com/canada/article/detail/T0443398EN/the-all-new-2025-bmw-m5?language=en',
    sourceDate: '2024-06-26',
    confidence: 'high',
  },
};

export const M5_REFERENCE_DATA_NEEDED = [
  '100–0 km/h stopping distance under a directly comparable procedure',
  'steering-wheel angle versus lateral acceleration',
  'steady-state understeer gradient',
  'step-steer yaw response delay / rise time / overshoot',
  'yaw-rate gain versus steering input',
  'body roll gradient in deg/g',
  'front/rear/individual dynamic tire normal loads',
  'suspension displacement versus lateral acceleration',
  'pitch gradient under braking and acceleration',
  'wheel-hop and sprung-mass natural frequencies',
  'lift-off yaw response and throttle-on combined-slip telemetry',
  'production-car CG height and principal inertia tensor measurements',
];

export function findM5Reference(metric: string): ValidationReference | undefined {
  return Object.values(M5_REFERENCE_DATA).find((reference) => reference.metric === metric);
}
