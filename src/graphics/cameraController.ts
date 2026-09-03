import * as THREE from 'three';
import { CameraMode, VehicleState } from '../types';
import { targetVerticalFov } from './cameraProjection';

export class CameraController {
  public camera: THREE.PerspectiveCamera;
  public mode: CameraMode = 'chase';

  // Smoothed camera target and positions
  private currentPos: THREE.Vector3 = new THREE.Vector3(0, 4, -8);
  private currentLookAt: THREE.Vector3 = new THREE.Vector3(0, 1, 4);
  private currentFov: number = 52;

  // Orbit controls
  private orbitAngle: number = 0;
  private orbitPitch: number = 0.35;
  private orbitDistance: number = 7.5;
  private isDragging: boolean = false;
  private lastMouseX: number = 0;
  private lastMouseY: number = 0;

  constructor(camera: THREE.PerspectiveCamera) {
    this.camera = camera;
    this.currentFov = targetVerticalFov('chase', 0, camera.aspect);
    this.camera.fov = this.currentFov;
    this.camera.updateProjectionMatrix();
    this.setupMouseEvents();
  }

  private setupMouseEvents() {
    window.addEventListener('mousedown', (e) => {
      if (e.target instanceof HTMLCanvasElement) {
        this.isDragging = true;
        this.lastMouseX = e.clientX;
        this.lastMouseY = e.clientY;
      }
    });

    window.addEventListener('mouseup', () => {
      this.isDragging = false;
    });

    window.addEventListener('mousemove', (e) => {
      if (this.isDragging && (this.mode === 'orbit' || this.mode === 'chase')) {
        const dx = e.clientX - this.lastMouseX;
        const dy = e.clientY - this.lastMouseY;
        this.lastMouseX = e.clientX;
        this.lastMouseY = e.clientY;

        this.orbitAngle -= dx * 0.006;
        this.orbitPitch = Math.max(0.05, Math.min(Math.PI / 2.2, this.orbitPitch + dy * 0.006));
      }
    });

    window.addEventListener('wheel', (e) => {
      if (this.mode === 'orbit') {
        this.orbitDistance = Math.max(3.5, Math.min(22, this.orbitDistance + e.deltaY * 0.01));
      }
    });
  }

  public setMode(mode: CameraMode) {
    this.mode = mode;
  }

  public nextMode(): CameraMode {
    const modes: CameraMode[] = ['chase', 'close', 'hood', 'cockpit', 'drift', 'orbit'];
    const idx = modes.indexOf(this.mode);
    this.mode = modes[(idx + 1) % modes.length];
    return this.mode;
  }

