# Agent Instructions

## Vehicle physics changes

Before editing anything under `src/physics/**`, read `PHYSICS_CONVENTIONS.md` and treat it as an invariant contract.

For any physics change involving steering, tire forces, suspension, drivetrain, brakes, driver aids, wheel ordering, coordinate transforms, or rendering of physical pose:

1. Identify the relevant coordinate/sign convention before changing equations.
2. Check the mirrored case, not just the reported direction. At minimum consider left/right and forward/reverse where applicable.
3. Do not compensate for a direction/sign bug by tuning grip, damping, spring rate, steering ratio, torque split, brake bias, or assists.
4. Add or update a deterministic invariant test when introducing a new sign-sensitive subsystem.
5. Run `npm run test:conventions` plus the subsystem's existing regression tests.
6. Do not merge a physics PR while a convention/symmetry regression is failing.

Canonical wheel order is `[FL, FR, RL, RR]`. Canonical body axes are `+X left, +Y up, +Z forward`. Positive steering/yaw means left.

If implementation behavior appears to disagree with these rules, investigate the implementation first rather than redefining the convention locally.
