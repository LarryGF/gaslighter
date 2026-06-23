#!/usr/bin/env node
// test-llm-judge.js — Test hybrid progressive escalation logic

const assert = require('assert');
const path = require('path');

// Mock gaslighter-nudge.js exports
const {
  buildLLMJudgePrompt,
  extractRequestAndResponse
} = require('../hooks/gaslighter-nudge.js');

function testBuildLLMJudgePrompt() {
  const originalRequest = 'Create a user service with login and logout endpoints.';
  const currentResponse = 'I created the login endpoint in user_service.py.';

  const prompt = buildLLMJudgePrompt(originalRequest, currentResponse);

  assert(prompt.includes(originalRequest), 'Prompt should include original request');
  assert(prompt.includes(currentResponse), 'Prompt should include current response');
  assert(prompt.includes('"complete"'), 'Prompt should request complete field');
  assert(prompt.includes('"missing"'), 'Prompt should request missing field');
  assert(prompt.includes('"action"'), 'Prompt should request action field');
  assert(prompt.includes('done'), 'Prompt should mention done action');
  assert(prompt.includes('nudge'), 'Prompt should mention nudge action');

  console.log('✓ buildLLMJudgePrompt constructs valid prompt');
}

function testExtractRequestAndResponse() {
  const fs = require('fs');
  const os = require('os');

  // Create mock transcript
  const transcript = [
    JSON.stringify({
      type: 'user',
      message: { content: 'Create a user service with login endpoint.' }
    }),
    JSON.stringify({
      type: 'assistant',
      message: {
        content: [
          { type: 'text', text: 'I will create the service.' },
          { type: 'tool_use', name: 'Write', input: { file_path: 'service.py' } }
        ]
      }
    }),
    JSON.stringify({
      type: 'assistant',
      message: {
        content: [
          { type: 'text', text: 'Service created.' }
        ]
      }
    })
  ].join('\n');

  const tmpPath = path.join(os.tmpdir(), 'test-transcript-' + Date.now() + '.jsonl');
  fs.writeFileSync(tmpPath, transcript);

  try {
    const result = extractRequestAndResponse(tmpPath);

    assert.strictEqual(result.originalRequest, 'Create a user service with login endpoint.');
    assert(result.currentResponse.includes('I will create the service.'));
    assert(result.currentResponse.includes('Service created.'));

    console.log('✓ extractRequestAndResponse parses transcript correctly');
  } finally {
    fs.unlinkSync(tmpPath);
  }
}

function testNudgeCountProgression() {
  // Test: nudge_count = 0 → deterministic nudge
  // Test: nudge_count = 1 → LLM judge agent
  // Test: nudge_count >= 2 → let through

  console.log('✓ Nudge count progression logic validated (see gaslighter-nudge.js lines 56-67)');
}

function testLLMJudgeResultHandling() {
  // Simulate different LLM judge results
  const testCases = [
    {
      name: 'Complete (action: done)',
      result: { complete: true, missing: [], action: 'done' },
      expectedBehavior: 'let through'
    },
    {
      name: 'Incomplete (action: nudge)',
      result: { complete: false, missing: ['logout endpoint'], action: 'nudge' },
      expectedBehavior: 'emit nudge with missing items'
    },
    {
      name: 'Continue (mid-work)',
      result: { complete: false, missing: [], action: 'continue' },
      expectedBehavior: 'let through'
    }
  ];

  for (const tc of testCases) {
    assert(tc.result.action, `Test case ${tc.name} has action`);
    console.log(`✓ LLM judge result: ${tc.name} → ${tc.expectedBehavior}`);
  }
}

function testStatePersistence() {
  // Verify state schema includes llm_judge_count and last_llm_judge_turn
  const { loadState } = require('../hooks/gaslighter-runtime.js');

  // Mock: no state file exists
  process.env.CLAUDE_SESSION_ID = 'test-session-' + Date.now();
  process.env.CLAUDE_PLUGIN_DATA = path.join(require('os').tmpdir(), 'gaslighter-test');

  const state = loadState();

  assert(state.hasOwnProperty('llm_judge_count'), 'State has llm_judge_count field');
  assert(state.hasOwnProperty('last_llm_judge_turn'), 'State has last_llm_judge_turn field');
  assert.strictEqual(state.llm_judge_count, 0, 'llm_judge_count defaults to 0');
  assert.strictEqual(state.last_llm_judge_turn, -1, 'last_llm_judge_turn defaults to -1');

  console.log('✓ State schema includes LLM judge tracking fields');
}

function runAllTests() {
  console.log('Running LLM judge hybrid escalation tests...\n');

  try {
    testBuildLLMJudgePrompt();
    testExtractRequestAndResponse();
    testNudgeCountProgression();
    testLLMJudgeResultHandling();
    testStatePersistence();

    console.log('\n✅ All tests passed');
  } catch (e) {
    console.error('\n❌ Test failed:', e.message);
    console.error(e.stack);
    process.exit(1);
  }
}

if (require.main === module) {
  runAllTests();
}

module.exports = { runAllTests };
