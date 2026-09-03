# 2025 BMW M5 Validation Suite

This is the quantitative physics-regression loop for the G90 M5 simulation. Its purpose is to measure whether the normal vehicle simulation produces defensible results under repeatable inputs—not to make tests pass by adding special behavior.

## Non-negotiable rule

Validation may prescribe initial state, driver throttle/brake/steering, tire-state parameters already supported by the model, assists already supported by the model, and road geometry/material.

Validation must never prescribe chassis pose/yaw, tire force, hidden grip, yaw damping, body-roll animation, acceleration/braking multipliers, test-specific steering inside the physics model, or invisible stability assistance.

## Run the suite

```bash
npm run test:m5-validation
```

This always writes evidence to `artifacts/m5-validation/`. External benchmark failures remain in the report. Blocking physical invariants return a non-zero status after artifacts are generated.

Strict mode makes any `FAIL` non-zero:

```bash
npm run test:m5-validation:strict
```

## Run individual tests

Core deterministic tests:

```bash
npx tsx src/physics/validation/M5ValidationSuite.ts --test=acceleration
npx tsx src/physics/validation/M5ValidationSuite.ts --test=determinism,static-loads,mass-properties-moments
npx tsx src/physics/validation/M5ValidationSuite.ts --test=rapid-reversal,slalom,lift-throttle
```

Hardened maneuver tests:

```bash
npx tsx src/physics/validation/M5ValidationIndividual.ts --test=braking
npx tsx src/physics/validation/M5ValidationIndividual.ts --test=skidpad
npx tsx src/physics/validation/M5ValidationIndividual.ts --test=step-steer
npx tsx src/physics/validation/M5ValidationIndividual.ts --test=bump-response
npx tsx src/physics/validation/M5ValidationIndividual.ts --test=energy-sanity
```

List the hardened IDs:

```bash
npx tsx src/physics/validation/M5ValidationIndividual.ts --list
```

## Outputs

The full run creates:

- `m5-validation-report.json` — complete machine-readable report
- `m5-validation-report.md` — human-readable report
- `m5-validation-metrics.csv` — flattened metrics/status table
- `telemetry/*.csv` — 120 Hz per-test telemetry
- `skidpad-sweep.csv` — fixed-radius speed/G/load/slip sweep
- SVG plots for acceleration, braking, skidpad, step steer and bump response

CI uploads the whole directory as the `m5-validation-suite` artifact even when a blocking test fails.

## Regression comparison

A saved report can be supplied as a baseline:

```bash
npx tsx src/physics/validation/M5ValidationRunner.ts \
  --base=artifacts/m5-validation/base \
  --baseline=artifacts/baselines/m5-validation-report.json
```

The report emits before/after deltas for matching numeric metrics. A baseline protects regressions; it never overrides a real-world mismatch.

## What is measured

### Harness and environment

- fixed 120 Hz timestep and automatic reset/settle
- deterministic replay
- configurable friction, grade, wetness, split-μ and smooth bump profiles
- tire temperature/pressure/wear hooks
- ABS/TCS mode hooks

### Vehicle/chassis

- position and body/world velocity
- raw and filtered acceleration
- yaw/pitch/roll, rates and angular acceleration
- sideslip
- gear/RPM and assist activity

### Four wheels

FL/FR/RL/RR telemetry includes Fz/Fx/Fy, slip angle/ratio, omega, steering, suspension displacement/velocity, actual unsprung hub position/velocity/acceleration, spring/damper/bump-stop/hard-stop/ARB forces, chassis-side suspension reaction, tire normal load, camber, aligning moment, pneumatic trail, grip utilization, temperature, pressure, wear and contact state.

### CG / inertia / moment closure

The suite checks static axle distribution and the rigid-body relation:

```text
τ = r × F
α = I⁻¹(τ − ω × Iω)
```

It reconstructs live tire/contact yaw moment and compares it with measured chassis angular acceleration.

### Acceleration

Measures 0–30/50/100/120 km/h, true-start 0–60 mph, quarter mile/trap, longitudinal G, pitch, slip and wheel loads through the normal launch-control/powertrain/differential/tire/TCS path.

### Braking

Runs 100–0 km/h, 70–0 mph and 100–0 mph after first accelerating through the normal driveline. A stopping distance is only emitted if the vehicle actually reaches ≤1 km/h. Failure to stop under full brake is a blocking physics invariant, not a distance benchmark.

### Skidpad / roll / understeer

The authoritative external comparison uses a 45.72 m radius, matching Car and Driver's 300-ft-diameter skidpad. A point counts only if the scripted driver holds speed and radius within ±8% and sideslip stays below 8°. The framework also supports the requested 20/30/50/100 m radius architecture.

Outputs include lateral G, radius, road-wheel steering demand, estimated steering-wheel demand, yaw, sideslip, roll, individual loads/forces/slips, roll gradient and understeer gradient.

### Step steer

Runs 30/50/80/100 km/h and measures steering/slip/yaw onset, 10–90% yaw rise, overshoot, settling time and yaw-rate gain. The PR #27 base does not yet include PR #26's physical steering rack, so rack inertia is not fabricated; road-wheel/tire/chassis response is measured and rack fields remain unavailable/derived where explicitly labelled.

### Rapid reversal / slalom

Exercises repeated force/load reversal and numerical stability without hidden ESC or yaw damping. Slalom spacings are 18/22/30 m.

### Bump / unsprung response

Uses single-wheel and full-width smooth road bumps. Telemetry contains actual unsprung hub state plus tire-normal and suspension chassis-force reactions. If wheel-to-chassis timing cannot be separated at the 120 Hz sample resolution, the result is a `WARNING`, not a false pass.

### Lift-off / throttle-on

Records natural load/slip/yaw redistribution and combined-slip behavior. No lift-off oversteer is forced.

### Energy / low-speed sanity

Checks kinetic energy every physics step while coasting, reproduces the historical no-throttle low-speed turning case, and checks steering at rest for spontaneous speed/yaw.

## Reference hierarchy

Reference data lives separately in `src/physics/validation/M5ReferenceData.ts`.

- `hard` — direct BMW or instrumented numerical source
- `engineering-plausibility` — derived/literature-supported expectation
- `internal-regression` — deterministic behavior protected while external data is missing

Unknown G90 values stay `NO REFERENCE DATA` / `REFERENCE DATA NEEDED`; they are never invented to make the report look complete.

## Development loop

```text
real-world measurement
→ simulation measurement
→ error
→ physical diagnosis
→ physics correction
→ regression comparison
```

Do not change a coefficient merely because a metric is red. First determine which part of the causal chain is wrong.
