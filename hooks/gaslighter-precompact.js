#!/usr/bin/env node
// gaslighter — PreCompact hook
// Injects a reminder to preserve remaining goals in the compaction summary

var output = 'GASLIGHTER REMINDER: Before compacting, preserve the following in your summary:\n' +
  '1. The original request and ALL stated requirements\n' +
  '2. Which requirements have been completed and which are still pending\n' +
  '3. Any task list items that are not yet done\n' +
  '4. The current mode (lite/full/ultra) of the gaslighter plugin\n' +
  'Do NOT lose track of unfinished requirements during context compaction.';

process.stdout.write(output);
