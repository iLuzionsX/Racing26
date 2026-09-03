import * as THREE from 'three';
import { WheelState } from '../types';
import { ProvingGroundSurfaceProvider } from '../physics/SurfaceProvider';
import {
  GROUND_MINOR_GRID_M,
  GROUND_TEXTURE_TILE_M,
  MAIN_TEST_LANE_HALF_WIDTH_M,
  MAIN_TEST_LANE_WIDTH_M,
  PROVING_GROUND_SIZE_M,
} from './worldScale';

export class EnvironmentManager {
  public scene: THREE.Scene;
  public groundMesh: THREE.Mesh;
  public skidMarksGroup: THREE.Group;
  public conesGroup: THREE.Group;
  public kerbsGroup: THREE.Group;
  public gantryGroup: THREE.Group;
  public smokeParticles: { mesh: THREE.Mesh; life: number; maxLife: number; vx: number; vy: number; vz: number; size: number }[] = [];
  public cones: { mesh: THREE.Group; x: number; z: number; vx: number; vz: number; rotX: number; rotZ: number; isHit: boolean }[] = [];

  private lastSkidPoints: { [key: string]: THREE.Vector3 | null } = {
    FL: null,
    FR: null,
    RL: null,
    RR: null,
  };

  private smokeGeo: THREE.SphereGeometry;
  private smokeMat: THREE.MeshBasicMaterial;
  private readonly surfaceProvider = new ProvingGroundSurfaceProvider();

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.skidMarksGroup = new THREE.Group();
    this.conesGroup = new THREE.Group();
    this.kerbsGroup = new THREE.Group();
    this.gantryGroup = new THREE.Group();

    this.scene.add(this.skidMarksGroup);
    this.scene.add(this.conesGroup);
    this.scene.add(this.kerbsGroup);
    this.scene.add(this.gantryGroup);

    this.smokeGeo = new THREE.SphereGeometry(0.35, 8, 8);
    this.smokeMat = new THREE.MeshBasicMaterial({
      color: 0xf1f5f9,
      transparent: true,
      opacity: 0.48,
      depthWrite: false,
    });

