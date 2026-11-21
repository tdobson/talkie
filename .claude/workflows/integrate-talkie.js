export const meta = {
  name: 'integrate-talkie',
  description:
    'Merge video-feedback and Talkie into one monorepo and add Talkie films as a reviewable media kind (docs/plans/2026-11-21-talkie-review.md)',
  whenToUse:
    'Only after BOTH builds are completely finished (TALKIE_DONE from /tmp/talkie-done-watch.sh) and Tim has said go. Pass {startPhase: N} to skip finished phases (0-6).',
  phases: [
    { title: 'Preflight', detail: 'haiku: both builds finished and green; map the Talkie APIs as built', model: 'haiku' },
    { title: 'Monorepo', detail: 'Task 1.1 move + merge + reconcile, Task 1.2 gate' },
    { title: 'Contracts', detail: 'Tasks 2.1 contracts, 2.2 fixture film' },
    { title: 'Talkie support', detail: 'Tasks 3.1-3.4 in worktrees, review 3.1-3.3, integrate, gate' },
    { title: 'End-to-end', detail: 'Task 4.1 Talkie flow + full MP4 regression, fix until green' },
    { title: 'Polish', detail: 'one review lens, fixes, final gate' },
    { title: 'Deploy docs', detail: 'DEPLOY.md, unit paths, root README (no deploy)' },
  ],
};

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const REPO = '/home/tdobson/dev/video-feedback.tdobson.net';
const PLAN = `${REPO}/docs/plans/2026-11-21-talkie-review.md`;
const SPEC = `${REPO}/docs/superpowers/specs/2026-11-21-talkie-review-design.md`;
const BASE_SPEC = `${REPO}/docs/superpowers/specs/2026-11-21-video-feedback-design.md`;
const BRANCH = 'feat/monorepo';
const VF_BRANCH = 'feat/video-feedback';
const TALKIE_BRANCH = 'svg-animation-codec-or-container';
const START = args && typeof args.startPhase === 'number' ? args.startPhase : 0;

// Same role mapping as build-video-feedback.js (Tim's choice): Fable 5.2 low writes, checking kept light.
const ROLE = {
  explore: { model: 'haiku' },
  build: { model: 'fable', effort: 'low' },
  review: { model: 'fable', effort: 'low' },
  test: { model: 'opus', effort: 'low' },
  fixTests: { model: 'opus', effort: 'high' },
};

const RULES = `
Repo: ${REPO}. Target branch: ${BRANCH} (created in Task 1.1 from ${VF_BRANCH}, then ${TALKIE_BRANCH} merged in).
Plan: ${PLAN} (read section 0 "Rules for every task" first, then your task).
Spec: ${SPEC} (Talkie additions) on top of the base spec ${BASE_SPEC}.
Hard rules:
- Background capacity only. EVERY install, build, lint, typecheck (tsgo), test, playwright, ffmpeg, chromium, node and
  dev-server command runs at "ionice -c2 -n7 nice -n19": use scripts/low at the root, ./scripts/lowprio.sh inside
  apps/video-feedback, or the yarn scripts (they already wrap themselves). Never a negative nice value.
  Vitest/Jest 2 workers, Playwright 2 workers, Next cpus 2. Never two builds or two e2e runs in one tree at once.
- No film renders on this machine beyond the 4 s 320x180 fixture.
- TDD: failing test first, see it fail, implement, see it pass.
- After Phase 2 the shared files listed in plan rule 5 are frozen: report changes in sharedChangesNeeded instead.
- The MP4 path must not regress: existing tests pass with only import-path changes.
- No em-dashes in user-facing text.
- Before your final commit, "yarn check" at the repo root (or your worktree root) must pass. Commit before you finish.
`;

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const STR_ARR = { type: 'array', items: { type: 'string' } };

const PREFLIGHT_SCHEMA = {
  type: 'object',
  properties: {
    ready: { type: 'boolean' },
    vfHead: { type: 'string' },
    talkieHead: { type: 'string' },
    vfCheck: { type: 'string', description: 'pass/fail counts of yarn check on the video-feedback tip' },
    talkieTest: { type: 'string', description: 'pass/fail counts of yarn test on the Talkie tip' },
    notes: STR_ARR,
  },
  required: ['ready', 'vfHead', 'talkieHead', 'vfCheck', 'talkieTest', 'notes'],
};

const NOTES_SCHEMA = {
  type: 'object',
  properties: { facts: STR_ARR, risks: STR_ARR, recommendations: STR_ARR },
  required: ['facts', 'risks', 'recommendations'],
};

