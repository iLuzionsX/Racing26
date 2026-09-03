import * as THREE from 'three';
import { VehicleConfig, VehicleState } from '../types';
import { computeWheelVisualPose } from './wheelVisualPose';
import { BASE_VISUAL_WHEEL_RADIUS_M } from './worldScale';

export class CarRenderer {
  public rootGroup: THREE.Group;
  public chassisPivotGroup: THREE.Group;
  public chassisGroup: THREE.Group;
  public rearWingBlade: THREE.Mesh | null = null;
  public wheelMeshes: THREE.Group[] = [];
  public wheelTires: THREE.Mesh[] = [];
  public brakeDiscs: THREE.Mesh[] = [];
  public brakeLightsMaterial: THREE.MeshStandardMaterial | null = null;
  public headlightsMaterial: THREE.MeshStandardMaterial | null = null;
  public brakeDiscMaterials: THREE.MeshStandardMaterial[] = [];
  public bodyMaterials: THREE.MeshStandardMaterial[] = [];
  public headlightGlows: THREE.SpotLight[] = [];
  public exhaustFlames: THREE.Mesh[] = [];
  public suspensionArms: THREE.Group[] = [];

  // 3D Force Vectors & Dynamic Friction Circle Meshes (4 corners)
  public forceVectorGroups: THREE.Group[] = [];
  public longForceArrows: THREE.ArrowHelper[] = [];
  public latForceArrows: THREE.ArrowHelper[] = [];
  public normForceArrows: THREE.ArrowHelper[] = [];
  public frictionCircles: THREE.Mesh[] = [];
  public frictionPucks: THREE.Mesh[] = [];

  constructor(bodyColor: string = '#2563eb') {
    this.rootGroup = new THREE.Group();
    this.chassisPivotGroup = new THREE.Group();
    this.chassisPivotGroup.rotation.order = 'YXZ';
    this.chassisGroup = new THREE.Group();
    this.chassisPivotGroup.add(this.chassisGroup);
    this.rootGroup.add(this.chassisPivotGroup);

    this.buildCarBody(bodyColor);
    this.buildWheels();
    this.buildLighting();
    this.buildExhaustFlames();
    this.build3DForceVectors();
  }

  public setBodyColor(hexColor: string) {
    const color = new THREE.Color(hexColor);
    this.bodyMaterials.forEach((mat) => {
      mat.color.copy(color);
    });
  }

