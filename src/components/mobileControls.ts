export type MobileSteeringDirection = 'left' | 'right';
export type MobileSteeringAction = 'steerLeft' | 'steerRight';

/**
 * Touch arrow labels use the same steering-action convention as the keyboard:
 * left means steerLeft and right means steerRight. Keep this mapping explicit so
 * a UI refactor cannot silently reverse the mobile controls again.
 */
export function mapMobileSteeringDirection(direction: MobileSteeringDirection): MobileSteeringAction {
  return direction === 'left' ? 'steerLeft' : 'steerRight';
}
