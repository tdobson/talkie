export const meta = {
  name: 'build-video-feedback',
  description:
    'Build the video feedback tool from docs/plans/2026-11-21-video-feedback.md: explore, scaffold, parallel TDD builds with adversarial review, integration, E2E, polish',
  whenToUse:
    'Run after the spec and plan are approved. Pass args {startPhase: N} to skip completed phases (0-7).',
  phases: [
    { title: 'Explore', detail: 'haiku: toolchain and media/API facts', model: 'haiku' },
    { title: 'Scaffold', detail: 'Tasks 1.1, 1.2, review R1' },
    { title: 'Core libraries', detail: 'Tasks 2.1-2.5 in worktrees, review each, integrate, test gate' },
    { title: 'Server and capture', detail: 'Tasks 3.1-3.5 in worktrees, review each, integrate, test gate' },
    { title: 'Export and UI', detail: 'Tasks 4.1-4.3 in worktrees, review each, integrate, test gate' },
    { title: 'End-to-end', detail: 'Playwright specs, then fix until green' },
    { title: 'Polish', detail: '4 review lenses, fixes, final gate' },
    { title: 'Deploy docs', detail: 'systemd unit, cloudflared and DEPLOY.md (no actual deploy)' },
  ],
};

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const REPO = '/home/tdobson/dev/video-feedback.tdobson.net';
const PLAN = `${REPO}/docs/plans/2026-11-21-video-feedback.md`;
const SPEC = `${REPO}/docs/superpowers/specs/2026-11-21-video-feedback-design.md`;
const BRANCH = 'feat/video-feedback';
const START = (args && typeof args.startPhase === 'number') ? args.startPhase : 0;

// Role -> model mapping requested by Tim.
const ROLE = {
  explore: { model: 'haiku' },
  build: { model: 'opus', effort: 'low' },
  review: { model: 'fable', effort: 'low' },
  test: { model: 'opus', effort: 'low' },
  fixTests: { model: 'opus', effort: 'high' },
};

const RULES = `
Project: ${REPO} (Next.js 16 + Mantine 9 video feedback tool).
Spec: ${SPEC}
Plan: ${PLAN} (read section 0 "Rules for every task" and section 2 "Shared contracts" before anything else).
Hard rules:
- Run EVERY install, build, lint, typecheck, test, playwright, ffmpeg and dev-server command at low priority:
  ./scripts/lowprio.sh <cmd>  (or "ionice -c2 -n7 nice -n19 <cmd>" if that script does not exist yet).
  The yarn scripts in package.json already wrap themselves, so "yarn check" etc. are fine as they are.
- TDD: failing test first, see it fail, implement, see it pass.
- Shared files (package.json, yarn.lock, lib/types.ts, lib/testids.ts, lib/review/copy.ts, lib/constants.ts, tsconfig.json,
  biome.json, vitest.config.ts) are frozen after Phase 1 unless your task text says otherwise. Report needed changes
  in sharedChangesNeeded instead of editing them.
- No em-dashes in user-facing text.
- "yarn check" must pass before your final commit. Commit your work before you finish.
`;

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const STR_ARR = { type: 'array', items: { type: 'string' } };

const NOTES_SCHEMA = {
  type: 'object',
  properties: { facts: STR_ARR, risks: STR_ARR, recommendations: STR_ARR },
  required: ['facts', 'risks', 'recommendations'],
};

const BUILD_SCHEMA = {
  type: 'object',
  properties: {
    branch: { type: 'string', description: 'git branch holding the work' },
    worktreePath: { type: 'string', description: 'absolute path of the working tree you worked in (output of pwd at repo root)' },
    baseCommit: { type: 'string', description: 'commit your work started from' },
    headCommit: { type: 'string' },
    checkPassing: { type: 'boolean', description: 'did yarn check pass at headCommit' },
    summary: { type: 'string' },
    sharedChangesNeeded: STR_ARR,
  },
  required: ['branch', 'worktreePath', 'baseCommit', 'headCommit', 'checkPassing', 'summary', 'sharedChangesNeeded'],
};

