import { getRunNoteSummaryFromOpenAI } from './functions/webhook';
import * as fs from 'fs';
import * as path from 'path';

// Expected results for validation
const EXPECTED_OUTPUTS = {
  '16445002078': 'R workout - 16 x 200m',
  '14971708503': 'R workout - 10 x 200m',
  '15120301578': 'R workout - mixed intervals'
};

async function testRepetitionActivities() {
  console.log('='.repeat(80));
  console.log('REPETITION (R) DETECTION TEST SUITE');
  console.log('='.repeat(80));
  console.log();

  // Check if OpenAI API key is set
  if (!process.env.OPENAI_API_KEY) {
    console.error('ERROR: OPENAI_API_KEY environment variable is not set!');
    console.error('Please set the API key before running this test.');
    process.exit(1);
  }

  console.log('✓ OpenAI API key found');
  console.log();

  // Load test data
  const dataPath = path.join(__dirname, 'data', 'repetition.json');
  let activities: any[];

  try {
    const rawData = fs.readFileSync(dataPath, 'utf-8');
    activities = JSON.parse(rawData);
    console.log(`✓ Loaded ${activities.length} test activities from repetition.json`);
  } catch (error) {
    console.error(`ERROR: Failed to load ${dataPath}`);
    console.error(error);
    process.exit(1);
  }

  console.log();
  console.log('-'.repeat(80));
  console.log();

  let successCount = 0;
  let failCount = 0;
  const results: any[] = [];

  // Test each activity
  for (let i = 0; i < activities.length; i++) {
    const activity = activities[i];
    const activityId = String(activity.id);
    const expectedNote = EXPECTED_OUTPUTS[activityId as keyof typeof EXPECTED_OUTPUTS] || 'R workout';

    console.log(`[${i + 1}/${activities.length}] Testing Activity ${activityId}`);
    console.log(`   Expected: ${expectedNote}`);
    console.log(`   Distance: ${(activity.distance / 1609.34).toFixed(2)} mi`);
    console.log(`   Avg HR: ${activity.average_heartrate} bpm, Max HR: ${activity.max_heartrate} bpm`);
    console.log(`   Avg Speed: ${activity.average_speed.toFixed(2)} m/s`);
    console.log(`   Laps: ${activity.laps?.length || 0}`);

    try {
      const result = await getRunNoteSummaryFromOpenAI(activity);
      console.log(`   Result: ${result}`);

      // Check if it's classified as R (Repetition)
      const isRWorkout = result.startsWith('R ');
      const success = isRWorkout;

      if (success) {
        console.log(`   ✓ SUCCESS - Correctly detected as R workout`);
        successCount++;
      } else {
        console.log(`   ✗ FAILED - Not detected as R workout`);
        failCount++;
      }

      results.push({
        id: activityId,
        expected: expectedNote,
        actual: result,
        success: success,
        distance_mi: (activity.distance / 1609.34).toFixed(2),
        avg_hr: activity.average_heartrate,
        max_hr: activity.max_heartrate,
        avg_speed: activity.average_speed.toFixed(2),
        laps: activity.laps?.length || 0
      });
    } catch (error: any) {
      console.log(`   ✗ ERROR: ${error.message}`);
      failCount++;
      results.push({
        id: activityId,
        expected: expectedNote,
        actual: `ERROR: ${error.message}`,
        success: false
      });
    }

    console.log();
  }

  // Print summary
  console.log('='.repeat(80));
  console.log('TEST SUMMARY');
  console.log('='.repeat(80));
  console.log();
  console.log(`Total Activities: ${activities.length}`);
  console.log(`✓ Successful: ${successCount}`);
  console.log(`✗ Failed: ${failCount}`);
  console.log(`Success Rate: ${((successCount / activities.length) * 100).toFixed(1)}%`);
  console.log();

  // Print detailed results table
  console.log('-'.repeat(80));
  console.log('DETAILED RESULTS');
  console.log('-'.repeat(80));
  console.log();

  for (const result of results) {
    const status = result.success ? '✓' : '✗';
    console.log(`${status} Activity ${result.id}`);
    console.log(`  Expected: ${result.expected}`);
    console.log(`  Actual:   ${result.actual}`);
    if (result.distance_mi) {
      console.log(`  Stats: ${result.distance_mi} mi, Avg HR ${result.avg_hr}, Max HR ${result.max_hr}, ${result.laps} laps`);
    }
    console.log();
  }

  // Exit with appropriate code
  if (failCount > 0) {
    console.log(`⚠️  ${failCount} test(s) failed!`);
    process.exit(1);
  } else {
    console.log('✅ All tests passed!');
    process.exit(0);
  }
}

// Run the test suite
testRepetitionActivities().catch((error) => {
  console.error('Unhandled error in test suite:');
  console.error(error);
  process.exit(1);
});
