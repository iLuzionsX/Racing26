import React, { useRef, useState } from 'react';
import * as THREE from 'three';
import {
  AlertTriangle,
  Box,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  FileArchive,
  FolderOpen,
  Gauge,
  Upload,
  X,
} from 'lucide-react';
import {
  AcMapping,
  AssettoCorsaImportResult,
  importAssettoCorsaFiles,
} from '../importers/assettoCorsaImporter';
import {
  extractPrimaryKn5FromFiles,
  loadKn5Visual,
  type Kn5VisualResult,
  type PrimaryKn5Source,
} from '../graphics/kn5Loader';

interface AssettoCorsaImportPanelProps {
  config: Record<string, any>;
  onApply: (config: any) => void;
  onApplyVisual?: (visual: Kn5VisualResult) => void;
}

function findNodeByNames(root: THREE.Object3D, names: string[]): THREE.Object3D | null {
  const wanted = new Set(names.map((name) => name.toUpperCase()));
  let found: THREE.Object3D | null = null;
  root.traverse((object) => {
    if (!found && wanted.has(object.name.toUpperCase())) found = object;
  });
  return found;
}

function alignKn5ToCurrentPhysics(visual: Kn5VisualResult, config: Record<string, any>) {
  const root = visual.group;

  // AC vehicle coordinates are +X left, +Y up, +Z forward. Physics Drive Lab
  // uses +X right, +Y up, +Z forward, so mirror only the lateral axis.
  root.scale.x = -1;
  root.updateMatrixWorld(true);

  const lf = findNodeByNames(root, ['WHEEL_LF', 'WHEEL_FL']);
  const rf = findNodeByNames(root, ['WHEEL_RF', 'WHEEL_FR']);
  const lr = findNodeByNames(root, ['WHEEL_LR', 'WHEEL_RL']);
  const rr = findNodeByNames(root, ['WHEEL_RR']);

  if (!lf || !rf || !lr || !rr) {
    visual.warnings.push('KN5 wheel anchors could not be resolved, so the body kept its authored origin.');
    return;
  }

  const pLF = lf.getWorldPosition(new THREE.Vector3());
  const pRF = rf.getWorldPosition(new THREE.Vector3());
  const pLR = lr.getWorldPosition(new THREE.Vector3());
  const pRR = rr.getWorldPosition(new THREE.Vector3());

  const acFrontZ = (pLF.z + pRF.z) * 0.5;
  const acRearZ = (pLR.z + pRR.z) * 0.5;
  const acWheelY = (pLF.y + pRF.y + pLR.y + pRR.y) * 0.25;
  const acWheelbase = Math.abs(acFrontZ - acRearZ);
  const acFrontTrack = Math.abs(pLF.x - pRF.x);
  const acRearTrack = Math.abs(pLR.x - pRR.x);

  const wheelbase = Number(config.wheelbase);
  const frontWeight = Number(config.weightDistributionFront);
  const wheelRadius = Number(config.wheelRadius);

  if (Number.isFinite(wheelbase) && wheelbase > 0 && Number.isFinite(frontWeight)) {
    // Simulator hardpoints are referenced to the vehicle CG, whereas KN5 origins
    // are arbitrary model-space origins. Align both axles, not the raw model origin.
    const simFrontZ = wheelbase * (1 - frontWeight);
    const simRearZ = -wheelbase * frontWeight;
    const zOffset = ((simFrontZ - acFrontZ) + (simRearZ - acRearZ)) * 0.5;
    root.position.z += zOffset;

    visual.warnings.push(
      `KN5 axle anchors aligned to the current physics origin (model wheelbase ${acWheelbase.toFixed(3)} m; longitudinal offset ${zOffset >= 0 ? '+' : ''}${zOffset.toFixed(3)} m).`
    );
  }

  if (Number.isFinite(wheelRadius) && wheelRadius > 0 && Number.isFinite(acWheelY)) {
    // This is normally only a millimetre-scale correction for a correctly authored
    // matching car, but it prevents a body from floating when the KN5 origin differs.
    const yOffset = wheelRadius - acWheelY;
    root.position.y += yOffset;
  }

  root.updateMatrixWorld(true);
  visual.warnings.push(
    `KN5 wheel anchors: front track ${acFrontTrack.toFixed(3)} m, rear track ${acRearTrack.toFixed(3)} m.`
  );
}

