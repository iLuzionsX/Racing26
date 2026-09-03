import assert from 'node:assert/strict';
import { DifferentialSystem } from '../Differential';
import { disableM5TwoWheelDrive, enableM5TwoWheelDrive } from '../m5DriveMode';

const stock = {
  drivetrain: 'AWD',
  differentialType: 'TORQUE_VECTOR',
  tcsMode: 'SPORT',
  absMode: 'FULL',
  launchControlEnabled: true,
  centerFrontTorqueRatio: 0.40,
};

const entered = enableM5TwoWheelDrive(stock);
assert.equal(entered.config.drivetrain, 'RWD', '2WD mode must use the rear axle only');
assert.equal(entered.config.tcsMode, 'OFF', '2WD mode should remove traction/stability intervention');
assert.equal(entered.config.launchControlEnabled, false, 'BMW disables Launch Control in 2WD');
assert.equal(entered.config.absMode, 'FULL', '2WD mode must not disable ABS');
assert.equal(entered.config.differentialType, 'TORQUE_VECTOR', 'Active rear differential behavior should remain available');

const rearDiff = new DifferentialSystem({
  type: 'TORQUE_VECTOR' as any,
  powerRamp: 0.88,
  coastRamp: 0.48,
  preloadTorque: 100,
  drivetrain: entered.config.drivetrain as any,
  frontTorqueRatio: entered.config.centerFrontTorqueRatio,
});
const distributed = rearDiff.distributeTorque(1000, [20, 20, 20, 20]);
assert.equal(distributed.wheelTorques[0], 0, 'front-left wheel must receive zero drive torque in 2WD');
assert.equal(distributed.wheelTorques[1], 0, 'front-right wheel must receive zero drive torque in 2WD');
assert.ok(distributed.wheelTorques[2] > 0, 'rear-left wheel should receive drive torque');
assert.ok(distributed.wheelTorques[3] > 0, 'rear-right wheel should receive drive torque');
assert.ok(Math.abs(distributed.wheelTorques[2] + distributed.wheelTorques[3] - 1000) < 1e-9, 'rear axle must receive all input torque');

const restored = disableM5TwoWheelDrive(entered.config, entered.restore);
assert.equal(restored.drivetrain, 'AWD', 'leaving 2WD must restore M xDrive');
assert.equal(restored.tcsMode, 'SPORT', 'leaving 2WD must restore the previous traction-control mode');
assert.equal(restored.launchControlEnabled, true, 'leaving 2WD must restore Launch Control availability');
assert.equal(restored.centerFrontTorqueRatio, 0.40, 'leaving 2WD must restore the prior AWD front torque baseline');

console.log('M5 xDrive 2WD regression tests passed');
