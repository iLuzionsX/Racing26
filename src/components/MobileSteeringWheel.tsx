import React from 'react';
import {
  advanceMobileWheelRotationDeg,
  mobileWheelPointerAngleDeg,
  mobileWheelRotationToSteer,
} from './mobileControls';

export const MobileSteeringWheel: React.FC<{
  onSteerChange: (value: number, active: boolean) => void;
  interactionEnabled?: boolean;
}> = ({ onSteerChange, interactionEnabled = true }) => {
  const [rotationDeg, setRotationDeg] = React.useState(0);
  const [dragging, setDragging] = React.useState(false);
  const pointerRef = React.useRef<{ id: number; lastPointerAngleDeg: number } | null>(null);
  const rotationRef = React.useRef(0);
  const onSteerChangeRef = React.useRef(onSteerChange);

  React.useEffect(() => {
    onSteerChangeRef.current = onSteerChange;
  }, [onSteerChange]);

  const reportRotation = React.useCallback((nextRotationDeg: number, active: boolean) => {
    rotationRef.current = nextRotationDeg;
    setRotationDeg(nextRotationDeg);
    onSteerChangeRef.current(mobileWheelRotationToSteer(nextRotationDeg), active);
  }, []);

  const release = React.useCallback(() => {
    pointerRef.current = null;
    setDragging(false);
    reportRotation(0, false);
  }, [reportRotation]);

  React.useEffect(() => {
    if (!interactionEnabled) release();
  }, [interactionEnabled, release]);

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

  const pointerAngleForEvent = (event: React.PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return mobileWheelPointerAngleDeg(
      rect.left + rect.width / 2,
      rect.top + rect.height / 2,
      event.clientX,
      event.clientY
    );
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
      aria-valuenow={Number(mobileWheelRotationToSteer(rotationDeg).toFixed(3))}
      onPointerDown={(event) => {
        if (!interactionEnabled) return;
        event.preventDefault();
        if (pointerRef.current !== null) return;
        const pointerAngleDeg = pointerAngleForEvent(event);
        pointerRef.current = {
          id: event.pointerId,
          lastPointerAngleDeg: pointerAngleDeg,
        };
        setDragging(true);
        event.currentTarget.setPointerCapture?.(event.pointerId);
        onSteerChangeRef.current(mobileWheelRotationToSteer(rotationRef.current), true);
      }}
      onPointerMove={(event) => {
        if (!interactionEnabled) return;
        const pointer = pointerRef.current;
        if (!pointer || pointer.id !== event.pointerId) return;
        event.preventDefault();
        const pointerAngleDeg = pointerAngleForEvent(event);
        const nextRotationDeg = advanceMobileWheelRotationDeg(
          rotationRef.current,
          pointer.lastPointerAngleDeg,
          pointerAngleDeg
        );
        pointer.lastPointerAngleDeg = pointerAngleDeg;
        reportRotation(nextRotationDeg, true);
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
        if (event.key === 'ArrowLeft') next -= 13.5;
        else if (event.key === 'ArrowRight') next += 13.5;
        else if (event.key === 'Home' || event.key === '0') next = 0;
        else return;
        event.preventDefault();
        const clamped = Math.max(-135, Math.min(135, next));
        reportRotation(clamped, true);
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
