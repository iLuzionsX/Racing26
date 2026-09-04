import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { VehicleConfig, VehicleState, CameraMode } from './types';
import { DEFAULT_VEHICLE_CONFIG, VEHICLE_PRESETS } from './physics/vehiclePresets';
import { BMW_M5_2025_OVERRIDES } from './physics/m5G90';
import { disableM5TwoWheelDrive, enableM5TwoWheelDrive } from './physics/m5DriveMode';
import type { M5XDriveRestoreSnapshot } from './physics/m5DriveMode';
import { VehiclePhysicsEngine } from './physics/vehiclePhysics';
import { updateDigitalSteeringInput } from './physics/DigitalSteeringInput';
import { mouseSteeringFromClientX, type SteeringInputMode } from './physics/MouseSteeringInput';
import { CarRenderer } from './graphics/carRenderer';
import { EnvironmentManager } from './graphics/environment';
import { CameraController } from './graphics/cameraController';
import { globalAudio } from './audio/engineAudio';
import { DashboardUI } from './components/DashboardUI';
import { ControlsOverlay } from './components/ControlsOverlay';
import { TuningModal } from './components/TuningModal';
import { PhysicsTestRunnerModal } from './components/PhysicsTestRunnerModal';
import { AssettoCorsaImportPanel } from './components/AssettoCorsaImportPanel';
import { StartMenu, type DrivingEnvironment } from './components/StartMenu';
import type { Kn5VisualResult } from './graphics/kn5Loader';
import { loadBundledM5Visual } from './graphics/bundledM5Visual';

const INITIAL_PRESET_KEY = 'm5G90';
const INITIAL_CONFIG: VehicleConfig = { ...DEFAULT_VEHICLE_CONFIG, ...BMW_M5_2025_OVERRIDES } as VehicleConfig;
const STEERING_INPUT_STORAGE_KEY = 'racing-game-steering-input-mode';

type ActiveTrackRuntime = {
  group: THREE.Group;
  surfaceProvider: {
    sampleSurface: (x: number, z: number) => any;
    resetHint: (elevation: number) => void;
  };
  spawn: { x: number; z: number; yaw: number; elevation: number };
  dispose: () => void;
};

