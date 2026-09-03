# Physics Coordinate & Sign Conventions

This file is the canonical contract for all vehicle-physics code in this repository. Read it before changing `src/physics/**`.

## Body coordinate system

The simulation uses a right-handed body frame:

- `+X` = vehicle left
- `+Y` = up
- `+Z` = forward
- positive yaw is a left turn about `+Y`
- positive pitch is nose-up about `+X`
- positive roll is determined by the right-hand rule about `+Z`

Wheel ordering is always:

`[FL, FR, RL, RR]`

Never change or reinterpret that ordering locally.

## Steering

Control convention:

- positive steering input = left turn
- negative steering input = right turn

Ackermann invariant:

- left turn: FL is inside and must have greater steering magnitude than FR
- right turn: FR is inside and must have greater steering magnitude than FL
- left/right mirror cases must have equal inner and outer magnitudes

Rear steering:

- low speed: opposite phase to front steering
- high speed: same phase as front steering

## Wheel-local tire axes

The scalar wheel frame used by `Vehicle` / `WheelDynamics` is:

- longitudinal `+` = wheel rolling forward
- lateral `+` = vehicle/wheel left

A tire force must oppose contact-patch slip in the corresponding axis.

Raw longitudinal slip ratio is kinematic and therefore changes sign with travel direction. Driver aids must normalize slip by the direction of travel before classifying it:

- normalized positive slip = driven wheelspin
- normalized negative slip = braking lock

Do not classify ABS/TCS state from raw slip sign alone.

## Camber

The repository uses conventional automotive camber:

- negative camber = top of tire tilted toward the vehicle centerline

With the canonical `+X = left` lateral axis, equal negative camber must produce mirrored inward camber thrust:

- left tire negative camber -> negative lateral force (toward vehicle center/right)
- right tire negative camber -> positive lateral force (toward vehicle center/left)

Equal left/right loads and equal camber must cancel net camber thrust.

## Suspension travel

Suspension displacement is:

- positive = compression / bump / jounce
- negative = droop / rebound travel

Camber gain under compression for the current M5 geometry moves camber more negative.

Anti-roll bars use `leftDisplacement - rightDisplacement`. Their two chassis reactions must always be equal and opposite. Equal bump/heave must produce exactly zero net ARB vertical force.

Example: in a left turn, the right/outside suspension loads/compresses more. The bar must transfer load toward the right/outside tire, not toward the left/inside tire.

## Drivetrain torque and reverse

Torque sign alone does **not** determine power vs coast because reverse gear reverses both shaft speed and propulsion torque.

Use mechanical power flow:

`power = torque * angularVelocity`

- positive power -> drivetrain is propelling the axle -> power ramp
- negative power -> axle is back-driving the drivetrain -> coast ramp

Forward and reverse acceleration must use the same configured power-ramp strength when mirrored.

## Force and moment transforms

All basis transforms must preserve vector magnitude. A transform into a kinematic wheel frame and the inverse transform back to the compatibility frame must not create or remove force/energy.

Rigid-body moments use `r x F` with the same right-handed coordinate system above.

## Mandatory symmetry checks

Every physics change that can depend on a sign, side, direction, or axle must add or preserve a deterministic mirror/invariant test where practical. At minimum, applicable changes must check some combination of:

- left vs right
- forward vs reverse
- acceleration vs coast/braking
- inside vs outside wheel
- front vs rear axle
- positive vs negative slip/steering

A physics tuning change must not be used to hide a sign error. Diagnose sign/convention correctness before adjusting grip, spring, damping, steering, differential, brake, or assist calibration.

Run:

`npm run test:conventions`

before considering any physics change complete.
