export type AcMappingConfidence = 'direct' | 'translated' | 'inferred';

export interface AcMapping {
  target: string;
  source: string;
  value: number | string | boolean | number[];
  confidence: AcMappingConfidence;
  note?: string;
}

export interface AssettoCorsaImportResult {
  name: string;
  config: Record<string, any>;
  mappings: AcMapping[];
  warnings: string[];
  archiveFiles: string[];
  kn5Files: string[];
  hasDataAcd: boolean;
  sourceStatus: 'ready' | 'needs-unpack' | 'no-physics-data';
}

interface AcFileSet {
  sourceName: string;
  textFiles: Map<string, string>;
  archiveFiles: string[];
  kn5Files: string[];
  hasDataAcd: boolean;
}

type IniSection = Record<string, string>;
type IniDocument = Record<string, IniSection>;

const TEXT_DECODER = new TextDecoder('utf-8');
const PSI_PER_BAR = 14.5037738;

export async function importAssettoCorsaFiles(inputFiles: File[] | FileList): Promise<AssettoCorsaImportResult> {
  const files = Array.from(inputFiles as ArrayLike<File>);
  if (files.length === 0) throw new Error('Choose an Assetto Corsa car ZIP or extracted car folder.');

  const fileSet = files.length === 1 && files[0].name.toLowerCase().endsWith('.zip')
    ? await readZip(files[0])
    : await readLooseFiles(files);

  return convertFileSet(fileSet);
}

async function readLooseFiles(files: File[]): Promise<AcFileSet> {
  const textFiles = new Map<string, string>();
  const archiveFiles: string[] = [];
  const kn5Files: string[] = [];
  let hasDataAcd = false;

  for (const file of files) {
    const path = normalizePath((file as any).webkitRelativePath || file.name);
    const lower = path.toLowerCase();
    archiveFiles.push(path);
    if (lower.endsWith('.kn5')) kn5Files.push(path);
    if (lower.endsWith('/data.acd') || lower === 'data.acd') hasDataAcd = true;
    if (isTextPhysicsFile(lower)) textFiles.set(path, await file.text());
  }

  return {
    sourceName: deriveLooseSourceName(files),
    textFiles,
    archiveFiles,
    kn5Files,
    hasDataAcd,
  };
}

async function readZip(file: File): Promise<AcFileSet> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocdOffset = findEndOfCentralDirectory(view);
  if (eocdOffset < 0) throw new Error('This does not look like a valid ZIP archive.');

  const entryCount = view.getUint16(eocdOffset + 10, true);
  let cursor = view.getUint32(eocdOffset + 16, true);
  const textFiles = new Map<string, string>();
  const archiveFiles: string[] = [];
  const kn5Files: string[] = [];
  let hasDataAcd = false;

  for (let i = 0; i < entryCount; i += 1) {
    if (cursor + 46 > view.byteLength || view.getUint32(cursor, true) !== 0x02014b50) {
      throw new Error('ZIP central directory is malformed or unsupported.');
    }

    const flags = view.getUint16(cursor + 8, true);
    const method = view.getUint16(cursor + 10, true);
    const compressedSize = view.getUint32(cursor + 20, true);
    const fileNameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const localHeaderOffset = view.getUint32(cursor + 42, true);
    const nameBytes = bytes.subarray(cursor + 46, cursor + 46 + fileNameLength);
    const path = normalizePath(TEXT_DECODER.decode(nameBytes));
    const lower = path.toLowerCase();

    if (path && !path.endsWith('/')) {
      archiveFiles.push(path);
      if (lower.endsWith('.kn5')) kn5Files.push(path);
      if (lower.endsWith('/data.acd') || lower === 'data.acd') hasDataAcd = true;

      if (isTextPhysicsFile(lower)) {
        if ((flags & 0x1) !== 0) {
          throw new Error(`ZIP entry ${path} is encrypted. Extract the mod normally and import the unpacked car folder instead.`);
        }
        const payload = await extractZipEntry(bytes, view, localHeaderOffset, compressedSize, method);
        textFiles.set(path, TEXT_DECODER.decode(payload));
      }
    }

    cursor += 46 + fileNameLength + extraLength + commentLength;
  }

  return {
    sourceName: file.name.replace(/\.zip$/i, ''),
    textFiles,
    archiveFiles,
    kn5Files,
    hasDataAcd,
  };
}

function findEndOfCentralDirectory(view: DataView): number {
  const minimum = Math.max(0, view.byteLength - 22 - 0xffff);
  for (let i = view.byteLength - 22; i >= minimum; i -= 1) {
    if (view.getUint32(i, true) === 0x06054b50) return i;
  }
  return -1;
}