  public update(dt: number, state: VehicleState) {
    const carPos = new THREE.Vector3(state.x, state.y, state.z);
    const speedKmh = state.speedKmh;
    const sinYaw = Math.sin(state.yaw);
    const cosYaw = Math.cos(state.yaw);

    // Right-handed vehicle frame: +Z forward, +X left, so vehicle-right is -X at zero yaw.
    const forward = new THREE.Vector3(sinYaw, 0, cosYaw);
    const right = new THREE.Vector3(-cosYaw, 0, sinYaw);

    let targetPos = new THREE.Vector3();
    let targetLookAt = new THREE.Vector3();

    // Three.js PerspectiveCamera.fov is VERTICAL FOV. Author the driving cameras
    // in horizontal FOV and convert using the live viewport aspect ratio so a
    // metre has the same perspective scale on 16:9, ultrawide, and mobile.
    const targetFov = targetVerticalFov(this.mode, speedKmh, this.camera.aspect);

    switch (this.mode) {
      case 'chase': {
        // Position behind car with dynamic lookahead.
        const chaseDist = 6.8 + Math.min(2.0, speedKmh * 0.012);
        const chaseHeight = 2.4 - state.pitch * 1.5; // pitch compensation

        // Lookahead into turns
        const steerOffset = right.clone().multiplyScalar(state.actualSteerAngle * 1.2);
        targetPos = carPos
          .clone()
          .sub(forward.clone().multiplyScalar(chaseDist))
          .add(new THREE.Vector3(0, chaseHeight, 0))
          .add(steerOffset);

        targetLookAt = carPos
          .clone()
          .add(forward.clone().multiplyScalar(4.5))
          .add(new THREE.Vector3(0, 0.9, 0));
        break;
      }

      case 'close': {
        const chaseDist = 4.6;
        const chaseHeight = 1.45;

        targetPos = carPos
          .clone()
          .sub(forward.clone().multiplyScalar(chaseDist))
          .add(new THREE.Vector3(0, chaseHeight, 0));

        targetLookAt = carPos
          .clone()
          .add(forward.clone().multiplyScalar(3.0))
          .add(new THREE.Vector3(0, 0.6, 0));
        break;
      }

      case 'hood': {
        // Rigidly attached to hood
        targetPos = carPos
          .clone()
          .add(forward.clone().multiplyScalar(0.8))
          .add(new THREE.Vector3(0, 0.82 + state.heave, 0));

        targetLookAt = carPos
          .clone()
          .add(forward.clone().multiplyScalar(22))
          .add(new THREE.Vector3(0, 0.7, 0));
        break;
      }

      case 'cockpit': {
        // Driver's eye view inside cabin (-0.35 left, 0.95 high, 0.1 forward)
        const driverOffset = right.clone().multiplyScalar(-0.35).add(forward.clone().multiplyScalar(0.1));
        targetPos = carPos
          .clone()
          .add(driverOffset)
          .add(new THREE.Vector3(0, 0.98 + state.heave, 0));

        targetLookAt = carPos
          .clone()
          .add(driverOffset)
          .add(forward.clone().multiplyScalar(15))
          .add(new THREE.Vector3(0, 0.9, 0));
        break;
      }

      case 'drift': {
        // Wide high-angle cinematic camera highlighting tire smoke
        const slipDir = state.vx > 0 ? 1 : -1;
        const angleOffset = right.clone().multiplyScalar(slipDir * 3.8);
        targetPos = carPos
          .clone()
          .sub(forward.clone().multiplyScalar(7.5))
          .add(angleOffset)
          .add(new THREE.Vector3(0, 3.2, 0));

        targetLookAt = carPos.clone().add(new THREE.Vector3(0, 0.8, 0));
        break;
      }

      case 'orbit': {
        const radius = this.orbitDistance;
        const ox = Math.sin(this.orbitAngle) * Math.cos(this.orbitPitch) * radius;
        const oy = Math.sin(this.orbitPitch) * radius;
        const oz = Math.cos(this.orbitAngle) * Math.cos(this.orbitPitch) * radius;

        targetPos = carPos.clone().add(new THREE.Vector3(ox, Math.max(0.5, oy), oz));
        targetLookAt = carPos.clone().add(new THREE.Vector3(0, 0.7, 0));
        break;
      }
    }

    // Smooth camera lerp
    const lerpRate = this.mode === 'hood' || this.mode === 'cockpit' ? 0.45 : 0.12;
    this.currentPos.lerp(targetPos, Math.min(1.0, dt * (lerpRate * 60)));
    this.currentLookAt.lerp(targetLookAt, Math.min(1.0, dt * (lerpRate * 60)));

    this.currentFov += (targetFov - this.currentFov) * Math.min(1.0, dt * 8);
    this.camera.fov = this.currentFov;
    this.camera.updateProjectionMatrix();

    this.camera.position.copy(this.currentPos);

    // Explicitly maintain upright camera vector and apply subtle chassis roll compliance
    const rollAngle = (this.mode === 'chase' || this.mode === 'cockpit') ? -state.roll * 0.35 : 0;
    this.camera.up.set(-Math.sin(rollAngle), Math.cos(rollAngle), 0);
    this.camera.lookAt(this.currentLookAt);
  }
}
