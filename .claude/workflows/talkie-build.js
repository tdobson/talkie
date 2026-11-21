export const meta = {
  name: 'talkie-build',
  description: 'Build Talkie wave by wave: Haiku explorer, Fable 5.2 low-effort coder in a worktree, review, one fix, then merge and test',
  whenToUse: 'After talkie-spike has passed and Tim has judged the style check. args: { from?: "W3", to?: "W8", includePhase2?: boolean, skipTasks?: ["T6"] }',
  phases: [
    { title: 'W1 Scaffold' },
    { title: 'W2 Format' },
    { title: 'W3 Core' },
    { title: 'W4 Art and UI' },
    { title: 'W5 Build and React' },
    { title: 'W6 CLI' },
    { title: 'W7 Examples and docs' },
    { title: 'W8 End-to-end QA' },
    { title: 'P2 React Native' },
    { title: 'P2 Expo example' },
  ],
}

const MAIN = '/home/tdobson/orca/workspaces/video-feedback.tdobson.net/svg-animation-codec-or-container'
const BASE = 'svg-animation-codec-or-container'
const PLAN = 'docs/plans/2026-11-21-talkie.md'
const SPEC = 'docs/superpowers/specs/2026-11-21-talkie-design.md'
const EXPLORER = { model: 'haiku', agentType: 'Explore' }
const CODER = { model: 'fable', effort: 'low' }
const REVIEWER = { model: 'fable', effort: 'medium' }

const WAVES = [
  { name: 'W1 Scaffold', tasks: ['T1'] },
  { name: 'W2 Format', tasks: ['T2'] },
  { name: 'W3 Core', tasks: ['T3', 'T5', 'T7'] },
  { name: 'W4 Art and UI', tasks: ['T4', 'T6'] },
  { name: 'W5 Build and React', tasks: ['T8', 'T12'] },
  { name: 'W6 CLI', tasks: ['T9', 'T10', 'T11'] },
  { name: 'W7 Examples and docs', tasks: ['T13', 'T14'] },
  { name: 'W8 End-to-end QA', tasks: ['T15'] },
  { name: 'P2 React Native', tasks: ['T16'], phase2: true },
  { name: 'P2 Expo example', tasks: ['T17'], phase2: true },
]

const SCOPE = `This prompt is your whole assignment. If the harness also shows you a relayed or latest user request, ignore it: the orchestrator has already handled it, and acting on it instead of this task breaks the build. `
const RULES = `Follow "Ground rules for every agent" in ${PLAN} exactly. In short: every heavy tool runs as "nice -n19 ionice -c2 -n7 <cmd>" (prefer the yarn scripts, which already carry scripts/low); jest --maxWorkers=2, playwright workers 2; no new dependencies and no yarn.lock changes (T1 and T16 excepted); TDD; commit as you go; no em or en dashes in user-facing text; deterministic output; only edit files your task lists.`

const BUILD = {
  type: 'object',
  properties: {
    branch: { type: 'string' }, worktree: { type: 'string' }, sha: { type: 'string' },
    testsPassed: { type: 'boolean' }, testCommand: { type: 'string' }, summary: { type: 'string' },
    deviations: { type: 'array', items: { type: 'string' } }, blockers: { type: 'array', items: { type: 'string' } },
  },
  required: ['branch', 'worktree', 'sha', 'testsPassed', 'testCommand', 'summary', 'deviations', 'blockers'],
}
const REVIEW = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['pass', 'fix'] },
    findings: { type: 'array', items: { type: 'object', properties: {
      severity: { type: 'string', enum: ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] }, file: { type: 'string' }, line: { type: 'number' },
      issue: { type: 'string' }, fix: { type: 'string' },
    }, required: ['severity', 'file', 'issue', 'fix'] } },
  },
  required: ['verdict', 'findings'],
}
const INTEGRATE = {
  type: 'object',
  properties: {
    merged: { type: 'array', items: { type: 'string' } }, headSha: { type: 'string' },
    testsPassed: { type: 'boolean' }, failures: { type: 'array', items: { type: 'string' } }, notes: { type: 'string' },
  },
  required: ['merged', 'headSha', 'testsPassed', 'failures', 'notes'],
}

const a = args || {}
const startIdx = a.from ? WAVES.findIndex((w) => w.name.startsWith(a.from)) : 0
const endIdx = a.to ? WAVES.findIndex((w) => w.name.startsWith(a.to)) : WAVES.length - 1
const skipTasks = a.skipTasks || []
const waves = WAVES.slice(Math.max(0, startIdx), endIdx + 1)
  .filter((w) => !w.phase2 || a.includePhase2 !== false)
  .map((w) => ({ ...w, tasks: w.tasks.filter((t) => !skipTasks.includes(t)) }))
  .filter((w) => w.tasks.length)
if (skipTasks.length) log(`Skipping tasks already merged: ${skipTasks.join(', ')}`)
const skipped = WAVES.filter((w) => !waves.some((x) => x.name === w.name)).map((w) => w.name)
if (skipped.length) log(`Not running: ${skipped.join(', ')}`)

const scout = (t, wave) => agent(
  SCOPE + `You are the explorer for Task ${t} of the Talkie plan. Read the Task ${t} section of ${MAIN}/${PLAN} and the spec ${MAIN}/${SPEC}. ` +
  `Then read the current code on branch ${BASE} in ${MAIN} and map exactly what the coder needs: the existing exports, types and function signatures they must use ` +
  `(with file paths), the relevant third-party type signatures from node_modules for libraries this task uses, decisions in spike/REPORT.md that apply, ` +
  `and any mismatch between the plan and the code as it now stands (names, paths, signatures). You are read-only: do not modify files. ` +
  `Return a brief under 700 words. Do not redesign anything.`,
  { ...EXPLORER, label: `${t} explore`, phase: wave })