const FINDING = {
  type: 'object',
  properties: {
    severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
    file: { type: 'string' },
    line: { type: 'number' },
    issue: { type: 'string' },
    fix: { type: 'string' },
  },
  required: ['severity', 'file', 'issue', 'fix'],
};

const REVIEW_SCHEMA = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['pass', 'fix'] },
    findings: { type: 'array', items: FINDING },
  },
  required: ['verdict', 'findings'],
};

const INTEGRATE_SCHEMA = {
  type: 'object',
  properties: {
    merged: STR_ARR,
    headCommit: { type: 'string' },
    checkPassing: { type: 'boolean' },
    failures: STR_ARR,
  },
  required: ['merged', 'headCommit', 'checkPassing', 'failures'],
};

const TEST_SCHEMA = {
  type: 'object',
  properties: {
    passing: { type: 'boolean' },
    failures: STR_ARR,
    testsAdded: STR_ARR,
    headCommit: { type: 'string' },
  },
  required: ['passing', 'failures', 'testsAdded', 'headCommit'],
};

// ---------------------------------------------------------------------------
// Task lists (ids match plan headings)
// ---------------------------------------------------------------------------

const PHASE2 = [
  { id: '2.1', title: 'Storage', focus: 'path traversal on every id, timing-safe token compare, exclusive chunk writes, atomic JSON' },
  { id: '2.2', title: 'Geometry', focus: 'letterbox maths, zoom inverse matches the CSS transform, label edges at exactly 1/3 and 2/3' },
  { id: '2.3', title: 'Moment selection', focus: 'dwell timing with sparse pointer samples, merge ranking, cap ordering, word alignment' },
  { id: '2.4', title: 'Media helpers', focus: 'every child process goes through ionice/nice, ffmpeg arg injection, validation messages' },
  { id: '2.5', title: 'Admin auth', focus: 'issuer/audience/alg pinning, service tokens, ADMIN_AUTH=off refused in production, no info leaks' },
];

const PHASE3 = [
  { id: '3.1', title: 'Video import and inbox API', focus: 'auth on every admin route, filename traversal, inbox file only deleted after success, version races' },
  { id: '3.2', title: 'Reviewer API', focus: 'token/session/video binding, size and rate limits, idempotent complete, Range edge cases, no stack traces in responses' },
  { id: '3.3', title: 'Processing pipeline', focus: 'restart recovery, single concurrency, clip work after all other work, Groq retry rules, empty detection' },
  { id: '3.4', title: 'Rendering', focus: 'pointer placement accuracy, zoom crop region, sharp concurrency 1, ffmpeg via low priority, even clip dimensions' },
  { id: '3.5', title: 'Client capture library', focus: 'IndexedDB persistence before send, retry/backoff and trouble signalling, seq ordering, resume after reload' },
];

const PHASE4 = [
  { id: '4.1', title: 'Export bundle', focus: 'spec section 9 fidelity: every field, sort order, inline markers, previous/, ETag, 202/304, no em-dashes' },
  { id: '4.2', title: 'Reviewer UI', focus: 'spec section 5 rule by rule: no timecode anywhere, click while paused never plays, space/arrow rules, zoom only while paused, overlay placement, copy matches, polish and a11y' },
  { id: '4.3', title: 'Admin UI', focus: 'requireAdminPage on every page, empty states, import errors surfaced, download handles 202' },
];

// ---------------------------------------------------------------------------
// Prompt builders
// ---------------------------------------------------------------------------

function notesBlock(notes) {
  if (!notes) return '';
  return `\nExplore notes gathered at the start (trust but verify):\n${notes}\n`;
}