async function extractZipEntry(
  bytes: Uint8Array,
  view: DataView,
  localHeaderOffset: number,
  compressedSize: number,
  method: number,
): Promise<Uint8Array> {
  if (localHeaderOffset + 30 > view.byteLength || view.getUint32(localHeaderOffset, true) !== 0x04034b50) {
    throw new Error('ZIP local file header is malformed.');
  }

  const localNameLength = view.getUint16(localHeaderOffset + 26, true);
  const localExtraLength = view.getUint16(localHeaderOffset + 28, true);
  const dataStart = localHeaderOffset + 30 + localNameLength + localExtraLength;
  const compressed = bytes.subarray(dataStart, dataStart + compressedSize);

  if (method === 0) return compressed.slice();
  if (method !== 8) throw new Error(`ZIP compression method ${method} is not supported yet.`);

  const DecompressionCtor = (globalThis as any).DecompressionStream;
  if (!DecompressionCtor) {
    throw new Error('This browser cannot decompress ZIP files here. Extract the car folder first, then import the folder.');
  }

  try {
    const stream = new Blob([compressed.slice().buffer]).stream().pipeThrough(new DecompressionCtor('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch {
    throw new Error('Could not decompress this ZIP. Extract the car folder first, then import the folder.');
  }
}

function convertFileSet(files: AcFileSet): AssettoCorsaImportResult {
  const warnings: string[] = [];
  const mappings: AcMapping[] = [];
  const config: Record<string, any> = {};

  const carText = findText(files.textFiles, 'car.ini');
  const suspensionText = findText(files.textFiles, 'suspensions.ini');
  const tyresText = findText(files.textFiles, 'tyres.ini');
  const engineText = findText(files.textFiles, 'engine.ini');
  const drivetrainText = findText(files.textFiles, 'drivetrain.ini');
  const brakesText = findText(files.textFiles, 'brakes.ini');
  const aeroText = findText(files.textFiles, 'aero.ini');
  const powerLutText = findText(files.textFiles, 'power.lut');

  const hasReadablePhysics = Boolean(carText || suspensionText || tyresText || engineText || drivetrainText || brakesText);
  const name = deriveCarName(files) || files.sourceName;

  if (!hasReadablePhysics) {
    if (files.hasDataAcd) {
      warnings.push('This car contains data.acd but no unpacked data/*.ini physics. In Assetto Corsa Content Manager, use Tools → Unpack Data, then import the extracted car folder or re-zip it.');
      return {
        name,
        config,
        mappings,
        warnings,
        archiveFiles: files.archiveFiles,
        kn5Files: files.kn5Files,
        hasDataAcd: true,
        sourceStatus: 'needs-unpack',
      };
    }

    warnings.push('No readable Assetto Corsa physics files were found. Expected files such as data/car.ini, suspensions.ini, tyres.ini, engine.ini, or drivetrain.ini.');
    return {
      name,
      config,
      mappings,
      warnings,
      archiveFiles: files.archiveFiles,
      kn5Files: files.kn5Files,
      hasDataAcd: false,
      sourceStatus: 'no-physics-data',
    };
  }

  const car = carText ? parseIni(carText.text) : {};
  const suspension = suspensionText ? parseIni(suspensionText.text) : {};
  const tyres = tyresText ? parseIni(tyresText.text) : {};
  const engine = engineText ? parseIni(engineText.text) : {};
  const drivetrain = drivetrainText ? parseIni(drivetrainText.text) : {};
  const brakes = brakesText ? parseIni(brakesText.text) : {};

  const add = (
    target: string,
    value: any,
    source: string,
    confidence: AcMappingConfidence,
    note?: string,
  ) => {
    if (value === undefined || value === null) return;
    if (typeof value === 'number' && !Number.isFinite(value)) return;
    config[target] = value;
    mappings.push({ target, source, value, confidence, note });
  };

  // Chassis / geometry. Real mods put these in either car.ini or suspensions.ini.
  add('mass', firstDefined(num(car, 'BASIC', 'TOTALMASS'), num(car, 'WEIGHT', 'MINIMUM')), sourceOf(carText, 'BASIC.TOTALMASS / WEIGHT.MINIMUM'), 'direct');
  add('wheelbase', firstDefined(num(car, 'BASIC', 'WHEELBASE'), num(suspension, 'BASIC', 'WHEELBASE')), `${sourceOf(carText, 'BASIC.WHEELBASE')} / ${sourceOf(suspensionText, 'BASIC.WHEELBASE')}`, 'direct');
  add('centerOfGravityHeight', firstDefined(num(car, 'BASIC', 'CG_HEIGHT'), num(car, 'BASIC', 'CGHEIGHT'), num(suspension, 'BASIC', 'CG_HEIGHT')), `${sourceOf(carText, 'BASIC.CG_HEIGHT')} / ${sourceOf(suspensionText, 'BASIC.CG_HEIGHT')}`, 'direct');

  const graphicsOffset = vec3(raw(car, 'BASIC', 'GRAPHICS_OFFSET'));
  if (graphicsOffset) {
    config.__acGraphicsOffset = graphicsOffset;
    mappings.push({ target: '__acGraphicsOffset', source: sourceOf(carText, 'BASIC.GRAPHICS_OFFSET'), value: graphicsOffset, confidence: 'direct', note: 'Preserved for visual alignment of the imported KN5 body.' });
  }
  const graphicsPitch = num(car, 'BASIC', 'GRAPHICS_PITCH_ROTATION');
  if (graphicsPitch !== undefined) {
    config.__acGraphicsPitchRotation = graphicsPitch;
    mappings.push({ target: '__acGraphicsPitchRotation', source: sourceOf(carText, 'BASIC.GRAPHICS_PITCH_ROTATION'), value: graphicsPitch, confidence: 'direct', note: 'Preserved for visual alignment of the imported KN5 body.' });
  }

  const frontTrack = num(suspension, 'FRONT', 'TRACK');
  const rearTrack = num(suspension, 'REAR', 'TRACK');
  add('trackWidth', averageDefined(frontTrack, rearTrack), sourceOf(suspensionText, 'FRONT/REAR.TRACK'), 'translated', 'The simulator currently exposes one base track width, so front and rear AC values are averaged.');

  const frontUnsprung = firstNum(suspension, 'FRONT', ['WHEEL_MASS', 'HUB_MASS', 'UNSPRUNG_MASS']);
  const rearUnsprung = firstNum(suspension, 'REAR', ['WHEEL_MASS', 'HUB_MASS', 'UNSPRUNG_MASS']);
  add('unsprungMassCorner', averageDefined(frontUnsprung, rearUnsprung), sourceOf(suspensionText, 'FRONT/REAR.WHEEL_MASS|HUB_MASS|UNSPRUNG_MASS'), 'translated', 'Front/rear corner unsprung masses are averaged because the current simulator exposes one per-corner value.');

  const cgLocation = num(suspension, 'BASIC', 'CG_LOCATION');
  if (cgLocation !== undefined) {
    warnings.push(`CG_LOCATION=${cgLocation} was preserved only in this report; AC mods differ in longitudinal-CG convention and the simulator currently separates front weight distribution from CG height.`);
  }

  // Suspension. Support both Kunos-style BUMP/REBOUND and common DAMP_* aliases.
  const springFront = firstNum(suspension, 'FRONT', ['SPRING_RATE', 'SPRING']);
  const springRear = firstNum(suspension, 'REAR', ['SPRING_RATE', 'SPRING']);
  add('suspensionStiffness', averageDefined(springFront, springRear), sourceOf(suspensionText, 'FRONT/REAR.SPRING_RATE|SPRING'), 'translated', 'Front/rear corner spring rates are averaged because VehicleConfig currently exposes one base spring rate.');

  const bumpFront = firstNum(suspension, 'FRONT', ['BUMP', 'DAMP_BUMP', 'DAMPER_BUMP']);
  const bumpRear = firstNum(suspension, 'REAR', ['BUMP', 'DAMP_BUMP', 'DAMPER_BUMP']);
  const bump = averageDefined(bumpFront, bumpRear);
  add('suspensionDamping', bump, sourceOf(suspensionText, 'FRONT/REAR.BUMP|DAMP_BUMP'), 'translated');
  add('suspensionDampingLowSpeed', bump, sourceOf(suspensionText, 'FRONT/REAR.BUMP|DAMP_BUMP'), 'translated');

  const fastBumpFront = firstNum(suspension, 'FRONT', ['FAST_BUMP', 'DAMP_FAST_BUMP', 'DAMPER_FAST_BUMP']);
  const fastBumpRear = firstNum(suspension, 'REAR', ['FAST_BUMP', 'DAMP_FAST_BUMP', 'DAMPER_FAST_BUMP']);
  add('suspensionDampingHighSpeed', averageDefined(fastBumpFront, fastBumpRear), sourceOf(suspensionText, 'FRONT/REAR.FAST_BUMP|DAMP_FAST_BUMP'), 'translated');

  const reboundFront = firstNum(suspension, 'FRONT', ['REBOUND', 'DAMP_REBOUND', 'DAMPER_REBOUND']);
  const reboundRear = firstNum(suspension, 'REAR', ['REBOUND', 'DAMP_REBOUND', 'DAMPER_REBOUND']);
  add('suspensionReboundDamping', averageDefined(reboundFront, reboundRear), sourceOf(suspensionText, 'FRONT/REAR.REBOUND|DAMP_REBOUND'), 'translated');

  const bumpStopFront = firstNum(suspension, 'FRONT', ['BUMPSTOP_RATE', 'BUMP_STOP_RATE']);
  const bumpStopRear = firstNum(suspension, 'REAR', ['BUMPSTOP_RATE', 'BUMP_STOP_RATE']);
  add('bumpStopStiffness', averageDefined(bumpStopFront, bumpStopRear), sourceOf(suspensionText, 'FRONT/REAR.BUMPSTOP_RATE'), 'translated');

  const arbFront = firstDefined(firstNum(suspension, 'FRONT', ['ARB', 'ANTIROLL_BAR', 'ANTI_ROLL_K']), num(suspension, 'ARB', 'FRONT'));
  const arbRear = firstDefined(firstNum(suspension, 'REAR', ['ARB', 'ANTIROLL_BAR', 'ANTI_ROLL_K']), num(suspension, 'ARB', 'REAR'));
  add('rollStiffnessFront', arbFront, sourceOf(suspensionText, 'FRONT.ARB / ARB.FRONT'), 'translated');
  add('rollStiffnessRear', arbRear, sourceOf(suspensionText, 'REAR.ARB / ARB.REAR'), 'translated');

  const camberFront = firstNum(suspension, 'FRONT', ['CAMBER', 'STATIC_CAMBER']);
  const camberRear = firstNum(suspension, 'REAR', ['CAMBER', 'STATIC_CAMBER']);
  add('camberStaticFront', radMaybeToDegrees(camberFront), sourceOf(suspensionText, 'FRONT.CAMBER|STATIC_CAMBER'), 'translated', 'Converted to degrees when the AC value looks like radians.');
  add('camberStaticRear', radMaybeToDegrees(camberRear), sourceOf(suspensionText, 'REAR.CAMBER|STATIC_CAMBER'), 'translated', 'Converted to degrees when the AC value looks like radians.');

  const hardpointKeys = ['WBCAR_TOP_FRONT', 'WBCAR_TOP_REAR', 'WBCAR_BOTTOM_FRONT', 'WBCAR_BOTTOM_REAR', 'WBCAR_STEER', 'WBCAR_TIE', 'WBTYRE_TOP', 'WBTYRE_BOTTOM', 'WBTYRE_STEER', 'STRUT_CAR', 'STRUT_TYRE'];
  const hardpointCount = hardpointKeys.reduce((count, key) => count + (raw(suspension, 'FRONT', key) ? 1 : 0) + (raw(suspension, 'REAR', key) ? 1 : 0), 0);
  if (hardpointCount > 0) {
    warnings.push(`Detected ${hardpointCount} suspension hardpoint entries. V1 imports rates, damping, unsprung mass, track, ARBs and static camber; full AC pickup-point kinematics are intentionally not flattened into the simulator’s current simplified geometry.`);
  }

  // Tires
  const frontRadius = num(tyres, 'FRONT', 'RADIUS');
  const rearRadius = num(tyres, 'REAR', 'RADIUS');
  add('wheelRadius', averageDefined(frontRadius, rearRadius), sourceOf(tyresText, 'FRONT/REAR.RADIUS'), 'direct');

  const frontWheelInertia = firstNum(tyres, 'FRONT', ['ANGULAR_INERTIA', 'INERTIA']);
  const rearWheelInertia = firstNum(tyres, 'REAR', ['ANGULAR_INERTIA', 'INERTIA']);
  add('wheelInertia', averageDefined(frontWheelInertia, rearWheelInertia), sourceOf(tyresText, 'FRONT/REAR.ANGULAR_INERTIA|INERTIA'), 'direct');

  const relaxFront = firstNum(tyres, 'FRONT', ['RELAXATION_LENGTH', 'RELAX_LENGTH']);
  const relaxRear = firstNum(tyres, 'REAR', ['RELAXATION_LENGTH', 'RELAX_LENGTH']);
  add('relaxationLength', averageDefined(relaxFront, relaxRear), sourceOf(tyresText, 'FRONT/REAR.RELAXATION_LENGTH'), 'direct');

  const verticalRateFront = firstNum(tyres, 'FRONT', ['RATE', 'VERTICAL_STIFFNESS']);
  const verticalRateRear = firstNum(tyres, 'REAR', ['RATE', 'VERTICAL_STIFFNESS']);
  add('tireVerticalStiffness', averageDefined(verticalRateFront, verticalRateRear), sourceOf(tyresText, 'FRONT/REAR.RATE|VERTICAL_STIFFNESS'), 'translated', 'AC tire vertical rate maps closely to the simulator tire vertical spring rate.');

  const tireDampFront = firstNum(tyres, 'FRONT', ['DAMP', 'VERTICAL_DAMPING']);
  const tireDampRear = firstNum(tyres, 'REAR', ['DAMP', 'VERTICAL_DAMPING']);
  add('tireVerticalDamping', averageDefined(tireDampFront, tireDampRear), sourceOf(tyresText, 'FRONT/REAR.DAMP|VERTICAL_DAMPING'), 'translated');

  const pressureFront = num(tyres, 'FRONT', 'PRESSURE_STATIC');
  const pressureRear = num(tyres, 'REAR', 'PRESSURE_STATIC');
  add('tireBasePressure', averageDefined(pressureFront, pressureRear), sourceOf(tyresText, 'FRONT/REAR.PRESSURE_STATIC'), 'direct');

  const gripFront = num(tyres, 'FRONT', 'DY0');
  const gripRear = num(tyres, 'REAR', 'DY0');
  if (gripFront !== undefined) add('tireGripFront', clamp(gripFront, 0.4, 2.5), sourceOf(tyresText, 'FRONT.DY0'), 'translated', 'DY0 is used as the closest peak lateral-friction input; it is not a 1:1 reproduction of Assetto Corsa’s tire equations.');
  if (gripRear !== undefined) add('tireGripRear', clamp(gripRear, 0.4, 2.5), sourceOf(tyresText, 'REAR.DY0'), 'translated', 'DY0 is used as the closest peak lateral-friction input; it is not a 1:1 reproduction of Assetto Corsa’s tire equations.');

  if (tyresText) {
    const hasAdvancedTyreData = ['DX0', 'DX1', 'DY1', 'FLEX', 'CAMBER', 'LS_EXPY', 'LS_EXPX', 'XMU', 'FRICTION_LIMIT_ANGLE'].some((key) => raw(tyres, 'FRONT', key) !== undefined || raw(tyres, 'REAR', key) !== undefined);
    if (hasAdvancedTyreData) warnings.push('Advanced AC tire coefficients were detected. V1 maps dimensions, inertia, pressure, vertical rate/damping, relaxation length when supplied, and a peak-grip proxy; remaining coefficients are not copied 1:1 into our different tire equations.');
  }

  // Engine / torque curve
  add('idleRpm', num(engine, 'ENGINE_DATA', 'MINIMUM'), sourceOf(engineText, 'ENGINE_DATA.MINIMUM'), 'direct');
  const limiter = num(engine, 'ENGINE_DATA', 'LIMITER');
  if (limiter !== undefined) {
    add('revLimiterRpm', limiter, sourceOf(engineText, 'ENGINE_DATA.LIMITER'), 'direct');
    add('maxRpm', limiter + 150, sourceOf(engineText, 'ENGINE_DATA.LIMITER'), 'inferred', 'A small headroom above the limiter is retained because VehicleConfig distinguishes maximum RPM from limiter RPM.');
  }
  add('flywheelInertia', num(engine, 'ENGINE_DATA', 'INERTIA'), sourceOf(engineText, 'ENGINE_DATA.INERTIA'), 'direct');
  add('engineBrakingTorque', num(engine, 'COAST_REF', 'TORQUE'), sourceOf(engineText, 'COAST_REF.TORQUE'), 'translated', 'Mapped from AC coast-reference torque to the simulator’s trailing engine-braking torque.');

  if (powerLutText) {
    const curve = parseLut(powerLutText.text);
    if (curve.length > 0) {
      const peakTorque = Math.max(...curve.map((point) => point.y));
      const highestRpm = Math.max(...curve.map((point) => point.x));
      add('maxTorque', peakTorque, `${powerLutText.path}: peak torque`, 'translated', 'The full AC LUT is preserved, but the current Powertrain API still consumes a peak-torque scalar.');
      if (limiter === undefined) add('maxRpm', highestRpm, `${powerLutText.path}: highest RPM`, 'inferred');
      config.__acPowerCurve = curve;
      mappings.push({ target: '__acPowerCurve', source: powerLutText.path, value: `${curve.length} points`, confidence: 'direct', note: 'Preserved for the planned arbitrary torque-curve powertrain path.' });
    }
  }

  const maxBoost = firstNum(engine, 'TURBO_0', ['MAX_BOOST', 'MAXBOOST']);
  const wastegate = num(engine, 'TURBO_0', 'WASTEGATE');
  if (maxBoost !== undefined) add('turboBoostMaxPsi', boostToPsi(maxBoost), sourceOf(engineText, 'TURBO_0.MAX_BOOST'), 'translated', 'AC boost values in the expected range are converted from bar to psi.');
  if (wastegate !== undefined) add('wastegatePressurePsi', boostToPsi(wastegate), sourceOf(engineText, 'TURBO_0.WASTEGATE'), 'translated');

  // Drivetrain / gearbox
  const traction = raw(drivetrain, 'TRACTION', 'TYPE')?.toUpperCase();
  if (traction === 'FWD' || traction === 'RWD' || traction === 'AWD') add('drivetrain', traction, sourceOf(drivetrainText, 'TRACTION.TYPE'), 'direct');

  const gearCount = Math.max(0, Math.round(num(drivetrain, 'GEARS', 'COUNT') ?? 0));
  if (gearCount > 0) {
    const ratios: number[] = [];
    for (let i = 1; i <= gearCount; i += 1) {
      const ratio = firstDefined(num(drivetrain, 'GEARS', `GEAR_${i}`), num(drivetrain, 'GEARS', `RATIO_${i}`));
      if (ratio !== undefined) ratios.push(ratio);
    }
    if (ratios.length > 0) {
      add('forwardGearRatios', ratios, sourceOf(drivetrainText, `GEARS.GEAR_1..GEAR_${gearCount}`), 'direct');
      const reverse = firstDefined(num(drivetrain, 'GEARS', 'GEAR_R'), num(drivetrain, 'GEARS', 'REVERSE'));
      if (reverse !== undefined) add('reverseRatio', reverse, sourceOf(drivetrainText, 'GEARS.GEAR_R|REVERSE'), 'direct');
      add('gearRatios', [reverse ?? -ratios[0], ...ratios], sourceOf(drivetrainText, 'GEARS'), 'translated', 'The simulator keeps reverse plus forward gears in a convenience array; if reverse is absent, V1 uses a conservative negative first-gear fallback.');
    }
  }

  add('finalDriveRatio', firstDefined(num(drivetrain, 'GEARS', 'FINAL'), num(drivetrain, 'GEARS', 'FINAL_RATIO')), sourceOf(drivetrainText, 'GEARS.FINAL|FINAL_RATIO'), 'direct');
  add('maxClutchTorque', firstDefined(num(drivetrain, 'CLUTCH', 'MAX_TORQUE'), num(drivetrain, 'DAMAGE', 'CLUTCH_TORQUE')), `${sourceOf(drivetrainText, 'CLUTCH.MAX_TORQUE')} / ${sourceOf(drivetrainText, 'DAMAGE.CLUTCH_TORQUE')}`, 'translated', 'Falls back to AC drivetrain clutch-damage torque when a dedicated clutch section is absent.');

  const shiftUpMs = num(drivetrain, 'GEARBOX', 'CHANGE_UP_TIME');
  if (shiftUpMs !== undefined) add('shiftDurationSec', shiftUpMs > 2 ? shiftUpMs / 1000 : shiftUpMs, sourceOf(drivetrainText, 'GEARBOX.CHANGE_UP_TIME'), 'translated', 'Milliseconds are converted to seconds when appropriate.');

  const autoblipping = boolNum(drivetrain, 'AUTOBLIP', 'ELECTRONIC');
  if (autoblipping !== undefined) add('autoBlipDownshift', autoblipping, sourceOf(drivetrainText, 'AUTOBLIP.ELECTRONIC'), 'direct');

  const diffPower = num(drivetrain, 'DIFFERENTIAL', 'POWER');
  const diffCoast = num(drivetrain, 'DIFFERENTIAL', 'COAST');
  const diffPreload = num(drivetrain, 'DIFFERENTIAL', 'PRELOAD');
  add('diffPowerRamp', normalizeRatio(diffPower), sourceOf(drivetrainText, 'DIFFERENTIAL.POWER'), 'translated');
  add('diffCoastRamp', normalizeRatio(diffCoast), sourceOf(drivetrainText, 'DIFFERENTIAL.COAST'), 'translated');
  add('diffPreloadTorque', diffPreload, sourceOf(drivetrainText, 'DIFFERENTIAL.PRELOAD'), 'direct');
  if (diffPower !== undefined || diffCoast !== undefined || diffPreload !== undefined) {
    const p = normalizeRatio(diffPower) ?? 0;
    const c = normalizeRatio(diffCoast) ?? 0;
    const preload = diffPreload ?? 0;
    const explicitType = raw(drivetrain, 'DIFFERENTIAL', 'TYPE')?.toUpperCase();
    const diffType = explicitType === 'OPEN'
      ? 'OPEN'
      : p < 0.08 && c < 0.08 && preload < 5
        ? 'OPEN'
        : c >= 0.7 && p >= 0.7
          ? 'CLUTCH_2_WAY'
          : 'CLUTCH_1_5';
    add('differentialType', diffType, sourceOf(drivetrainText, 'DIFFERENTIAL'), 'inferred', 'The simulator needs a categorical differential type, so it is inferred from AC type/power/coast/preload values.');
  }

  // Brakes. Support both the classic [DATA] schema and axle-split schemas.
  const dataBrake = num(brakes, 'DATA', 'MAX_TORQUE');
  const frontBrake = num(brakes, 'FRONT', 'MAX_TORQUE');
  const rearBrake = num(brakes, 'REAR', 'MAX_TORQUE');
  if (frontBrake !== undefined && rearBrake !== undefined) {
    // BrakeSystem stores total axle-summed command torque, then applies bias and /2 per wheel.
    add('brakeForce', 2 * (frontBrake + rearBrake), sourceOf(brakesText, 'FRONT/REAR.MAX_TORQUE'), 'translated', 'AC axle entries are per-wheel maxima; converted to the simulator’s total four-wheel brake command.');
    const explicitBias = firstDefined(num(brakes, 'BRAKES', 'BIAS'), num(brakes, 'DATA', 'FRONT_SHARE'));
    add('brakeBiasFront', normalizeRatio(explicitBias ?? frontBrake / (frontBrake + rearBrake)), sourceOf(brakesText, 'BRAKES.BIAS / DATA.FRONT_SHARE'), explicitBias !== undefined ? 'direct' : 'inferred');
  } else {
    add('brakeForce', dataBrake, sourceOf(brakesText, 'DATA.MAX_TORQUE'), 'direct', 'Classic AC DATA schema is retained directly because mods differ in how MAX_TORQUE is authored.');
    add('brakeBiasFront', normalizeRatio(firstDefined(num(brakes, 'DATA', 'FRONT_SHARE'), num(brakes, 'BRAKES', 'BIAS'))), sourceOf(brakesText, 'DATA.FRONT_SHARE / BRAKES.BIAS'), 'translated');
  }
  const handbrake = firstDefined(num(brakes, 'HANDBRAKE', 'MAX_TORQUE'), num(brakes, 'DATA', 'HANDBRAKE_TORQUE'));
  if (handbrake !== undefined) add('handbrakeForce', handbrake * 2, sourceOf(brakesText, 'HANDBRAKE.MAX_TORQUE / DATA.HANDBRAKE_TORQUE'), 'translated', 'BrakeSystem stores total rear handbrake torque and divides it between the two rear wheels.');

  if (aeroText) {
    const aero = parseIni(aeroText.text);
    const wingSections = Object.keys(aero).filter((section) => section.startsWith('WING_')).length;
    if (wingSections > 0) warnings.push(`Detected ${wingSections} AC aero wing section${wingSections === 1 ? '' : 's'}. V1 does not flatten AC’s wing/LUT aero model into a guessed single downforce number; existing simulator aero calibration remains until that converter is implemented.`);
  }

  if (files.kn5Files.length > 0) {
    warnings.push(`Detected ${files.kn5Files.length} KN5 visual model${files.kn5Files.length === 1 ? '' : 's'}. The browser visual loader will attempt the most likely main, unprotected KN5 and keep simulator-driven wheel assemblies separate.`);
  } else {
    warnings.push('No KN5 visual model was found. Physics import will still work, but this package cannot provide the real car body.');
  }

  if (files.hasDataAcd) warnings.push('data.acd is present, but unpacked data files were also found, so the importer used the readable unpacked physics and left data.acd untouched.');
  if (mappings.length === 0) warnings.push('Readable AC files were found, but none of their fields matched the V1 conversion map.');

  return {
    name,
    config,
    mappings,
    warnings,
    archiveFiles: files.archiveFiles,
    kn5Files: files.kn5Files,
    hasDataAcd: files.hasDataAcd,
    sourceStatus: 'ready',
  };
}

function parseIni(text: string): IniDocument {
  const doc: IniDocument = { ROOT: {} };
  let section = 'ROOT';

  for (const rawLine of text.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith(';') || line.startsWith('#') || line.startsWith('//')) continue;

    const sectionMatch = line.match(/^\[([^\]]+)\]/);
    if (sectionMatch) {
      section = sectionMatch[1].trim().toUpperCase();
      if (!doc[section]) doc[section] = {};
      continue;
    }

    const equals = line.indexOf('=');
    if (equals < 0) continue;
    const key = line.slice(0, equals).trim().toUpperCase();
    let value = line.slice(equals + 1).trim();
    value = stripInlineComment(value, ';');
    value = stripInlineComment(value, '//');
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    doc[section][key] = value.trim();
  }

  return doc;
}

