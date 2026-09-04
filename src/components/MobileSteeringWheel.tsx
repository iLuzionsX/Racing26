import React from 'react';
import {
  MOBILE_STEERING_WHEEL_DEFAULT_ROTATION_DEG,
  advanceMobileWheelPointerMotion,
  clampMobileWheelRotationDeg,
  isMobileWheelPointerNearCenter,
  mobileWheelMaxRotationDeg,
  mobileWheelPointerAngleDeg,
  mobileWheelPointerRadiusPx,
  mobileWheelRotationToSteer,
} from './mobileControls';

export const MobileSteeringWheel: React.FC<{
  onSteerChange: (value: number, active: boolean) => void;
  interactionEnabled?: boolean;
  steeringRotationDeg?: number;
}> = ({
  onSteerChange,
  interactionEnabled = true,
  steeringRotationDeg = MOBILE_STEERING_WHEEL_DEFAULT_ROTATION_DEG,
}) => {
  const [rotationDeg, setRotationDeg] = React.useState(0);
  const [dragging, setDragging] = React.useState(false);
  const pointerRef = React.useRef<{
    id: number;
    lastPointerAngleDeg: number;
    needsAngleResync: boolean;
  } | null>(null);
  const rotationRef = React.useRef(0);
  const onSteerChangeRef = React.useRef(onSteerChange);

  React.useEffect(() => {
    onSteerChangeRef.current = onSteerChange;
  }, [onSteerChange]);

  const reportRotation = React.useCallback((nextRotationDeg: number, active: boolean) => {
    const clamped = clampMobileWheelRotationDeg(nextRotationDeg, steeringRotationDeg);
    rotationRef.current = clamped;
    setRotationDeg(clamped);
    onSteerChangeRef.current(
      mobileWheelRotationToSteer(clamped, steeringRotationDeg),
      active
    );
  }, [steeringRotationDeg]);

  const release = React.useCallback(() => {
    pointerRef.current = null;
    setDragging(false);
    reportRotation(0, false);
  }, [reportRotation]);

  React.useEffect(() => {
    if (!interactionEnabled) release();
  }, [interactionEnabled, release]);

  React.useEffect(() => {
    const clamped = clampMobileWheelRotationDeg(rotationRef.current, steeringRotationDeg);
    if (clamped !== rotationRef.current) {
      reportRotation(clamped, dragging);
    } else if (dragging) {
      onSteerChangeRef.current(
        mobileWheelRotationToSteer(clamped, steeringRotationDeg),
        true
      );
    }
  }, [steeringRotationDeg, dragging, reportRotation]);

  React.useEffect(() => {
    const onBlur = () => release();
    const onVisibility = () => {
      if (document.hidden) release();
    };
    const onOrientation = () => release();

    window.addEventListener('blur', onBlur);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('orientationchange', onOrientation);
    return () => {
      window.removeEventListener('blur', onBlur);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('orientationchange', onOrientation);
      onSteerChangeRef.current(0, false);
    };
  }, [release]);

  const pointerPolarForEvent = (event: React.PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const wheelRadiusPx = Math.max(1, Math.min(rect.width, rect.height) * 0.5);
    const pointerRadiusPx = mobileWheelPointerRadiusPx(
      centerX,
      centerY,
      event.clientX,
      event.clientY
    );
    return {
      angleDeg: mobileWheelPointerAngleDeg(
        centerX,
        centerY,
        event.clientX,
        event.clientY
      ),
      nearCenter: isMobileWheelPointerNearCenter(pointerRadiusPx, wheelRadiusPx),
    };
  };

  return (
    <div
      id="mobile-steering-wheel"
      className={`relative touch-none select-none rounded-full ${dragging ? 'is-dragging' : ''}`}
      role="slider"
      tabIndex={interactionEnabled ? 0 : -1}
      aria-disabled={!interactionEnabled}
      aria-label="Steering wheel"
      aria-valuemin={-1}
      aria-valuemax={1}
      aria-valuenow={Number(
        mobileWheelRotationToSteer(rotationDeg, steeringRotationDeg).toFixed(3)
      )}
      onPointerDown={(event) => {
        if (!interactionEnabled) return;
        event.preventDefault();
        if (pointerRef.current !== null) return;
        const pointer = pointerPolarForEvent(event);
        pointerRef.current = {
          id: event.pointerId,
          lastPointerAngleDeg: pointer.angleDeg,
          needsAngleResync: pointer.nearCenter,
        };
        setDragging(true);
        event.currentTarget.setPointerCapture?.(event.pointerId);
        onSteerChangeRef.current(
          mobileWheelRotationToSteer(rotationRef.current, steeringRotationDeg),
          true
        );
      }}
      onPointerMove={(event) => {
        if (!interactionEnabled) return;
        const pointer = pointerRef.current;
        if (!pointer || pointer.id !== event.pointerId) return;
        event.preventDefault();
        const polar = pointerPolarForEvent(event);

        const nextMotion = advanceMobileWheelPointerMotion(
          {
            rotationDeg: rotationRef.current,
            lastPointerAngleDeg: pointer.lastPointerAngleDeg,
            needsAngleResync: pointer.needsAngleResync,
          },
          polar.angleDeg,
          polar.nearCenter,
          steeringRotationDeg
        );

        pointer.lastPointerAngleDeg = nextMotion.lastPointerAngleDeg;
        pointer.needsAngleResync = nextMotion.needsAngleResync;
        if (nextMotion.rotationDeg !== rotationRef.current) {
          reportRotation(nextMotion.rotationDeg, true);
        }
      }}
      onPointerLeave={(event) => {
        const pointer = pointerRef.current;
        if (!pointer || pointer.id !== event.pointerId) return;
        try {
          if (event.currentTarget.hasPointerCapture?.(event.pointerId)) return;
        } catch {
          // Older WebKit can throw around capture state; release is safest.
        }
        release();
      }}
      onPointerUp={(event) => {
        if (pointerRef.current?.id !== event.pointerId) return;
        release();
      }}
      onPointerCancel={(event) => {
        if (pointerRef.current?.id !== event.pointerId) return;
        release();
      }}
      onLostPointerCapture={(event) => {
        if (pointerRef.current?.id !== event.pointerId) return;
        release();
      }}
      onKeyDown={(event) => {
        if (!interactionEnabled) return;
        let next = rotationRef.current;
        const keyboardStepDeg = mobileWheelMaxRotationDeg(steeringRotationDeg) / 10;
        if (event.key === 'ArrowLeft') next -= keyboardStepDeg;
        else if (event.key === 'ArrowRight') next += keyboardStepDeg;
        else if (event.key === 'Home' || event.key === '0') next = 0;
        else return;
        event.preventDefault();
        reportRotation(next, true);
      }}
      onKeyUp={(event) => {
        if (!interactionEnabled) return;
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') release();
      }}
      onBlur={release}
      onContextMenu={(event) => event.preventDefault()}
      onDragStart={(event) => event.preventDefault()}
    >
      <div
        className="mobile-steering-wheel-rotor"
        style={{ transform: `rotate(${rotationDeg}deg)` }}
        aria-hidden="true"
      >
        <img
          src={`${import.meta.env.BASE_URL}assets/steering-wheel.svg`}
          alt=""
          draggable={false}
          className="pointer-events-none h-full w-full"
        />
      </div>
      <span className="mobile-steering-wheel-center-mark" aria-hidden="true" />
    </div>
  );
};
