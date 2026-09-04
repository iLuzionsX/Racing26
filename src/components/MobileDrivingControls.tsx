import React from 'react';
import { Camera, RotateCcw } from 'lucide-react';
import { MobileSteeringWheel } from './MobileSteeringWheel';
import {
  resolveMobileClusterDrag,
  type MobileClusterLayout,
  type MobileControlLayoutPair,
  type MobileSafeAreaPx,
} from './mobileControlLayout';

export type MobileTouchAction =
  | 'throttle'
  | 'brake'
  | 'steerLeft'
  | 'steerRight'
  | 'handbrake';

interface MobileDrivingControlsProps {
  layout: MobileControlLayoutPair;
  editMode: boolean;
  onLayoutChange: (next: MobileControlLayoutPair) => void;
  onTouchInput: (action: MobileTouchAction, active: boolean) => void;
  onTouchSteer: (value: number, active: boolean) => void;
  onNextCamera: () => void;
  onReset: () => void;
}

const readSafeAreaPx = (): MobileSafeAreaPx => {
  if (typeof window === 'undefined') {
    return { left: 0, right: 0, top: 0, bottom: 0 };
  }

  const styles = window.getComputedStyle(document.documentElement);
  const read = (name: string) => {
    const parsed = Number.parseFloat(styles.getPropertyValue(name));
    return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
  };

  return {
    left: read('--driving-safe-left'),
    right: read('--driving-safe-right'),
    top: read('--driving-safe-top'),
    bottom: read('--driving-safe-bottom'),
  };
};

const DraggableCluster: React.FC<{
  id: 'wheel' | 'pedals';
  label: string;
  layout: MobileClusterLayout;
  editMode: boolean;
  onPositionChange: (position: Pick<MobileClusterLayout, 'x' | 'y'>) => void;
  children: React.ReactNode;
}> = ({ id, label, layout, editMode, onPositionChange, children }) => {
  const dragRef = React.useRef<{
    id: number;
    startClientX: number;
    startClientY: number;
    startCenter: Pick<MobileClusterLayout, 'x' | 'y'>;
    width: number;
    height: number;
    safeArea: MobileSafeAreaPx;
  } | null>(null);

  const clearDrag = (pointerId?: number) => {
    if (
      pointerId !== undefined &&
      dragRef.current &&
      dragRef.current.id !== pointerId
    ) {
      return;
    }
    dragRef.current = null;
  };

  return (
    <div
      id={id === 'wheel' ? 'mobile-steering-pad' : 'mobile-pedal-pad'}
      className={
        'mobile-control-cluster pointer-events-auto absolute touch-none ' +
        (id === 'wheel'
          ? 'flex flex-col items-center gap-1.5 '
          : 'flex items-end gap-2 ') +
        (editMode ? 'is-layout-editing' : '')
      }
      style={{
        left: (layout.x * 100).toFixed(3) + '%',
        top: (layout.y * 100).toFixed(3) + '%',
        transform:
          'translate(-50%, -50%) scale(' + layout.scale.toFixed(3) + ')',
        transformOrigin: 'center center',
      }}
      role={editMode ? 'group' : undefined}
      aria-label={editMode ? 'Move ' + label : undefined}
      onPointerDown={(event) => {
        if (!editMode || dragRef.current) return;
        event.preventDefault();

        const rect = event.currentTarget.getBoundingClientRect();
        dragRef.current = {
          id: event.pointerId,
          startClientX: event.clientX,
          startClientY: event.clientY,
          startCenter: { x: layout.x, y: layout.y },
          width: rect.width,
          height: rect.height,
          safeArea: readSafeAreaPx(),
        };

        event.currentTarget.setPointerCapture?.(event.pointerId);
      }}
      onPointerMove={(event) => {
        const drag = dragRef.current;
        if (!editMode || !drag || drag.id !== event.pointerId) return;

        event.preventDefault();
        const viewport = {
          width: Math.max(1, window.innerWidth),
          height: Math.max(1, window.innerHeight),
        };
        const next = resolveMobileClusterDrag(
          drag.startCenter,
          event.clientX - drag.startClientX,
          event.clientY - drag.startClientY,
          viewport,
          { width: drag.width, height: drag.height },
          drag.safeArea
        );

        onPositionChange(next);
      }}
      onPointerUp={(event) => clearDrag(event.pointerId)}
      onPointerCancel={(event) => clearDrag(event.pointerId)}
      onLostPointerCapture={(event) => clearDrag(event.pointerId)}
      onContextMenu={(event) => {
        if (editMode) event.preventDefault();
      }}
    >
      {children}
    </div>
  );
};