  private buildCarBody(bodyColor: string) {
    const carColor = new THREE.Color(bodyColor);

    // Primary Body Material (glossy automotive metallic paint with clearcoat look)
    const paintMaterial = new THREE.MeshStandardMaterial({
      color: carColor,
      roughness: 0.22,
      metalness: 0.70,
      envMapIntensity: 1.3,
    });
    this.bodyMaterials.push(paintMaterial);

    const darkTrimMaterial = new THREE.MeshStandardMaterial({
      color: 0x18181b,
      roughness: 0.6,
      metalness: 0.25,
    });

    const carbonMaterial = new THREE.MeshStandardMaterial({
      color: 0x222226,
      roughness: 0.35,
      metalness: 0.4,
    });

    const chromeMaterial = new THREE.MeshStandardMaterial({
      color: 0xf4f4f5,
      roughness: 0.08,
      metalness: 0.95,
    });

    const glassMaterial = new THREE.MeshPhysicalMaterial({
      color: 0x0f172a,
      roughness: 0.08,
      metalness: 0.15,
      transmission: 0.75,
      transparent: true,
      opacity: 0.85,
    });

    const interiorMaterial = new THREE.MeshStandardMaterial({
      color: 0x1e293b,
      roughness: 0.85,
    });

    // --- Main Lower Body / Tub ---
    const lowerBodyGeo = new THREE.BoxGeometry(1.84, 0.46, 4.45);
    const lowerBody = new THREE.Mesh(lowerBodyGeo, paintMaterial);
    lowerBody.position.y = 0.46;
    lowerBody.castShadow = true;
    lowerBody.receiveShadow = true;
    this.chassisGroup.add(lowerBody);

    // Front Hood Slope with Power Bulge
    const hoodGeo = new THREE.BoxGeometry(1.78, 0.24, 1.45);
    const hood = new THREE.Mesh(hoodGeo, paintMaterial);
    hood.position.set(0, 0.59, 1.12);
    hood.rotation.x = 0.08;
    hood.castShadow = true;
    this.chassisGroup.add(hood);

    // Hood Aerodynamic Air Extractor Vent
    const hoodVentGeo = new THREE.BoxGeometry(0.75, 0.04, 0.45);
    const hoodVent = new THREE.Mesh(hoodVentGeo, carbonMaterial);
    hoodVent.position.set(0, 0.72, 1.15);
    hoodVent.rotation.x = 0.08;
    this.chassisGroup.add(hoodVent);

    // Front Splitter / Canards
    const splitterGeo = new THREE.BoxGeometry(1.92, 0.06, 0.55);
    const splitter = new THREE.Mesh(splitterGeo, carbonMaterial);
    splitter.position.set(0, 0.22, 2.2);
    splitter.castShadow = true;
    this.chassisGroup.add(splitter);

    // Rear Aero Diffuser
    const diffuserGeo = new THREE.BoxGeometry(1.88, 0.14, 0.55);
    const diffuser = new THREE.Mesh(diffuserGeo, carbonMaterial);
    diffuser.position.set(0, 0.25, -2.18);
    diffuser.castShadow = true;
    this.chassisGroup.add(diffuser);

    // Dual Exhaust Tips
    for (const side of [-0.55, 0.55]) {
      const exhaustGeo = new THREE.CylinderGeometry(0.075, 0.075, 0.38, 16);
      const exhaust = new THREE.Mesh(exhaustGeo, chromeMaterial);
      exhaust.rotation.x = Math.PI / 2;
      exhaust.position.set(side, 0.26, -2.28);
      this.chassisGroup.add(exhaust);
    }

    // --- Cabin Greenhouse & Fastback Roof ---
    const cabinGeo = new THREE.BoxGeometry(1.54, 0.54, 2.15);
    const cabin = new THREE.Mesh(cabinGeo, paintMaterial);
    cabin.position.set(0, 0.90, -0.15);
    cabin.castShadow = true;
    this.chassisGroup.add(cabin);

    // Roof Panel
    const roofGeo = new THREE.BoxGeometry(1.46, 0.08, 1.45);
    const roof = new THREE.Mesh(roofGeo, carbonMaterial);
    roof.position.set(0, 1.17, -0.22);
    roof.castShadow = true;
    this.chassisGroup.add(roof);

    // Windshield (Front Glass)
    const windshieldGeo = new THREE.BoxGeometry(1.48, 0.60, 0.06);
    const windshield = new THREE.Mesh(windshieldGeo, glassMaterial);
    windshield.position.set(0, 0.88, 0.74);
    windshield.rotation.x = 0.72;
    windshield.castShadow = true;
    this.chassisGroup.add(windshield);

    // Rear Windshield Glass
    const rearGlassGeo = new THREE.BoxGeometry(1.44, 0.55, 0.06);
    const rearGlass = new THREE.Mesh(rearGlassGeo, glassMaterial);
    rearGlass.position.set(0, 0.90, -1.08);
    rearGlass.rotation.x = -0.68;
    this.chassisGroup.add(rearGlass);

    // Side Windows & Mirrors
    for (const side of [-0.75, 0.75]) {
      const sideGlassGeo = new THREE.BoxGeometry(0.05, 0.38, 1.48);
      const sideGlass = new THREE.Mesh(sideGlassGeo, glassMaterial);
      sideGlass.position.set(side, 0.90, -0.15);
      this.chassisGroup.add(sideGlass);

      // Aero Side Mirrors
      const mirrorGeo = new THREE.BoxGeometry(0.24, 0.12, 0.16);
      const mirror = new THREE.Mesh(mirrorGeo, carbonMaterial);
      mirror.position.set(side > 0 ? 0.90 : -0.90, 0.80, 0.64);
      mirror.castShadow = true;
      this.chassisGroup.add(mirror);
    }

    // --- Active Aerodynamic GT Wing (Supports DRS flattening & Airbrake pitch) ---
    const wingBladeGeo = new THREE.BoxGeometry(1.82, 0.05, 0.36);
    const wingBlade = new THREE.Mesh(wingBladeGeo, carbonMaterial);
    wingBlade.position.set(0, 1.06, -2.15);
    wingBlade.rotation.x = -0.08;
    wingBlade.castShadow = true;
    this.chassisGroup.add(wingBlade);
    this.rearWingBlade = wingBlade;

    // Wing Endplates
    for (const side of [-0.91, 0.91]) {
      const endplateGeo = new THREE.BoxGeometry(0.04, 0.22, 0.42);
      const endplate = new THREE.Mesh(endplateGeo, carbonMaterial);
      endplate.position.set(side, 1.05, -2.15);
      endplate.castShadow = true;
      this.chassisGroup.add(endplate);
    }

    // Wing Upright Pylons
    for (const side of [-0.45, 0.45]) {
      const pylonGeo = new THREE.BoxGeometry(0.04, 0.38, 0.15);
      const pylon = new THREE.Mesh(pylonGeo, darkTrimMaterial);
      pylon.position.set(side, 0.86, -2.12);
      pylon.castShadow = true;
      this.chassisGroup.add(pylon);
    }

    // Cockpit Interior Dashboard & Steering Wheel
    const dashGeo = new THREE.BoxGeometry(1.38, 0.30, 0.58);
    const dash = new THREE.Mesh(dashGeo, interiorMaterial);
    dash.position.set(0, 0.67, 0.36);
    this.chassisGroup.add(dash);

    // Racing Steering Wheel
    const steerRingGeo = new THREE.TorusGeometry(0.17, 0.026, 8, 24);
    const steerRing = new THREE.Mesh(steerRingGeo, darkTrimMaterial);
    steerRing.position.set(-0.36, 0.74, 0.13);
    steerRing.rotation.x = 0.36;
    this.chassisGroup.add(steerRing);

    // Front Grille & Intercooler
    const grilleGeo = new THREE.BoxGeometry(1.24, 0.26, 0.08);
    const grille = new THREE.Mesh(grilleGeo, darkTrimMaterial);
    grille.position.set(0, 0.42, 2.24);
    this.chassisGroup.add(grille);

    const intercoolerGeo = new THREE.BoxGeometry(1.10, 0.20, 0.05);
    const intercooler = new THREE.Mesh(intercoolerGeo, chromeMaterial);
    intercooler.position.set(0, 0.42, 2.20);
    this.chassisGroup.add(intercooler);

    // --- Headlights & Taillights ---
    this.headlightsMaterial = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: 0xe0f2fe,
      emissiveIntensity: 1.8,
      roughness: 0.1,
    });

    for (const side of [-0.70, 0.70]) {
      const headGeo = new THREE.BoxGeometry(0.38, 0.12, 0.15);
      const headlight = new THREE.Mesh(headGeo, this.headlightsMaterial);
      headlight.position.set(side, 0.54, 2.20);
      this.chassisGroup.add(headlight);
    }

    this.brakeLightsMaterial = new THREE.MeshStandardMaterial({
      color: 0xef4444,
      emissive: 0x991b1b,
      emissiveIntensity: 0.8,
      roughness: 0.2,
    });

    for (const side of [-0.68, 0.68]) {
      const tailGeo = new THREE.BoxGeometry(0.45, 0.12, 0.12);
      const taillight = new THREE.Mesh(tailGeo, this.brakeLightsMaterial);
      taillight.position.set(side, 0.60, -2.22);
      this.chassisGroup.add(taillight);
    }
  }

  private buildLighting() {
    // Forward Headlight Beam Cones
    for (const side of [-0.65, 0.65]) {
      const spot = new THREE.SpotLight(0xfff5e6, 3.2, 55, Math.PI / 5.5, 0.35, 1.2);
      spot.position.set(side, 0.55, 2.25);
      const target = new THREE.Object3D();
      target.position.set(side * 0.35, 0, 22);
      this.chassisGroup.add(spot);
      this.chassisGroup.add(target);
      spot.target = target;
      this.headlightGlows.push(spot);
    }
  }

  private buildExhaustFlames() {
    const flameGeo = new THREE.ConeGeometry(0.08, 0.55, 12);
    flameGeo.rotateX(-Math.PI / 2);

    const flameMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
    });

    for (const side of [-0.55, 0.55]) {
      const flame = new THREE.Mesh(flameGeo, flameMat.clone());
      flame.position.set(side, 0.26, -2.55);
      this.chassisGroup.add(flame);
      this.exhaustFlames.push(flame);
    }
  }

  private buildWheels() {
    const tireRadius = BASE_VISUAL_WHEEL_RADIUS_M;
    const tireWidth = 0.27;

    const tireGeo = new THREE.CylinderGeometry(tireRadius, tireRadius, tireWidth, 28);
    tireGeo.rotateZ(Math.PI / 2);

    const rimGeo = new THREE.CylinderGeometry(tireRadius * 0.72, tireRadius * 0.72, tireWidth * 1.02, 20);
    rimGeo.rotateZ(Math.PI / 2);

    const spokeGeo = new THREE.BoxGeometry(tireWidth * 1.03, tireRadius * 1.36, 0.045);
    const caliperGeo = new THREE.BoxGeometry(tireWidth * 0.8, 0.13, 0.13);

    const tireMat = new THREE.MeshStandardMaterial({
      color: 0x18181b,
      roughness: 0.85,
      metalness: 0.05,
    });

    const rimMat = new THREE.MeshStandardMaterial({
      color: 0xd4d4d8,
      roughness: 0.18,
      metalness: 0.88,
    });

    const caliperMat = new THREE.MeshStandardMaterial({
      color: 0xdc2626, // Brembo Racing Red
      roughness: 0.25,
      metalness: 0.55,
    });

    for (let i = 0; i < 4; i++) {
      const wheelGroup = new THREE.Group();
      const hubGroup = new THREE.Group();

      // Rubber Tire
      const tire = new THREE.Mesh(tireGeo, tireMat);
      tire.castShadow = true;
      hubGroup.add(tire);
      this.wheelTires.push(tire);

      // Alloy Rim
      const rim = new THREE.Mesh(rimGeo, rimMat);
      rim.castShadow = true;
      hubGroup.add(rim);

      // 5-Spoke Split Pattern
      for (let s = 0; s < 5; s++) {
        const spoke = new THREE.Mesh(spokeGeo, rimMat);
        spoke.rotation.x = (s * Math.PI) / 2.5;
        hubGroup.add(spoke);
      }

      // Carbon-Ceramic Drilled Brake Rotor Disc
      const discGeo = new THREE.CylinderGeometry(tireRadius * 0.62, tireRadius * 0.62, tireWidth * 0.42, 20);
      discGeo.rotateZ(Math.PI / 2);

      const brakeDiscMat = new THREE.MeshStandardMaterial({
        color: 0x71717a,
        roughness: 0.35,
        metalness: 0.92,
        emissive: new THREE.Color(0x000000),
        emissiveIntensity: 0,
      });
      this.brakeDiscMaterials.push(brakeDiscMat);

      const brakeDisc = new THREE.Mesh(discGeo, brakeDiscMat);
      wheelGroup.add(brakeDisc);
      this.brakeDiscs.push(brakeDisc);

      // Brake Caliper
      const caliper = new THREE.Mesh(caliperGeo, caliperMat);
      caliper.position.set(0, 0.13, 0.11);
      caliper.castShadow = true;
      wheelGroup.add(caliper);

      // Wishbone Control Arm
      const armGeo = new THREE.CylinderGeometry(0.02, 0.02, 0.45, 8);
      armGeo.rotateZ(Math.PI / 2);
      const armMat = new THREE.MeshStandardMaterial({ color: 0x3f3f46, roughness: 0.6 });
      const arm = new THREE.Mesh(armGeo, armMat);
      arm.position.set(i % 2 === 0 ? 0.22 : -0.22, 0.08, 0);
      wheelGroup.add(arm);

      wheelGroup.add(hubGroup);
      this.rootGroup.add(wheelGroup);
      this.wheelMeshes.push(wheelGroup);
    }
  }

  private build3DForceVectors() {
    // 3D Visual Force Vectors at each wheel contact patch:
    // - Longitudinal Force Fx (Green/Red)
    // - Lateral Force Fy (Cyan/Orange)
    // - Normal Load Fz (White/Gold)
    // - Friction Circle ground ring + saturation puck
    const circleGeo = new THREE.RingGeometry(0.38, 0.42, 32);
    circleGeo.rotateX(-Math.PI / 2);

    const puckGeo = new THREE.SphereGeometry(0.04, 12, 12);
    const puckMat = new THREE.MeshBasicMaterial({ color: 0xfacc15 });

    for (let i = 0; i < 4; i++) {
      const fvGroup = new THREE.Group();

      // Friction Circle Ring on Ground
      const circleMat = new THREE.MeshBasicMaterial({
        color: 0x38bdf8,
        transparent: true,
        opacity: 0.75,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      const circleMesh = new THREE.Mesh(circleGeo, circleMat);
      circleMesh.position.y = 0.025;
      fvGroup.add(circleMesh);
      this.frictionCircles.push(circleMesh);

      // Puck dot representing current combined slip vector
      const puckMesh = new THREE.Mesh(puckGeo, puckMat.clone());
      puckMesh.position.y = 0.035;
      fvGroup.add(puckMesh);
      this.frictionPucks.push(puckMesh);

      // Longitudinal Force Arrow (Dir +Z forward)
      const arrowLong = new THREE.ArrowHelper(
        new THREE.Vector3(0, 0, 1),
        new THREE.Vector3(0, 0.03, 0),
        0.5,
        0x22c55e,
        0.14,
        0.08
      );
      fvGroup.add(arrowLong);
      this.longForceArrows.push(arrowLong);

      // Lateral Force Arrow (Dir +X right)
      const arrowLat = new THREE.ArrowHelper(
        new THREE.Vector3(1, 0, 0),
        new THREE.Vector3(0, 0.03, 0),
        0.5,
        0x06b6d4,
        0.14,
        0.08
      );
      fvGroup.add(arrowLat);
      this.latForceArrows.push(arrowLat);

      // Normal Load Arrow (Dir +Y up)
      const arrowNorm = new THREE.ArrowHelper(
        new THREE.Vector3(0, 1, 0),
        new THREE.Vector3(0, 0.03, 0),
        0.5,
        0xf1f5f9,
        0.12,
        0.07
      );
      fvGroup.add(arrowNorm);
      this.normForceArrows.push(arrowNorm);

      this.rootGroup.add(fvGroup);
      this.forceVectorGroups.push(fvGroup);
    }
  }

  public update(state: VehicleState, config: VehicleConfig) {
    this.rootGroup.position.set(state.x, state.elevationHeight, state.z);
    this.rootGroup.rotation.y = state.yaw;

    // The renderer now uses the exact same physical CG as the 6-DOF rigid body.
    // Meshes are authored in road-relative coordinates, so translate them by the
    // CG height after placing the rotation pivot at the CG.
    const chassisCgOffset = config.centerOfGravityHeight;
    this.chassisPivotGroup.position.set(0, state.heave + chassisCgOffset, 0);
    this.chassisPivotGroup.rotation.set(state.pitch, 0, state.roll, 'YXZ');
    this.chassisGroup.position.set(0, -chassisCgOffset, 0);
    this.chassisGroup.rotation.set(0, 0, 0);

    // 3. Active Aerodynamic Wing Rotation (DRS vs High Downforce vs Airbrake Pitch)
    if (this.rearWingBlade) {
      if (state.airbrakeActive) {
        // Pop wing up 38 degrees into airbrake mode
        this.rearWingBlade.rotation.x = 0.58;
      } else if (state.drsActive) {
        // Flatten wing to reduce drag by 40%
        this.rearWingBlade.rotation.x = 0.0;
      } else {
        // Standard downforce angle
        this.rearWingBlade.rotation.x = -0.12;
      }
    }

    // 4. Update 4 Wheels with dynamic multi-link camber, steer articulation, and Force Vectors
    state.wheels.forEach((wheel, idx) => {
      const wheelGroup = this.wheelMeshes[idx];
      if (!wheelGroup) return;

      // Geometry is authored at 0.33 m radius, but the active vehicle's physical
      // wheel radius is the visual source of truth. For the G90 this is 0.369 m,
      // so the old renderer understated wheel/car scale by about 11.8%.
      const physicalWheelRadius = Number.isFinite(config.wheelRadius) && config.wheelRadius > 0
        ? config.wheelRadius
        : BASE_VISUAL_WHEEL_RADIUS_M;
      const wheelVisualScale = physicalWheelRadius / BASE_VISUAL_WHEEL_RADIUS_M;
      wheelGroup.scale.setScalar(wheelVisualScale);

      const camberRad = (wheel.camberAngleDeg * Math.PI) / 180;
      const crashPose = computeWheelVisualPose({
        chassisHeaveM: state.heave, chassisPitchRad: state.pitch, chassisRollRad: state.roll,
        mountX: wheel.localPos.x, mountZ: wheel.localPos.z, suspensionTravelM: wheel.verticalTravelM,
        tireSquishM: wheel.tireSquishM, sidewallDeflectionM: wheel.sidewallDeflection,
        isLeft: wheel.isLeft, camberRad, visualWheelRadiusM: physicalWheelRadius,
      });
      const hub = (wheel as any).hubWorldPos as { x: number; y: number; z: number } | undefined;
      if (hub && Number.isFinite(hub.x) && Number.isFinite(hub.y) && Number.isFinite(hub.z)) {
        const dx = hub.x - state.x;
        const dz = hub.z - state.z;
        const c = Math.cos(state.yaw);
        const s = Math.sin(state.yaw);
        wheelGroup.position.set(c * dx - s * dz, hub.y - state.elevationHeight, s * dx + c * dz);
      } else {
        wheelGroup.position.set(crashPose.x, crashPose.y, crashPose.z);
      }
      wheelGroup.rotation.set(crashPose.rotationX, wheel.steerAngle, crashPose.rotationZ, 'YXZ');

      // Spinning wheel hub (child index 4 in wheelGroup)
      const hubGroup = wheelGroup.children[4] as THREE.Group;
      if (hubGroup) {
        hubGroup.rotation.x = wheel.rotationAngle;
      }

      // Brake Rotor Thermal Glow
      const discMat = this.brakeDiscMaterials[idx];
      if (discMat) {
        if (wheel.brakeRotorTemp > 250) {
          const glowProgress = Math.min(1.0, (wheel.brakeRotorTemp - 250) / 450);
          const r = 1.0;
          const g = Math.min(0.6, glowProgress * 0.7);
          const b = 0.05;
          discMat.emissive.setRGB(r, g, b);
          discMat.emissiveIntensity = glowProgress * 2.8;
        } else {
          discMat.emissiveIntensity = 0;
        }
      }

      // 5. Update 3D Force Vectors and Friction Ellipses
      const fvGroup = this.forceVectorGroups[idx];
      if (fvGroup) {
        fvGroup.visible = !!state.showForceVectors3D;
        if (state.showForceVectors3D) {
          // Position vector group at wheel local coordinate on the ground
          fvGroup.position.set(wheel.localPos.x, 0.01, wheel.localPos.z);

          // Longitudinal Force Arrow (Fx)
          const fx = Number.isFinite(wheel.forceVectorLong) ? wheel.forceVectorLong : 0;
          const longMag = Math.min(1.6, Math.abs(fx) / 2400);
          const arrowLong = this.longForceArrows[idx];
          if (arrowLong) {
            arrowLong.visible = longMag > 0.04;
            if (longMag > 0.04) {
              const dirLong = fx >= 0 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 0, -1);
              arrowLong.setDirection(dirLong);
              arrowLong.setLength(longMag, Math.min(longMag * 0.35, 0.12), Math.min(longMag * 0.25, 0.07));
              arrowLong.setColor(fx >= 0 ? 0x22c55e : 0xef4444); // Green accel / Red brake
            }
          }

          // Lateral Force Arrow (Fy)
          const fy = Number.isFinite(wheel.forceVectorLat) ? wheel.forceVectorLat : 0;
          const latMag = Math.min(1.6, Math.abs(fy) / 2400);
          const arrowLat = this.latForceArrows[idx];
          if (arrowLat) {
            arrowLat.visible = latMag > 0.04;
            if (latMag > 0.04) {
              const dirLat = fy >= 0 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(-1, 0, 0);
              arrowLat.setDirection(dirLat);
              arrowLat.setLength(latMag, Math.min(latMag * 0.35, 0.12), Math.min(latMag * 0.25, 0.07));
              // Cyan when gripping, Bright Orange when sliding
              arrowLat.setColor(wheel.isSkidding ? 0xf97316 : 0x06b6d4);
            }
          }

          // Normal Force Arrow (Fz)
          const fz = Number.isFinite(wheel.forceVectorNorm) ? wheel.forceVectorNorm : 0;
          const normMag = Math.min(1.2, Math.max(0.01, (fz / (config.mass * 9.81 * 0.45)) * 0.65));
          const arrowNorm = this.normForceArrows[idx];
          if (arrowNorm) {
            arrowNorm.visible = normMag > 0.04;
            if (arrowNorm.visible) {
              arrowNorm.setLength(normMag, Math.min(normMag * 0.35, 0.10), Math.min(normMag * 0.25, 0.06));
              if (wheel.bumpStopEngaged) {
                arrowNorm.setColor(0xf43f5e); // Rose red when hitting bump stop
              } else {
                arrowNorm.setColor(0xf8fafc); // Crisp white under normal travel
              }
            }
          }

          // Friction Puck inside Friction Ring
          const puck = this.frictionPucks[idx];
          if (puck) {
            const scaleFactor = 0.38; // Maps max friction to ring radius (0.4m)
            const puckX = Math.max(-0.45, Math.min(0.45, (fy / 4500) * scaleFactor));
            const puckZ = Math.max(-0.45, Math.min(0.45, (fx / 4500) * scaleFactor));
            puck.position.set(Number.isFinite(puckX) ? puckX : 0, 0.035, Number.isFinite(puckZ) ? puckZ : 0);
            const puckMat = puck.material as THREE.MeshBasicMaterial;
            if (wheel.gripUtilization >= 0.95) {
              puckMat.color.setHex(0xef4444); // Red: Friction envelope breached (skidding)
            } else if (wheel.gripUtilization >= 0.75) {
              puckMat.color.setHex(0xfacc15); // Yellow: Approaching limit of adhesion
            } else {
              puckMat.color.setHex(0x22c55e); // Green: Linear elastic grip zone
            }
          }
        }
      }
    });

    // 6. Update Taillights & Reverse lights
    if (this.brakeLightsMaterial) {
      if (state.brake > 0.05 || state.handbrake || state.absActive) {
        this.brakeLightsMaterial.emissive.setHex(0xff0000);
        this.brakeLightsMaterial.emissiveIntensity = 3.5;
      } else if (state.gear === -1) {
        this.brakeLightsMaterial.emissive.setHex(0xffffff);
        this.brakeLightsMaterial.emissiveIntensity = 2.2;
      } else {
        this.brakeLightsMaterial.emissive.setHex(0x991b1b);
        this.brakeLightsMaterial.emissiveIntensity = 0.75;
      }
    }

    // 7. Update Turbo Exhaust Backfire Flames
    this.exhaustFlames.forEach((flame) => {
      const mat = flame.material as THREE.MeshBasicMaterial;
      if (state.exhaustFlameIntensity > 0.05) {
        mat.opacity = state.exhaustFlameIntensity * 0.95;
        const scaleZ = 0.8 + state.exhaustFlameIntensity * 0.8 + Math.random() * 0.4;
        const scaleXY = 0.9 + Math.random() * 0.4;
        flame.scale.set(scaleXY, scaleXY, scaleZ);
        mat.color.setHex(Math.random() > 0.4 ? 0x38bdf8 : 0xf97316);
      } else {
        mat.opacity = 0;
      }
    });
  }
}
