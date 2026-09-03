import React from 'react';
import { VehicleState, VehicleConfig } from '../types';
import {
  Activity,
  ChevronDown,
  ChevronUp,
  Cpu,
  Eye,
  EyeOff,
  Flame,
  ShieldAlert,
  Sparkles,
  Timer,
  Wind,
} from 'lucide-react';

interface DashboardUIProps {
  state: VehicleState;
  config: VehicleConfig;
  useMph: boolean;
  onToggleUnit: () => void;
  onToggleAuto: () => void;
  showTelemetry: boolean;
  onToggleAbs?: () => void;
  onToggleTcs?: () => void;
  onToggleForceVectors?: () => void;
  onTriggerClutchKick?: () => void;
  onToggleDrs?: () => void;
}

type HudMode = 'compact' | 'expanded' | 'hidden';

export const DashboardUI: React.FC<DashboardUIProps> = ({
  state,
  config,
  useMph,
  onToggleUnit,
  onToggleAuto,
  showTelemetry,
  onToggleForceVectors,
  onTriggerClutchKick,
  onToggleDrs,
}) => {
  const [hudMode, setHudMode] = React.useState<HudMode>('compact');

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code !== 'KeyH' || event.repeat) return;
      setHudMode((mode) => (mode === 'hidden' ? 'compact' : 'hidden'));
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const displaySpeed = useMph ? Math.round(state.speedMph) : Math.round(state.speedKmh);
  const unitLabel = useMph ? 'MPH' : 'KM/H';
  const gearText = state.gear === -1 ? 'R' : state.gear === 0 ? 'N' : `${state.gear}`;
  const rpmPercent = Math.min(100, Math.max(0, (state.rpm / config.maxRpm) * 100));
  const boostPercent = Math.min(100, Math.max(0, (state.turboBoostPsi / config.turboBoostMaxPsi) * 100));
  const isRedlining = state.rpm > config.revLimiterRpm * 0.96;
  const rollDeg = (state.roll * 180) / Math.PI;
  const pitchDeg = (state.pitch * 180) / Math.PI;

  const primarySurface = state.wheels[0]?.surfaceType || 'asphalt';
  const primaryFriction = state.wheels[0]?.surfaceFriction || 1;

  const surfaceLabel = (() => {
    switch (primarySurface) {
      case 'wet':
        return 'WET';
      case 'racing_line':
        return 'RUBBERED';
      case 'kerb':
        return 'KERB';
      case 'gravel':
        return 'GRAVEL';
      case 'marbles':
        return 'MARBLES';
      default:
        return 'ASPHALT';
    }
  })();

  const wheelTempClass = (temp: number) => {
    if (temp < 60) return 'text-sky-300';
    if (temp <= 95) return 'text-emerald-300';
    if (temp <= 115) return 'text-amber-300';
    return 'text-rose-300';
  };

  if (hudMode === 'hidden') {
    return (
      <div id="driving-hud" className="pointer-events-none absolute inset-0 z-10 select-none font-sans">
        <button
          id="hud-show-btn"
          onClick={() => setHudMode('compact')}
          className="pointer-events-auto absolute left-1/2 top-14 -translate-x-1/2 flex items-center gap-1.5 rounded-full sm:left-auto sm:right-3 sm:top-auto sm:bottom-3 sm:translate-x-0 border border-slate-700/70 bg-slate-950/75 px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-300 shadow-lg backdrop-blur-md hover:text-white"
          title="Show HUD (H)"
        >
          <Eye size={13} />
          HUD
        </button>
      </div>
    );
  }

  const expanded = hudMode === 'expanded';

  return (
    <div id="driving-hud" className="pointer-events-none absolute inset-0 z-10 select-none overflow-hidden font-sans">
      {/* Minimal status rail: only persistent context and active warnings. */}
      <div className="absolute left-3 top-3 hidden max-w-[calc(100vw-1.5rem)] flex-wrap sm:flex items-center gap-1.5 text-[10px] font-mono">
        <div className="rounded-full border border-slate-700/60 bg-slate-950/72 px-2.5 py-1 text-slate-300 shadow-lg backdrop-blur-md">
          <span className="font-bold text-sky-300">{config.drivetrain}</span>
          <span className="mx-1.5 text-slate-600">•</span>
          <span>{surfaceLabel} {primaryFriction.toFixed(2)}μ</span>
        </div>

        {state.isDrifting && (
          <div className="flex items-center gap-1 rounded-full bg-amber-400/90 px-2.5 py-1 font-bold text-slate-950 shadow-lg">
            <Flame size={11} />
            {Math.abs(Math.round(state.driftAngleDeg))}°
          </div>
        )}

        {state.diffuserStalled && (
          <div className="flex items-center gap-1 rounded-full bg-rose-600/90 px-2.5 py-1 font-bold text-white shadow-lg">
            <ShieldAlert size={11} />
            DIFFUSER STALL
          </div>
        )}

        {state.isRevLimiting && (
          <div className="flex items-center gap-1 rounded-full bg-rose-500/90 px-2.5 py-1 font-bold text-slate-950 shadow-lg">
            <Cpu size={11} />
            REV CUT
          </div>
        )}
      </div>

      {/* Expanded telemetry is intentionally off the main sightline and scrolls instead of growing. */}
      {expanded && showTelemetry && (
        <div className="pointer-events-auto absolute right-3 top-14 w-[min(19rem,calc(100vw-1.5rem))] max-h-[48vh] sm:max-h-[62vh] overflow-y-auto rounded-2xl border border-slate-700/70 bg-slate-950/88 p-3 text-[10px] text-slate-300 shadow-2xl backdrop-blur-xl">
          <div className="mb-2 flex items-center justify-between border-b border-slate-800 pb-2">
            <span className="flex items-center gap-1.5 font-bold uppercase tracking-wider text-slate-100">
              <Activity size={13} className="text-sky-300" />
              Dynamics
            </span>
            <span className="font-mono text-emerald-300">{config.mass} kg</span>
          </div>

          <div className="grid grid-cols-2 gap-1.5">
            <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-2">
              <div className="text-slate-500">Lateral G</div>
              <div className="mt-0.5 font-mono text-sm font-bold text-sky-300">{state.lateralG.toFixed(2)}</div>
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-2">
              <div className="text-slate-500">Long. G</div>
              <div className="mt-0.5 font-mono text-sm font-bold text-amber-300">{state.longitudinalG.toFixed(2)}</div>
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-2">
              <div className="text-slate-500">Body roll</div>
              <div className="mt-0.5 font-mono font-bold text-slate-100">{rollDeg >= 0 ? '+' : ''}{rollDeg.toFixed(1)}°</div>
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-2">
              <div className="text-slate-500">Pitch</div>
              <div className="mt-0.5 font-mono font-bold text-slate-100">{pitchDeg >= 0 ? '+' : ''}{pitchDeg.toFixed(1)}°</div>
            </div>
          </div>

          <div className="mt-2 rounded-xl border border-slate-800 bg-slate-900/45 p-2">
            <div className="flex items-center justify-between">
              <span className="text-slate-500">Self-aligning torque</span>
              <span className="font-mono font-bold text-sky-300">{state.steeringRackTorque.toFixed(1)} Nm</span>
            </div>
            <div className="mt-1 flex items-center justify-between">
              <span className="text-slate-500">Aero load</span>
              <span className="font-mono font-bold text-emerald-300">{Math.round(state.aeroDownforceTotalN)} N</span>
            </div>
            {config.groundEffectUnderbody && (
              <div className="mt-1 flex items-center justify-between">
                <span className="text-slate-500">Ride height</span>
                <span className={`font-mono font-bold ${state.diffuserStalled ? 'text-rose-300' : 'text-emerald-300'}`}>
                  {(state.diffuserRideHeightM * 100).toFixed(1)} cm
                </span>
              </div>
            )}
          </div>

          <button
            id="toggle-3d-vectors-btn"
            onClick={onToggleForceVectors}
            className={`mt-2 flex w-full items-center justify-between rounded-xl border px-2.5 py-2 text-[10px] font-semibold transition-colors ${
              state.showForceVectors3D
                ? 'border-sky-500/50 bg-sky-500/10 text-sky-200'
                : 'border-slate-800 bg-slate-900/50 text-slate-400 hover:text-slate-200'
            }`}
          >
            <span>3D force vectors</span>
            <span className="font-mono">{state.showForceVectors3D ? 'ON' : 'OFF'}</span>
          </button>

          <div className="mt-2 border-t border-slate-800 pt-2">
            <div className="mb-1.5 flex items-center justify-between uppercase tracking-wider text-slate-500">
              <span>4-corner load / temp</span>
              <span>wear</span>
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              {state.wheels.map((wheel) => {
                const loadKg = Math.round(wheel.suspensionForce / 9.81);
                return (
                  <div
                    key={wheel.id}
                    className={`rounded-xl border p-2 ${
                      wheel.bumpStopEngaged
                        ? 'border-rose-500/60 bg-rose-950/30'
                        : wheel.isSkidding
                        ? 'border-amber-500/60 bg-amber-950/25'
                        : 'border-slate-800 bg-slate-900/45'
                    }`}
                  >
                    <div className="flex items-center justify-between font-bold">
                      <span>{wheel.id}</span>
                      <span className="font-mono text-emerald-300">{loadKg}kg</span>
                    </div>
                    <div className="mt-1 flex items-center justify-between font-mono text-[9px]">
                      <span className={wheelTempClass(wheel.temperature)}>{Math.round(wheel.temperature)}°C</span>
                      <span className="text-slate-500">{wheel.tireWearPercent.toFixed(0)}%</span>
                    </div>
                    <div className="mt-1 flex items-center justify-between font-mono text-[9px] text-slate-500">
                      <span>{(wheel.slipAngle * 180 / Math.PI).toFixed(1)}° slip</span>
                      <span>{wheel.damperVelocity.toFixed(2)}m/s</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="mt-2 border-t border-slate-800 pt-2">
            <div className="mb-1.5 flex items-center gap-1.5 font-bold uppercase tracking-wider text-slate-400">
              <Timer size={12} className="text-sky-300" />
              Sprint
            </div>
            <div className="grid grid-cols-3 gap-1 text-center font-mono">
              <div className="rounded-lg bg-slate-900/60 p-1.5">
                <div className="text-[8px] text-slate-500">0-60</div>
                <div className="font-bold text-white">{state.performanceTimer.zeroToSixtyTime ? `${state.performanceTimer.zeroToSixtyTime}s` : '--'}</div>
              </div>
              <div className="rounded-lg bg-slate-900/60 p-1.5">
                <div className="text-[8px] text-slate-500">1/4 MI</div>
                <div className="font-bold text-amber-300">{state.performanceTimer.quarterMileTime ? `${state.performanceTimer.quarterMileTime}s` : '--'}</div>
              </div>
              <div className="rounded-lg bg-slate-900/60 p-1.5">
                <div className="text-[8px] text-slate-500">PEAK G</div>
                <div className="font-bold text-sky-300">{state.performanceTimer.peakLateralG}</div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Small quick-action dock. */}
      <div className="pointer-events-auto absolute right-3 top-3 flex items-center gap-1">
        {config.drsEnabled && (
          <button
            id="drs-toggle-btn"
            onClick={onToggleDrs}
            className={`flex h-8 items-center gap-1 rounded-full border px-2 text-[9px] font-bold ${
              state.drsActive
                ? 'border-emerald-400/70 bg-emerald-500/80 text-slate-950'
                : 'border-slate-700/70 bg-slate-950/75 text-slate-400 hover:text-white'
            }`}
            title="Toggle DRS"
          >
            <Wind size={12} />
            DRS
          </button>
        )}
        <button
          id="clutch-kick-btn"
          onClick={onTriggerClutchKick}
          className={`flex h-8 w-8 items-center justify-center rounded-full border ${
            state.clutchKickImpulse > 0.1
              ? 'border-amber-300 bg-amber-400 text-slate-950'
              : 'border-slate-700/70 bg-slate-950/75 text-amber-300 hover:bg-slate-900'
          }`}
          title="Clutch kick"
        >
          <Sparkles size={13} />
        </button>
      </div>

      {/* Compact primary cluster. */}
      <div className="pointer-events-auto absolute bottom-28 left-1/2 -translate-x-1/2 sm:bottom-3">
        <div className={`flex items-center rounded-2xl border border-slate-700/70 bg-slate-950/86 shadow-2xl backdrop-blur-xl transition-all ${expanded ? 'gap-3 px-3.5 py-2.5' : 'gap-2.5 px-3 py-2'}`}>
          <div className="flex flex-col items-center gap-1">
            <div className="flex h-2 items-center gap-0.5" aria-label="Shift lights">
              {[1, 2, 3, 4, 3, 2, 1].map((stage, index) => (
                <span
                  key={`${stage}-${index}`}
                  className={`h-1.5 w-2 rounded-sm ${
                    state.shiftLightStage >= stage
                      ? stage >= 4
                        ? 'bg-cyan-300 shadow-sm shadow-cyan-300'
                        : stage >= 3
                        ? 'bg-rose-400'
                        : stage >= 2
                        ? 'bg-amber-300'
                        : 'bg-emerald-400'
                      : 'bg-slate-800'
                  }`}
                />
              ))}
            </div>
            <button
              id="toggle-auto-btn"
              onClick={onToggleAuto}
              className="min-w-10 rounded-lg border border-slate-800 bg-slate-900/80 px-2 py-1 font-mono text-2xl font-black leading-none text-white hover:border-slate-600"
              title="Toggle automatic/manual"
            >
              {gearText}
              <span className="mt-0.5 block text-[7px] font-bold tracking-widest text-slate-500">{state.isAutomatic ? 'AUTO' : 'MAN'}</span>
            </button>
          </div>

          <div className="flex min-w-[5rem] flex-col sm:min-w-[8rem]">
            <div className="flex items-baseline gap-1.5">
              <span className="font-mono text-4xl font-black leading-none tracking-tighter text-white">{displaySpeed}</span>
              <button
                id="toggle-unit-btn"
                onClick={onToggleUnit}
                className="text-[9px] font-bold text-slate-500 hover:text-sky-300"
                title="Toggle speed unit"
              >
                {unitLabel}
              </button>
            </div>
            <div className="mt-1 text-[8px] font-mono text-slate-500">{Math.round(state.rpm)} RPM</div>
          </div>

          <div className={`${expanded ? 'w-44' : 'w-32'} hidden space-y-1.5 sm:block`}>
            <div>
              <div className="mb-0.5 flex items-center justify-between text-[8px] font-mono text-slate-500">
                <span>RPM</span>
                <span className={isRedlining ? 'font-bold text-rose-300' : ''}>{Math.round(rpmPercent)}%</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-slate-800">
                <div
                  className={`h-full rounded-full transition-[width] duration-75 ${isRedlining ? 'bg-rose-400' : 'bg-sky-400'}`}
                  style={{ width: `${rpmPercent}%` }}
                />
              </div>
            </div>
            <div>
              <div className="mb-0.5 flex items-center justify-between text-[8px] font-mono text-slate-500">
                <span>BOOST</span>
                <span className="text-slate-300">{state.turboBoostPsi.toFixed(1)} psi</span>
              </div>
              <div className="h-1 overflow-hidden rounded-full bg-slate-800">
                <div className="h-full rounded-full bg-cyan-300 transition-[width] duration-75" style={{ width: `${boostPercent}%` }} />
              </div>
            </div>
          </div>

          {expanded && (
            <div className="hidden items-center gap-1.5 border-l border-slate-800 pl-3 sm:flex">
              <div className="w-10 text-center text-[8px] font-bold text-slate-500">
                GAS
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-800">
                  <div className="h-full bg-emerald-400" style={{ width: `${Math.round(state.throttle * 100)}%` }} />
                </div>
              </div>
              <div className="w-10 text-center text-[8px] font-bold text-slate-500">
                BRK
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-800">
                  <div className={`h-full ${state.absActive ? 'bg-amber-300' : 'bg-rose-400'}`} style={{ width: `${Math.round(state.brake * 100)}%` }} />
                </div>
              </div>
            </div>
          )}

          <div className="flex items-center gap-1 border-l border-slate-800 pl-2">
            <button
              id="hud-density-btn"
              onClick={() => setHudMode(expanded ? 'compact' : 'expanded')}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-800 hover:text-white"
              title={expanded ? 'Collapse HUD' : 'Expand HUD'}
            >
              {expanded ? <ChevronDown size={15} /> : <ChevronUp size={15} />}
            </button>
            <button
              id="hud-hide-btn"
              onClick={() => setHudMode('hidden')}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-800 hover:text-white"
              title="Hide HUD (H)"
            >
              <EyeOff size={14} />
            </button>
          </div>
        </div>

        <div className="mt-1 text-center text-[8px] font-mono uppercase tracking-[0.18em] text-slate-500/80">
          H hides HUD
        </div>
      </div>
    </div>
  );
};