export const MobileDrivingControls: React.FC<MobileDrivingControlsProps> = ({
  layout,
  editMode,
  onLayoutChange,
  onTouchInput,
  onTouchSteer,
  onNextCamera,
  onReset,
}) => {
  const updatePosition = (
    id: 'wheel' | 'pedals',
    position: Pick<MobileClusterLayout, 'x' | 'y'>
  ) => {
    onLayoutChange({
      ...layout,
      [id]: { ...layout[id], ...position },
    });
  };

  return (
    <>
      <div
        id="mobile-landscape-hint"
        className="pointer-events-none absolute left-1/2 top-16 z-30 hidden -translate-x-1/2 rounded-full border border-slate-700/80 bg-slate-950/82 px-3 py-1.5 text-[9px] font-bold uppercase tracking-wider text-slate-300 shadow-xl backdrop-blur-lg"
      >
        Rotate for the best driving view
      </div>

      {editMode && (
        <div
          id="mobile-layout-edit-hint"
          className="pointer-events-none absolute bottom-20 left-1/2 z-40 -translate-x-1/2 rounded-full border border-sky-300/50 bg-slate-950/86 px-3 py-1.5 text-[9px] font-black uppercase tracking-[0.16em] text-sky-200 shadow-xl backdrop-blur-lg"
        >
          Drag wheel + pedals · Save in Settings
        </div>
      )}

      <div
        id="mobile-driving-controls"
        className="pointer-events-none absolute inset-0 z-40"
        data-layout-editing={editMode ? 'true' : 'false'}
      >
        <DraggableCluster
          id="wheel"
          label="steering wheel"
          layout={layout.wheel}
          editMode={editMode}
          onPositionChange={(position) => updatePosition('wheel', position)}
        >
          <span className="w-full text-center text-[8px] font-black uppercase tracking-[0.2em] text-slate-300/90">
            Steer
          </span>
          <MobileSteeringWheel
            onSteerChange={onTouchSteer}
            interactionEnabled={!editMode}
          />
        </DraggableCluster>

        <div
          id="mobile-quick-actions"
          className={
            'pointer-events-auto absolute bottom-0 left-1/2 flex -translate-x-1/2 gap-1.5 ' +
            (editMode ? 'pointer-events-none opacity-30' : '')
          }
          style={{
            marginBottom: 'max(0.75rem, env(safe-area-inset-bottom))',
          }}
        >
          <button
            type="button"
            onClick={onNextCamera}
            className="flex h-9 items-center gap-1 rounded-full border border-slate-600/90 bg-slate-950/72 px-3 text-[9px] font-bold text-slate-100 shadow-lg backdrop-blur-lg active:bg-slate-800"
            aria-label="Change camera"
          >
            <Camera size={13} /> CAM
          </button>
          <button
            type="button"
            onClick={onReset}
            className="flex h-9 items-center gap-1 rounded-full border border-slate-600/90 bg-slate-950/72 px-3 text-[9px] font-bold text-slate-100 shadow-lg backdrop-blur-lg active:bg-amber-300 active:text-slate-950"
            aria-label="Reset car"
          >
            <RotateCcw size={13} /> RESET
          </button>
        </div>

        <DraggableCluster
          id="pedals"
          label="pedal cluster"
          layout={layout.pedals}
          editMode={editMode}
          onPositionChange={(position) => updatePosition('pedals', position)}
        >
          <MobileTouchButton
            label="HB"
            ariaLabel="Handbrake"
            disabled={editMode}
            className="mobile-handbrake h-14 w-14 text-[11px] active:border-amber-300 active:bg-amber-300 active:text-slate-950"
            onActiveChange={(active) => onTouchInput('handbrake', active)}
          />
          <MobileTouchButton
            label="BRAKE"
            ariaLabel="Brake"
            disabled={editMode}
            className="mobile-brake h-[6.25rem] w-[4.75rem] text-[10px] active:border-rose-300 active:bg-rose-400 active:text-slate-950"
            onActiveChange={(active) => onTouchInput('brake', active)}
          />
          <MobileTouchButton
            label="GAS"
            ariaLabel="Throttle"
            disabled={editMode}
            className="mobile-throttle h-[7.25rem] w-[5rem] text-xs active:border-emerald-300 active:bg-emerald-400 active:text-slate-950"
            onActiveChange={(active) => onTouchInput('throttle', active)}
          />
        </DraggableCluster>
      </div>
    </>
  );
};

const MobileTouchButton: React.FC<{
  label: string;
  ariaLabel: string;
  className: string;
  disabled?: boolean;
  onActiveChange: (active: boolean) => void;
}> = ({ label, ariaLabel, className, disabled = false, onActiveChange }) => {
  const pointerIdRef = React.useRef<number | null>(null);

  React.useEffect(() => {
    if (!disabled) return;
    pointerIdRef.current = null;
    onActiveChange(false);
  }, [disabled, onActiveChange]);

  const deactivate = (event?: React.PointerEvent<HTMLButtonElement>) => {
    if (
      event &&
      pointerIdRef.current !== null &&
      event.pointerId !== pointerIdRef.current
    ) {
      return;
    }
    pointerIdRef.current = null;
    onActiveChange(false);
  };

  return (
    <button
      type="button"
      aria-label={ariaLabel}
      aria-disabled={disabled}
      tabIndex={disabled ? -1 : 0}
      onPointerDown={(event) => {
        if (disabled) return;
        event.preventDefault();
        if (pointerIdRef.current !== null) return;
        pointerIdRef.current = event.pointerId;
        event.currentTarget.setPointerCapture?.(event.pointerId);
        onActiveChange(true);
      }}
      onPointerUp={deactivate}
      onPointerCancel={deactivate}
      onLostPointerCapture={deactivate}
      onContextMenu={(event) => event.preventDefault()}
      className={
        className +
        ' flex touch-none select-none items-center justify-center rounded-[1.5rem] border border-white/25 bg-slate-950/54 font-black text-white shadow-2xl backdrop-blur-sm transition-[transform,background-color,border-color] duration-75 active:scale-[0.96]'
      }
    >
      {label}
    </button>
  );
};
