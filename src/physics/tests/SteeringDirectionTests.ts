import { Simulation } from '../Simulation';
import { DEFAULT_VEHICLE_CONFIG } from '../vehiclePresets';
import { BMW_M5_2025_OVERRIDES } from '../m5G90';
import { PhysicsMath } from '../math/PhysicsMath';

const assert = (condition: boolean, message: string) => {
  if (!condition) throw new Error(message);
};

const config = { ...DEFAULT_VEHICLE_CONFIG, ...BMW_M5_2025_OVERRIDES } as any;
const neutral = { throttle: 0, brake: 0, steer: 0, handbrake: false, shiftUp: false, shiftDown: false };

function assertFullRackAuthorityAtSpeed() {
  const sim = new Simulation(config);
  const steering = sim.vehicle.driverAids;

  steering.reset();
  const crawl = steering.updateSteering(1, 2, 1.0);
  steering.reset();
  const highway = steering.updateSteering(1, 35, 1.0);
  steering.reset();
  const veryFast = steering.updateSteering(1, 55, 1.0);

  const epsilon = 1e-12;
  assert(
    Math.abs(crawl.centerAngle - config.maxSteerAngle) < epsilon,
    `crawl full rack did not reach physical stop: ${crawl.centerAngle}`
  );
  assert(
    Math.abs(highway.centerAngle - config.maxSteerAngle) < epsilon,
    `highway speed silently reduced steering authority: ${highway.centerAngle}`
  );
  assert(
    Math.abs(veryFast.centerAngle - config.maxSteerAngle) < epsilon,
    `high speed silently reduced steering authority: ${veryFast.centerAngle}`
  );

  return { crawl, highway, veryFast };
}

function assertAckermannAtLowSpeed() {
  const sim = new Simulation(config);
  const steering = sim.vehicle.driverAids;
  const speedMs = 6.0; // 21.6 km/h: the reported parking/urban-speed problem range.

  steering.reset();
  const left = steering.updateSteering(0.75, speedMs, 1.0);
  assert(left.steerFL > 0 && left.steerFR > 0, `LEFT Ackermann signs invalid: FL=${left.steerFL} FR=${left.steerFR}`);
  assert(
    Math.abs(left.steerFL) > Math.abs(left.steerFR),
    `LEFT turn requires inside FL angle > outside FR angle: FL=${left.steerFL} FR=${left.steerFR}`
  );

  steering.reset();
  const right = steering.updateSteering(-0.75, speedMs, 1.0);
  assert(right.steerFL < 0 && right.steerFR < 0, `RIGHT Ackermann signs invalid: FL=${right.steerFL} FR=${right.steerFR}`);
  assert(
    Math.abs(right.steerFR) > Math.abs(right.steerFL),
    `RIGHT turn requires inside FR angle > outside FL angle: FL=${right.steerFL} FR=${right.steerFR}`
  );

  assert(
    Math.abs(Math.abs(left.steerFL) - Math.abs(right.steerFR)) < 1e-10,
    `inside steer magnitude lost left/right symmetry: left FL=${left.steerFL} right FR=${right.steerFR}`
  );
  assert(
    Math.abs(Math.abs(left.steerFR) - Math.abs(right.steerFL)) < 1e-10,
    `outside steer magnitude lost left/right symmetry: left FR=${left.steerFR} right FL=${right.steerFL}`
  );

  return { left, right, speedMs };
}

function runTurn(steer: number, speedMs: number = 18) {
  const sim = new Simulation(config);
  sim.reset(0, 0, 0);
  for (let i = 0; i < 240; i++) sim.stepExplicit(neutral, 1);
  sim.vehicle.rigidBody.velocity = PhysicsMath.vec3(0, 0, speedMs);
  sim.vehicle.wheels.forEach((wheel) => wheel.reset(speedMs));
  for (let i = 0; i < 60; i++) sim.stepExplicit(neutral, 1);

  let state = sim.vehicle.getState();
  for (let i = 0; i < 120; i++) state = sim.stepExplicit({ ...neutral, steer }, 1);
  const leftLoadN = state.wheels[0].suspensionForce + state.wheels[2].suspensionForce;
  const rightLoadN = state.wheels[1].suspensionForce + state.wheels[3].suspensionForce;
  return { state, leftLoadN, rightLoadN };
}

const rackAuthority = assertFullRackAuthorityAtSpeed();
const ackermann = assertAckermannAtLowSpeed();

const left = runTurn(0.18);
assert(left.state.x > 0.5, `LEFT command must move toward vehicle-left (+X), got x=${left.state.x}`);
assert(left.state.yaw > 0.03, `LEFT command must produce positive yaw, got yaw=${left.state.yaw}`);
assert(left.state.actualSteerAngle > 0, `LEFT command must produce positive rack angle, got ${left.state.actualSteerAngle}`);
assert(left.rightLoadN > left.leftLoadN, `LEFT turn must load RIGHT/outside tires: left=${left.leftLoadN} right=${left.rightLoadN}`);

const right = runTurn(-0.18);
assert(right.state.x < -0.5, `RIGHT command must move toward vehicle-right (-X), got x=${right.state.x}`);
assert(right.state.yaw < -0.03, `RIGHT command must produce negative yaw, got yaw=${right.state.yaw}`);
assert(right.state.actualSteerAngle < 0, `RIGHT command must produce negative rack angle, got ${right.state.actualSteerAngle}`);
assert(right.leftLoadN > right.rightLoadN, `RIGHT turn must load LEFT/outside tires: left=${right.leftLoadN} right=${right.rightLoadN}`);

console.log(JSON.stringify({
  fullRackAuthority: {
    maxSteerDeg: config.maxSteerAngle * 180 / Math.PI,
    crawlDeg: rackAuthority.crawl.centerAngle * 180 / Math.PI,
    highwayDeg: rackAuthority.highway.centerAngle * 180 / Math.PI,
    veryFastDeg: rackAuthority.veryFast.centerAngle * 180 / Math.PI,
  },
  lowSpeedAckermann: {
    speedKmh: ackermann.speedMs * 3.6,
    left: {
      insideFLDeg: ackermann.left.steerFL * 180 / Math.PI,
      outsideFRDeg: ackermann.left.steerFR * 180 / Math.PI,
    },
    right: {
      outsideFLDeg: ackermann.right.steerFL * 180 / Math.PI,
      insideFRDeg: ackermann.right.steerFR * 180 / Math.PI,
    },
  },
  left: { x: left.state.x, yawDeg: left.state.yaw * 180 / Math.PI, leftLoadN: left.leftLoadN, rightLoadN: left.rightLoadN },
  right: { x: right.state.x, yawDeg: right.state.yaw * 180 / Math.PI, leftLoadN: right.leftLoadN, rightLoadN: right.rightLoadN },
  status: 'passed',
}, null, 2));
