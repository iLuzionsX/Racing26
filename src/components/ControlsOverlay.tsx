import React from 'react';
import { CameraMode } from '../types';
import { VEHICLE_PRESETS } from '../physics/vehiclePresets';
import type { SteeringInputMode } from '../physics/MouseSteeringInput';
import { MobileDrivingControls } from './MobileDrivingControls';
import {
  MOBILE_PEDALS_SCALE_MAX,
  MOBILE_PEDALS_SCALE_MIN,
  MOBILE_WHEEL_SCALE_MAX,
  MOBILE_WHEEL_SCALE_MIN,
  cloneMobileControlLayoutStore,
  getDefaultMobileControlPair,
  loadMobileControlLayoutStore,
  mobileControlOrientationForViewport,
  sanitizeMobileControlLayoutStore,
  saveMobileControlLayoutStore,
  updateMobileControlCluster,
  type MobileControlClusterId,
  type MobileControlLayoutPair,
  type MobileControlOrientation,
} from './mobileControlLayout';
import {
  MOBILE_STEERING_WHEEL_DEFAULT_ROTATION_DEG,
  MOBILE_STEERING_WHEEL_MAX_ROTATION_DEG,
  MOBILE_STEERING_WHEEL_MIN_ROTATION_DEG,
  loadMobileSteeringRotationDeg,
  saveMobileSteeringRotationDeg,
  sanitizeMobileSteeringRotationDeg,
} from './mobileControls';
import {
  Activity,
  Camera,
  Car,
  ChevronDown,
  ChevronUp,
  Cpu,
  HelpCircle,
  RotateCcw,
  Settings2,
  Sliders,
  Sparkles,
  Volume2,
  VolumeX,
} from 'lucide-react';

interface ControlsOverlayProps {
  cameraMode: CameraMode;
  onNextCamera: () => void;
  onReset: () => void;
  onClearSkidMarks: () => void;
  isMuted: boolean;
  onToggleMute: () => void;
  onOpenTuning: () => void;
  onOpenTestRunner?: () => void;
  showTelemetry: boolean;
  onToggleTelemetry: () => void;
  activePresetKey: string;
  onSelectPreset: (key: string) => void;
  activeKeys: { [key: string]: boolean };
  onTouchInput: (action: 'throttle' | 'brake' | 'steerLeft' | 'steerRight' | 'handbrake', active: boolean) => void;
  onTouchSteer: (value: number, active: boolean) => void;
  frontSaturationLevel?: number;
  isAutomatic: boolean;
  onSetAutomatic: (automatic: boolean) => void;
  steeringInputMode: SteeringInputMode;
  onSetSteeringInputMode: (mode: SteeringInputMode) => void;
  showM5XDriveSetting: boolean;
  isM5RwdMode: boolean;
  onSetM5RwdMode?: (enabled: boolean) => void;
}