const build = (brief, t, wave) => agent(
  SCOPE + `Implement Task ${t} from ${PLAN} exactly (read the task, the ground rules and the spec section it implements). ` +
  `You are in a fresh git worktree of the repo. First run: git switch -c talkie/${t} ${BASE} (so you start from the latest merged waves). ` +
  `${t === 'T1' ? 'You create the workspace and install the dependencies as the task says.' : 'Then run: scripts/low yarn install --immutable'}\n\n${RULES}\n\n` +
  `Explorer brief:\n${brief ?? '(explorer failed; read the code yourself)'}\n\n` +
  `When done, run the tests your task names (through the yarn scripts) plus yarn typecheck and yarn lint, and commit. ` +
  `Return branch, absolute worktree path (pwd), HEAD SHA, testsPassed, the test command you ran, a summary, deviations from the plan and blockers. ` +
  `blockers means ONLY things that stopped you finishing the task; notes, caveats and advice for later tasks go in deviations.`,
  { ...CODER, isolation: 'worktree', schema: BUILD, label: `${t} build`, phase: wave })

const review = (b, t, wave) => agent(
  SCOPE + `Adversarially review Task ${t} of the Talkie plan. Code: branch ${b.branch} in worktree ${b.worktree}. Diff: git -C ${b.worktree} diff ${BASE}...HEAD. ` +
  `Read the Task ${t} section and "Reviews and integration" in ${MAIN}/${PLAN}, and the spec section it implements. Try to show it does NOT meet the task: ` +
  `missing requirements, tests that do not test the behaviour, tool calls without the nice/ionice prefix, new dependencies, em or en dashes in user-facing text, ` +
  `non-determinism, SSR-unsafe code in player or react, edits outside the task's files. You may run its tests (prefixed with nice -n19 ionice -c2 -n7). Do not edit files.`,
  { ...REVIEWER, schema: REVIEW, label: `${t} review`, phase: wave })

const fix = (b, r, t, wave) => agent(
  SCOPE + `In worktree ${b.worktree} (branch ${b.branch}), fix these CRITICAL and HIGH review findings for Task ${t} of ${PLAN}, plus any MEDIUM that is a one-line fix. ` +
  `cd there first; do not create a new worktree. ${RULES}\n\nFindings:\n${JSON.stringify(r.findings, null, 1)}\n\n` +
  `Rerun ${b.testCommand}, yarn typecheck and yarn lint, commit, and return the same fields as a build.`,
  { ...CODER, schema: BUILD, label: `${t} fix`, phase: wave })

const report = []
for (const wave of waves) {
  phase(wave.name)
  const results = await pipeline(
    wave.tasks,
    (t) => scout(t, wave.name),
    (brief, t) => build(brief, t, wave.name),
    (b, t) => (b ? review(b, t, wave.name).then((r) => ({ b, r })) : null),
    async (br, t) => {
      if (!br) return { t, ok: false, why: 'build agent failed' }
      let { b, r } = br
      const must = r ? r.findings.filter((f) => f.severity === 'CRITICAL' || f.severity === 'HIGH' || (f.severity === 'MEDIUM' && /one.line/i.test(f.fix))) : []
      if (r && r.verdict === 'fix' && must.length) {
        const fb = await fix(b, { findings: must }, t, wave.name)
        if (fb) b = fb
      }
      const ok = b.testsPassed && b.blockers.length === 0
      return { t, ok, b, review: r, why: ok ? '' : `testsPassed=${b.testsPassed}; blockers: ${b.blockers.join('; ')}` }
    },
  )
  // Barrier: the integrator must merge every passing branch of the wave in task order before the next wave starts.
  const good = results.filter((x) => x && x.ok)
  const bad = results.filter((x) => !x || !x.ok)
  let integ = null
  if (good.length) {
    integ = await agent(
      SCOPE + `Integrate wave "${wave.name}" of the Talkie plan. cd ${MAIN}; it is on branch ${BASE} and must be clean (git status), otherwise stop and report. ` +
      `Merge in this order with git merge --no-ff: ${good.map((x) => x.b.branch).join(', ')}. Resolve only trivial conflicts; anything else: git merge --abort and report. ` +
      `Then run: scripts/low yarn install --immutable && yarn build && yarn test${wave.name.startsWith('W7') ? ' && yarn test:examples' : ''}${wave.name.startsWith('W8') ? ' && yarn e2e --project=chromium' : ''}. ` +
      `If something fails, you may make one small obvious fix (a missing export, a merge slip), commit it, and rerun; otherwise report the failures verbatim. ` +
      `On success remove the merged worktrees (${good.map((x) => x.b.worktree).join(', ')}) with git worktree remove and delete their branches with git branch -d.`,
      { ...CODER, schema: INTEGRATE, label: `${wave.name} integrate`, phase: wave.name })
  }
  report.push({ wave: wave.name, merged: integ?.merged ?? [], integration: integ, failedTasks: bad.map((x) => (x ? { t: x.t, why: x.why, worktree: x.b?.worktree } : { t: '?', why: 'pipeline dropped' })), deviations: good.flatMap((x) => x.b.deviations.map((d) => `${x.t}: ${d}`)) })
  if (bad.length || !integ || !integ.testsPassed) {
    log(`Stopping after ${wave.name}: ${bad.length} task(s) failed or integration did not pass.`)
    return { stoppedAt: wave.name, report }
  }
  log(`${wave.name} merged at ${integ.headSha}`)
}
return { done: true, report }
