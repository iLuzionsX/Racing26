import React from 'react';
import {
  mobileWheelGrabOffsetDeg,
  mobileWheelPointerAngleDeg,
  mobileWheelRotationToSteer,
  resolveMobileWheelRotationDeg,
} from './mobileControls';

export const MobileSteeringWheel: React.FC<{
  onSteerChange: (value: number, active: boolean) => void;
}> = ({ onSteerChange }) => {
  const [rotationDeg, setRotationDeg] = React.useState(0);
  const [dragging, setDragging] = React.useState(false);
  const pointerRef = React.useRef<{ id: number; grabOffsetDeg: number } | null>(null);
  const rotationRef = React.useRef(0);
  const rootRef = React.useRef<HTMLDivElement | null>(null);

  const reportRotation = React.useCallback((nextRotationDeg: number, active: boolean) => {
    rotationRef.current = nextRotationDeg;
    setRotationDeg(nextRotationDeg);
    onSteerChange(mobileWheelRotationToSteer(nextRotationDeg), active);
  }, [onSteerChange]);

  const release = React.useCallback(() => {
    pointerRef.current = null;
    setDragging(false);
    reportRotation(0, false);
  }, [reportRotation]);

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
      onSteerChange(0, false);
    };
  }, [onSteerChange, release]);

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
      ref={rootRef}
      id="mobile-steering-wheel"
      className={`relative touch-none select-none rounded-full ${dragging ? 'is-dragging' : ''}`}
      role="slider"
      tabIndex={0}
      aria-label="Steering wheel"
      aria-valuemin={-1}
      aria-valuemax={1}
      aria-valuenow={Number(mobileWheelRotationToSteer(rotationDeg).toFixed(3))}
      onPointerDown={(event) => {
        event.preventDefault();
        if (pointerRef.current !== null) return;
        const pointerAngleDeg = pointerAngleForEvent(event);
        pointerRef.current = {
          id: event.pointerId,
          grabOffsetDeg: mobileWheelGrabOffsetDeg(pointerAngleDeg, rotationRef.current),
        };
        setDragging(true);
        event.currentTarget.setPointerCapture?.(event.pointerId);
        onSteerChange(mobileWheelRotationToSteer(rotationRef.current), true);
      }}
      onPointerMove={(event) => {
        const pointer = pointerRef.current;
        if (!pointer || pointer.id !== event.pointerId) return;
        event.preventDefault();
        const nextRotationDeg = resolveMobileWheelRotationDeg(
          pointerAngleForEvent(event),
          pointer.grabOffsetDeg
        );
        reportRotation(nextRotationDeg, true);
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
