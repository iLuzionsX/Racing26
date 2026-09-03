/**
 * Pure deterministic 3D Math primitives for vehicle physics (headless compatible)
 */

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface Quat {
  x: number;
  y: number;
  z: number;
  w: number;
}

export interface Mat3 {
  // 3x3 matrix in row-major:
  // [m00, m01, m02]
  // [m10, m11, m12]
  // [m20, m21, m22]
  elements: [number, number, number, number, number, number, number, number, number];
}

export class PhysicsMath {
  public static vec3(x: number = 0, y: number = 0, z: number = 0): Vec3 {
    return { x, y, z };
  }

  public static vec3Clone(v: Vec3): Vec3 {
    return { x: v.x, y: v.y, z: v.z };
  }

  public static vec3Set(out: Vec3, x: number, y: number, z: number): Vec3 {
    out.x = x;
    out.y = y;
    out.z = z;
    return out;
  }

  public static vec3Add(a: Vec3, b: Vec3): Vec3 {
    return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
  }

  public static vec3Sub(a: Vec3, b: Vec3): Vec3 {
    return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
  }

  public static vec3Scale(v: Vec3, s: number): Vec3 {
    return { x: v.x * s, y: v.y * s, z: v.z * s };
  }

  public static vec3Dot(a: Vec3, b: Vec3): number {
    return a.x * b.x + a.y * b.y + a.z * b.z;
  }

  public static vec3Cross(a: Vec3, b: Vec3): Vec3 {
    return {
      x: a.y * b.z - a.z * b.y,
      y: a.z * b.x - a.x * b.z,
      z: a.x * b.y - a.y * b.x,
    };
  }

  public static vec3Length(v: Vec3): number {
    return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
  }

  public static vec3Normalize(v: Vec3): Vec3 {
    const len = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
    if (len > 1e-7) {
      return { x: v.x / len, y: v.y / len, z: v.z / len };
    }
    return { x: 0, y: 0, z: 0 };
  }

  public static vec3Lerp(a: Vec3, b: Vec3, t: number): Vec3 {
    return {
      x: a.x + (b.x - a.x) * t,
      y: a.y + (b.y - a.y) * t,
      z: a.z + (b.z - a.z) * t,
    };
  }

  // Quaternion operations
  public static quatIdentity(): Quat {
    return { x: 0, y: 0, z: 0, w: 1 };
  }

  public static quatFromEuler(pitch: number, yaw: number, roll: number): Quat {
    // Pitch (X), Yaw (Y), Roll (Z) - YXZ order standard for vehicles
    const c1 = Math.cos(yaw * 0.5);
    const s1 = Math.sin(yaw * 0.5);
    const c2 = Math.cos(pitch * 0.5);
    const s2 = Math.sin(pitch * 0.5);
    const c3 = Math.cos(roll * 0.5);
    const s3 = Math.sin(roll * 0.5);

    return {
      x: s2 * c1 * c3 + c2 * s1 * s3,
      y: c2 * s1 * c3 - s2 * c1 * s3,
      z: c2 * c1 * s3 - s2 * s1 * c3,
      w: c2 * c1 * c3 + s2 * s1 * s3,
    };
  }

  public static quatToEuler(q: Quat): { pitch: number; yaw: number; roll: number } {
    // Extract YXZ Euler angles
    const x = q.x;
    const y = q.y;
    const z = q.z;
    const w = q.w;

    const sinPitch = 2 * (w * x - y * z);
    let pitch: number;
    if (Math.abs(sinPitch) >= 1) {
      pitch = Math.sign(sinPitch) * (Math.PI / 2);
    } else {
      pitch = Math.asin(sinPitch);
    }

    const yaw = Math.atan2(2 * (w * y + x * z), 1 - 2 * (x * x + y * y));
    const roll = Math.atan2(2 * (w * z + x * y), 1 - 2 * (x * x + z * z));

    return { pitch, yaw, roll };
  }

  public static quatMultiply(a: Quat, b: Quat): Quat {
    return {
      x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
      y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
      z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
      w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
    };
  }

  public static quatNormalize(q: Quat): Quat {
    const len = Math.sqrt(q.x * q.x + q.y * q.y + q.z * q.z + q.w * q.w);
    if (len > 1e-7) {
      return { x: q.x / len, y: q.y / len, z: q.z / len, w: q.w / len };
    }
    return { x: 0, y: 0, z: 0, w: 1 };
  }

  public static quatRotateVec3(q: Quat, v: Vec3): Vec3 {
    // Rotates vector v from local frame to world frame via quaternion q
    const u = { x: q.x, y: q.y, z: q.z };
    const s = q.w;

    const uCrossV = PhysicsMath.vec3Cross(u, v);
    const uCrossUV = PhysicsMath.vec3Cross(u, uCrossV);

    return {
      x: v.x + 2 * (s * uCrossV.x + uCrossUV.x),
      y: v.y + 2 * (s * uCrossV.y + uCrossUV.y),
      z: v.z + 2 * (s * uCrossV.z + uCrossUV.z),
    };
  }

  public static quatInverseRotateVec3(q: Quat, v: Vec3): Vec3 {
    // Rotates vector v from world frame to local frame via inverse quaternion q*
    const qInv: Quat = { x: -q.x, y: -q.y, z: -q.z, w: q.w };
    return PhysicsMath.quatRotateVec3(qInv, v);
  }

  public static quatSlerp(qa: Quat, qb: Quat, t: number): Quat {
    let cosHalfTheta = qa.w * qb.w + qa.x * qb.x + qa.y * qb.y + qa.z * qb.z;

    let bx = qb.x;
    let by = qb.y;
    let bz = qb.z;
    let bw = qb.w;

    if (cosHalfTheta < 0) {
      bw = -bw;
      bx = -bx;
      by = -by;
      bz = -bz;
      cosHalfTheta = -cosHalfTheta;
    }

    if (Math.abs(cosHalfTheta) >= 1.0) {
      return { x: qa.x, y: qa.y, z: qa.z, w: qa.w };
    }

    const halfTheta = Math.acos(cosHalfTheta);
    const sinHalfTheta = Math.sqrt(1.0 - cosHalfTheta * cosHalfTheta);

    if (Math.abs(sinHalfTheta) < 0.001) {
      return {
        x: qa.x * (1 - t) + bx * t,
        y: qa.y * (1 - t) + by * t,
        z: qa.z * (1 - t) + bz * t,
        w: qa.w * (1 - t) + bw * t,
      };
    }

    const ratioA = Math.sin((1 - t) * halfTheta) / sinHalfTheta;
    const ratioB = Math.sin(t * halfTheta) / sinHalfTheta;

    return {
      x: qa.x * ratioA + bx * ratioB,
      y: qa.y * ratioA + by * ratioB,
      z: qa.z * ratioA + bz * ratioB,
      w: qa.w * ratioA + bw * ratioB,
    };
  }

  // Smooth clamping & step helpers
  public static clamp(val: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, val));
  }

  public static lerp(a: number, b: number, t: number): number {
    return a + (b - a) * t;
  }
}
