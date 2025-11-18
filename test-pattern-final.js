const fs = require('fs');

// Full implementation of all functions
function roundToStandard(meters) {
  const standards = [100, 200, 300, 400, 600, 800, 1000, 1200, 1600];
  let closest = standards[0];
  let minDiff = Math.abs(meters - closest);
  for (const std of standards) {
    const diff = Math.abs(meters - std);
    if (diff < minDiff) {
      minDiff = diff;
      closest = std;
    }
  }
  if (minDiff / meters < 0.15) return closest;
  return Math.round(meters / 100) * 100;
}

function findRepeatingPattern(arr) {
  for (let len = 1; len <= Math.floor(arr.length / 2); len++) {
    const pattern = arr.slice(0, len);
    let fullSets = 0;
    let isValidPattern = true;

    for (let i = 0; i < arr.length; i += len) {
      const segment = arr.slice(i, i + len);

      if (segment.length === len) {
        if (JSON.stringify(segment) === JSON.stringify(pattern)) {
          fullSets++;
        } else {
          isValidPattern = false;
          break;
        }
      } else if (segment.length > 0) {
        const partialPattern = pattern.slice(0, segment.length);
        if (JSON.stringify(segment) !== JSON.stringify(partialPattern)) {
          isValidPattern = false;
        }
        break;
      }
    }

    if (isValidPattern && fullSets >= 2) {
      return { pattern, sets: fullSets };
    }
  }

  return null;
}

function calculateRepetitionStructure(params) {
  const laps = params.laps;

  const workLaps = [];
  const regularRecoveryLaps = [];
  const betweenSetRecoveryLaps = [];

  for (let i = 0; i < laps.length; i++) {
    const lap = laps[i];

    if (lap.average_speed > 4.3 && lap.distance >= 180 && lap.distance <= 600) {
      workLaps.push(i);
    } else if (lap.average_speed < 3.5 && lap.distance >= 150 && lap.distance <= 600) {
      regularRecoveryLaps.push(i);
    } else if (
      lap.average_speed < 3.5 &&
      lap.distance > 600 &&
      lap.distance <= 2000 &&
      i > 0 &&
      i < laps.length - 3
    ) {
      const hasWorkBefore = workLaps.some(idx => idx < i);
      const hasWorkAfter = laps.slice(i + 1).some(
        l => l.average_speed > 4.3 && l.distance >= 180 && l.distance <= 600
      );

      if (hasWorkBefore && hasWorkAfter) {
        betweenSetRecoveryLaps.push(i);
      }
    }
  }

  const workDistances = workLaps.map((idx) => roundToStandard(laps[idx].distance));
  const recoveryDistances = regularRecoveryLaps.map((idx) => roundToStandard(laps[idx].distance));
  const betweenSetRecovery = betweenSetRecoveryLaps.length > 0 ? roundToStandard(laps[betweenSetRecoveryLaps[0]].distance) : 0;

  const workPattern = findRepeatingPattern(workDistances);
  const recoveryPattern = findRepeatingPattern(recoveryDistances);

  let sets = 1;
  let repsPerSet;
  let workDistance;
  let recoveryDistance;

  if (workPattern) {
    if (workPattern.pattern.length === 1) {
      workDistance = workPattern.pattern[0];
      if (betweenSetRecoveryLaps.length > 0) {
        sets = betweenSetRecoveryLaps.length + 1;
        repsPerSet = Math.round(workPattern.sets / sets);
      } else {
        sets = 1;
        repsPerSet = workPattern.sets;
      }
    } else {
      workDistance = workPattern.pattern;
      repsPerSet = workPattern.pattern.length;
      if (betweenSetRecoveryLaps.length > 0) {
        sets = betweenSetRecoveryLaps.length + 1;
      } else {
        sets = workPattern.sets;
      }
    }
  } else {
    const avgWorkDist = workDistances.reduce((sum, d) => sum + d, 0) / workDistances.length;
    workDistance = roundToStandard(avgWorkDist);
    if (betweenSetRecoveryLaps.length > 0) {
      sets = betweenSetRecoveryLaps.length + 1;
      repsPerSet = Math.round(workLaps.length / sets);
    } else {
      sets = 1;
      repsPerSet = workLaps.length;
    }
  }

  if (recoveryPattern && recoveryPattern.pattern.length > 1) {
    recoveryDistance = recoveryPattern.pattern;
  } else if (recoveryDistances.length > 0) {
    const avgRecoveryDist = recoveryDistances.reduce((sum, d) => sum + d, 0) / recoveryDistances.length;
    recoveryDistance = roundToStandard(avgRecoveryDist);
  } else {
    recoveryDistance = Array.isArray(workDistance) ? workDistance[0] : workDistance;
  }

  return {
    sets,
    reps_per_set: repsPerSet,
    work_distance_meters: workDistance,
    recovery_distance_meters: recoveryDistance,
    between_set_recovery_distance_meters: betweenSetRecovery,
  };
}

function formatWorkout(result) {
  const { sets, reps_per_set, work_distance_meters, recovery_distance_meters, between_set_recovery_distance_meters } = result;
  const isPatternArray = Array.isArray(work_distance_meters);
  const hasMultipleSets = sets > 1 && between_set_recovery_distance_meters > 0;

  if (isPatternArray) {
    const workPattern = work_distance_meters.map(d => d + 'm').join(', ');
    if (hasMultipleSets) {
      const betweenSetDist = between_set_recovery_distance_meters + 'm';
      return `${sets} x (${workPattern}) R w/ equal jog recovery w/${betweenSetDist} jog`;
    } else {
      return `${sets} x (${workPattern}) R w/ equal jog recovery`;
    }
  } else {
    const workDist = work_distance_meters + 'm';
    const recDist = (Array.isArray(recovery_distance_meters) ? recovery_distance_meters[0] : recovery_distance_meters) + 'm';
    if (hasMultipleSets) {
      const betweenSetDist = between_set_recovery_distance_meters + 'm';
      return `${sets} x(${reps_per_set} x ${workDist} R w/${recDist} jog) w/${betweenSetDist} jog`;
    } else {
      return `${sets * reps_per_set} x ${workDist} R w/${recDist} jog`;
    }
  }
}

// Test with actual data
const data = JSON.parse(fs.readFileSync('src/data/repetition.json', 'utf-8'));

console.log('='.repeat(80));
console.log('FINAL TEST: ALL REPETITION ACTIVITIES');
console.log('='.repeat(80));
console.log();

let passCount = 0;
let failCount = 0;

data.forEach(activity => {
  console.log(`Activity ${activity.id}:`);
  const expected = activity.description.split('\n')[0].replace(/--from RunNote/, '').trim();
  console.log(`  Expected:   ${expected}`);

  const result = calculateRepetitionStructure({ laps: activity.laps });
  const formatted = formatWorkout(result);
  console.log(`  Calculated: ${formatted}`);

  // Check if formats match (allowing for minor formatting differences)
  const exp = expected.toLowerCase().replace(/\s+/g, ' ').replace(/r\s*-\s*/,'').trim();
  const calc = formatted.toLowerCase().replace(/\s+/g, ' ').trim();
  const isMatch = exp === calc || exp.includes(calc) || calc.includes(exp);

  if (isMatch) {
    console.log('  Status: ✓ PASS');
    passCount++;
  } else {
    console.log('  Status: ✗ FAIL');
    failCount++;
  }
  console.log();
});

console.log('='.repeat(80));
console.log(`RESULTS: ${passCount}/${data.length} passed, ${failCount}/${data.length} failed`);
console.log('='.repeat(80));