    this.groundMesh = this.buildGround();
    this.setupLighting();
    this.buildTrackMarkings();
    // Flat test map: no raised decorative kerbs.
    this.buildDragStripGantry();
    this.buildTestSlalomCones();
  }

  private buildGround(): THREE.Mesh {
    // Literal metre-scale flat plane. No hidden terrain geometry.
    const groundGeo = new THREE.PlaneGeometry(PROVING_GROUND_SIZE_M, PROVING_GROUND_SIZE_M, 1, 1);
    groundGeo.rotateX(-Math.PI / 2);

    // Procedural Asphalt Texture using Canvas
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;
    const ctx = canvas.getContext('2d')!;

    ctx.fillStyle = '#22252a';
    ctx.fillRect(0, 0, 512, 512);

    // Subtle noise for asphalt grain
    for (let i = 0; i < 22000; i++) {
      const x = Math.random() * 512;
      const y = Math.random() * 512;
      const val = Math.floor(28 + Math.random() * 26);
      ctx.fillStyle = `rgb(${val},${val + 2},${val + 4})`;
      ctx.fillRect(x, y, 1.5, 1.5);
    }

    // Ground grid is a real ruler: 5 m minor spacing inside a 20 m texture tile.
    // The old texture produced 2.5 m lines without documenting the distance cue.
    const pixelsPerMeter = 512 / GROUND_TEXTURE_TILE_M;
    const minorGridStepPx = GROUND_MINOR_GRID_M * pixelsPerMeter;
    ctx.strokeStyle = '#30353c';
    ctx.lineWidth = 1;
    for (let i = minorGridStepPx; i < 512; i += minorGridStepPx) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i, 512);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(0, i);
      ctx.lineTo(512, i);
      ctx.stroke();
    }
    ctx.strokeStyle = '#3a4048';
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, 510, 510);

    const groundTex = new THREE.CanvasTexture(canvas);
    groundTex.wrapS = THREE.RepeatWrapping;
    groundTex.wrapT = THREE.RepeatWrapping;
    const tileRepeats = PROVING_GROUND_SIZE_M / GROUND_TEXTURE_TILE_M;
    groundTex.repeat.set(tileRepeats, tileRepeats);

    const groundMat = new THREE.MeshStandardMaterial({
      map: groundTex,
      roughness: 0.88,
      metalness: 0.12,
    });

    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.receiveShadow = true;
    this.scene.add(ground);
    return ground;
  }

  private setupLighting() {
    // Soft Ambient Sky Light
    const hemiLight = new THREE.HemisphereLight(0xe0f2fe, 0x1e293b, 0.75);
    this.scene.add(hemiLight);

    // Main Sunlight
    const sunLight = new THREE.DirectionalLight(0xfffbeb, 1.4);
    sunLight.position.set(65, 110, 50);
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.width = 2048;
    sunLight.shadow.mapSize.height = 2048;
    sunLight.shadow.camera.near = 10;
    sunLight.shadow.camera.far = 350;
    sunLight.shadow.camera.left = -70;
    sunLight.shadow.camera.right = 70;
    sunLight.shadow.camera.top = 70;
    sunLight.shadow.camera.bottom = -70;
    sunLight.shadow.bias = -0.0004;
    this.scene.add(sunLight);

    // Atmospheric Horizon Fog
    this.scene.fog = new THREE.FogExp2(0x94a3b8, 0.0018);
  }

  private buildTrackMarkings() {
    const markingsGroup = new THREE.Group();
    const whiteMat = new THREE.MeshBasicMaterial({ color: 0xf8fafc, side: THREE.DoubleSide });
    const yellowMat = new THREE.MeshBasicMaterial({ color: 0xfacc15, side: THREE.DoubleSide });
    const redMat = new THREE.MeshBasicMaterial({ color: 0xef4444, side: THREE.DoubleSide });

    // 1. Long Drag Strip / Acceleration Runway (Center Runway 1000m)
    for (let z = -500; z <= 500; z += 16) {
      const dashGeo = new THREE.PlaneGeometry(0.45, 8.5);
      dashGeo.rotateX(-Math.PI / 2);
      const dash = new THREE.Mesh(dashGeo, whiteMat);
      const road = this.surfaceProvider.sampleSurface(0, z);
      dash.position.set(0, road.elevation + 0.016, z);
      dash.rotation.x = -road.slopePitch;
      markingsGroup.add(dash);
    }

    // Match the visible main test-lane edges to the same |x| <= 6.5 m high-grip
    // zone used by SurfaceProvider. The old +/-18 m lines visually implied a 36 m road.
    for (const x of [-MAIN_TEST_LANE_HALF_WIDTH_M, MAIN_TEST_LANE_HALF_WIDTH_M]) {
      for (let z = -496; z <= 496; z += 8) {
        const lineGeo = new THREE.PlaneGeometry(0.38, 8.2);
        lineGeo.rotateX(-Math.PI / 2);
        const line = new THREE.Mesh(lineGeo, whiteMat);
        const road = this.surfaceProvider.sampleSurface(x, z);
        line.position.set(x, road.elevation + 0.016, z);
        line.rotation.x = -road.slopePitch;
        markingsGroup.add(line);
      }
    }

    // Drag Strip Staging Line & 1/4 Mile Finish Lines (at 0m, 100m, 200m, 402.3m)
    const addTrapLine = (zPos: number, labelColor: THREE.Material) => {
      const trapGeo = new THREE.PlaneGeometry(MAIN_TEST_LANE_WIDTH_M, 1.8);
      trapGeo.rotateX(-Math.PI / 2);
      const trap = new THREE.Mesh(trapGeo, labelColor);
      const road = this.surfaceProvider.sampleSurface(0, zPos);
      trap.position.set(0, road.elevation + 0.018, zPos);
      trap.rotation.x = -road.slopePitch;
      markingsGroup.add(trap);
    };

    addTrapLine(0, whiteMat); // Start / Staging Line
    addTrapLine(100, yellowMat); // 100m trap
    addTrapLine(201.16, yellowMat); // 1/8 Mile trap
    addTrapLine(402.34, redMat); // 1/4 Mile (402m) Finish Trap

    // 2. Meter-calibrated skidpad rings. The red 20 m ring is intentionally close
    // to the reported 50 km/h turn radius so the player has an immediate visual ruler.
    const createRing = (radius: number, centerX: number, centerZ: number, mat: THREE.Material) => {
      const ringGeo = new THREE.RingGeometry(radius - 0.4, radius + 0.4, 64);
      ringGeo.rotateX(-Math.PI / 2);
      const ring = new THREE.Mesh(ringGeo, mat);
      ring.position.set(centerX, 0.016, centerZ);
      markingsGroup.add(ring);
    };

    // Skidpad Arena 1 (Left, Dry High Grip, Center X: -85, Z: 60)
    createRing(20, -85, 60, redMat);
    createRing(30, -85, 60, yellowMat);
    createRing(50, -85, 60, whiteMat);
    createRing(75, -85, 60, whiteMat);

    // Skidpad Arena 2 (Right, Wet / Polished Concrete, Center X: 85, Z: -60)
    const wetSurfaceGeo = new THREE.CircleGeometry(78, 48);
    wetSurfaceGeo.rotateX(-Math.PI / 2);
    const wetSurfaceMat = new THREE.MeshStandardMaterial({
      color: 0x1e293b,
      roughness: 0.12,
      metalness: 0.85,
      transparent: true,
      opacity: 0.88,
    });
    const wetSurface = new THREE.Mesh(wetSurfaceGeo, wetSurfaceMat);
    wetSurface.position.set(85, 0.012, -60);
    markingsGroup.add(wetSurface);

    createRing(20, 85, -60, redMat);
    createRing(30, 85, -60, yellowMat);
    createRing(50, 85, -60, whiteMat);
    createRing(75, 85, -60, whiteMat);

    this.scene.add(markingsGroup);
  }

  private build3DKerbs() {
    // 3D Alternating Red & White Raised Apex Kerbs / Rumble Strips
    const redKerbMat = new THREE.MeshStandardMaterial({ color: 0xdc2626, roughness: 0.5 });
    const whiteKerbMat = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.4 });

    const createKerbCurve = (centerX: number, centerZ: number, radius: number, startAngle: number, endAngle: number) => {
      const step = 0.08;
      let isRed = true;
      for (let a = startAngle; a < endAngle; a += step) {
        const x = centerX + Math.cos(a) * radius;
        const z = centerZ + Math.sin(a) * radius;
        const kerbGeo = new THREE.BoxGeometry(0.8, 0.06, 1.2);
        const kerb = new THREE.Mesh(kerbGeo, isRed ? redKerbMat : whiteKerbMat);
        kerb.position.set(x, 0.03, z);
        kerb.rotation.y = -a + Math.PI / 2;
        kerb.castShadow = true;
        this.kerbsGroup.add(kerb);
        isRed = !isRed;
      }
    };

    // Apex Kerbs along Skidpads and Runway ends
    createKerbCurve(-85, 60, 31, 0, Math.PI);
    createKerbCurve(85, -60, 31, Math.PI, Math.PI * 2);
  }

  private buildDragStripGantry() {
    // 1/4 Mile Starting Gantry & Christmas Tree Tower
    const metalMat = new THREE.MeshStandardMaterial({ color: 0x475569, metalness: 0.8, roughness: 0.3 });
    const yellowLightMat = new THREE.MeshBasicMaterial({ color: 0xfacc15 });
    const greenLightMat = new THREE.MeshBasicMaterial({ color: 0x22c55e });

    // Gantry Overhead Arch spans the wider proving-ground apron; it is not a road-width ruler.
    const pillarGeo = new THREE.BoxGeometry(0.5, 6.5, 0.5);
    const p1 = new THREE.Mesh(pillarGeo, metalMat);
    p1.position.set(-18, 3.25, 0);
    this.gantryGroup.add(p1);

    const p2 = new THREE.Mesh(pillarGeo, metalMat);
    p2.position.set(18, 3.25, 0);
    this.gantryGroup.add(p2);

    const beamGeo = new THREE.BoxGeometry(36.5, 0.6, 0.6);
    const beam = new THREE.Mesh(beamGeo, metalMat);
    beam.position.set(0, 6.5, 0);
    this.gantryGroup.add(beam);

    // Center Christmas Tree Signal Post
    const treePoleGeo = new THREE.CylinderGeometry(0.12, 0.12, 4.2, 12);
    const treePole = new THREE.Mesh(treePoleGeo, metalMat);
    treePole.position.set(0, 2.1, 4.0);
    this.gantryGroup.add(treePole);

    // Tree Stage Lights
    for (let i = 0; i < 3; i++) {
      const lightGeo = new THREE.SphereGeometry(0.14, 12, 12);
      const light = new THREE.Mesh(lightGeo, yellowLightMat);
      light.position.set(0, 3.2 - i * 0.4, 4.0);
      this.gantryGroup.add(light);
    }
    const greenLight = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 12), greenLightMat);
    greenLight.position.set(0, 1.8, 4.0);
    this.gantryGroup.add(greenLight);
  }

  private buildTestSlalomCones() {
    const coneGeo = new THREE.ConeGeometry(0.25, 0.72, 12);
    const baseGeo = new THREE.BoxGeometry(0.5, 0.05, 0.5);

    const orangeMat = new THREE.MeshStandardMaterial({
      color: 0xf97316,
      roughness: 0.35,
      metalness: 0.1,
    });
    const whiteStripeMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.3,
    });

    const createCone = (x: number, z: number) => {
      const group = new THREE.Group();
      const cone = new THREE.Mesh(coneGeo, orangeMat);
      cone.position.y = 0.36;
      cone.castShadow = true;
      group.add(cone);

      const base = new THREE.Mesh(baseGeo, orangeMat);
      base.position.y = 0.025;
      group.add(base);

      const stripeGeo = new THREE.CylinderGeometry(0.16, 0.20, 0.18, 12);
      const stripe = new THREE.Mesh(stripeGeo, whiteStripeMat);
      stripe.position.y = 0.36;
      group.add(stripe);

      group.position.set(x, this.surfaceProvider.sampleSurface(x, z).elevation, z);
      this.conesGroup.add(group);

      this.cones.push({
        mesh: group,
        x,
        z,
        vx: 0,
        vz: 0,
        rotX: 0,
        rotZ: 0,
        isHit: false,
      });
    };

    // Slalom row along Z axis (z = -220 to 220, spaced 26m apart)
    for (let z = -220; z <= 220; z += 26) {
      if (Math.abs(z) < 14) continue;
      createCone(0, z);
    }

    // Skidpad perimeter cones
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 8) {
      createCone(-85 + Math.cos(a) * 30, 60 + Math.sin(a) * 30);
    }
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 8) {
      createCone(85 + Math.cos(a) * 30, -60 + Math.sin(a) * 30);
    }
  }

  public addSkidMarkSegment(wheelId: string, currentPos: THREE.Vector3, intensity: number) {
    const lastPos = this.lastSkidPoints[wheelId];
    if (lastPos && lastPos.distanceTo(currentPos) > 0.25 && lastPos.distanceTo(currentPos) < 4.5) {
      const dir = new THREE.Vector3().subVectors(currentPos, lastPos).normalize();
      const normal = new THREE.Vector3(-dir.z, 0, dir.x).multiplyScalar(0.15); // tire width

      const p1 = new THREE.Vector3().addVectors(lastPos, normal);
      const p2 = new THREE.Vector3().subVectors(lastPos, normal);
      const p3 = new THREE.Vector3().addVectors(currentPos, normal);
      const p4 = new THREE.Vector3().subVectors(currentPos, normal);

      p1.y = 0.02;
      p2.y = 0.02;
      p3.y = 0.02;
      p4.y = 0.02;

      const geom = new THREE.BufferGeometry();
      const vertices = new Float32Array([
        p1.x, p1.y, p1.z,
        p2.x, p2.y, p2.z,
        p3.x, p3.y, p3.z,
        p2.x, p2.y, p2.z,
        p4.x, p4.y, p4.z,
        p3.x, p3.y, p3.z,
      ]);
      geom.setAttribute('position', new THREE.BufferAttribute(vertices, 3));

      const opacity = Math.min(0.72, intensity * 0.65);
      const mat = new THREE.MeshBasicMaterial({
        color: 0x09090b,
        transparent: true,
        opacity: opacity,
        depthWrite: false,
        side: THREE.DoubleSide,
      });

      const mesh = new THREE.Mesh(geom, mat);
      this.skidMarksGroup.add(mesh);

      // Limit max skid segments
      if (this.skidMarksGroup.children.length > 700) {
        const oldest = this.skidMarksGroup.children[0] as THREE.Mesh;
        this.skidMarksGroup.remove(oldest);
        oldest.geometry.dispose();
        (oldest.material as THREE.Material).dispose();
      }
    }

    this.lastSkidPoints[wheelId] = currentPos.clone();
  }

  public endSkidMark(wheelId: string) {
    this.lastSkidPoints[wheelId] = null;
  }

  public spawnSmokeParticle(pos: THREE.Vector3, intensity: number) {
    if (this.smokeParticles.length > 110) return;

    const mesh = new THREE.Mesh(this.smokeGeo, this.smokeMat.clone());
    mesh.position.copy(pos);
    mesh.position.y += 0.16;
    const initialScale = 0.45 + Math.random() * 0.35;
    mesh.scale.set(initialScale, initialScale, initialScale);
    this.scene.add(mesh);

    this.smokeParticles.push({
      mesh,
      life: 0,
      maxLife: 0.9 + Math.random() * 0.55,
      vx: (Math.random() - 0.5) * 0.9,
      vy: 0.8 + Math.random() * 1.0,
      vz: (Math.random() - 0.5) * 0.9,
      size: initialScale,
    });
  }

  public update(dt: number, carX: number, carZ: number, carYaw: number, carSpeedMs: number, wheels: WheelState[]) {
    const cosYaw = Math.cos(carYaw);
    const sinYaw = Math.sin(carYaw);

    wheels.forEach((wheel) => {
      const wx = carX + (wheel.localPos.x * cosYaw + wheel.localPos.z * sinYaw);
      const wz = carZ + (-wheel.localPos.x * sinYaw + wheel.localPos.z * cosYaw);
      const contactPos = new THREE.Vector3(wx, 0.02, wz);
      wheel.groundContactPos = { x: wx, y: 0.02, z: wz };

      if (wheel.isSkidding && wheel.skidIntensity > 0.08) {
        this.addSkidMarkSegment(wheel.id, contactPos, wheel.skidIntensity);
        if (Math.random() < wheel.skidIntensity * 0.7) {
          this.spawnSmokeParticle(contactPos, wheel.skidIntensity);
        }
      } else {
        this.endSkidMark(wheel.id);
      }
    });

    // Update Smoke Particles
    for (let i = this.smokeParticles.length - 1; i >= 0; i--) {
      const p = this.smokeParticles[i];
      p.life += dt;
      if (p.life >= p.maxLife) {
        this.scene.remove(p.mesh);
        p.mesh.geometry.dispose();
        (p.mesh.material as THREE.Material).dispose();
        this.smokeParticles.splice(i, 1);
      } else {
        const progress = p.life / p.maxLife;
        p.mesh.position.x += p.vx * dt;
        p.mesh.position.y += p.vy * dt;
        p.mesh.position.z += p.vz * dt;
        const scale = p.size * (1 + progress * 3.2);
        p.mesh.scale.set(scale, scale, scale);
        (p.mesh.material as THREE.MeshBasicMaterial).opacity = (1 - progress) * 0.38;
      }
    }

    // Cone Hit Physics
    const carRadius = 1.45;
    this.cones.forEach((cone) => {
      if (!cone.isHit) {
        const dx = cone.x - carX;
        const dz = cone.z - carZ;
        const dist = Math.sqrt(dx * dx + dz * dz);
        if (dist < carRadius + 0.35) {
          cone.isHit = true;
          const hitAngle = Math.atan2(dz, dx);
          const impactSpeed = Math.max(4, carSpeedMs);
          cone.vx = Math.cos(hitAngle) * impactSpeed * 0.9;
          cone.vz = Math.sin(hitAngle) * impactSpeed * 0.9;
          cone.rotX = (Math.random() - 0.5) * 7;
          cone.rotZ = (Math.random() - 0.5) * 7;
        }
      } else {
        cone.x += cone.vx * dt;
        cone.z += cone.vz * dt;
        cone.vx *= 0.93;
        cone.vz *= 0.93;
        cone.mesh.position.set(cone.x, 0.1, cone.z);
        cone.mesh.rotation.x += cone.rotX * dt;
        cone.mesh.rotation.z += cone.rotZ * dt;
        cone.rotX *= 0.91;
        cone.rotZ *= 0.91;
      }
    });
  }

  public clearSkidMarks() {
    while (this.skidMarksGroup.children.length > 0) {
      const obj = this.skidMarksGroup.children[0] as THREE.Mesh;
      this.skidMarksGroup.remove(obj);
      obj.geometry.dispose();
      (obj.material as THREE.Material).dispose();
    }
  }

  public resetCones() {
    this.cones.forEach((cone) => {
      cone.isHit = false;
      cone.vx = 0;
      cone.vz = 0;
      cone.rotX = 0;
      cone.rotZ = 0;
      cone.mesh.position.set(cone.x, 0, cone.z);
      cone.mesh.rotation.set(0, 0, 0);
    });
  }
}
