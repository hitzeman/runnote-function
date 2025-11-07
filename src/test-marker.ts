import { applyRunNoteTopLLMSafe } from './functions/webhook';

/**
 * Test suite for applyRunNoteTopLLMSafe function to ensure
 * exactly one "--from RunNote" marker appears in the output.
 */

function testCase(
  description: string,
  existing: string,
  llmSummary: string,
  expectedPattern: RegExp
): void {
  const result = applyRunNoteTopLLMSafe(existing, llmSummary);
  const markerCount = (result.match(/--from RunNote/gi) || []).length;

  console.log(`\n${description}`);
  console.log(`  Existing: "${existing}"`);
  console.log(`  LLM Summary: "${llmSummary}"`);
  console.log(`  Result: "${result}"`);
  console.log(`  Marker count: ${markerCount}`);

  if (markerCount !== 1) {
    console.log(`  ❌ FAIL - Expected exactly 1 marker, found ${markerCount}`);
  } else if (!expectedPattern.test(result)) {
    console.log(`  ❌ FAIL - Result doesn't match expected pattern`);
  } else {
    console.log(`  ✅ PASS`);
  }
}

console.log('=== Testing applyRunNoteTopLLMSafe Marker Handling ===');

// Test 1: LLM output without marker (normal case after fix)
testCase(
  'Test 1: LLM output without marker',
  '',
  'T 6 x 1km @ 4:02, 4:01, 4:03',
  /^T 6 x 1km @ 4:02, 4:01, 4:03 --from RunNote\n\n$/
);

// Test 2: LLM output WITH marker (shouldn't happen, but handle it)
testCase(
  'Test 2: LLM output with marker (should strip and re-add)',
  '',
  'T 6 x 1km @ 4:02, 4:01, 4:03 --from RunNote',
  /^T 6 x 1km @ 4:02, 4:01, 4:03 --from RunNote\n\n$/
);

// Test 3: Existing description with old RunNote marker
testCase(
  'Test 3: Replace existing RunNote marker',
  'T 3 x 1mi @ 6:30, 6:29, 6:28 --from RunNote\n\n137 Training Load\n-- from COROS',
  'E 7.2 mi @ 8:09/mi (HR 141)',
  /^E 7\.2 mi @ 8:09\/mi \(HR 141\) --from RunNote\n\n137 Training Load\n-- from COROS$/
);

// Test 4: Multiple summaries in LLM output (bug case from user)
testCase(
  'Test 4: Multiple summaries from LLM (should collapse to single line)',
  '',
  'T 6 x 1km @ 4:02, 4:01, 4:03 --from RunNote E 7.2 mi @ 8:09/mi (HR 141) --from RunNote',
  /--from RunNote/
);

// Test 5: LLM output with multiple markers
testCase(
  'Test 5: LLM output with duplicate markers',
  '',
  'E 7.5 mi @ 8:39/mi (HR 137) --from RunNote --from RunNote',
  /^E 7\.5 mi @ 8:39\/mi \(HR 137\) --from RunNote\n\n$/
);

// Test 6: Preserve existing COROS content
testCase(
  'Test 6: Preserve COROS content while updating RunNote',
  '137 Training Load\n-- from COROS',
  'T 5k continuous @ 7:45/mi',
  /^T 5k continuous @ 7:45\/mi --from RunNote\n\n137 Training Load\n-- from COROS$/
);

// Test 7: Case insensitive marker removal
testCase(
  'Test 7: Case insensitive marker removal',
  'Old summary --FROM RUNNOTE\n\n--from COROS',
  'New summary',
  /^New summary --from RunNote\n\n--from COROS$/
);

console.log('\n=== Test Summary ===');
console.log('All tests check that exactly ONE "--from RunNote" marker appears.');
console.log('The marker should always be at the end of the first line.');
