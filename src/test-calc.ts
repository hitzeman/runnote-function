import { calculateRepetitionStructure } from './services/workoutCalculations';

// Test data from activity 16445002078
const activity16445002078_laps = [
  { distance: 2556.63, moving_time: 946, average_speed: 2.7 },  // warmup
  { distance: 200.0, moving_time: 44, average_speed: 4.55 },    // work
  { distance: 200.0, moving_time: 69, average_speed: 2.9 },     // recovery
  { distance: 200.0, moving_time: 43, average_speed: 4.65 },    // work
  { distance: 200.0, moving_time: 81, average_speed: 2.47 },    // recovery
  { distance: 200.0, moving_time: 41, average_speed: 4.88 },    // work
  { distance: 200.0, moving_time: 70, average_speed: 2.86 },    // recovery
  { distance: 200.0, moving_time: 42, average_speed: 4.76 },    // work
  { distance: 200.0, moving_time: 79, average_speed: 2.53 },    // recovery
  { distance: 200.0, moving_time: 41, average_speed: 4.88 },    // work
  { distance: 200.0, moving_time: 77, average_speed: 2.6 },     // recovery
  { distance: 200.0, moving_time: 41, average_speed: 4.88 },    // work
  { distance: 200.0, moving_time: 77, average_speed: 2.6 },     // recovery
  { distance: 200.0, moving_time: 40, average_speed: 5.0 },     // work
  { distance: 200.0, moving_time: 73, average_speed: 2.74 },    // recovery
  { distance: 200.0, moving_time: 41, average_speed: 4.88 },    // work
  { distance: 200.0, moving_time: 71, average_speed: 2.82 },    // recovery
  { distance: 800.0, moving_time: 274, average_speed: 2.92 },   // between-set
  { distance: 200.0, moving_time: 44, average_speed: 4.55 },    // work
  { distance: 200.0, moving_time: 75, average_speed: 2.67 },    // recovery
  { distance: 200.0, moving_time: 41, average_speed: 4.88 },    // work
  { distance: 200.0, moving_time: 85, average_speed: 2.35 },    // recovery
  { distance: 200.0, moving_time: 41, average_speed: 4.88 },    // work
  { distance: 200.0, moving_time: 92, average_speed: 2.17 },    // recovery
  { distance: 200.0, moving_time: 41, average_speed: 4.88 },    // work
  { distance: 200.0, moving_time: 75, average_speed: 2.67 },    // recovery
  { distance: 200.0, moving_time: 42, average_speed: 4.76 },    // work
  { distance: 200.0, moving_time: 91, average_speed: 2.2 },     // recovery
  { distance: 200.0, moving_time: 43, average_speed: 4.65 },    // work
  { distance: 200.0, moving_time: 94, average_speed: 2.13 },    // recovery
  { distance: 200.0, moving_time: 44, average_speed: 4.55 },    // work
  { distance: 200.0, moving_time: 69, average_speed: 2.9 },     // recovery
  { distance: 200.0, moving_time: 44, average_speed: 4.55 },    // work
  { distance: 200.0, moving_time: 75, average_speed: 2.67 },    // recovery
  { distance: 1522.3, moving_time: 525, average_speed: 2.9 }    // cooldown
];

// Test data from activity 14971708503
const activity14971708503_laps = [
  { distance: 3218.61, moving_time: 1220, average_speed: 2.64 },  // warmup
  { distance: 191.21, moving_time: 41, average_speed: 4.66 },     // work
  { distance: 208.98, moving_time: 96, average_speed: 2.18 },     // recovery
  { distance: 192.51, moving_time: 41, average_speed: 4.7 },      // work
  { distance: 209.12, moving_time: 106, average_speed: 1.97 },    // recovery
  { distance: 190.59, moving_time: 40, average_speed: 4.76 },     // work
  { distance: 208.19, moving_time: 106, average_speed: 1.96 },    // recovery
  { distance: 190.17, moving_time: 40, average_speed: 4.75 },     // work
  { distance: 209.6, moving_time: 107, average_speed: 1.96 },     // recovery
  { distance: 192.37, moving_time: 38, average_speed: 5.06 },     // work
  { distance: 206.82, moving_time: 143, average_speed: 1.45 },    // recovery
  { distance: 194.58, moving_time: 38, average_speed: 5.12 },     // work
  { distance: 207.49, moving_time: 168, average_speed: 1.24 },    // recovery
  { distance: 189.93, moving_time: 40, average_speed: 4.75 },     // work
  { distance: 210.0, moving_time: 106, average_speed: 1.98 },     // recovery
  { distance: 189.16, moving_time: 40, average_speed: 4.73 },     // work
  { distance: 210.67, moving_time: 104, average_speed: 2.03 },    // recovery
  { distance: 189.65, moving_time: 41, average_speed: 4.63 },     // work
  { distance: 211.15, moving_time: 106, average_speed: 1.99 },    // recovery
  { distance: 188.79, moving_time: 41, average_speed: 4.6 },      // work
  { distance: 196.2, moving_time: 92, average_speed: 2.13 },      // recovery
  { distance: 4071.85, moving_time: 1294, average_speed: 3.15 }   // cooldown
];

console.log('='.repeat(80));
console.log('TESTING REPETITION STRUCTURE CALCULATION');
console.log('='.repeat(80));
console.log();

// Test activity 16445002078 (exclude warmup and cooldown)
console.log('Activity 16445002078:');
console.log('Expected: 2 x(8 x 200m R w/200m jog) w/800m jog');
const laps1 = activity16445002078_laps.slice(1, -1); // exclude first and last
const result1 = calculateRepetitionStructure({ laps: laps1 });
console.log('Result:', result1);
console.log(`Formatted: ${result1.sets} x(${result1.reps_per_set} x ${result1.work_distance_meters}m R w/${result1.recovery_distance_meters}m jog) w/${result1.between_set_recovery_distance_meters}m jog`);
console.log();

// Test activity 14971708503 (exclude warmup and cooldown)
console.log('Activity 14971708503:');
console.log('Expected: 10 x 200m R w/200m jog');
const laps2 = activity14971708503_laps.slice(1, -1); // exclude first and last
const result2 = calculateRepetitionStructure({ laps: laps2 });
console.log('Result:', result2);
if (result2.sets === 1) {
  console.log(`Formatted: ${result2.reps_per_set} x ${result2.work_distance_meters}m R w/${result2.recovery_distance_meters}m jog`);
} else {
  console.log(`Formatted: ${result2.sets} x(${result2.reps_per_set} x ${result2.work_distance_meters}m R w/${result2.recovery_distance_meters}m jog) w/${result2.between_set_recovery_distance_meters}m jog`);
}
console.log();

console.log('='.repeat(80));
