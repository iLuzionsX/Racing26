export const PROVING_GROUND_SIZE_M = 2600;
export const GROUND_TEXTURE_TILE_M = 20;
export const GROUND_MINOR_GRID_M = 5;

// The surface provider's central high-grip lane is |x| <= 6.5 m.
// Keep the visible road edges on exactly the same physical boundary.
export const MAIN_TEST_LANE_HALF_WIDTH_M = 6.5;
export const MAIN_TEST_LANE_WIDTH_M = MAIN_TEST_LANE_HALF_WIDTH_M * 2;

// The procedural wheel mesh was authored at this radius. It is scaled at runtime
// to the active vehicle's physical wheelRadius so one rendered metre stays one metre.
export const BASE_VISUAL_WHEEL_RADIUS_M = 0.33;

// BMW G90 overall body length used to validate the bundled visual's metre scale.
export const BMW_M5_G90_LENGTH_M = 5.096;
