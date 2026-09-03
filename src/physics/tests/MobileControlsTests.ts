import assert from 'node:assert/strict';
import { mapMobileSteeringDirection } from '../../components/mobileControls';

assert.equal(
  mapMobileSteeringDirection('left'),
  'steerLeft',
  'The left touch arrow must map to the left steering action.'
);

assert.equal(
  mapMobileSteeringDirection('right'),
  'steerRight',
  'The right touch arrow must map to the right steering action.'
);

assert.notEqual(
  mapMobileSteeringDirection('left'),
  mapMobileSteeringDirection('right'),
  'Left and right touch arrows must never resolve to the same steering action.'
);

console.log('MobileControlsTests: PASS');