function buildPrompt(task, notes, expectHead) {
  return `${RULES}${notesBlock(notes)}
You are the build agent for Task ${task.id} (${task.title}) of the plan. You are in your own git worktree.
1. Make sure your worktree contains the latest integrated work: run "git log --oneline -3" and, if commit ${expectHead || '(none given)'} is not an ancestor of HEAD, run "git merge ${expectHead || BRANCH}". Create a branch named task-${task.id.replace('.', '-')} from there.
2. Run "./scripts/lowprio.sh yarn install --immutable" if node_modules is missing.
3. Execute Task ${task.id} exactly as written in the plan, step by step, TDD, including every listed test.
4. Run "yarn check". Fix your own failures. Commit.
Return the branch, absolute worktree path, base and head commits, whether yarn check passed, a short summary, and any sharedChangesNeeded.`;
}

function reviewPrompt(task, built) {
  return `${RULES}
You are an adversarial reviewer. Do NOT modify any files. Try to REFUTE that Task ${task.id} (${task.title}) is correct and complete.
The work is in worktree ${built.worktreePath} on branch ${built.branch}. Inspect it with:
  git -C ${built.worktreePath} diff ${built.baseCommit}..${built.headCommit}
and read files under ${built.worktreePath}. You may run tests there (low priority) to confirm a suspicion.
Check against the plan's Task ${task.id} contract and the spec. Special focus: ${task.focus}.
Also check: tests really exercise behaviour (not just mocks of themselves), no skipped tests, no dead code, names match the shared contracts.
Report only real problems with evidence. verdict "pass" if there are no critical/high/medium findings.`;
}

function fixPrompt(task, built, findings) {
  return `${RULES}
You are the build agent fixing review findings for Task ${task.id} (${task.title}).
Work ONLY inside ${built.worktreePath} (cd there first), on branch ${built.branch}.
Findings to fix (add a test for each where it makes sense):
${JSON.stringify(findings, null, 2)}
If you believe a finding is wrong, leave the code as is and explain why in summary.
Run "yarn check", commit, and return the same fields as before (worktreePath must stay ${built.worktreePath}, baseCommit stays ${built.baseCommit}).`;
}

function integratePrompt(results, extra) {
  const list = results
    .map((r) => `- ${r.task.id} ${r.task.title}: branch ${r.branch} at ${r.worktreePath} (head ${r.headCommit}); yarn check ${r.checkPassing ? 'passed' : 'FAILED'}; sharedChangesNeeded: ${JSON.stringify(r.sharedChangesNeeded || [])}; unresolved review notes: ${JSON.stringify(r.openFindings || [])}`)
    .join('\n');
  return `${RULES}
You are the integration agent. Work in the main tree ${REPO} on branch ${BRANCH}.
Merge these task branches in order with "git merge --no-ff <branch>", resolving conflicts carefully (keep both sides' intent; the plan's contracts win):
${list}
Then apply every sharedChangesNeeded item (you may edit the frozen shared files for this), run "./scripts/lowprio.sh yarn install" if package.json changed, and run "yarn check".
${extra || ''}
Fix integration breakages (not feature work). Commit. Remove the merged worktrees with "git worktree remove <path>" (use --force only if the branch is fully merged).
Return merged branches, the new head commit, whether yarn check passes, and any remaining failures.`;
}

function testGatePrompt(scope, commands) {
  return `${RULES}
You are the test agent for: ${scope}. Work in ${REPO} on ${BRANCH}.
1. Run: ${commands}.
2. Compare the tests that exist with the plan's contracts and the spec sections for this scope. Add missing tests for untested contract items and spec rules (TDD style: they should pass if the code is right; if a new test fails, that is a real bug, keep the test and report the failure).
3. Commit new tests ("test: ...").
Return whether everything passes, the failures (test name + assertion + likely cause), the tests you added, and the head commit.`;
}

function fixTestsPrompt(scope, failures, commands) {
  return `${RULES}
You are the fix-tests agent for: ${scope}. Work in ${REPO} on ${BRANCH}.
These are failing:
${failures.map((f) => `- ${f}`).join('\n')}
For each: reproduce, find the root cause, decide whether the code or the test is wrong against the spec (the spec wins), and fix the root cause. Do not weaken assertions, skip tests or add arbitrary sleeps. For Playwright, use traces (--trace on) and auto-waiting locators/expect.poll.
Then run: ${commands}. Commit.
Return whether everything passes now, any remaining failures with diagnosis, tests you added, and the head commit.`;
}