const detectMobileDrivingMode = () => {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;

  const override = new URLSearchParams(window.location.search).get('mobileControls');
  if (override === '1' || override === 'true') return true;
  if (override === '0' || override === 'false') return false;

  const nav = navigator as Navigator & { userAgentData?: { mobile?: boolean } };
  const userAgent = navigator.userAgent || '';
  const platform = navigator.platform || '';
  const uaMobile = nav.userAgentData?.mobile === true || /Android|iPhone|iPod|IEMobile|Opera Mini/i.test(userAgent);
  const iPadLike = /iPad/i.test(userAgent) || (platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const coarsePointer = window.matchMedia('(pointer: coarse)').matches;
  const touchCapable = navigator.maxTouchPoints > 0 || 'ontouchstart' in window;
  const touchSizedViewport = window.innerWidth <= 1180;

  return uaMobile || iPadLike || (coarsePointer && touchCapable && touchSizedViewport);
};

export const ControlsOverlay: React.FC<ControlsOverlayProps> = ({
  cameraMode,
  onNextCamera,
  onReset,
  onClearSkidMarks,
  isMuted,
  onToggleMute,
  onOpenTuning,
  onOpenTestRunner,
  showTelemetry,
  onToggleTelemetry,
  activePresetKey,
  activeKeys,
  onTouchInput,
  onTouchSteer,
  frontSaturationLevel = 0,
  isAutomatic,
  onSetAutomatic,
  steeringInputMode,
  onSetSteeringInputMode,
  showM5XDriveSetting,
  isM5RwdMode,
  onSetM5RwdMode,
}) => {
  const [toolbarExpanded, setToolbarExpanded] = React.useState(false);
  const [showHelp, setShowHelp] = React.useState(false);
  const [mobileMode, setMobileMode] = React.useState(false);
  const [showDrivingSettings, setShowDrivingSettings] = React.useState(false);
  const [mobileOrientation, setMobileOrientation] = React.useState<MobileControlOrientation>(() =>
    typeof window === 'undefined'
      ? 'portrait'
      : mobileControlOrientationForViewport(window.innerWidth, window.innerHeight)
  );
  const [mobileLayout, setMobileLayout] = React.useState(() => loadMobileControlLayoutStore());
  const [mobileLayoutDraft, setMobileLayoutDraft] = React.useState(() =>
    cloneMobileControlLayoutStore(loadMobileControlLayoutStore())
  );
  const [mobileLayoutEditing, setMobileLayoutEditing] = React.useState(false);
  const [mobileSteeringRotationDeg, setMobileSteeringRotationDeg] = React.useState(() =>
    loadMobileSteeringRotationDeg()
  );
  const activePreset = VEHICLE_PRESETS[activePresetKey] || VEHICLE_PRESETS.sportGT;

  const isW = activeKeys['KeyW'] || activeKeys['ArrowUp'];
  const isS = activeKeys['KeyS'] || activeKeys['ArrowDown'];
  const isA = activeKeys['KeyA'] || activeKeys['ArrowLeft'];
  const isD = activeKeys['KeyD'] || activeKeys['ArrowRight'];
  const isSpace = activeKeys['Space'];

  React.useEffect(() => {
    const pointerQuery = window.matchMedia('(pointer: coarse)');
    const evaluate = () => {
      setMobileMode(detectMobileDrivingMode());
      setMobileOrientation(
        mobileControlOrientationForViewport(window.innerWidth, window.innerHeight)
      );
    };

    evaluate();
    pointerQuery.addEventListener?.('change', evaluate);
    window.addEventListener('resize', evaluate);
    window.addEventListener('orientationchange', evaluate);

    return () => {
      pointerQuery.removeEventListener?.('change', evaluate);
      window.removeEventListener('resize', evaluate);
      window.removeEventListener('orientationchange', evaluate);
    };
  }, []);

  React.useEffect(() => {
    if (mobileMode) {
      document.documentElement.dataset.drivingMobile = 'true';
      return () => {
        delete document.documentElement.dataset.drivingMobile;
      };
    }

    delete document.documentElement.dataset.drivingMobile;
    return undefined;
  }, [mobileMode]);

  const toggleTransmissionMode = () => {
    onSetAutomatic(!isAutomatic);
  };

  const neutralizeMobileControls = () => {
    onTouchSteer(0, false);
    onTouchInput('throttle', false);
    onTouchInput('brake', false);
    onTouchInput('steerLeft', false);
    onTouchInput('steerRight', false);
    onTouchInput('handbrake', false);
  };

  const beginMobileLayoutEdit = () => {
    neutralizeMobileControls();
    setMobileLayoutDraft(cloneMobileControlLayoutStore(mobileLayout));
    setMobileLayoutEditing(true);
    setShowDrivingSettings(true);
  };

  const saveMobileLayoutEdit = () => {
    neutralizeMobileControls();
    const next = sanitizeMobileControlLayoutStore(mobileLayoutDraft);
    saveMobileControlLayoutStore(next);
    setMobileLayout(next);
    setMobileLayoutDraft(cloneMobileControlLayoutStore(next));
    setMobileLayoutEditing(false);
  };

  const cancelMobileLayoutEdit = () => {
    neutralizeMobileControls();
    setMobileLayoutDraft(cloneMobileControlLayoutStore(mobileLayout));
    setMobileLayoutEditing(false);
  };

  const updateMobileLayoutDraftPair = (pair: MobileControlLayoutPair) => {
    setMobileLayoutDraft((previous) => ({
      ...previous,
      [mobileOrientation]: pair,
    }));
  };

  const updateMobileClusterScale = (
    id: MobileControlClusterId,
    scale: number
  ) => {
    setMobileLayoutDraft((previous) => ({
      ...previous,
      [mobileOrientation]: updateMobileControlCluster(
        previous[mobileOrientation],
        id,
        { scale }
      ),
    }));
  };

  const resetCurrentMobileLayout = () => {
    neutralizeMobileControls();
    setMobileLayoutDraft((previous) => ({
      ...previous,
      [mobileOrientation]: getDefaultMobileControlPair(mobileOrientation),
    }));
  };

  const updateMobileSteeringRotation = (rotationDeg: number) => {
    neutralizeMobileControls();
    const next = sanitizeMobileSteeringRotationDeg(rotationDeg);
    setMobileSteeringRotationDeg(next);
    saveMobileSteeringRotationDeg(next);
  };

  const activeMobileLayout =
    (mobileLayoutEditing ? mobileLayoutDraft : mobileLayout)[mobileOrientation];

  return (
    <>
      <div
        id="driving-utility-bar"
        className="absolute left-1/2 top-3 z-50 -translate-x-1/2"
        style={mobileMode ? { top: 'max(0.75rem, env(safe-area-inset-top))' } : undefined}
      >
        <div className="flex items-center gap-1 rounded-2xl border border-slate-800/75 bg-slate-950/80 p-1 shadow-2xl backdrop-blur-xl">
          <button
            id="preset-selector-btn"
            onClick={onOpenTuning}
            className="flex h-8 max-w-32 items-center gap-1.5 rounded-xl px-2 text-[10px] font-bold text-slate-200 hover:bg-slate-800/80"
            title="Vehicle / tuning"
          >
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: activePreset.color }} />
            <span className="truncate">{activePreset.name}</span>
          </button>

          <button
            id="camera-mode-btn"
            onClick={onNextCamera}
            className="flex h-8 items-center gap-1 rounded-xl px-2 text-[10px] font-semibold text-slate-400 hover:bg-slate-800/80 hover:text-sky-300"
            title="Switch camera (C)"
          >
            <Camera size={14} />
            <span className={mobileMode ? 'capitalize' : 'hidden capitalize sm:inline'}>{cameraMode}</span>
          </button>

          <button
            id="driving-settings-btn"
            onClick={() => setShowDrivingSettings((open) => !open)}
            className={`flex h-8 items-center gap-1 rounded-xl px-2 text-[10px] font-bold ${showDrivingSettings ? 'bg-sky-500/15 text-sky-300' : 'text-slate-400 hover:bg-slate-800/80 hover:text-white'}`}
            title="Driving settings"
            aria-label="Driving settings"
          >
            <Settings2 size={14} />
            <span className="hidden sm:inline">{isAutomatic ? 'AUTO' : 'MANUAL'}</span>
          </button>

          <button
            id="toolbar-expand-btn"
            onClick={() => setToolbarExpanded((open) => !open)}
            className="flex h-8 w-8 items-center justify-center rounded-xl text-slate-500 hover:bg-slate-800/80 hover:text-white"
            title={toolbarExpanded ? 'Collapse controls' : 'More controls'}
          >
            {toolbarExpanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
          </button>
        </div>

        {showDrivingSettings && (
          <div
            id="driving-settings-panel"
            className="absolute right-0 mt-2 max-h-[calc(100vh-5rem)] w-72 max-w-[calc(100vw-1rem)] overflow-y-auto rounded-2xl border border-slate-700/80 bg-slate-950/94 p-3 text-slate-200 shadow-2xl backdrop-blur-xl"
          >
            <div className="mb-2 flex items-center gap-2 border-b border-slate-800 pb-2">
              <Settings2 size={14} className="text-sky-300" />
              <span className="text-[10px] font-black uppercase tracking-[0.16em]">Settings</span>
            </div>

            <div className="flex items-center justify-between gap-3 rounded-xl bg-slate-900/65 p-2.5">
              <div>
                <div className="text-[10px] font-bold text-white">Transmission</div>
                <div className="mt-0.5 text-[8px] text-slate-500">Automatic shifting</div>
              </div>
              <button
                id="transmission-mode-toggle"
                type="button"
                role="switch"
                aria-checked={isAutomatic}
                onClick={toggleTransmissionMode}
                className={`relative h-7 w-12 rounded-full border transition-colors ${isAutomatic ? 'border-emerald-400/50 bg-emerald-400/25' : 'border-slate-600 bg-slate-800'}`}
                aria-label="Toggle automatic transmission"
              >
                <span
                  className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${isAutomatic ? 'translate-x-6' : 'translate-x-0.5'}`}
                />
              </button>
            </div>

            <div className="mt-2 flex items-center justify-between px-1 text-[8px] font-bold uppercase tracking-wider text-slate-500">
              <span>Mode</span>
              <span className={isAutomatic ? 'text-emerald-300' : 'text-sky-300'}>{isAutomatic ? 'Automatic' : 'Manual'}</span>
            </div>
            <div className="mt-2 px-1 text-[8px] text-slate-500">Keyboard shortcut: M</div>

            {mobileMode && (
              <div className="mt-3 border-t border-slate-800 pt-3">
                <div className="flex items-start justify-between gap-3 px-1">
                  <div>
                    <div className="text-[10px] font-bold text-white">Mobile controls</div>
                    <div className="mt-0.5 text-[8px] leading-relaxed text-slate-500">
                      Wheel and pedals save separately for portrait and landscape.
                    </div>
                  </div>
                  <span className="rounded-full border border-slate-700 bg-slate-900 px-2 py-1 text-[7px] font-black uppercase tracking-wider text-slate-400">
                    {mobileOrientation}
                  </span>
                </div>

                <label className="mt-3 block rounded-xl bg-slate-900/65 p-2.5">
                  <div className="mb-1 flex items-center justify-between text-[8px] font-bold text-slate-300">
                    <span>Steering rotation</span>
                    <span className="text-sky-300">{Math.round(mobileSteeringRotationDeg)}°</span>
                  </div>
                  <input
                    id="mobile-steering-rotation"
                    type="range"
                    min={MOBILE_STEERING_WHEEL_MIN_ROTATION_DEG}
                    max={MOBILE_STEERING_WHEEL_MAX_ROTATION_DEG}
                    step={90}
                    value={mobileSteeringRotationDeg}
                    onChange={(event) => updateMobileSteeringRotation(Number(event.target.value))}
                    className="w-full accent-sky-400"
                    aria-label="Mobile steering wheel lock-to-lock rotation"
                  />
                  <div className="mt-1 flex items-center justify-between text-[7px] text-slate-500">
                    <span>360° quick</span>
                    <span>
                      {mobileSteeringRotationDeg === MOBILE_STEERING_WHEEL_DEFAULT_ROTATION_DEG
                        ? 'Road-car default'
                        : 'Full rack preserved'}
                    </span>
                    <span>1080° fine</span>
                  </div>
                  <div className="mt-1.5 text-[8px] leading-relaxed text-slate-500">
                    Higher rotation gives finer control before the front tires saturate. Full mechanical lock is still available.
                  </div>
                </label>

                {!mobileLayoutEditing ? (
                  <div className="mt-2">
                    <div className="grid grid-cols-2 gap-1.5 text-[8px]">
                      <div className="rounded-lg bg-slate-900/65 p-2 text-slate-400">
                        Wheel <span className="font-bold text-sky-300">{Math.round(activeMobileLayout.wheel.scale * 100)}%</span>
                      </div>
                      <div className="rounded-lg bg-slate-900/65 p-2 text-slate-400">
                        Pedals <span className="font-bold text-emerald-300">{Math.round(activeMobileLayout.pedals.scale * 100)}%</span>
                      </div>
                    </div>
                    <button
                      id="mobile-layout-edit-btn"
                      type="button"
                      onClick={beginMobileLayoutEdit}
                      className="mt-2 w-full rounded-xl border border-sky-400/40 bg-sky-400/10 px-3 py-2 text-[9px] font-black uppercase tracking-[0.12em] text-sky-200 active:bg-sky-400 active:text-slate-950"
                    >
                      Customize layout
                    </button>
                  </div>
                ) : (
                  <div className="mt-2 rounded-xl border border-sky-400/25 bg-sky-400/5 p-2.5">
                    <div className="text-[8px] leading-relaxed text-sky-100/80">
                      Drag the wheel and pedal cluster directly on the driving view. Size changes preview live until you save.
                    </div>

                    <label className="mt-3 block">
                      <div className="mb-1 flex items-center justify-between text-[8px] font-bold text-slate-300">
                        <span>Wheel size</span>
                        <span className="text-sky-300">{Math.round(activeMobileLayout.wheel.scale * 100)}%</span>
                      </div>
                      <input
                        id="mobile-wheel-size"
                        type="range"
                        min={MOBILE_WHEEL_SCALE_MIN}
                        max={MOBILE_WHEEL_SCALE_MAX}
                        step={0.05}
                        value={activeMobileLayout.wheel.scale}
                        onChange={(event) => updateMobileClusterScale('wheel', Number(event.target.value))}
                        className="w-full accent-sky-400"
                      />
                    </label>

                    <label className="mt-3 block">
                      <div className="mb-1 flex items-center justify-between text-[8px] font-bold text-slate-300">
                        <span>Pedal size</span>
                        <span className="text-emerald-300">{Math.round(activeMobileLayout.pedals.scale * 100)}%</span>
                      </div>
                      <input
                        id="mobile-pedals-size"
                        type="range"
                        min={MOBILE_PEDALS_SCALE_MIN}
                        max={MOBILE_PEDALS_SCALE_MAX}
                        step={0.05}
                        value={activeMobileLayout.pedals.scale}
                        onChange={(event) => updateMobileClusterScale('pedals', Number(event.target.value))}
                        className="w-full accent-emerald-400"
                      />
                    </label>

                    <div className="mt-3 grid grid-cols-2 gap-1.5">
                      <button
                        id="mobile-layout-save-btn"
                        type="button"
                        onClick={saveMobileLayoutEdit}
                        className="rounded-lg bg-sky-400 px-2 py-2 text-[8px] font-black uppercase tracking-wider text-slate-950 active:bg-sky-300"
                      >
                        Save
                      </button>
                      <button
                        id="mobile-layout-cancel-btn"
                        type="button"
                        onClick={cancelMobileLayoutEdit}
                        className="rounded-lg border border-slate-700 bg-slate-900 px-2 py-2 text-[8px] font-black uppercase tracking-wider text-slate-300 active:bg-slate-800"
                      >
                        Cancel
                      </button>
                    </div>

                    <button
                      id="mobile-layout-reset-btn"
                      type="button"
                      onClick={resetCurrentMobileLayout}
                      className="mt-1.5 w-full rounded-lg px-2 py-2 text-[8px] font-bold text-slate-500 active:bg-slate-900 active:text-white"
                    >
                      Reset {mobileOrientation} layout
                    </button>
                  </div>
                )}
              </div>
            )}

            {!mobileMode && (
              <div className="mt-3 border-t border-slate-800 pt-3">
                <div className="mb-2 px-1">
                  <div className="text-[10px] font-bold text-white">Steering input</div>
                  <div className="mt-0.5 text-[8px] leading-relaxed text-slate-500">Choose digital keys or continuous analog mouse steering.</div>
                </div>
                <div className="grid grid-cols-2 gap-1 rounded-xl bg-slate-900/65 p-1">
                  <button
                    id="steering-input-keyboard"
                    type="button"
                    onClick={() => onSetSteeringInputMode('keyboard')}
                    className={`rounded-lg px-2 py-2 text-[9px] font-bold transition-colors ${steeringInputMode === 'keyboard' ? 'bg-sky-400 text-slate-950' : 'text-slate-400 hover:bg-slate-800 hover:text-white'}`}
                    aria-pressed={steeringInputMode === 'keyboard'}
                  >
                    Keyboard
                  </button>
                  <button
                    id="steering-input-mouse"
                    type="button"
                    onClick={() => onSetSteeringInputMode('mouse')}
                    className={`rounded-lg px-2 py-2 text-[9px] font-bold transition-colors ${steeringInputMode === 'mouse' ? 'bg-sky-400 text-slate-950' : 'text-slate-400 hover:bg-slate-800 hover:text-white'}`}
                    aria-pressed={steeringInputMode === 'mouse'}
                  >
                    Mouse
                  </button>
                </div>
                <div className="mt-2 px-1 text-[8px] leading-relaxed text-slate-500">
                  {steeringInputMode === 'mouse'
                    ? 'Center = straight • move left/right across the driving view • screen edge = true full steering input.'
                    : 'A / D or arrow keys use speed-aware digital steering.'}
                </div>
              </div>
            )}

            {showM5XDriveSetting && onSetM5RwdMode && (
              <div className="mt-3 border-t border-slate-800 pt-3">
                <div className={`flex items-center justify-between gap-3 rounded-xl border p-2.5 ${isM5RwdMode ? 'border-amber-400/40 bg-amber-400/10' : 'border-slate-800 bg-slate-900/65'}`}>
                  <div className="min-w-0">
                    <div className="text-[10px] font-bold text-white">M xDrive</div>
                    <div className="mt-0.5 text-[8px] leading-relaxed text-slate-500">AWD / rear-wheel-drive 2WD mode</div>
                  </div>
                  <button
                    id="m5-rwd-mode-toggle"
                    type="button"
                    role="switch"
                    aria-checked={isM5RwdMode}
                    onClick={() => onSetM5RwdMode(!isM5RwdMode)}
                    className={`relative h-7 w-12 shrink-0 rounded-full border transition-colors ${isM5RwdMode ? 'border-amber-300/70 bg-amber-400/30' : 'border-slate-600 bg-slate-800'}`}
                    aria-label="Toggle BMW M5 AWD or rear-wheel-drive mode"
                  >
                    <span
                      className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${isM5RwdMode ? 'translate-x-6' : 'translate-x-0.5'}`}
                    />
                  </button>
                </div>

                <div className="mt-2 flex items-center justify-between px-1 text-[8px] font-bold uppercase tracking-wider text-slate-500">
                  <span>Drive</span>
                  <span className={isM5RwdMode ? 'text-amber-300' : 'text-emerald-300'}>{isM5RwdMode ? 'RWD / 2WD' : 'AWD / 4WD'}</span>
                </div>
                {isM5RwdMode && (
                  <div className="mt-1 px-1 text-[8px] leading-relaxed text-amber-200/75">Rear axle only • traction control off • Launch Control unavailable</div>
                )}
              </div>
            )}
          </div>
        )}

        {toolbarExpanded && (
          <div id="driving-utility-menu" className="mt-1.5 flex items-center justify-center gap-1 rounded-2xl border border-slate-800/75 bg-slate-950/88 p-1 shadow-2xl backdrop-blur-xl">
            <button
              id="tuning-btn"
              onClick={onOpenTuning}
              className="flex h-8 items-center gap-1 rounded-xl px-2 text-[10px] font-semibold text-slate-400 hover:bg-slate-800 hover:text-sky-300"
              title="Physics tuning (P)"
            >
              <Sliders size={14} />
              <span className={mobileMode ? 'hidden' : 'hidden sm:inline'}>Physics</span>
            </button>

            {onOpenTestRunner && (
              <button
                id="physics-tests-btn"
                onClick={onOpenTestRunner}
                className="flex h-8 items-center gap-1 rounded-xl px-2 text-[10px] font-semibold text-sky-300 hover:bg-sky-950/60"
                title="Physics tests (Y)"
              >
                <Cpu size={14} />
                <span className={mobileMode ? 'hidden' : 'hidden sm:inline'}>Tests</span>
              </button>
            )}

            <button
              id="telemetry-toggle-btn"
              onClick={onToggleTelemetry}
              className={`flex h-8 w-8 items-center justify-center rounded-xl ${
                showTelemetry ? 'bg-sky-500/15 text-sky-300' : 'text-slate-500 hover:bg-slate-800 hover:text-white'
              }`}
              title="Toggle detailed telemetry (T)"
            >
              <Activity size={14} />
            </button>

            <button
              id="sound-toggle-btn"
              onClick={onToggleMute}
              className={`flex h-8 w-8 items-center justify-center rounded-xl ${
                isMuted ? 'text-slate-500 hover:bg-slate-800 hover:text-white' : 'bg-emerald-500/10 text-emerald-300'
              }`}
              title="Toggle audio (U)"
            >
              {isMuted ? <VolumeX size={14} /> : <Volume2 size={14} />}
            </button>

            <button
              id="reset-car-btn"
              onClick={onReset}
              className="flex h-8 w-8 items-center justify-center rounded-xl text-slate-500 hover:bg-slate-800 hover:text-amber-300"
              title="Reset car (R)"
            >
              <RotateCcw size={14} />
            </button>

            <button
              id="clear-skids-btn"
              onClick={onClearSkidMarks}
              className="flex h-8 w-8 items-center justify-center rounded-xl text-slate-500 hover:bg-slate-800 hover:text-slate-200"
              title="Clear skid marks"
            >
              <Sparkles size={14} />
            </button>

            <button
              id="help-toggle-btn"
              onClick={() => setShowHelp((open) => !open)}
              className="flex h-8 w-8 items-center justify-center rounded-xl text-slate-500 hover:bg-slate-800 hover:text-white"
              title="Driving controls"
            >
              <HelpCircle size={14} />
            </button>
          </div>
        )}
      </div>

      {showHelp && (
        <div className="absolute left-1/2 top-24 z-30 w-[min(22rem,calc(100vw-1.5rem))] -translate-x-1/2 rounded-2xl border border-slate-700/80 bg-slate-950/94 p-3 text-[10px] text-slate-300 shadow-2xl backdrop-blur-xl">
          <div className="mb-2 flex items-center justify-between border-b border-slate-800 pb-2">
            <span className="flex items-center gap-1.5 font-bold uppercase tracking-wider text-white">
              <Car size={14} className="text-sky-300" />
              Driving controls
            </span>
            <button onClick={() => setShowHelp(false)} className="text-slate-500 hover:text-white">✕</button>
          </div>
          {mobileMode ? (
            <div className="grid grid-cols-2 gap-1.5 font-mono">
              <div className="rounded-lg bg-slate-900/65 p-2"><span className="text-sky-300">WHEEL</span><br />Analog steer</div>
              <div className="rounded-lg bg-slate-900/65 p-2"><span className="text-emerald-300">GAS</span><br />Throttle</div>
              <div className="rounded-lg bg-slate-900/65 p-2"><span className="text-rose-300">BRAKE</span><br />Brake</div>
              <div className="rounded-lg bg-slate-900/65 p-2"><span className="text-amber-300">HB</span><br />Handbrake</div>
              <div className="rounded-lg bg-slate-900/65 p-2"><span className="text-slate-200">CAM</span><br />Camera</div>
              <div className="rounded-lg bg-slate-900/65 p-2"><span className="text-slate-200">RESET</span><br />Respawn</div>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-1.5 font-mono">
              <div className="rounded-lg bg-slate-900/65 p-2"><span className="text-emerald-300">W / ↑</span><br />Throttle</div>
              <div className="rounded-lg bg-slate-900/65 p-2"><span className="text-rose-300">S / ↓</span><br />Brake</div>
              <div className="rounded-lg bg-slate-900/65 p-2"><span className="text-sky-300">{steeringInputMode === 'mouse' ? 'MOUSE' : 'A / D'}</span><br />{steeringInputMode === 'mouse' ? 'Steer by cursor' : 'Steer'}</div>
              <div className="rounded-lg bg-slate-900/65 p-2"><span className="text-amber-300">SPACE</span><br />Handbrake</div>
              <div className="rounded-lg bg-slate-900/65 p-2"><span className="text-slate-200">C / R</span><br />Camera / reset</div>
              <div className="rounded-lg bg-slate-900/65 p-2"><span className="text-slate-200">M</span><br />Auto / manual</div>
            </div>
          )}
        </div>
      )}

      {toolbarExpanded && !mobileMode && (
        <div className="pointer-events-none absolute bottom-3 left-3 z-10 hidden items-end gap-1.5 sm:flex">
          <div className="grid grid-cols-3 gap-1 rounded-xl border border-slate-800/70 bg-slate-950/70 p-1.5 backdrop-blur-md">
            <div />
            <KeyCap active={isW} label="W" activeClass="bg-emerald-400 text-slate-950" />
            <div />
            <KeyCap active={isA} label="A" activeClass="bg-sky-400 text-slate-950" />
            <KeyCap active={isS} label="S" activeClass="bg-rose-400 text-slate-950" />
            <KeyCap active={isD} label="D" activeClass="bg-sky-400 text-slate-950" />
          </div>
          <div className={`rounded-xl border px-2 py-2 font-mono text-[9px] font-bold ${isSpace ? 'border-amber-300 bg-amber-400 text-slate-950' : 'border-slate-800/70 bg-slate-950/70 text-slate-500'}`}>
            SPACE
          </div>
        </div>
      )}

      {mobileMode && (
        <MobileDrivingControls
          layout={activeMobileLayout}
          editMode={mobileLayoutEditing}
          onLayoutChange={updateMobileLayoutDraftPair}
          onTouchInput={onTouchInput}
          onTouchSteer={onTouchSteer}
          steeringRotationDeg={mobileSteeringRotationDeg}
          frontSaturationLevel={frontSaturationLevel}
          onNextCamera={onNextCamera}
          onReset={onReset}
        />
      )}
    </>
  );
};

const KeyCap: React.FC<{ active: boolean; label: string; activeClass: string }> = ({ active, label, activeClass }) => (
  <div className={`flex h-7 w-7 items-center justify-center rounded-lg border font-mono text-[9px] font-bold ${active ? `${activeClass} border-white/30` : 'border-slate-800 bg-slate-900/90 text-slate-500'}`}>
    {label}
  </div>
);