function stripInlineComment(value: string, marker: string): string {
  const index = value.indexOf(marker);
  return index >= 0 ? value.slice(0, index).trim() : value;
}

function parseLut(text: string): Array<{ x: number; y: number }> {
  const points: Array<{ x: number; y: number }> = [];
  for (const rawLine of text.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const line = stripInlineComment(rawLine, ';').trim();
    if (!line || line.startsWith('#') || line.startsWith('//')) continue;
    const parts = line.split(/[|,\s]+/).filter(Boolean);
    if (parts.length < 2) continue;
    const x = Number(parts[0]);
    const y = Number(parts[1]);
    if (Number.isFinite(x) && Number.isFinite(y)) points.push({ x, y });
  }
  return points.sort((a, b) => a.x - b.x);
}

function raw(doc: IniDocument, section: string, key: string): string | undefined {
  return doc[section.toUpperCase()]?.[key.toUpperCase()];
}

function num(doc: IniDocument, section: string, key: string): number | undefined {
  const value = raw(doc, section, key);
  if (value === undefined || value === '') return undefined;
  const parsed = Number(value.replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function vec3(value: string | undefined): number[] | undefined {
  if (!value) return undefined;
  const parts = value.replace(/\|/g, ',').split(',').map((part) => Number(part.trim()));
  if (parts.length < 3 || parts.slice(0, 3).some((part) => !Number.isFinite(part))) return undefined;
  return parts.slice(0, 3);
}

function firstNum(doc: IniDocument, section: string, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = num(doc, section, key);
    if (value !== undefined) return value;
  }
  return undefined;
}

function firstDefined(...values: Array<number | undefined>): number | undefined {
  return values.find((value): value is number => value !== undefined && Number.isFinite(value));
}

function boolNum(doc: IniDocument, section: string, key: string): boolean | undefined {
  const value = raw(doc, section, key);
  if (value === undefined) return undefined;
  const normalized = value.trim().toUpperCase();
  if (['1', 'TRUE', 'YES', 'ON'].includes(normalized)) return true;
  if (['0', 'FALSE', 'NO', 'OFF'].includes(normalized)) return false;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed !== 0 : undefined;
}

function averageDefined(...values: Array<number | undefined>): number | undefined {
  const finite = values.filter((value): value is number => value !== undefined && Number.isFinite(value));
  if (finite.length === 0) return undefined;
  return finite.reduce((sum, value) => sum + value, 0) / finite.length;
}

function normalizeRatio(value: number | undefined): number | undefined {
  if (value === undefined) return undefined;
  return clamp(value > 1.5 ? value / 100 : value, 0, 1);
}

function radMaybeToDegrees(value: number | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (Math.abs(value) <= 0.25) return value * (180 / Math.PI);
  return value;
}

function boostToPsi(value: number): number {
  return value >= 0 && value < 5 ? value * PSI_PER_BAR : value;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function findText(files: Map<string, string>, baseName: string): { path: string; text: string } | undefined {
  const wanted = baseName.toLowerCase();
  const candidates = Array.from(files.entries())
    .filter(([path]) => path.toLowerCase().split('/').pop() === wanted)
    .sort(([a], [b]) => scorePhysicsPath(b) - scorePhysicsPath(a));
  if (candidates.length === 0) return undefined;
  return { path: candidates[0][0], text: candidates[0][1] };
}

function scorePhysicsPath(path: string): number {
  const lower = path.toLowerCase();
  let score = 0;
  if (lower.includes('/data/') || lower.startsWith('data/')) score += 4;
  if (!lower.includes('/extension/')) score += 1;
  return score;
}

function sourceOf(file: { path: string; text: string } | undefined, field: string): string {
  return `${file?.path ?? 'missing file'}: ${field}`;
}

function isTextPhysicsFile(lowerPath: string): boolean {
  const name = lowerPath.split('/').pop() || '';
  return name.endsWith('.ini') || name.endsWith('.lut') || name === 'ui_car.json';
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+/g, '/');
}

function deriveLooseSourceName(files: File[]): string {
  const firstPath = normalizePath((files[0] as any)?.webkitRelativePath || '');
  const root = firstPath.split('/')[0];
  return root || files[0]?.name?.replace(/\.[^.]+$/, '') || 'Imported Assetto Corsa car';
}

function deriveCarName(files: AcFileSet): string | undefined {
  const ui = findText(files.textFiles, 'ui_car.json');
  if (ui) {
    try {
      const parsed = JSON.parse(ui.text);
      if (typeof parsed.name === 'string' && parsed.name.trim()) return parsed.name.trim();
    } catch {
      // Relaxed/non-standard UI JSON exists in the wild; fall through to car.ini/folder name.
    }
  }

  const carIni = findText(files.textFiles, 'car.ini');
  if (carIni) {
    const parsed = parseIni(carIni.text);
    const iniName = raw(parsed, 'BASIC', 'SCREEN_NAME') || raw(parsed, 'BASIC', 'NAME');
    if (iniName?.trim()) return iniName.trim();

    const parts = normalizePath(carIni.path).split('/');
    const dataIndex = parts.findIndex((part) => part.toLowerCase() === 'data');
    if (dataIndex > 0) return prettifyName(parts[dataIndex - 1]);
  }

  return prettifyName(files.sourceName);
}

function prettifyName(name: string): string {
  return name
    .replace(/\.(zip|kn5)$/i, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}