// ---------------------------------------------------------------------------
// Building blocks
// ---------------------------------------------------------------------------

const BLOCKING = ['critical', 'high', 'medium'];

async function buildReviewed(task, phaseTitle, notes, expectHead) {
  let built = await agent(buildPrompt(task, notes, expectHead), {
    ...ROLE.build, isolation: 'worktree', phase: phaseTitle, label: `build ${task.id} ${task.title}`, schema: BUILD_SCHEMA,
  });
  if (!built) {
    log(`Task ${task.id} build agent returned nothing; it will be missing from integration.`);
    return null;
  }
  let review = null;
  for (let round = 1; round <= 2; round++) {
    review = await agent(reviewPrompt(task, built), {
      ...ROLE.review, phase: phaseTitle, label: `review ${task.id} #${round}`, schema: REVIEW_SCHEMA,
    });
    const blocking = (review?.findings || []).filter((f) => BLOCKING.includes(f.severity));
    if (!review || blocking.length === 0) break;
    if (round === 2) {
      log(`Task ${task.id}: ${blocking.length} blocking findings remain after 2 review rounds; passing them to integration.`);
      break;
    }
    const fixed = await agent(fixPrompt(task, built, blocking), {
      ...ROLE.build, phase: phaseTitle, label: `fix ${task.id} #${round}`, schema: BUILD_SCHEMA,
    });
    if (fixed) built = { ...built, headCommit: fixed.headCommit, checkPassing: fixed.checkPassing, summary: fixed.summary,
      sharedChangesNeeded: [...new Set([...(built.sharedChangesNeeded || []), ...(fixed.sharedChangesNeeded || [])])] };
  }
  return { ...built, task, openFindings: (review?.findings || []) };
}

async function gate(phaseTitle, scope, commands, maxRounds) {
  let result = await agent(testGatePrompt(scope, commands), {
    ...ROLE.test, phase: phaseTitle, label: `test gate: ${scope}`, schema: TEST_SCHEMA,
  });
  let round = 0;
  while (result && !result.passing && round < maxRounds) {
    round++;
    const fixed = await agent(fixTestsPrompt(scope, result.failures, commands), {
      ...ROLE.fixTests, phase: phaseTitle, label: `fix tests: ${scope} #${round}`, schema: TEST_SCHEMA,
    });
    if (!fixed) break;
    result = fixed;
  }
  if (result && !result.passing) log(`${scope}: still failing after ${round} fix rounds: ${result.failures.join('; ')}`);
  return result;
}

