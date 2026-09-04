import React, { useState } from 'react';
import { VehicleConfig, VehiclePreset, DrivetrainType, DifferentialType, AssistMode } from '../types';
import { VEHICLE_PRESETS, DEFAULT_VEHICLE_CONFIG } from '../physics/vehiclePresets';
import { X, RotateCcw, Sliders, Shield, Zap, Wind, Disc, Gauge, Activity, Sparkles } from 'lucide-react';

interface TuningModalProps {
  isOpen: boolean;
  onClose: () => void;
  config: VehicleConfig;
  onSaveConfig: (newConfig: VehicleConfig) => void;
  onSelectPreset: (presetKey: string) => void;
  currentColor: string;
  onChangeColor: (hexColor: string) => void;
}

export const TuningModal: React.FC<TuningModalProps> = ({
  isOpen,
  onClose,
  config,
  onSaveConfig,
  onSelectPreset,
  currentColor,
  onChangeColor,
}) => {
  const [activeTab, setActiveTab] = useState<'chassis' | 'suspension' | 'tires' | 'powertrain' | 'aero' | 'presets'>('presets');
  const [tempConfig, setTempConfig] = useState<VehicleConfig>({ ...config });

  if (!isOpen) return null;

  const handleChange = (key: keyof VehicleConfig, value: number | string | boolean) => {
    const updated = { ...tempConfig, [key]: value };
    setTempConfig(updated);
    onSaveConfig(updated);
  };

  const handleDifferentialOverride = (value: DifferentialType) => {
    const updated = {
      ...tempConfig,
      differentialType: value,
    } as VehicleConfig & Record<string, any>;

    // A single explicit tuning selection means "apply this type to both axles".
    // Removing per-axle stock overrides keeps the existing selector honest.
    delete updated.frontDifferentialType;
    delete updated.rearDifferentialType;

    setTempConfig(updated);
    onSaveConfig(updated);
  };

  const splitFrontDifferential = (tempConfig as any).frontDifferentialType as DifferentialType | undefined;
  const splitRearDifferential = (tempConfig as any).rearDifferentialType as DifferentialType | undefined;
  const hasSplitDifferential =
    Boolean(splitFrontDifferential && splitRearDifferential) &&
    splitFrontDifferential !== splitRearDifferential;

  const handleReset = () => {
    setTempConfig(DEFAULT_VEHICLE_CONFIG);
    onSaveConfig(DEFAULT_VEHICLE_CONFIG);
  };

  const colorOptions = [
    { label: 'Sapphire Blue', hex: '#2563eb' },
    { label: 'Crimson Red', hex: '#dc2626' },
    { label: 'Emerald Green', hex: '#10b981' },
    { label: 'Ember Orange', hex: '#ea580c' },
    { label: 'Obsidian Black', hex: '#18181b' },
    { label: 'Rally White', hex: '#f8fafc' },
    { label: 'Ultra Violet', hex: '#7c3aed' },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md">
      <div className="bg-slate-900 border border-slate-700/80 w-full max-w-3xl rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-950/50">
          <div className="flex items-center gap-2.5">
            <Sliders size={20} className="text-sky-400" />
            <div>
              <h2 className="text-base font-bold text-slate-100">Vehicle Dynamics & Telemetry Tuning</h2>
              <p className="text-xs text-slate-400">Tune 2-way valved dampers, bump stops, DRS aero balance, flywheel & clutch-kick dynamics</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              id="reset-tuning-btn"
              onClick={handleReset}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-slate-300 hover:text-slate-100 hover:bg-slate-800 rounded-xl transition-colors border border-slate-700/70 cursor-pointer"
            >
              <RotateCcw size={14} />
              Reset Stock
            </button>
            <button
              id="close-tuning-modal-btn"
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-slate-100 hover:bg-slate-800 rounded-xl transition-colors cursor-pointer"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="flex items-center gap-1 px-6 py-2.5 bg-slate-950/80 border-b border-slate-800 overflow-x-auto text-xs font-semibold">
          {[
            { id: 'presets', label: 'Vehicle Archetypes', icon: Zap },
            { id: 'suspension', label: '2-Way Dampers & Bump Stops', icon: Activity },
            { id: 'tires', label: 'Pacejka Tires & Wear', icon: Disc },
            { id: 'powertrain', label: 'Flywheel, Clutch & LSD', icon: Gauge },
            { id: 'aero', label: 'Aero & Active DRS', icon: Wind },
            { id: 'chassis', label: 'Chassis & Paint', icon: Sliders },
          ].map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                id={`tab-${tab.id}`}
                onClick={() => setActiveTab(tab.id as typeof activeTab)}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-xl transition-all whitespace-nowrap cursor-pointer ${
                  isActive
                    ? 'bg-sky-500 text-slate-950 font-bold shadow-lg shadow-sky-500/20'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
                }`}
              >
                <Icon size={14} />
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Tab Content Body */}
        <div className="p-6 overflow-y-auto space-y-6 flex-1 text-xs">
          {/* TAB 1: PRESETS */}
          {activeTab === 'presets' && (
            <div className="space-y-4">
              <p className="text-slate-400">
                Choose an engineered chassis archetype to immediately load custom physics geometry, differential lock rates, and suspension kinematics:
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                {Object.entries(VEHICLE_PRESETS).map(([key, preset]) => (
                  <div
                    key={key}
                    onClick={() => {
                      onSelectPreset(key);
                      setTempConfig({ ...tempConfig, ...preset.config });
                    }}
                    className="p-4 rounded-2xl border border-slate-700/60 bg-slate-950/40 hover:bg-slate-800/50 hover:border-sky-500/60 cursor-pointer transition-all flex flex-col justify-between group"
                  >
                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="font-bold text-slate-100 text-sm group-hover:text-sky-400 transition-colors">
                          {preset.name}
                        </span>
                        <div
                          className="w-3.5 h-3.5 rounded-full border border-slate-700 shadow-sm"
                          style={{ backgroundColor: preset.color }}
                        ></div>
                      </div>
                      <div className="text-[11px] font-semibold text-sky-400/90 mb-2">
                        {preset.tagline}
                      </div>
                      <p className="text-slate-400 text-[11px] leading-relaxed">
                        {preset.description}
                      </p>
                    </div>
                    <div className="mt-3 pt-2 border-t border-slate-800/80 flex items-center justify-between text-[10px] text-slate-500 font-mono">
                      <span>LOAD ARCHETYPE</span>
                      <span className="text-sky-400 font-bold group-hover:translate-x-0.5 transition-transform">→</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* TAB 2: SUSPENSION & 2-WAY DAMPING */}
          {activeTab === 'suspension' && (
            <div className="space-y-5">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <SliderControl
                  label="Spring Stiffness (Main Rate)"
                  sub="Coil spring rate (N/m)"
                  min={20000}
                  max={75000}
                  step={1000}
                  value={tempConfig.suspensionStiffness}
                  unit=" N/m"
                  onChange={(v) => handleChange('suspensionStiffness', v)}
                />
                <SliderControl
                  label="Low-Speed Damper Valving"
                  sub="Chassis roll & pitch control"
                  min={1500}
                  max={7000}
                  step={100}
                  value={tempConfig.suspensionDampingLowSpeed}
                  unit=" Ns/m"
                  onChange={(v) => handleChange('suspensionDampingLowSpeed', v)}
                />
                <SliderControl
                  label="High-Speed Damper Valving"
                  sub="Kerb strike & sharp bump compliance"
                  min={1000}
                  max={4500}
                  step={100}
                  value={tempConfig.suspensionDampingHighSpeed}
                  unit=" Ns/m"
                  onChange={(v) => handleChange('suspensionDampingHighSpeed', v)}
                />
                <SliderControl
                  label="Rebound Damper Rate"
                  sub="Extension stroke damping"
                  min={2000}
                  max={8000}
                  step={100}
                  value={tempConfig.suspensionReboundDamping}
                  unit=" Ns/m"
                  onChange={(v) => handleChange('suspensionReboundDamping', v)}
                />
                <SliderControl
                  label="Bump Stop Stiffness"
                  sub="Progressive rubber bump stop rate"
                  min={25000}
                  max={85000}
                  step={1000}
                  value={tempConfig.bumpStopStiffness}
                  unit=" N/m"
                  onChange={(v) => handleChange('bumpStopStiffness', v)}
                />
                <SliderControl
                  label="Bump Stop Travel Threshold"
                  sub="Engagement stroke threshold"
                  min={0.65}
                  max={0.95}
                  step={0.01}
                  value={tempConfig.bumpStopTravelThreshold}
                  unit=""
                  onChange={(v) => handleChange('bumpStopTravelThreshold', v)}
                />
                <SliderControl
                  label="Front Anti-Roll Bar"
                  sub="Front lateral roll resistance"
                  min={10000}
                  max={55000}
                  step={1000}
                  value={tempConfig.rollStiffnessFront}
                  unit=" N/m"
                  onChange={(v) => handleChange('rollStiffnessFront', v)}
                />
                <SliderControl
                  label="Rear Anti-Roll Bar"
                  sub="Rear lateral roll resistance"
                  min={10000}
                  max={55000}
                  step={1000}
                  value={tempConfig.rollStiffnessRear}
                  unit=" N/m"
                  onChange={(v) => handleChange('rollStiffnessRear', v)}
                />
                <SliderControl
                  label="Front Static Camber"
                  sub="Static negative tire tilt"
                  min={-4.5}
                  max={0.0}
                  step={0.1}
                  value={tempConfig.camberStaticFront}
                  unit="°"
                  onChange={(v) => handleChange('camberStaticFront', v)}
                />
                <SliderControl
                  label="Dynamic Camber Gain"
                  sub="Degrees gain per meter bump"
                  min={2.0}
                  max={14.0}
                  step={0.5}
                  value={tempConfig.camberGain}
                  unit=" deg/m"
                  onChange={(v) => handleChange('camberGain', v)}
                />
              </div>
            </div>
          )}

          {/* TAB 3: PACEJKA TIRES, WEAR & SURFACE */}
          {activeTab === 'tires' && (
            <div className="space-y-5">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <SliderControl
                  label="Front Tire Grip (Peak Mu)"
                  sub="Pacejka peak friction coefficient"
                  min={0.85}
                  max={1.65}
                  step={0.02}
                  value={tempConfig.tireGripFront}
                  unit=" µ"
                  onChange={(v) => handleChange('tireGripFront', v)}
                />
                <SliderControl
                  label="Rear Tire Grip (Peak Mu)"
                  sub="Pacejka peak friction coefficient"
                  min={0.85}
                  max={1.65}
                  step={0.02}
                  value={tempConfig.tireGripRear}
                  unit=" µ"
                  onChange={(v) => handleChange('tireGripRear', v)}
                />
                <SliderControl
                  label="Tire Cornering Stiffness (B)"
                  sub="Initial slip response slope"
                  min={8.0}
                  max={24.0}
                  step={0.5}
                  value={tempConfig.tireStiffness}
                  unit=""
                  onChange={(v) => handleChange('tireStiffness', v)}
                />
                <SliderControl
                  label="Relaxation Length (Sidewall Compliance)"
                  sub="Dynamic tire lag distance"
                  min={0.08}
                  max={0.35}
                  step={0.01}
                  value={tempConfig.relaxationLength}
                  unit=" m"
                  onChange={(v) => handleChange('relaxationLength', v)}
                />
                <SliderControl
                  label="Tire Tread Wear Rate"
                  sub="Rate of friction degradation per burnout"
                  min={0.2}
                  max={3.0}
                  step={0.1}
                  value={tempConfig.tireWearRate}
                  unit="x"
                  onChange={(v) => handleChange('tireWearRate', v)}
                />
                <SliderControl
                  label="Ambient Surface Grip Baseline"
                  sub="Global proving ground asphalt grip multiplier"
                  min={0.5}
                  max={1.5}
                  step={0.05}
                  value={tempConfig.ambientSurfaceFrictionMultiplier}
                  unit="x"
                  onChange={(v) => handleChange('ambientSurfaceFrictionMultiplier', v)}
                />
              </div>
            </div>
          )}

          {/* TAB 4: POWERTRAIN, FLYWHEEL, CLUTCH & LSD */}
          {activeTab === 'powertrain' && (
            <div className="space-y-5">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Drivetrain Selector */}
                <div className="space-y-1.5">
                  <label className="font-semibold text-slate-200">Drivetrain Layout</label>
                  <div className="grid grid-cols-3 gap-2">
                    {(['RWD', 'AWD', 'FWD'] as DrivetrainType[]).map((type) => (
                      <button
                        key={type}
                        onClick={() => handleChange('drivetrain', type)}
                        className={`py-2 rounded-xl font-bold border transition-all cursor-pointer ${
                          tempConfig.drivetrain === type
                            ? 'bg-sky-500 text-slate-950 border-sky-400'
                            : 'bg-slate-950 text-slate-400 border-slate-800 hover:text-slate-200'
                        }`}
                      >
                        {type}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Differential Selector */}
                <div className="space-y-1.5">
                  <label className="font-semibold text-slate-200">Differential Setup</label>
                  <select
                    value={hasSplitDifferential ? '__SPLIT__' : tempConfig.differentialType}
                    onChange={(e) => {
                      if (e.target.value === '__SPLIT__') return;
                      handleDifferentialOverride(e.target.value as DifferentialType);
                    }}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-slate-200 font-semibold cursor-pointer"
                  >
                    {hasSplitDifferential && (
                      <option value="__SPLIT__" disabled>
                        Stock — {splitFrontDifferential} front / Active rear
                      </option>
                    )}
                    <option value="CLUTCH_1_5">1.5-Way Clutch LSD (both axles)</option>
                    <option value="CLUTCH_2_WAY">2-Way Clutch LSD (both axles)</option>
                    <option value="TORQUE_VECTOR">Torque Vectoring / Active Bias (both axles)</option>
                    <option value="OPEN">Open Differential (both axles)</option>
                    <option value="SPOOL">Spool / Locked (both axles)</option>
                  </select>
                  {hasSplitDifferential && (
                    <div className="text-[9px] leading-relaxed text-slate-500">
                      G90 stock uses an open front differential with the Active M Differential at the rear. Choosing another type overrides both axles until the preset is reloaded.
                    </div>
                  )}
                </div>

                <SliderControl
                  label="Flywheel Rotational Inertia"
                  sub="Engine rev acceleration/deceleration lag"
                  min={0.08}
                  max={0.35}
                  step={0.01}
                  value={tempConfig.flywheelInertia}
                  unit=" kg·m²"
                  onChange={(v) => handleChange('flywheelInertia', v)}
                />
                <SliderControl
                  label="Engine Braking Torque"
                  sub="Trailing throttle-lift oversteer torque"
                  min={30}
                  max={180}
                  step={5}
                  value={tempConfig.engineBrakingTorque}
                  unit=" Nm"
                  onChange={(v) => handleChange('engineBrakingTorque', v)}
                />
                <SliderControl
                  label="Clutch Kick Torque Multiplier"
                  sub="Torque shock dumped on clutch bite"
                  min={1.5}
                  max={4.0}
                  step={0.1}
                  value={tempConfig.clutchKickTorqueMultiplier}
                  unit="x"
                  onChange={(v) => handleChange('clutchKickTorqueMultiplier', v)}
                />
                <SliderControl
                  label="Max Engine Torque"
                  sub="Peak internal combustion torque"
                  min={300}
                  max={950}
                  step={20}
                  value={tempConfig.maxTorque}
                  unit=" Nm"
                  onChange={(v) => handleChange('maxTorque', v)}
                />
                <SliderControl
                  label="Turbocharger Boost Peak"
                  sub="Maximum manifold pressure"
                  min={6.0}
                  max={30.0}
                  step={1.0}
                  value={tempConfig.turboBoostMaxPsi}
                  unit=" PSI"
                  onChange={(v) => handleChange('turboBoostMaxPsi', v)}
                />
                <div className="flex items-center justify-between p-3.5 rounded-2xl border border-slate-800 bg-slate-950/50">
                  <div>
                    <span className="font-semibold text-slate-200 block">Anti-Lag Turbo System (ALS)</span>
                    <span className="text-[10px] text-slate-400">Keep boost primed off-throttle</span>
                  </div>
                  <button
                    onClick={() => handleChange('antiLagEnabled', !tempConfig.antiLagEnabled)}
                    className={`px-3 py-1 rounded-xl font-bold font-mono text-xs cursor-pointer border ${
                      tempConfig.antiLagEnabled
                        ? 'bg-amber-500 text-slate-950 border-amber-400'
                        : 'bg-slate-900 text-slate-400 border-slate-800'
                    }`}
                  >
                    {tempConfig.antiLagEnabled ? 'ACTIVE' : 'OFF'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* TAB 5: AERO & ACTIVE DRS */}
          {activeTab === 'aero' && (
            <div className="space-y-5">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <SliderControl
                  label="Front Aero Downforce"
                  sub="Front splitter downforce at 100 km/h"
                  min={50}
                  max={600}
                  step={25}
                  value={tempConfig.aeroDownforceFront}
                  unit=" N"
                  onChange={(v) => handleChange('aeroDownforceFront', v)}
                />
                <SliderControl
                  label="Rear Aero Downforce"
                  sub="GT rear wing downforce at 100 km/h"
                  min={80}
                  max={950}
                  step={25}
                  value={tempConfig.aeroDownforceRear}
                  unit=" N"
                  onChange={(v) => handleChange('aeroDownforceRear', v)}
                />
                <SliderControl
                  label="CoP Pitch Sensitivity"
                  sub="Downforce forward migration under pitch dive"
                  min={0.01}
                  max={0.12}
                  step={0.005}
                  value={tempConfig.aeroCopPitchSensitivity}
                  unit=""
                  onChange={(v) => handleChange('aeroCopPitchSensitivity', v)}
                />
                <div className="flex items-center justify-between p-3.5 rounded-2xl border border-slate-800 bg-slate-950/50">
                  <div>
                    <span className="font-semibold text-slate-200 block">Deployable DRS Wing</span>
                    <span className="text-[10px] text-slate-400">Reduces drag by 35-45% on straights</span>
                  </div>
                  <button
                    onClick={() => handleChange('drsEnabled', !tempConfig.drsEnabled)}
                    className={`px-3 py-1 rounded-xl font-bold font-mono text-xs cursor-pointer border ${
                      tempConfig.drsEnabled
                        ? 'bg-emerald-500 text-slate-950 border-emerald-400'
                        : 'bg-slate-900 text-slate-400 border-slate-800'
                    }`}
                  >
                    {tempConfig.drsEnabled ? 'ENABLED' : 'DISABLED'}
                  </button>
                </div>

                {/* ABS Mode */}
                <div className="space-y-1.5">
                  <label className="font-semibold text-slate-200">Anti-Lock Braking (ABS)</label>
                  <div className="grid grid-cols-3 gap-2">
                    {(['OFF', 'SPORT', 'FULL'] as AssistMode[]).map((mode) => (
                      <button
                        key={mode}
                        onClick={() => handleChange('absMode', mode)}
                        className={`py-2 rounded-xl font-bold border transition-all cursor-pointer ${
                          tempConfig.absMode === mode
                            ? 'bg-amber-500 text-slate-950 border-amber-400'
                            : 'bg-slate-950 text-slate-400 border-slate-800 hover:text-slate-200'
                        }`}
                      >
                        {mode}
                      </button>
                    ))}
                  </div>
                </div>

                {/* TCS Mode */}
                <div className="space-y-1.5">
                  <label className="font-semibold text-slate-200">Traction Control (TCS)</label>
                  <div className="grid grid-cols-3 gap-2">
                    {(['OFF', 'SPORT', 'FULL'] as AssistMode[]).map((mode) => (
                      <button
                        key={mode}
                        onClick={() => handleChange('tcsMode', mode)}
                        className={`py-2 rounded-xl font-bold border transition-all cursor-pointer ${
                          tempConfig.tcsMode === mode
                            ? 'bg-cyan-500 text-slate-950 border-cyan-400'
                            : 'bg-slate-950 text-slate-400 border-slate-800 hover:text-slate-200'
                        }`}
                      >
                        {mode}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 6: CHASSIS & PAINT */}
          {activeTab === 'chassis' && (
            <div className="space-y-5">
              <div className="space-y-2">
                <label className="font-semibold text-slate-200">Exterior Paint Color</label>
                <div className="flex flex-wrap gap-2.5">
                  {colorOptions.map((c) => (
                    <button
                      key={c.hex}
                      onClick={() => onChangeColor(c.hex)}
                      className={`w-9 h-9 rounded-2xl border-2 transition-all flex items-center justify-center cursor-pointer ${
                        currentColor.toLowerCase() === c.hex.toLowerCase()
                          ? 'border-sky-400 scale-110 shadow-lg shadow-sky-500/30'
                          : 'border-slate-700 hover:border-slate-500'
                      }`}
                      style={{ backgroundColor: c.hex }}
                      title={c.label}
                    />
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <SliderControl
                  label="Vehicle Curb Mass"
                  sub="Total vehicle weight"
                  min={1000}
                  max={2400}
                  step={25}
                  value={tempConfig.mass}
                  unit=" kg"
                  onChange={(v) => handleChange('mass', v)}
                />
                <SliderControl
                  label="Center of Gravity Height"
                  sub="Height of chassis mass above ground"
                  min={0.32}
                  max={0.65}
                  step={0.01}
                  value={tempConfig.centerOfGravityHeight}
                  unit=" m"
                  onChange={(v) => handleChange('centerOfGravityHeight', v)}
                />
                <SliderControl
                  label="Body Roll Multiplier"
                  sub="Visual & dynamic body roll sensitivity"
                  min={0.5}
                  max={2.5}
                  step={0.05}
                  value={tempConfig.bodyRollMultiplier}
                  unit="x"
                  onChange={(v) => handleChange('bodyRollMultiplier', v)}
                />
                <SliderControl
                  label="Pitch Multiplier"
                  sub="Visual & dynamic squat/dive sensitivity"
                  min={0.5}
                  max={2.5}
                  step={0.05}
                  value={tempConfig.bodyPitchMultiplier}
                  unit="x"
                  onChange={(v) => handleChange('bodyPitchMultiplier', v)}
                />
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3.5 border-t border-slate-800 bg-slate-950/60 flex justify-end">
          <button
            id="apply-tuning-btn"
            onClick={onClose}
            className="px-6 py-2.5 bg-sky-500 hover:bg-sky-400 text-slate-950 font-bold rounded-2xl transition-all shadow-lg shadow-sky-500/25 cursor-pointer"
          >
            Apply & Close
          </button>
        </div>
      </div>
    </div>
  );
};

interface SliderControlProps {
  label: string;
  sub: string;
  min: number;
  max: number;
  step: number;
  value: number;
  unit: string;
  onChange: (v: number) => void;
}

const SliderControl: React.FC<SliderControlProps> = ({ label, sub, min, max, step, value, unit, onChange }) => {
  return (
    <div className="p-3.5 rounded-2xl border border-slate-800 bg-slate-950/50 space-y-2">
      <div className="flex justify-between items-baseline">
        <span className="font-semibold text-slate-200">{label}</span>
        <span className="font-mono font-bold text-sky-400">
          {typeof value === 'number' ? (Number.isInteger(step) ? value : value.toFixed(2)) : value}
          {unit}
        </span>
      </div>
      <div className="text-[10px] text-slate-400">{sub}</div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full accent-sky-500 cursor-pointer h-1.5 bg-slate-800 rounded-lg appearance-none"
      />
    </div>
  );
};