function shouldDefaultToAutomaticOnMobile() {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;

  const override = new URLSearchParams(window.location.search).get('mobileControls');
  if (override === '0' || override === 'false') return false;
  if (override === '1' || override === 'true') return true;

  const nav = navigator as Navigator & { userAgentData?: { mobile?: boolean } };
  const userAgent = navigator.userAgent || '';
  const platform = navigator.platform || '';
  const uaMobile = nav.userAgentData?.mobile === true || /Android|iPhone|iPod|IEMobile|Opera Mini/i.test(userAgent);
  const iPadLike = /iPad/i.test(userAgent) || (platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const coarsePointer = window.matchMedia('(pointer: coarse)').matches;
  const touchCapable = navigator.maxTouchPoints > 0 || 'ontouchstart' in window;
  const touchSizedViewport = window.innerWidth <= 1180;

  return uaMobile || iPadLike || (coarsePointer && touchCapable && touchSizedViewport);
}

function getInitialSteeringInputMode(): SteeringInputMode {
  if (typeof window === 'undefined') return 'keyboard';
  return window.localStorage.getItem(STEERING_INPUT_STORAGE_KEY) === 'mouse' ? 'mouse' : 'keyboard';
}

function disposeImportedVisual(root: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();

  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    if (object.geometry) geometries.add(object.geometry);
    const meshMaterials = Array.isArray(object.material) ? object.material : [object.material];
    meshMaterials.forEach((material) => {
      if (!material) return;
      materials.add(material);
      const candidate = material as THREE.Material & Record<string, any>;
      ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'alphaMap', 'emissiveMap'].forEach((key) => {
        if (candidate[key] instanceof THREE.Texture) textures.add(candidate[key]);
      });
    });
  });

  geometries.forEach((geometry) => geometry.dispose());
  textures.forEach((texture) => texture.dispose());
  materials.forEach((material) => material.dispose());
}

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const [config, setConfig] = useState<VehicleConfig>(INITIAL_CONFIG);
  const [activePresetKey, setActivePresetKey] = useState<string>(INITIAL_PRESET_KEY);
  const [currentColor, setCurrentColor] = useState<string>('#111827');
  const [cameraMode, setCameraMode] = useState<CameraMode>('chase');
  const [useMph, setUseMph] = useState<boolean>(false);
  const [showTelemetry, setShowTelemetry] = useState<boolean>(true);
  const [isTuningOpen, setIsTuningOpen] = useState<boolean>(false);
  const [isTestRunnerOpen, setIsTestRunnerOpen] = useState<boolean>(false);
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [activeKeys, setActiveKeys] = useState<{ [key: string]: boolean }>({});
  const [steeringInputMode, setSteeringInputMode] = useState<SteeringInputMode>(getInitialSteeringInputMode);
  const [drivingEnvironment, setDrivingEnvironment] = useState<DrivingEnvironment>('plane');
  const [isStartMenuOpen, setIsStartMenuOpen] = useState<boolean>(true);
  const [isTrackLoading, setIsTrackLoading] = useState<boolean>(false);

  const [vehicleTelemetry, setVehicleTelemetry] = useState<VehicleState>(() => {
    const engine = new VehiclePhysicsEngine(INITIAL_CONFIG);
    if (shouldDefaultToAutomaticOnMobile()) engine.state.isAutomatic = true;
    return engine.state;
  });

  const physicsEngineRef = useRef<VehiclePhysicsEngine | null>(null);
  const carRendererRef = useRef<CarRenderer | null>(null);
  const importedVisualRef = useRef<THREE.Group | null>(null);
  const defaultVisualLoadTokenRef = useRef(0);
  const envManagerRef = useRef<EnvironmentManager | null>(null);
  const cameraControllerRef = useRef<CameraController | null>(null);
  const m5XDriveRestoreRef = useRef<M5XDriveRestoreSnapshot | null>(null);
  const keysDownRef = useRef<{ [code: string]: boolean }>({});
  const digitalSteerInputRef = useRef(0);
  const mouseSteerInputRef = useRef(0);
  const steeringInputModeRef = useRef<SteeringInputMode>(steeringInputMode);
  const drivingEnvironmentRef = useRef<DrivingEnvironment>('plane');
  const isStartMenuOpenRef = useRef(true);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const provingGroundObjectsRef = useRef<THREE.Object3D[]>([]);
  const provingSurfaceProviderRef = useRef<any>(null);
  const trackRuntimeRef = useRef<ActiveTrackRuntime | null>(null);
  const touchInputsRef = useRef<{
    throttle: boolean;
    brake: boolean;
    steerLeft: boolean;
    steerRight: boolean;
    handbrake: boolean;
  }>({
    throttle: false,
    brake: false,
    steerLeft: false,
    steerRight: false,
    handbrake: false,
  });

  const setPhysicsSurface = (engine: VehiclePhysicsEngine, provider: any) => {
    // Both references are authoritative in different app paths: Vehicle samples
    // contacts from the latter while engine hydration/telemetry samples the former.
    (engine as any).surfaceProvider = provider;
    engine.simulation.vehicle.surfaceProvider = provider;
  };

  const resetVehicleForActiveEnvironment = (engine: VehiclePhysicsEngine | null = physicsEngineRef.current) => {
    if (!engine) return;

    if (drivingEnvironmentRef.current === 'showcase' && trackRuntimeRef.current) {
      const { spawn, surfaceProvider } = trackRuntimeRef.current;
      surfaceProvider.resetHint(spawn.elevation);
      engine.reset(spawn.x, spawn.z, spawn.yaw);
      // reset() deliberately assumes flat proving-ground height. Track mode raises
      // the physical CG after reset, before suspension initializes its wheel hubs.
      engine.simulation.vehicle.rigidBody.position.y = spawn.elevation + engine.config.centerOfGravityHeight;
    } else {
      engine.reset(0, 0, 0);
    }

    digitalSteerInputRef.current = 0;
    mouseSteerInputRef.current = 0;
    envManagerRef.current?.resetCones();
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x94a3b8);
    sceneRef.current = scene;

    const width = container.clientWidth || window.innerWidth;
    const height = container.clientHeight || window.innerHeight;

    const camera = new THREE.PerspectiveCamera(62, width / height, 0.1, 2000);
    camera.position.set(0, 3.5, -7.5);

    const renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
    });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;

    const physicsEngine = new VehiclePhysicsEngine(config);
    if (shouldDefaultToAutomaticOnMobile()) physicsEngine.state.isAutomatic = true;
    physicsEngineRef.current = physicsEngine;
    provingSurfaceProviderRef.current = physicsEngine.surfaceProvider;

    const carRenderer = new CarRenderer(VEHICLE_PRESETS[activePresetKey]?.color || currentColor);
    carRendererRef.current = carRenderer;
    scene.add(carRenderer.rootGroup);

    loadDefaultM5Visual(INITIAL_CONFIG);

    const beforeEnvironment = new Set(scene.children);
    const envManager = new EnvironmentManager(scene);
    envManagerRef.current = envManager;
    provingGroundObjectsRef.current = scene.children.filter((child) => !beforeEnvironment.has(child));

    const cameraController = new CameraController(camera);
    cameraControllerRef.current = cameraController;

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width: w, height: h } = entry.contentRect;
        if (w > 0 && h > 0) {
          camera.aspect = w / h;
          camera.updateProjectionMatrix();
          renderer.setSize(w, h);
        }
      }
    });
    resizeObserver.observe(container);

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Escape') {
        keysDownRef.current = {};
        setActiveKeys({});
        digitalSteerInputRef.current = 0;
        mouseSteerInputRef.current = 0;
        touchInputsRef.current.throttle = false;
        touchInputsRef.current.brake = false;
        touchInputsRef.current.steerLeft = false;
        touchInputsRef.current.steerRight = false;
        touchInputsRef.current.handbrake = false;
        setDrivingEnvironment(drivingEnvironmentRef.current);
        isStartMenuOpenRef.current = true;
        setIsStartMenuOpen(true);
        return;
      }
      if (isStartMenuOpenRef.current) return;
      keysDownRef.current[e.code] = true;
      setActiveKeys({ ...keysDownRef.current });

      globalAudio.init();

      if (e.code === 'KeyC') {
        const next = cameraController.nextMode();
        setCameraMode(next);
      } else if (e.code === 'KeyR') {
        resetVehicleForActiveEnvironment(physicsEngine);
      } else if (e.code === 'KeyT') {
        setShowTelemetry((prev) => !prev);
      } else if (e.code === 'KeyP') {
        setIsTuningOpen((prev) => !prev);
      } else if (e.code === 'KeyV') {
        physicsEngine.state.showForceVectors3D = !physicsEngine.state.showForceVectors3D;
      } else if (e.code === 'KeyF' || e.code === 'KeyX') {
        physicsEngine.toggleDrs();
      } else if (e.code === 'KeyJ' || e.code === 'KeyK') {
        physicsEngine.triggerClutchKick();
      } else if (e.code === 'KeyU') {
        const muted = globalAudio.toggleMute();
        setIsMuted(muted);
      } else if (e.code === 'KeyM') {
        physicsEngine.state.isAutomatic = !physicsEngine.state.isAutomatic;
      } else if (e.code === 'KeyB') {
        const modes: ('OFF' | 'SPORT' | 'FULL')[] = ['OFF', 'SPORT', 'FULL'];
        const currentIdx = modes.indexOf(physicsEngine.config.absMode);
        const nextMode = modes[(currentIdx + 1) % modes.length];
        physicsEngine.config.absMode = nextMode;
        setConfig({ ...physicsEngine.config });
      } else if (e.code === 'KeyN') {
        const modes: ('OFF' | 'SPORT' | 'FULL')[] = ['OFF', 'SPORT', 'FULL'];
        const currentIdx = modes.indexOf(physicsEngine.config.tcsMode);
        const nextMode = modes[(currentIdx + 1) % modes.length];
        physicsEngine.config.tcsMode = nextMode;
        setConfig({ ...physicsEngine.config });
      } else if (e.code === 'KeyY') {
        setIsTestRunnerOpen((prev) => !prev);
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      keysDownRef.current[e.code] = false;
      setActiveKeys({ ...keysDownRef.current });
    };

    const handlePointerMove = (e: PointerEvent) => {
      if (isStartMenuOpenRef.current) return;
      if (steeringInputModeRef.current !== 'mouse') return;
      const rect = canvas.getBoundingClientRect();
      mouseSteerInputRef.current = mouseSteeringFromClientX(e.clientX, rect.left, rect.width);
    };

    const handlePointerLeave = () => {
      if (steeringInputModeRef.current === 'mouse') mouseSteerInputRef.current = 0;
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    canvas.addEventListener('pointermove', handlePointerMove);
    canvas.addEventListener('pointerleave', handlePointerLeave);

    let animationFrameId: number;
    let lastTime = performance.now();
    let hudUpdateTimer = 0;

    const animate = (currentTime: number) => {
      animationFrameId = requestAnimationFrame(animate);

      const deltaTime = Math.min((currentTime - lastTime) / 1000, 0.05);
      lastTime = currentTime;

      const keys = keysDownRef.current;
      const touches = touchInputsRef.current;
      const inputBlocked = isStartMenuOpenRef.current;

      const isThrottle = !inputBlocked && (keys['KeyW'] || keys['ArrowUp'] || touches.throttle);
      const isBrake = !inputBlocked && (keys['KeyS'] || keys['ArrowDown'] || touches.brake);
      const isLeft = !inputBlocked && (keys['KeyA'] || keys['ArrowLeft'] || touches.steerLeft);
      const isRight = !inputBlocked && (keys['KeyD'] || keys['ArrowRight'] || touches.steerRight);
      const isHandbrake = !inputBlocked && (keys['Space'] || touches.handbrake);

      const throttleInput = isThrottle ? 1.0 : 0;
      const brakeInput = isBrake ? 1.0 : 0;
      const touchSteeringActive = touches.steerLeft || touches.steerRight;
      let steerInput: number;

      if (steeringInputModeRef.current === 'mouse' && !touchSteeringActive && !inputBlocked) {
        // Analog pointer/wheel input directly represents a fraction of the
        // physical steering rack. It intentionally bypasses digital-driver shaping.
        digitalSteerInputRef.current = 0;
        steerInput = mouseSteerInputRef.current;
      } else {
        // Keyboard/touch is binary hardware pretending to be a steering wheel.
        // Shape only the digital driver request: normal cornering follows a
        // speed/curvature envelope, while real oversteer can unlock fast opposite
        // lock. The rack, Ackermann geometry, tire forces and chassis remain physical.
        const steerDirection: -1 | 0 | 1 = isLeft === isRight ? 0 : isLeft ? 1 : -1;
        const rigidBody = physicsEngine.simulation.vehicle.rigidBody;
        const localVelocity = rigidBody.getLocalVelocity();
        const localAngularVelocity = rigidBody.getLocalAngularVelocity();
        const steeringSpeedMs = Math.hypot(localVelocity.x, localVelocity.z);
        const sideslipRad =
          steeringSpeedMs > 0.5
            ? Math.atan2(localVelocity.x, Math.max(0.5, Math.abs(localVelocity.z)))
            : 0;

        digitalSteerInputRef.current = updateDigitalSteeringInput(
          digitalSteerInputRef.current,
          steerDirection,
          steeringSpeedMs,
          deltaTime,
          {
            wheelbaseM: physicsEngine.config.wheelbase,
            maxSteerAngleRad: physicsEngine.config.maxSteerAngle,
            yawRateRadS: localAngularVelocity.y,
            sideslipRad,
            forwardSpeedMs: localVelocity.z,
          }
        );
        steerInput = inputBlocked ? 0 : digitalSteerInputRef.current;
      }

      const shiftUp = !inputBlocked && (keys['ShiftLeft'] || keys['ShiftRight']);
      const shiftDown = !inputBlocked && (keys['ControlLeft'] || keys['ControlRight']);

      // Freeze the simulation while the start menu is visible. Do not advance
      // VehiclePhysicsEngine with zero inputs behind the menu.
      let state = physicsEngine.state;
      if (!inputBlocked) {
        state = physicsEngine.update(deltaTime, {
          throttle: throttleInput,
          brake: brakeInput,
          steer: steerInput,
          handbrake: isHandbrake,
          shiftUp,
          shiftDown,
        });
      }

      carRenderer.update(state, physicsEngine.config);
      if (drivingEnvironmentRef.current === 'plane' && !inputBlocked) {
        envManager.update(deltaTime, state.x, state.z, state.yaw, state.speedMs, state.wheels);
      }
      cameraController.update(deltaTime, state);

      const maxSkid = Math.max(...state.wheels.map((w) => (w.isSkidding ? w.skidIntensity : 0)));
      const kerbRumble = Math.max(...state.wheels.map((w) => (w.surfaceType === 'kerb' ? 1.0 : 0)));
      globalAudio.update(
        state.rpm,
        physicsEngine.config.maxRpm,
        state.throttle,
        state.speedKmh,
        maxSkid,
        state.turboBoostPsi,
        state.turboBlowOff,
        state.absActive,
        state.isRevLimiting,
        state.revCutBounce,
        kerbRumble
      );

      renderer.render(scene, camera);

      hudUpdateTimer += deltaTime;
      if (hudUpdateTimer >= 0.033) {
        hudUpdateTimer = 0;
        setVehicleTelemetry({ ...state });
      }
    };

    animationFrameId = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(animationFrameId);
      resizeObserver.disconnect();
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      canvas.removeEventListener('pointermove', handlePointerMove);
      canvas.removeEventListener('pointerleave', handlePointerLeave);
      defaultVisualLoadTokenRef.current += 1;
      if (importedVisualRef.current) {
        disposeImportedVisual(importedVisualRef.current);
        importedVisualRef.current = null;
      }
      trackRuntimeRef.current?.dispose();
      trackRuntimeRef.current = null;
      sceneRef.current = null;
      renderer.dispose();
    };
  }, []);

  const handleConfigChange = (newConfig: VehicleConfig) => {
    setConfig(newConfig);
    if (physicsEngineRef.current) {
      physicsEngineRef.current.setConfig(newConfig);
    }
  };

  const replaceVisual = (visual: Kn5VisualResult) => {
    const renderer = carRendererRef.current;
    if (!renderer) {
      disposeImportedVisual(visual.group);
      return;
    }

    const previous = importedVisualRef.current;
    if (previous) {
      renderer.chassisGroup.remove(previous);
      disposeImportedVisual(previous);
      importedVisualRef.current = null;
    }

    renderer.chassisGroup.children.forEach((child) => {
      child.visible = false;
    });
    visual.group.visible = true;
    renderer.chassisGroup.add(visual.group);
    importedVisualRef.current = visual.group;
  };

  const loadDefaultM5Visual = (vehicleConfig: VehicleConfig) => {
    const token = ++defaultVisualLoadTokenRef.current;
    void loadBundledM5Visual(vehicleConfig)
      .then((visual) => {
        if (defaultVisualLoadTokenRef.current !== token) {
          disposeImportedVisual(visual.group);
          return;
        }
        replaceVisual(visual);
      })
      .catch((error) => {
        console.warn('[default BMW M5 G90 visual]', error);
      });
  };

  const restoreProceduralBody = () => {
    defaultVisualLoadTokenRef.current += 1;
    const renderer = carRendererRef.current;
    if (!renderer) return;

    const imported = importedVisualRef.current;
    if (imported) {
      renderer.chassisGroup.remove(imported);
      disposeImportedVisual(imported);
      importedVisualRef.current = null;
    }

    renderer.chassisGroup.children.forEach((child) => {
      child.visible = true;
    });
  };

  const handleApplyImportedVisual = (visual: Kn5VisualResult) => {
    defaultVisualLoadTokenRef.current += 1;
    replaceVisual(visual);
  };

  const handleSelectPreset = (presetKey: string) => {
    const preset = VEHICLE_PRESETS[presetKey];
    if (!preset) return;
    m5XDriveRestoreRef.current = null;
    restoreProceduralBody();
    setActivePresetKey(presetKey);
    setCurrentColor(preset.color);
    const mergedConfig: VehicleConfig = {
      ...DEFAULT_VEHICLE_CONFIG,
      ...preset.config,
    };
    handleConfigChange(mergedConfig);

    if (carRendererRef.current) {
      carRendererRef.current.setBodyColor(preset.color);
    }

    if (presetKey === INITIAL_PRESET_KEY) {
      loadDefaultM5Visual(mergedConfig);
    }
  };

  const handleChangeColor = (hexColor: string) => {
    setCurrentColor(hexColor);
    if (carRendererRef.current) {
      carRendererRef.current.setBodyColor(hexColor);
    }
  };

  const handleNextCamera = () => {
    if (cameraControllerRef.current) {
      const next = cameraControllerRef.current.nextMode();
      setCameraMode(next);
    }
  };

  const handleResetCar = () => {
    resetVehicleForActiveEnvironment();
  };

  const handleClearSkidMarks = () => {
    if (envManagerRef.current) {
      envManagerRef.current.clearSkidMarks();
    }
  };

  const handleToggleMute = () => {
    globalAudio.init();
    const muted = globalAudio.toggleMute();
    setIsMuted(muted);
  };

  const handleTouchInput = (action: 'throttle' | 'brake' | 'steerLeft' | 'steerRight' | 'handbrake', active: boolean) => {
    if (isStartMenuOpenRef.current) return;
    globalAudio.init();
    touchInputsRef.current[action] = active;
  };

  const handleSetSteeringInputMode = (mode: SteeringInputMode) => {
    steeringInputModeRef.current = mode;
    setSteeringInputMode(mode);
    digitalSteerInputRef.current = 0;
    mouseSteerInputRef.current = 0;
    if (typeof window !== 'undefined') window.localStorage.setItem(STEERING_INPUT_STORAGE_KEY, mode);
  };

  const handleToggleForceVectors = () => {
    if (physicsEngineRef.current) {
      physicsEngineRef.current.state.showForceVectors3D = !physicsEngineRef.current.state.showForceVectors3D;
    }
  };

  const handleTriggerClutchKick = () => {
    globalAudio.init();
    if (physicsEngineRef.current) {
      physicsEngineRef.current.triggerClutchKick();
    }
  };

  const handleToggleDrs = () => {
    if (physicsEngineRef.current) {
      physicsEngineRef.current.toggleDrs();
    }
  };

  const handleSetM5RwdMode = (enabled: boolean) => {
    if (enabled) {
      if (config.drivetrain === 'RWD') return;
      const entered = enableM5TwoWheelDrive(config as unknown as Record<string, any>);
      m5XDriveRestoreRef.current = entered.restore;
      handleConfigChange(entered.config as unknown as VehicleConfig);
      return;
    }

    if (config.drivetrain === 'AWD' && !m5XDriveRestoreRef.current) return;
    const restored = disableM5TwoWheelDrive(
      config as unknown as Record<string, any>,
      m5XDriveRestoreRef.current
    );
    m5XDriveRestoreRef.current = null;
    handleConfigChange(restored as unknown as VehicleConfig);
  };

  const handleStartEnvironment = async () => {
    const scene = sceneRef.current;
    const engine = physicsEngineRef.current;
    if (!scene || !engine) return;

    if (drivingEnvironment === 'plane') {
      drivingEnvironmentRef.current = 'plane';
      setPhysicsSurface(engine, provingSurfaceProviderRef.current);
      if (trackRuntimeRef.current) {
        trackRuntimeRef.current.dispose();
        trackRuntimeRef.current = null;
      }
      provingGroundObjectsRef.current.forEach((object) => { object.visible = true; });
      scene.background = new THREE.Color(0x94a3b8);
      scene.fog = new THREE.FogExp2(0x94a3b8, 0.0018);
      envManagerRef.current?.clearSkidMarks();
      resetVehicleForActiveEnvironment(engine);
      isStartMenuOpenRef.current = false;
      setIsStartMenuOpen(false);
      return;
    }

    setIsTrackLoading(true);
    try {
      if (!trackRuntimeRef.current) {
        const module = await import('./graphics/tracks/showcaseCircuit');
        trackRuntimeRef.current = module.createShowcaseCircuit(scene) as ActiveTrackRuntime;
      }
      const runtime = trackRuntimeRef.current;
      provingGroundObjectsRef.current.forEach((object) => { object.visible = false; });
      scene.background = new THREE.Color(0x7897aa);
      scene.fog = new THREE.FogExp2(0x7897aa, 0.00135);
      drivingEnvironmentRef.current = 'showcase';
      setPhysicsSurface(engine, runtime.surfaceProvider);
      envManagerRef.current?.clearSkidMarks();
      resetVehicleForActiveEnvironment(engine);
      isStartMenuOpenRef.current = false;
      setIsStartMenuOpen(false);
    } catch (error) {
      console.error('[showcase circuit]', error);
      drivingEnvironmentRef.current = 'plane';
      setDrivingEnvironment('plane');
      setPhysicsSurface(engine, provingSurfaceProviderRef.current);
      provingGroundObjectsRef.current.forEach((object) => { object.visible = true; });
      scene.background = new THREE.Color(0x94a3b8);
      scene.fog = new THREE.FogExp2(0x94a3b8, 0.0018);
      envManagerRef.current?.clearSkidMarks();
      resetVehicleForActiveEnvironment(engine);
    } finally {
      setIsTrackLoading(false);
    }
  };

  return (
    <div
      ref={containerRef}
      id="driving-simulator-app"
      className="relative w-screen h-screen overflow-hidden bg-slate-950 select-none font-sans"
    >
      <canvas
        ref={canvasRef}
        className={`absolute inset-0 block h-full w-full ${steeringInputMode === 'mouse' ? 'cursor-crosshair' : 'cursor-grab active:cursor-grabbing'}`}
      />

      <DashboardUI
        state={vehicleTelemetry}
        config={config}
        useMph={useMph}
        onToggleUnit={() => setUseMph(!useMph)}
        onToggleAuto={() => {
          if (physicsEngineRef.current) {
            physicsEngineRef.current.state.isAutomatic = !physicsEngineRef.current.state.isAutomatic;
          }
        }}
        showTelemetry={showTelemetry}
        onToggleAbs={() => {
          const modes: ('OFF' | 'SPORT' | 'FULL')[] = ['OFF', 'SPORT', 'FULL'];
          const currentIdx = modes.indexOf(config.absMode);
          const nextMode = modes[(currentIdx + 1) % modes.length];
          handleConfigChange({ ...config, absMode: nextMode });
        }}
        onToggleTcs={() => {
          const modes: ('OFF' | 'SPORT' | 'FULL')[] = ['OFF', 'SPORT', 'FULL'];
          const currentIdx = modes.indexOf(config.tcsMode);
          const nextMode = modes[(currentIdx + 1) % modes.length];
          handleConfigChange({ ...config, tcsMode: nextMode });
        }}
        onToggleForceVectors={handleToggleForceVectors}
        onTriggerClutchKick={handleTriggerClutchKick}
        onToggleDrs={handleToggleDrs}
      />

      <ControlsOverlay
        cameraMode={cameraMode}
        onNextCamera={handleNextCamera}
        onReset={handleResetCar}
        onClearSkidMarks={handleClearSkidMarks}
        isMuted={isMuted}
        onToggleMute={handleToggleMute}
        onOpenTuning={() => setIsTuningOpen(true)}
        onOpenTestRunner={() => setIsTestRunnerOpen(true)}
        showTelemetry={showTelemetry}
        onToggleTelemetry={() => setShowTelemetry(!showTelemetry)}
        activePresetKey={activePresetKey}
        onSelectPreset={handleSelectPreset}
        activeKeys={activeKeys}
        onTouchInput={handleTouchInput}
        isAutomatic={vehicleTelemetry.isAutomatic}
        onSetAutomatic={(automatic) => {
          if (physicsEngineRef.current) {
            physicsEngineRef.current.state.isAutomatic = automatic;
            setVehicleTelemetry({ ...physicsEngineRef.current.state });
          }
        }}
        steeringInputMode={steeringInputMode}
        onSetSteeringInputMode={handleSetSteeringInputMode}
        showM5XDriveSetting={activePresetKey === INITIAL_PRESET_KEY}
        isM5RwdMode={config.drivetrain === 'RWD'}
        onSetM5RwdMode={handleSetM5RwdMode}
      />

      <AssettoCorsaImportPanel
        config={config as unknown as Record<string, any>}
        onApply={(importedConfig) => handleConfigChange(importedConfig as VehicleConfig)}
        onApplyVisual={handleApplyImportedVisual}
      />

      <TuningModal
        isOpen={isTuningOpen}
        onClose={() => setIsTuningOpen(false)}
        config={config}
        onSaveConfig={handleConfigChange}
        onSelectPreset={handleSelectPreset}
        currentColor={currentColor}
        onChangeColor={handleChangeColor}
      />

      <PhysicsTestRunnerModal
        isOpen={isTestRunnerOpen}
        onClose={() => setIsTestRunnerOpen(false)}
        config={config}
      />

      <StartMenu
        open={isStartMenuOpen}
        selected={drivingEnvironment}
        isLoadingTrack={isTrackLoading}
        onSelect={setDrivingEnvironment}
        onStart={() => void handleStartEnvironment()}
      />
    </div>
  );
}