const BUILD_SCHEMA = {
  type: 'object',
  properties: {
    branch: { type: 'string' },
    worktreePath: { type: 'string', description: 'absolute path of the working tree you worked in' },
    baseCommit: { type: 'string' },
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
  properties: { verdict: { type: 'string', enum: ['pass', 'fix'] }, findings: { type: 'array', items: FINDING } },
  required: ['verdict', 'findings'],
};

const INTEGRATE_SCHEMA = {
  type: 'object',
  properties: { merged: STR_ARR, headCommit: { type: 'string' }, checkPassing: { type: 'boolean' }, failures: STR_ARR },
  required: ['merged', 'headCommit', 'checkPassing', 'failures'],
};

const TEST_SCHEMA = {
  type: 'object',
  properties: { passing: { type: 'boolean' }, failures: STR_ARR, testsAdded: STR_ARR, headCommit: { type: 'string' } },
  required: ['passing', 'failures', 'testsAdded', 'headCommit'],
};

// ---------------------------------------------------------------------------
// Tasks (ids match plan headings)
// ---------------------------------------------------------------------------

const PHASE3 = [
  { id: '3.1', title: 'Import, storage and film route', review: true,
    focus: 'zip traversal and bombs, size checked while streaming, path allow-list, kind mismatch 404s, Range edge cases, nothing half-written on failure' },
  { id: '3.2', title: 'Client media adapters', review: true,
    focus: 'base spec section 5 rule by rule for both kinds (no timecode anywhere, space/arrow rules, click while paused never plays, zoom only while paused), MP4 behaviour unchanged, no SSR import of @talkie/player, listener cleanup' },
  { id: '3.3', title: 'Server frame sources', review: true,
    focus: 'zombie Chromium, nice 19 really applied, per-frame timeout, loopback-only server, memory on a 2-core 9 GB host, MP4 path unchanged' },
  { id: '3.4', title: 'Export enrichment', review: false, focus: 'Talkie spec section 10 fidelity; mp4 export byte-identical' },
];

// ---------------------------------------------------------------------------
// Prompt builders
// ---------------------------------------------------------------------------

const notesBlock = (notes) => (notes ? `\nFacts gathered in Task 0.2 (trust but verify):\n${notes}\n` : '');

function buildPrompt(task, notes, expectHead) {
  return `${RULES}${notesBlock(notes)}
You are the build agent for plan Task ${task.id} (${task.title}). You are in your own git worktree.
1. Make sure the worktree has the latest integrated work: if ${expectHead || BRANCH} is not an ancestor of HEAD, "git merge ${expectHead || BRANCH}". Then "git switch -c task-t${task.id.replace('.', '-')}".
2. "scripts/low yarn install --immutable" if node_modules is missing.
3. Execute Task ${task.id} exactly as written, TDD, with every listed test. Commit as you go.
4. Run "yarn check" at the worktree root. Fix your own failures. Commit.
Return branch, absolute worktree path, base and head commits, whether yarn check passed, a summary, and sharedChangesNeeded.`;
}

function reviewPrompt(task, built) {
  return `${RULES}
You are an adversarial reviewer. Do NOT modify files. Try to REFUTE that Task ${task.id} (${task.title}) is correct and complete.
Work: worktree ${built.worktreePath}, branch ${built.branch}. Inspect "git -C ${built.worktreePath} diff ${built.baseCommit}..${built.headCommit}" and the files.
You may run tests there at low priority to confirm a suspicion. Special focus: ${task.focus}.
Also: tests exercise real behaviour, nothing skipped, names match the Phase 2 contracts. Real problems with evidence only.
verdict "pass" if nothing is critical, high or medium.`;
}

function fixPrompt(task, built, findings) {
  return `${RULES}
Fix these review findings for Task ${task.id} (${task.title}). Work ONLY in ${built.worktreePath} on ${built.branch}.
${JSON.stringify(findings, null, 2)}
Add a test per finding where it makes sense. If a finding is wrong, leave the code and say why in summary.
"yarn check", commit, return the same fields (worktreePath ${built.worktreePath}, baseCommit ${built.baseCommit}).`;
}

function testGatePrompt(scope, commands) {
  return `${RULES}
You are the test agent for: ${scope}. Work in ${REPO} on ${BRANCH}.
1. Run, one at a time: ${commands}.
2. Compare existing tests with the plan tasks and spec sections in scope. Add missing tests for untested contract items and spec rules; a new failing test is a real bug: keep it and report it.
3. Commit new tests ("test: ...").
Return passing, failures (test + assertion + likely cause), testsAdded, headCommit.`;
}

function fixTestsPrompt(scope, failures, commands) {
  return `${RULES}
You are the fix-tests agent for: ${scope}. Work in ${REPO} on ${BRANCH}.
Failing:
${failures.map((f) => `- ${f}`).join('\n')}
For each: reproduce, find the root cause, decide against the spec whether code or test is wrong (the spec wins), fix the root cause.
No weakened assertions, skipped tests or arbitrary sleeps. For Playwright use traces and auto-waiting locators.
Then run, one at a time: ${commands}. Commit. Return passing, remaining failures with diagnosis, testsAdded, headCommit.`;
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
    log(`Task ${task.id}: build agent returned nothing; it will be missing from integration.`);
    return null;
  }
  if (!task.review) return { ...built, task, openFindings: [] };
  const review = await agent(reviewPrompt(task, built), {
    ...ROLE.review, phase: phaseTitle, label: `review ${task.id}`, schema: REVIEW_SCHEMA,
  });
  const blocking = (review?.findings || []).filter((f) => BLOCKING.includes(f.severity));
  if (blocking.length) {
    const fixed = await agent(fixPrompt(task, built, blocking), {
      ...ROLE.build, phase: phaseTitle, label: `fix ${task.id}`, schema: BUILD_SCHEMA,
    });
    if (fixed) {
      built = {
        ...built, headCommit: fixed.headCommit, checkPassing: fixed.checkPassing, summary: fixed.summary,
        sharedChangesNeeded: [...new Set([...(built.sharedChangesNeeded || []), ...(fixed.sharedChangesNeeded || [])])],
      };
    }
  }
  return { ...built, task, openFindings: (review?.findings || []).filter((f) => !BLOCKING.includes(f.severity)) };
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

function stop(reason) {
  log(`STOPPED: ${reason}`);
  return { stopped: true, reason, report };
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

const report = {};
let notes = '';
let head = null;

// Phase 0: preflight (hard stop if either build is unfinished) and API map
if (START <= 0) {
  phase('Preflight');
  const [pre, map] = await parallel([
    () => agent(`${RULES}\nRead-only except throwaway worktrees under /tmp (remove them when done). Do plan Task 0.1 exactly. Be strict: if anything suggests either build is still running or unfinished, ready=false.`, {
      ...ROLE.explore, phase: 'Preflight', label: 'preflight: both builds done', schema: PREFLIGHT_SCHEMA,
    }),
    () => agent(`${RULES}\nRead-only. Do plan Task 0.2 against branch ${TALKIE_BRANCH} (use "git show ${TALKIE_BRANCH}:<path>" or its worktree). Give exact signatures and file paths.`, {
      ...ROLE.explore, phase: 'Preflight', label: 'map Talkie APIs', schema: NOTES_SCHEMA,
    }),
  ]);
  report.preflight = pre;
  if (!pre || !pre.ready) return stop(`preflight not ready: ${pre ? pre.notes.join('; ') : 'no result'}`);
  if (map) {
    notes = [...map.facts.map((f) => `FACT: ${f}`), ...map.risks.map((r) => `RISK: ${r}`), ...map.recommendations.map((r) => `RECOMMEND: ${r}`)].join('\n');
    report.apiMap = map;
  }
}

// Phase 1: monorepo restructure (sequential, main tree)
if (START <= 1) {
  phase('Monorepo');
  const moved = await agent(`${RULES}${notesBlock(notes)}
You are the build agent for plan Task 1.1. Work in the main tree ${REPO}. Start from ${VF_BRANCH} (git status must be clean first; stop and report if not).
Execute every step of Task 1.1 exactly, including the conflict table. Then "yarn check" at the root, "yarn workspace video-feedback build" and "yarn build", one at a time. Commit.`, {
    ...ROLE.build, phase: 'Monorepo', label: 'build 1.1 move + merge', schema: BUILD_SCHEMA,
  });
  report.monorepo = { moved };
  if (!moved) return stop('Task 1.1 returned nothing');
  const g = await gate('Monorepo', 'Task 1.2 monorepo restructure',
    '"yarn check", "yarn workspace video-feedback test:e2e", "yarn e2e" (Talkie)', 2);
  report.monorepo.gate = g;
  head = g?.headCommit || moved.headCommit;
  if (!g || !g.passing) return stop('the restructured monorepo is not green; fix before adding features');
}

// Phase 2: contracts and fixture (sequential, main tree)
if (START <= 2) {
  phase('Contracts');
  for (const id of ['2.1', '2.2']) {
    const r = await agent(`${RULES}${notesBlock(notes)}
You are the build agent for plan Task ${id}. Work in the main tree ${REPO} on ${BRANCH}. Execute every step exactly, TDD, "yarn check", commit.`, {
      ...ROLE.build, phase: 'Contracts', label: `build ${id}`, schema: BUILD_SCHEMA,
    });
    report[`task${id}`] = r;
    if (r) head = r.headCommit;
  }
}

// Phase 3: parallel Talkie support builds
if (START <= 3) {
  const title = 'Talkie support';
  phase(title);
  const results = (await pipeline(PHASE3, (t) => buildReviewed(t, title, notes, head))).filter(Boolean);
  const missing = PHASE3.filter((t) => !results.some((r) => r.task.id === t.id)).map((t) => t.id);
  if (missing.length) log(`${title}: no result for ${missing.join(', ')}`);
  const list = results.map((r) => `- ${r.task.id} ${r.task.title}: branch ${r.branch} at ${r.worktreePath} (head ${r.headCommit}); check ${r.checkPassing ? 'passed' : 'FAILED'}; sharedChangesNeeded ${JSON.stringify(r.sharedChangesNeeded || [])}; open low findings ${JSON.stringify(r.openFindings || [])}`).join('\n');
  const integ = await agent(`${RULES}
You are the integration agent. Main tree ${REPO}, branch ${BRANCH}. Merge in order with "git merge --no-ff":
${list}
Then do the plan's "Integration and gate" step for Phase 3: wire lib/media/frame-sources.ts into the pipeline steps, apply every sharedChangesNeeded (frozen files may be edited for this), "scripts/low yarn install" if manifests changed, "yarn check" and "yarn workspace video-feedback build".
Fix integration breakage only. Commit. Remove merged worktrees ("git worktree remove <path>"; --force only if fully merged).`, {
    ...ROLE.build, phase: title, label: 'integrate Talkie support', schema: INTEGRATE_SCHEMA,
  });
  const g = await gate(title, 'Phase 3 Talkie support',
    '"yarn check", "yarn workspace video-feedback test:chromium", "yarn workspace video-feedback build"', 2);
  report.talkie = { results: results.map((r) => ({ id: r.task.id, head: r.headCommit, check: r.checkPassing })), integ, gate: g };
  head = g?.headCommit || integ?.headCommit || head;
}

// Phase 4: end-to-end
if (START <= 4) {
  phase('End-to-end');
  const cmds = '"yarn check" then "yarn workspace video-feedback test:e2e"';
  let result = await agent(`${RULES}
You are the test agent. Do plan Task 4.1 in ${REPO} on ${BRANCH}. Write the spec and helpers, then run ${cmds}. Commit the spec even if some tests fail.
Return passing, failures (spec + test + failing assertion + trace path), testsAdded, headCommit.`, {
    ...ROLE.test, phase: 'End-to-end', label: 'write + run Talkie E2E', schema: TEST_SCHEMA,
  });
  let round = 0;
  while (result && !result.passing && round < 3) {
    round++;
    const fixed = await agent(fixTestsPrompt('end-to-end suite with Talkie (Task 4.1)', result.failures, cmds), {
      ...ROLE.fixTests, phase: 'End-to-end', label: `fix E2E #${round}`, schema: TEST_SCHEMA,
    });
    if (!fixed) break;
    result = fixed;
  }
  if (result && !result.passing) log(`E2E still failing after ${round} rounds: ${result.failures.join('; ')}`);
  report.e2e = result;
}

// Phase 5: polish
if (START <= 5) {
  phase('Polish');
  const review = await agent(`${RULES}
Adversarial review, read-only. Plan Task 5.1: Talkie spec compliance, reviewer UX on a Talkie film (look at screenshots in apps/video-feedback/test-results/), and security of import and the film route.
Review "git -C ${REPO} diff ${VF_BRANCH}..${BRANCH} -- apps/video-feedback" and the files. Real problems with evidence only.`, {
    ...ROLE.review, phase: 'Polish', label: 'review: Talkie spec, UX, security', schema: REVIEW_SCHEMA,
  });
  const findings = review?.findings || [];
  log(`Polish review: ${findings.length} findings (${findings.filter((f) => BLOCKING.includes(f.severity)).length} blocking).`);
  if (findings.length) {
    report.polishFix = await agent(`${RULES}
Plan Task 5.2. Main tree ${REPO}, branch ${BRANCH}. Fix every critical, high and medium finding with a test, and the quick lows.
Record the rest in docs/FOLLOW-UPS.md under a "Talkie" heading. "yarn check", commit.
${JSON.stringify(findings, null, 2)}`, { ...ROLE.build, phase: 'Polish', label: 'apply polish fixes', schema: BUILD_SCHEMA });
  }
  report.polish = { findings: findings.length, gate: await gate('Polish', 'final gate (Task 5.2)',
    '"yarn check", "yarn workspace video-feedback test:e2e", "yarn e2e", "yarn workspace video-feedback test:chromium", "yarn workspace video-feedback build"', 2) };
}

// Phase 6: deployment docs (nothing is deployed)
if (START <= 6) {
  phase('Deploy docs');
  report.deploy = await agent(`${RULES}
Plan Task 6.1 in ${REPO} on ${BRANCH}. Documentation and the unit file only: do not touch geriatrix or any remote host. "yarn check", commit.`, {
    ...ROLE.build, phase: 'Deploy docs', label: 'deploy docs', schema: BUILD_SCHEMA,
  });
}

return report;
