import { getRunNoteSummaryFromOpenAI } from './functions/webhook';
import * as fs from 'fs';
import * as path from 'path';

// Expected results for validation
const EXPECTED_OUTPUTS = {
  '16350927604': '6 x 1km intervals',
  '15750042759': '7 x 1km intervals',
  '15669347896': '7 x 1km intervals',
  '15350786848': '4 x 1mi intervals',
  '15272941640': '3 x 1mi intervals',
  '16230797726': 'Continuous tempo (5k)',
  '14703153220': 'Easy run (misclassified)'
};

async function testTempoActivities() {
  console.log('='.repeat(80));
  console.log('TEMPO DETECTION TEST SUITE');
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
  const dataPath = path.join(__dirname, 'data', 'tempo.json');
  let activities: any[];

  try {
    const rawData = fs.readFileSync(dataPath, 'utf-8');
    activities = JSON.parse(rawData);
    console.log(`✓ Loaded ${activities.length} test activities from tempo.json`);
  } catch (error) {
    console.error(`ERROR: Failed to load ${dataPath}`);
    console.error(error);
    process.exit(1);
  }

  console.log();
  console.log('-'.repeat(80));
  console.log();

  let successCount = 0;
  let errorCount = 0;
  const results: Array<{ id: string; expected: string; result: string; error?: string }> = [];

  // Test each activity
  for (let i = 0; i < activities.length; i++) {
    const activity = activities[i];
    const activityId = String(activity.id);
    const expected = EXPECTED_OUTPUTS[activityId] || 'Unknown';

    console.log(`[${i + 1}/${activities.length}] Testing Activity ${activityId}`);
    console.log(`Expected: ${expected}`);
    console.log('Processing...');

    try {
      const startTime = Date.now();
      const summary = await getRunNoteSummaryFromOpenAI(activity);
      const elapsed = Date.now() - startTime;

      console.log(`✓ Result: ${summary}`);
      console.log(`  (completed in ${(elapsed / 1000).toFixed(1)}s)`);

      // Verify the result ends with --from RunNote
      if (!summary.includes('--from RunNote')) {
        console.warn('  ⚠ WARNING: Result does not contain "--from RunNote" marker');
      }

      results.push({ id: activityId, expected, result: summary });
      successCount++;
    } catch (error: any) {
      console.error(`✗ ERROR: ${error.message}`);
      if (error.response) {
        console.error(`  API Response: ${JSON.stringify(error.response.data)}`);
      }
      results.push({ id: activityId, expected, result: 'ERROR', error: error.message });
      errorCount++;
    }

    console.log();
  }

  // Print summary
  console.log('='.repeat(80));
  console.log('TEST SUMMARY');
  console.log('='.repeat(80));
  console.log();
  console.log(`Total Activities: ${activities.length}`);
  console.log(`Successful: ${successCount}`);
  console.log(`Errors: ${errorCount}`);
  console.log();

  // Print detailed results
  console.log('-'.repeat(80));
  console.log('DETAILED RESULTS');
  console.log('-'.repeat(80));
  console.log();

  for (const result of results) {
    console.log(`Activity ${result.id}:`);
    console.log(`  Expected: ${result.expected}`);
    if (result.error) {
      console.log(`  Result: ERROR - ${result.error}`);
    } else {
      console.log(`  Result: ${result.result}`);

      // Analysis
      const resultLower = result.result.toLowerCase();
      if (resultLower.includes('x 1km') || resultLower.includes('x 1mi')) {
        console.log(`  Analysis: ✓ Interval format detected`);
      } else if (resultLower.startsWith('t ') && resultLower.includes('@ avg')) {
        console.log(`  Analysis: ✓ Continuous tempo format detected`);
      } else if (resultLower.startsWith('e ')) {
        console.log(`  Analysis: ✓ Easy run detected`);
      } else {
        console.log(`  Analysis: ⚠ Unexpected format`);
      }
    }
    console.log();
  }

  // Classification analysis
  console.log('-'.repeat(80));
  console.log('CLASSIFICATION ANALYSIS');
  console.log('-'.repeat(80));
  console.log();

  const tempoCount = results.filter(r => r.result.toLowerCase().startsWith('t ')).length;
  const easyCount = results.filter(r => r.result.toLowerCase().startsWith('e ')).length;
  const intervalCount = results.filter(r => r.result.toLowerCase().includes(' x ')).length;
  const continuousCount = results.filter(r =>
    r.result.toLowerCase().startsWith('t ') &&
    r.result.toLowerCase().includes('@ avg')
  ).length;

  console.log(`Tempo runs detected: ${tempoCount}`);
  console.log(`  - Interval format: ${intervalCount}`);
  console.log(`  - Continuous format: ${continuousCount}`);
  console.log(`Easy runs detected: ${easyCount}`);
  console.log();

  // Check for Activity 14703153220 (should be Easy, not Tempo)
  const activity7 = results.find(r => r.id === '14703153220');
  if (activity7) {
    const isEasy = activity7.result.toLowerCase().startsWith('e ');
    console.log(`Activity 14703153220 (expected Easy): ${isEasy ? '✓ PASS' : '✗ FAIL'}`);
    if (!isEasy) {
      console.log(`  Misclassified as: ${activity7.result}`);
    }
    console.log();
  }

  console.log('='.repeat(80));
  console.log('TEST COMPLETE');
  console.log('='.repeat(80));
}

// Run the test
testTempoActivities().catch((error) => {
  console.error('FATAL ERROR:', error);
  process.exit(1);
});
