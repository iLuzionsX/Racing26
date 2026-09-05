import assert from 'node:assert/strict';
import { AerodynamicsSystem } from '../Aero';

function makeAero() {
  return new AerodynamicsSystem({
    downforceFront100Kmh: 300,
    downforceRear100Kmh: 300,
    dragCoeff: 0.35,
    copPitchSensitivity: 0.04,
    groundEffectUnderbody: false,
    groundEffectMaxDownforce: 0,
    diffuserStallHeight: 0.035,
    drsEnabled: false,
    drsDragReduction: 0.35,
    drsDownforceReduction: 0.45,
    airbrakeEnabled: false,
  });
}

const wheelbase = 3.00482;
const frontWeight = 0.545;
const cgFront = wheelbase * (1 - frontWeight);
const cgRear = wheelbase * frontWeight;
const v100 = 100 / 3.6;

function vel(z: number) {
  return { x: 0, y: 0, z };
}

{
  const aero = makeAero();
  const out = aero.calculateAeroForces(vel(v100), 0, 0.12, 0, wheelbase, cgFront, cgRear);
  assert(Math.abs(out.frontPointBody.z - cgFront) < 1e-9, 'front aero point must be at true CG-to-front-axle');
  assert(Math.abs(out.rearPointBody.z + cgRear) < 1e-9, 'rear aero point must be at true CG-to-rear-axle');
  assert(Math.abs(out.frontAeroForce.y + 300) < 1e-6, 'front downforce at 100 kmh must equal calibration');
  assert(Math.abs(out.rearAeroForce.y + 300) < 1e-6, 'rear downforce at 100 kmh must equal calibration');
}

{
  const aero = makeAero();
  const out = aero.calculateAeroForces(vel(v100 * 2), 0, 0.12, 0, wheelbase, cgFront, cgRear);
  assert(Math.abs(out.frontAeroForce.y + 1200) < 1e-6, 'downforce must scale with v squared');
  assert(Math.abs(out.rearAeroForce.y + 1200) < 1e-6, 'rear downforce must scale with v squared');
}

{
  const aero = makeAero();
  const fwd = aero.calculateAeroForces(vel(v100), 0, 0.12, 0, wheelbase, cgFront, cgRear);
  const rev = aero.calculateAeroForces(vel(-v100), 0, 0.12, 0, wheelbase, cgFront, cgRear);
  assert(Math.abs(fwd.frontAeroForce.y - rev.frontAeroForce.y) < 1e-9, 'downforce must not flip in reverse');
  assert(Math.abs(fwd.dragForce.z + rev.dragForce.z) < 1e-9, 'drag must oppose travel direction');
}

{
  const aero = makeAero();
  const out = aero.calculateAeroForces(vel(v100), 0, 0.12, 0, wheelbase, cgFront, cgRear);
  const frontF = -out.frontAeroForce.y;
  const rearF = -out.rearAeroForce.y;
  const netMx = out.frontPointBody.z * frontF + out.rearPointBody.z * rearF;
  const expected = cgFront * frontF - cgRear * rearF;
  assert(Math.abs(netMx - expected) < 1e-6, 'aero pitch moment must use true axle arms');
  assert(netMx < 0, 'equal aero with rear-biased CG must bias moment rearward, not zero');
}

console.log('AeroBalanceTests: PASS');