async function buildPhase(phaseTitle, tasks, notes, expectHead, integrateExtra, gateScope, gateCommands) {
  phase(phaseTitle);
  const results = (await pipeline(tasks, (t) => buildReviewed(t, phaseTitle, notes, expectHead))).filter(Boolean);
  const missing = tasks.filter((t) => !results.some((r) => r.task.id === t.id)).map((t) => t.id);
  if (missing.length) log(`${phaseTitle}: tasks with no result: ${missing.join(', ')}`);
  const integ = await agent(integratePrompt(results, integrateExtra), {
    ...ROLE.build, phase: phaseTitle, label: `integrate ${phaseTitle}`, schema: INTEGRATE_SCHEMA,
  });
  const g = await gate(phaseTitle, gateScope, gateCommands, 3);
  return { results: results.map((r) => ({ id: r.task.id, head: r.headCommit, check: r.checkPassing })), integ, gate: g, head: g?.headCommit || integ?.headCommit };
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

const report = {};
let notes = '';
let head = null;

// Phase 0: Explore
if (START <= 0) {
  phase('Explore');
  const [tool, media] = await parallel([
    () => agent(`${RULES}\nRead-only. Do Task 0.1 of the plan (toolchain facts). Use npm view, official docs and ~/dev/next-app-template/node_modules. Be concrete: exact config snippets and versions.`, {
      ...ROLE.explore, phase: 'Explore', label: 'explore toolchain', schema: NOTES_SCHEMA,
    }),
    () => agent(`${RULES}\nRead-only (you may run harmless ffmpeg -encoders/-filters queries). Do Task 0.2 of the plan (media and API facts). Check ~/dev/transcribeMe for how Groq is called today. Be concrete.`, {
      ...ROLE.explore, phase: 'Explore', label: 'explore media + APIs', schema: NOTES_SCHEMA,
    }),
  ]);
  const all = [tool, media].filter(Boolean);
  notes = all.map((n) => [
    ...n.facts.map((f) => `FACT: ${f}`),
    ...n.risks.map((r) => `RISK: ${r}`),
    ...n.recommendations.map((r) => `RECOMMEND: ${r}`),
  ].join('\n')).join('\n');
  report.explore = all;
}

// Phase 1: Scaffold (sequential, main tree)
if (START <= 1) {
  phase('Scaffold');
  for (const id of ['1.1', '1.2']) {
    await agent(`${RULES}${notesBlock(notes)}
You are the build agent for Task ${id} of the plan. Work in the main tree ${REPO}. ${id === '1.1' ? `Start by creating branch ${BRANCH} from spec/video-feedback-design as the task says.` : `You are on ${BRANCH}.`}
Execute every step of Task ${id} exactly, TDD, then "yarn check" (and "yarn build" for 1.1), then commit.`, {
      ...ROLE.build, phase: 'Scaffold', label: `build ${id}`, schema: BUILD_SCHEMA,
    });
  }
  let r1 = null;
  for (let round = 1; round <= 2; round++) {
    r1 = await agent(`${RULES}
Adversarial review, read-only. Do Task R1 of the plan: review "git -C ${REPO} diff spec/video-feedback-design..${BRANCH}". Try to refute that Phase 1 is correct and complete.`, {
      ...ROLE.review, phase: 'Scaffold', label: `review R1 #${round}`, schema: REVIEW_SCHEMA,
    });
    const blocking = (r1?.findings || []).filter((f) => BLOCKING.includes(f.severity));
    if (!blocking.length || round === 2) break;
    await agent(`${RULES}
Fix these Phase 1 review findings in ${REPO} on ${BRANCH}, add tests where sensible, run "yarn check", commit:
${JSON.stringify(blocking, null, 2)}`, { ...ROLE.build, phase: 'Scaffold', label: `fix R1 #${round}`, schema: BUILD_SCHEMA });
  }
  const g1 = await gate('Scaffold', 'Phase 1 scaffold and contracts', '"yarn check" and "yarn build"', 2);
  head = g1?.headCommit || head;
  report.scaffold = { review: r1, gate: g1 };
}

// Phase 2: Core libraries
if (START <= 2) {
  const p2 = await buildPhase('Core libraries', PHASE2, notes, head, '',
    'Phase 2 core libraries (storage, geometry, moments, media, auth)', '"yarn check" and "yarn test:coverage"');
  head = p2.head || head;
  report.core = p2;
}

// Phase 3: Server features and capture
if (START <= 3) {
  const p3 = await buildPhase('Server and capture', PHASE3, notes, head,
    'Also do the I3 extra from the plan: replace the "render not wired" stubs in lib/pipeline/steps/index.ts with the real stills and clip steps, and add the end-to-end processComment integration test with includeClip: true.',
    'Phase 3 server features and capture library', '"yarn check" and "yarn test:coverage"');
  head = p3.head || head;
  report.server = p3;
}

// Phase 4: Export, reviewer UI, admin UI
if (START <= 4) {
  const p4 = await buildPhase('Export and UI', PHASE4, notes, head,
    'Also run "yarn build" after merging and fix any build errors.',
    'Phase 4 export, reviewer UI and admin UI', '"yarn check" and "yarn build"');
  head = p4.head || head;
  report.ui = p4;
}

// Phase 5: End-to-end
if (START <= 5) {
  phase('End-to-end');
  const e2e = await agent(`${RULES}${notesBlock(notes)}
You are the test agent. Do Task 5.1 of the plan in ${REPO} on ${BRANCH}: Playwright config, global setup and every listed spec, using data-testids from lib/testids.ts. Install browsers at low priority. Run "yarn test:e2e". Commit the specs even if some fail.
Return passing, failures (spec + test name + failing assertion + trace path), testsAdded, headCommit.`, {
    ...ROLE.test, phase: 'End-to-end', label: 'write + run E2E', schema: TEST_SCHEMA,
  });
  let result = e2e;
  let round = 0;
  while (result && !result.passing && round < 4) {
    round++;
    const fixed = await agent(fixTestsPrompt('Playwright end-to-end suite (Task 5.2)', result.failures, '"yarn check" then "yarn test:e2e"'), {
      ...ROLE.fixTests, phase: 'End-to-end', label: `fix E2E #${round}`, schema: TEST_SCHEMA,
    });
    if (!fixed) break;
    result = fixed;
  }
  if (result && !result.passing) log(`E2E still failing after ${round} rounds: ${result.failures.join('; ')}`);
  report.e2e = result;
}

// Phase 6: Polish
if (START <= 6) {
  phase('Polish');
  const LENSES = [
    { key: 'spec', prompt: 'Lens 1 (spec compliance) of Task 6.1.' },
    { key: 'security', prompt: 'Lens 2 (security) of Task 6.1.' },
    { key: 'ux', prompt: 'Lens 3 (reviewer UX polish) of Task 6.1. Look at screenshots in test-results/ and, if useful, run the app (yarn dev at low priority) and screenshot screens yourself.' },
    { key: 'robustness', prompt: 'Lens 4 (robustness) of Task 6.1.' },
  ];
  const reviews = await parallel(LENSES.map((l) => () => agent(`${RULES}
Adversarial review, read-only (no file edits). ${l.prompt} Review the whole branch: "git -C ${REPO} diff spec/video-feedback-design..${BRANCH}" plus the files themselves. Report real problems with evidence only.`, {
    ...ROLE.review, phase: 'Polish', label: `review: ${l.key}`, schema: REVIEW_SCHEMA,
  })));
  const findings = reviews.filter(Boolean).flatMap((r, i) => r.findings.map((f) => ({ lens: LENSES[i].key, ...f })));
  log(`Polish review: ${findings.length} findings (${findings.filter((f) => BLOCKING.includes(f.severity)).length} blocking).`);
  if (findings.length) {
    await agent(`${RULES}
Do Task 6.2 of the plan in ${REPO} on ${BRANCH}. Fix every critical/high/medium finding below, adding a test that would have caught each. Low findings: fix if quick, otherwise list them in docs/FOLLOW-UPS.md. Run "yarn check", commit per area.
${JSON.stringify(findings, null, 2)}`, { ...ROLE.build, phase: 'Polish', label: 'apply polish fixes', schema: BUILD_SCHEMA });
  }
  const finalGate = await gate('Polish', 'final gate (Task 6.3)', '"yarn check", "yarn build" and "yarn test:e2e"', 3);
  report.polish = { findings: findings.length, gate: finalGate };
}

// Phase 7: Deploy docs (no deploy)
if (START <= 7) {
  phase('Deploy docs');
  report.deploy = await agent(`${RULES}
Do Task 7.1 of the plan in ${REPO} on ${BRANCH}: deploy/video-feedback.service, deploy/cloudflared.md, docs/DEPLOY.md and the README usage section. Do NOT deploy or touch geriatrix. Run "yarn check", commit.`, {
    ...ROLE.build, phase: 'Deploy docs', label: 'deploy docs', schema: BUILD_SCHEMA,
  });
}

return report;