export const AssettoCorsaImportPanel: React.FC<AssettoCorsaImportPanelProps> = ({
  config,
  onApply,
  onApplyVisual,
}) => {
  const zipInputRef = useRef<HTMLInputElement | null>(null);
  const folderInputRef = useRef<HTMLInputElement | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [isReading, setIsReading] = useState(false);
  const [isLoadingVisual, setIsLoadingVisual] = useState(false);
  const [result, setResult] = useState<AssettoCorsaImportResult | null>(null);
  const [visualSource, setVisualSource] = useState<PrimaryKn5Source | null>(null);
  const [visualResult, setVisualResult] = useState<Kn5VisualResult | null>(null);
  const [visualWarning, setVisualWarning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showMappings, setShowMappings] = useState(true);
  const [appliedName, setAppliedName] = useState<string | null>(null);

  const readFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const selectedFiles = Array.from(files);
    setError(null);
    setResult(null);
    setVisualSource(null);
    setVisualResult(null);
    setVisualWarning(null);
    setIsReading(true);

    try {
      const [imported, visual] = await Promise.all([
        importAssettoCorsaFiles(selectedFiles),
        extractPrimaryKn5FromFiles(selectedFiles),
      ]);
      setResult(imported);
      setVisualSource(visual.source);
      setVisualWarning(visual.warning ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read this Assetto Corsa car.');
    } finally {
      setIsReading(false);
      if (zipInputRef.current) zipInputRef.current.value = '';
      if (folderInputRef.current) folderInputRef.current.value = '';
    }
  };

  const physicsReady = Boolean(result && result.sourceStatus === 'ready' && result.mappings.length > 0);
  const visualReady = Boolean(visualSource && onApplyVisual);

  const applyImport = async () => {
    if (!result || isLoadingVisual || (!physicsReady && !visualReady)) return;

    setError(null);

    // Physics and visuals are intentionally independent. Many legitimate AC mods
    // ship readable KN5 geometry but keep physics packed in data.acd. In that case
    // we can still use the real body while retaining Physics Drive Lab's current
    // calibrated vehicle setup instead of blocking the entire import.
    if (physicsReady) {
      onApply({ ...config, ...result.config });
    }

    if (visualSource && onApplyVisual) {
      setIsLoadingVisual(true);
      try {
        const loadedVisual = await loadKn5Visual(visualSource);
        alignKn5ToCurrentPhysics(loadedVisual, physicsReady ? { ...config, ...result.config } : config);

        setVisualResult(loadedVisual);
        setVisualSource(null); // release the large raw KN5 byte buffer after parsing
        onApplyVisual(loadedVisual);
        setAppliedName(physicsReady ? result.name : `${result.name} model`);
        setIsOpen(false);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'The KN5 visual model could not be loaded.';
        if (physicsReady) {
          setVisualWarning(`Physics was applied, but the visual body was not replaced: ${message}`);
          setAppliedName(`${result.name} (physics)`);
        } else {
          setVisualWarning(`The current physics were left unchanged, and the visual body could not be loaded: ${message}`);
        }
      } finally {
        setIsLoadingVisual(false);
      }
      return;
    }

    if (physicsReady) {
      setAppliedName(result.name);
      setIsOpen(false);
    }
  };

  const directCount = result?.mappings.filter((mapping) => mapping.confidence === 'direct').length ?? 0;
  const translatedCount = result?.mappings.filter((mapping) => mapping.confidence === 'translated').length ?? 0;
  const inferredCount = result?.mappings.filter((mapping) => mapping.confidence === 'inferred').length ?? 0;

  const applyLabel = isLoadingVisual
    ? 'Loading KN5…'
    : physicsReady && visualReady
      ? 'Apply car + model'
      : visualReady
        ? 'Apply model — keep physics'
        : 'Apply imported physics';

  return (
    <>
      <button
        id="assetto-corsa-import-btn"
        onClick={() => setIsOpen(true)}
        className="absolute right-3 top-3 z-30 flex h-9 max-w-[13rem] items-center gap-2 rounded-xl border border-slate-700/80 bg-slate-950/84 px-3 text-[10px] font-bold text-slate-200 shadow-xl backdrop-blur-xl hover:border-emerald-500/60 hover:text-emerald-200"
        title="Import Assetto Corsa car physics and visual model"
      >
        <FileArchive size={14} className={appliedName ? 'text-emerald-300' : 'text-sky-300'} />
        <span className="truncate">{appliedName ? `AC: ${appliedName}` : 'Import AC Car'}</span>
      </button>

      {isOpen && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-slate-950/72 p-3 backdrop-blur-sm">
          <div className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-3xl border border-slate-700/80 bg-slate-950 shadow-2xl">
            <div className="flex items-start justify-between border-b border-slate-800 px-5 py-4">
              <div>
                <div className="flex items-center gap-2">
                  <FileArchive size={18} className="text-emerald-300" />
                  <h2 className="text-sm font-black tracking-tight text-white">Assetto Corsa Car Importer</h2>
                  <span className="rounded-md border border-emerald-500/25 bg-emerald-500/10 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wider text-emerald-300">V1</span>
                </div>
                <p className="mt-1 max-w-2xl text-[10px] leading-relaxed text-slate-400">
                  Reads the mod locally in your browser, converts compatible AC physics, and can use an ordinary KN5 as the visible sprung body while our simulated wheels stay physics-driven.
                </p>
              </div>
              <button
                onClick={() => setIsOpen(false)}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-slate-500 hover:bg-slate-800 hover:text-white"
                aria-label="Close Assetto Corsa importer"
              >
                <X size={16} />
              </button>
            </div>

            <div className="overflow-y-auto p-5">
              <div className="grid gap-3 sm:grid-cols-2">
                <button
                  onClick={() => zipInputRef.current?.click()}
                  className="group flex min-h-28 flex-col items-center justify-center rounded-2xl border border-dashed border-slate-700 bg-slate-900/45 p-4 text-center hover:border-sky-500/60 hover:bg-sky-950/20"
                >
                  <Upload size={21} className="mb-2 text-sky-300" />
                  <span className="text-xs font-bold text-white">Choose car ZIP</span>
                  <span className="mt-1 text-[9px] leading-relaxed text-slate-500">An unpacked data/ folder enables physics conversion; KN5 visuals can be used independently.</span>
                </button>

                <button
                  onClick={() => folderInputRef.current?.click()}
                  className="group flex min-h-28 flex-col items-center justify-center rounded-2xl border border-dashed border-slate-700 bg-slate-900/45 p-4 text-center hover:border-emerald-500/60 hover:bg-emerald-950/20"
                >
                  <FolderOpen size={21} className="mb-2 text-emerald-300" />
                  <span className="text-xs font-bold text-white">Choose extracted car folder</span>
                  <span className="mt-1 text-[9px] leading-relaxed text-slate-500">Use this after Content Manager → Tools → Unpack Data when you also want the mod's packed physics converted.</span>
                </button>
              </div>

              <input
                ref={zipInputRef}
                type="file"
                accept=".zip,application/zip"
                className="hidden"
                onChange={(event) => readFiles(event.target.files)}
              />
              <input
                ref={folderInputRef}
                type="file"
                multiple
                className="hidden"
                {...({ webkitdirectory: '', directory: '' } as any)}
                onChange={(event) => readFiles(event.target.files)}
              />

              {isReading && (
                <div className="mt-4 flex items-center gap-2 rounded-2xl border border-sky-500/20 bg-sky-500/8 px-4 py-3 text-[10px] text-sky-200">
                  <Gauge size={15} className="animate-pulse" />
                  Reading AC physics and locating the primary KN5…
                </div>
              )}

              {error && (
                <div className="mt-4 flex items-start gap-2 rounded-2xl border border-rose-500/25 bg-rose-500/8 px-4 py-3 text-[10px] leading-relaxed text-rose-200">
                  <AlertTriangle size={15} className="mt-0.5 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              {result && (
                <div className="mt-4 space-y-3">
                  <div className="rounded-2xl border border-slate-800 bg-slate-900/55 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="text-[9px] font-bold uppercase tracking-[0.18em] text-slate-500">Detected car</div>
                        <div className="mt-1 text-base font-black text-white">{result.name}</div>
                        <div className="mt-1 text-[9px] text-slate-500">{result.archiveFiles.length} files scanned • {result.kn5Files.length} KN5 model{result.kn5Files.length === 1 ? '' : 's'} detected</div>
                      </div>

                      <StatusBadge status={result.sourceStatus} />
                    </div>

                    {result.sourceStatus === 'ready' && (
                      <div className="mt-4 grid grid-cols-3 gap-2">
                        <Metric label="Direct" value={directCount} className="text-emerald-300" />
                        <Metric label="Translated" value={translatedCount} className="text-sky-300" />
                        <Metric label="Inferred" value={inferredCount} className="text-amber-300" />
                      </div>
                    )}
                  </div>

                  {(visualSource || visualResult || visualWarning) && (
                    <div className="rounded-2xl border border-violet-500/20 bg-violet-500/6 p-4">
                      <div className="flex items-start gap-2">
                        <Box size={15} className="mt-0.5 shrink-0 text-violet-300" />
                        <div className="min-w-0">
                          <div className="text-[10px] font-bold uppercase tracking-wider text-violet-300">Visual body</div>
                          {visualSource && !visualResult && (
                            <p className="mt-1 truncate text-[9px] text-violet-100/75">KN5 source found: {visualSource.name}</p>
                          )}
                          {visualSource && result.sourceStatus !== 'ready' && (
                            <p className="mt-1 text-[9px] leading-relaxed text-emerald-200/80">
                              The model can still be applied now without changing the simulator's current physics.
                            </p>
                          )}
                          {visualResult && (
                            <p className="mt-1 text-[9px] leading-relaxed text-violet-100/80">
                              Loaded KN5 v{visualResult.version}: {visualResult.meshCount} meshes, {visualResult.textureCount} textures, {visualResult.hiddenWheelNodeCount} wheel/suspension nodes hidden so simulator wheels remain articulated.
                            </p>
                          )}
                          {visualWarning && <p className="mt-1 text-[9px] leading-relaxed text-amber-200/80">{visualWarning}</p>}
                        </div>
                      </div>
                    </div>
                  )}

                  {result.mappings.length > 0 && (
                    <div className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/35">
                      <button
                        onClick={() => setShowMappings((open) => !open)}
                        className="flex w-full items-center justify-between px-4 py-3 text-left"
                      >
                        <div>
                          <div className="text-[10px] font-bold text-white">Physics mapping</div>
                          <div className="mt-0.5 text-[9px] text-slate-500">Exactly what will change when you apply the car.</div>
                        </div>
                        {showMappings ? <ChevronUp size={15} className="text-slate-500" /> : <ChevronDown size={15} className="text-slate-500" />}
                      </button>

                      {showMappings && (
                        <div className="max-h-72 overflow-y-auto border-t border-slate-800">
                          {result.mappings.map((mapping, index) => (
                            <MappingRow key={`${mapping.target}-${index}`} mapping={mapping} />
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {result.warnings.length > 0 && (
                    <div className="rounded-2xl border border-amber-500/20 bg-amber-500/6 p-4">
                      <div className="mb-2 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-amber-300">
                        <AlertTriangle size={13} />
                        Conversion notes
                      </div>
                      <div className="space-y-2">
                        {result.warnings.map((warning, index) => (
                          <p key={index} className="text-[9px] leading-relaxed text-amber-100/75">• {warning}</p>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-800 bg-slate-950/95 px-5 py-4">
              <div className="max-w-md text-[9px] leading-relaxed text-slate-500">
                Nothing is uploaded. The importer does not decrypt data.acd or protected KN5 files. A readable KN5 can still be used with the simulator's existing physics.
              </div>
              <button
                onClick={applyImport}
                disabled={!result || (!physicsReady && !visualReady) || isLoadingVisual}
                className="flex h-9 items-center gap-2 rounded-xl bg-emerald-400 px-4 text-[10px] font-black text-slate-950 disabled:cursor-not-allowed disabled:bg-slate-800 disabled:text-slate-600"
              >
                {isLoadingVisual ? <Gauge size={14} className="animate-pulse" /> : <CheckCircle2 size={14} />}
                {applyLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

const Metric: React.FC<{ label: string; value: number; className: string }> = ({ label, value, className }) => (
  <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-2.5 text-center">
    <div className={`text-lg font-black ${className}`}>{value}</div>
    <div className="text-[8px] font-bold uppercase tracking-wider text-slate-600">{label}</div>
  </div>
);

const StatusBadge: React.FC<{ status: AssettoCorsaImportResult['sourceStatus'] }> = ({ status }) => {
  if (status === 'ready') {
    return <span className="rounded-lg border border-emerald-500/25 bg-emerald-500/10 px-2 py-1 text-[8px] font-bold uppercase tracking-wider text-emerald-300">Physics ready</span>;
  }
  if (status === 'needs-unpack') {
    return <span className="rounded-lg border border-amber-500/25 bg-amber-500/10 px-2 py-1 text-[8px] font-bold uppercase tracking-wider text-amber-300">Physics packed</span>;
  }
  return <span className="rounded-lg border border-rose-500/25 bg-rose-500/10 px-2 py-1 text-[8px] font-bold uppercase tracking-wider text-rose-300">No physics found</span>;
};

const MappingRow: React.FC<{ mapping: AcMapping }> = ({ mapping }) => {
  const confidenceClass = mapping.confidence === 'direct'
    ? 'text-emerald-300 border-emerald-500/20 bg-emerald-500/8'
    : mapping.confidence === 'translated'
      ? 'text-sky-300 border-sky-500/20 bg-sky-500/8'
      : 'text-amber-300 border-amber-500/20 bg-amber-500/8';

  return (
    <div className="grid gap-2 border-b border-slate-800/75 px-4 py-2.5 last:border-b-0 sm:grid-cols-[1fr_1fr_auto] sm:items-center">
      <div className="min-w-0">
        <div className="truncate font-mono text-[9px] font-bold text-slate-200">{mapping.target}</div>
        <div className="mt-0.5 truncate text-[8px] text-slate-600">{mapping.source}</div>
      </div>
      <div className="min-w-0 font-mono text-[9px] text-slate-400">{formatValue(mapping.value)}</div>
      <span className={`w-fit rounded-md border px-1.5 py-0.5 text-[7px] font-bold uppercase tracking-wider ${confidenceClass}`}>{mapping.confidence}</span>
      {mapping.note && <div className="text-[8px] leading-relaxed text-slate-600 sm:col-span-3">{mapping.note}</div>}
    </div>
  );
};

function formatValue(value: AcMapping['value']): string {
  if (Array.isArray(value)) return `[${value.map((item) => typeof item === 'number' ? round(item) : item).join(', ')}]`;
  if (typeof value === 'number') return String(round(value));
  return String(value);
}

function round(value: number): number {
  return Math.round(value * 10000) / 10000;
}
