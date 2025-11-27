const { analyzeWorkout } = require('./dist/src/services/workoutAnalysis');
const { formatWorkoutSummary } = require('./dist/src/utils/activityFormatter');
const fs = require('fs');
const path = require('path');

async function testActivities() {
  console.log('='.repeat(80));
  console.log('TESTING TEMPO CLASSIFICATIONS');
  console.log('='.repeat(80));
  console.log();

  // Check if OpenAI API key is set
  if (!process.env.OPENAI_API_KEY) {
    console.error('ERROR: OPENAI_API_KEY environment variable is not set!');
    console.error('Please set the API key before running this test.');
    process.exit(1);
  }

  // Load test data
  const dataPath = path.join(__dirname, 'src', 'data', 'tempo.json');
  let activities;

  try {
    const rawData = fs.readFileSync(dataPath, 'utf-8');
    activities = JSON.parse(rawData);
    console.log(`✓ Loaded ${activities.length} test activities from tempo.json`);
  } catch (error) {
    console.error(`ERROR: Failed to load ${dataPath}`);
    console.error(error);
    process.exit(1);
  }

  // Test activities
  const testIds = [
    { id: '16581133185', type: 'Cruise Interval Tempo', expected: 'T 3 x 1 mi @ 6:24, 6:24, 6:23' },
    { id: '16514624729', type: 'Continuous Tempo', expected: 'T X.X mi @ avg X:XX/mi' }
  ];

  console.log();
  console.log('-'.repeat(80));

  for (const test of testIds) {
    const activity = activities.find(a => String(a.id) === test.id);

    if (!activity) {
      console.log();
      console.log(`❌ Activity ${test.id} not found in tempo.json`);
      continue;
    }

    console.log();
    console.log(`Testing ${test.type} (${test.id}):`);
    console.log(`Distance: ${(activity.distance / 1609.34).toFixed(2)} miles`);
    console.log(`Moving time: ${Math.floor(activity.moving_time / 60)}:${(activity.moving_time % 60).toString().padStart(2, '0')}`);
    console.log(`Average HR: ${activity.average_heartrate}`);
    console.log();

    try {
      const result = await analyzeWorkout(activity);
      const summary = formatWorkoutSummary(result);

      console.log(`Result: ${summary}`);
      console.log(`Expected: ${test.expected}`);

      if (result.structure === 'interval') {
        console.log(`✓ Detected as INTERVAL tempo`);
        console.log(`  Intervals: ${result.interval_metrics.interval_count}`);
        console.log(`  Distance per interval: ${result.interval_metrics.distance_per_interval_miles.toFixed(2)} mi`);
        console.log(`  Paces: ${result.interval_metrics.individual_paces_seconds.map(p => {
          const min = Math.floor(p / 60);
          const sec = Math.floor(p % 60);
          return `${min}:${sec.toString().padStart(2, '0')}`;
        }).join(', ')}`);
      } else if (result.structure === 'continuous') {
        console.log(`✓ Detected as CONTINUOUS tempo`);
        console.log(`  Distance: ${result.metrics.distance_miles.toFixed(1)} mi`);
        console.log(`  Pace: ${Math.floor(result.metrics.pace_seconds_per_mile / 60)}:${Math.floor(result.metrics.pace_seconds_per_mile % 60).toString().padStart(2, '0')}/mi`);
      }

      console.log();
      console.log('-'.repeat(80));
    } catch (error) {
      console.log();
      console.log(`❌ Error analyzing activity: ${error.message}`);
      console.error(error);
      console.log();
      console.log('-'.repeat(80));
    }
  }

  console.log();
  console.log('='.repeat(80));
  console.log('TEST COMPLETE');
  console.log('='.repeat(80));
}

testActivities().catch(console.error);
