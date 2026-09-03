export interface M5XDriveRestoreSnapshot {
  tcsMode?: string;
  launchControlEnabled?: boolean;
  differentialType?: string;
  centerFrontTorqueRatio?: number;
}

/**
 * Enter the G90 M5's track-oriented 2WD configuration.
 *
 * BMW only permits 2WD with DSC fully disabled, and Launch Control is not
 * available in 2WD. The simulator does not yet have a complete DSC model, so
 * TCS OFF is the closest existing intervention state while ABS remains
 * untouched. The Active M Differential remains available at the rear axle.
 */
export function enableM5TwoWheelDrive<T extends Record<string, any>>(
  config: T
): { config: T; restore: M5XDriveRestoreSnapshot } {
  const restore: M5XDriveRestoreSnapshot = {
    tcsMode: config.tcsMode,
    launchControlEnabled: config.launchControlEnabled,
    differentialType: config.differentialType,
    centerFrontTorqueRatio: config.centerFrontTorqueRatio,
  };

  return {
    config: {
      ...config,
      drivetrain: 'RWD',
      differentialType: 'TORQUE_VECTOR',
      tcsMode: 'OFF',
      launchControlEnabled: false,
    } as T,
    restore,
  };
}

/** Restore the normal rear-biased M xDrive configuration after 2WD mode. */
export function disableM5TwoWheelDrive<T extends Record<string, any>>(
  config: T,
  restore?: M5XDriveRestoreSnapshot | null
): T {
  return {
    ...config,
    drivetrain: 'AWD',
    differentialType: restore?.differentialType ?? 'TORQUE_VECTOR',
    tcsMode: restore?.tcsMode ?? 'SPORT',
    launchControlEnabled: restore?.launchControlEnabled ?? true,
    centerFrontTorqueRatio: restore?.centerFrontTorqueRatio ?? 0.40,
  } as T;
}
