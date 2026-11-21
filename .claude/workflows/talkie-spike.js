export const meta = {
  name: 'talkie-spike',
  description: 'Talkie Phase 0: hand-port one GSE scene to Lottie and measure style, sync, size and dotLottie compatibility',
  whenToUse: 'Run once before talkie-build. Stops for Tim to judge the style stills and run the phone checks.',
  phases: [
    { title: 'Explore', detail: 'Haiku explorers survey the GSE scene, the Lottie runtimes and SVG converters', model: 'haiku' },
    { title: 'Prototype', detail: 'Fable coder hand-ports the scene and builds the compare and sync harnesses', model: 'fable' },
    { title: 'Measure', detail: 'Fable coder runs the four checks and writes spike/REPORT.md', model: 'fable' },
    { title: 'Review', detail: 'Independent check of every claim in the report' },
    { title: 'Integrate', detail: 'Merge the spike branch' },
  ],
}

const MAIN = '/home/tdobson/orca/workspaces/video-feedback.tdobson.net/svg-animation-codec-or-container'
const BASE = 'svg-animation-codec-or-container'
const PLAN = 'docs/plans/2026-11-21-talkie.md'
const SPEC = 'docs/superpowers/specs/2026-11-21-talkie-design.md'
const EXPLORER = { model: 'haiku', agentType: 'Explore' }
const CODER = { model: 'fable', effort: 'low' }
const REVIEWER = { model: 'fable', effort: 'medium' }

const RULES = `Ground rules (from ${PLAN}): this machine is tragicomix, Tim's shared desktop. Run every heavy tool (npm install, ffmpeg, playwright, node scripts that render) as "nice -n19 ionice -c2 -n7 <cmd>". The only renders allowed here are the five comparison stills and the sync harness; the H.265 chapter encode runs on asterix over ssh (also niced). No em or en dashes in anything a person reads.`

const BUILD = {
  type: 'object',
  properties: {
    branch: { type: 'string' }, worktree: { type: 'string' }, sha: { type: 'string' },
    testsPassed: { type: 'boolean' }, summary: { type: 'string' },
    deviations: { type: 'array', items: { type: 'string' } }, blockers: { type: 'array', items: { type: 'string' } },
  },
  required: ['branch', 'worktree', 'sha', 'testsPassed', 'summary', 'deviations', 'blockers'],
}
const REVIEW = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['pass', 'fix'] },
    findings: { type: 'array', items: { type: 'object', properties: {
      severity: { type: 'string', enum: ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] }, file: { type: 'string' }, issue: { type: 'string' }, fix: { type: 'string' },
    }, required: ['severity', 'file', 'issue', 'fix'] } },
  },
  required: ['verdict', 'findings'],
}

phase('Explore')
const surveys = await parallel([
  ['E1 source survey', 'E1'], ['E2 runtime survey', 'E2'], ['E3 converter survey', 'E3'],
].map(([label, id]) => () => agent(
  `Do explorer task ${id} described under "Phase 0" in ${MAIN}/${PLAN} (read that section and spec ${MAIN}/${SPEC} section 10). ` +
  `You are read-only: do not modify any file. Use web search or fetch where the task needs current library facts, and cite URLs. ` +
  `Return a concise brief (under 700 words) with exact paths, versions, API names and signatures. No speculation: mark anything unverified as UNVERIFIED.`,
  { ...EXPLORER, label, phase: 'Explore' })))
const brief = surveys.map((s, i) => `--- E${i + 1} ---\n${s ?? '(explorer failed; investigate this yourself)'}`).join('\n\n')

phase('Prototype')
const s1 = await agent(
  `Implement Task S1 from ${PLAN} (read it and spec section 10 first). You are in a fresh git worktree of the repo. ` +
  `First run: git switch -c talkie/spike ${BASE}. ${RULES}\n\nExplorer briefs:\n${brief}\n\n` +
  `Commit as you go. Return the branch, the absolute worktree path (pwd), HEAD SHA, whether your harness pages load without console errors (testsPassed), a summary, deviations from the plan and blockers.`,
  { ...CODER, isolation: 'worktree', schema: BUILD, label: 'S1 prototype', phase: 'Prototype' })
if (!s1 || !s1.testsPassed) return { stoppedAt: 'S1', s1, brief }
const s1Notes = `S1 deviations:\n- ${s1.deviations.join('\n- ')}\n\nS1 open items you must handle (they are instructions for you, not reasons to stop):\n- ${s1.blockers.join('\n- ') || 'none'}\n\n` +
  `You may download the Playwright browsers that playwright-core needs for check 2 (nice -n19 ionice -c2 -n7 npx playwright-core install chromium-headless-shell firefox webkit). ` +
  `Copy the chapter MP4 into spike/media/ as S1's README says if a page needs it.`

phase('Measure')
const s2 = await agent(
  `Implement Task S2 from ${PLAN}. Work in the existing worktree ${s1.worktree} on branch ${s1.branch} (cd there first; do not create a new worktree). ${RULES}\n\n` +
  `Explorer briefs:\n${brief}\n\nS1 summary: ${s1.summary}\n\n${s1Notes}\n\n` +
  `Write spike/REPORT.md with PASS or FAIL and the numbers for each of the four checks, the chosen Opus container, the chosen SVG converter, and Tim's manual steps. Commit. testsPassed means all four automated checks ran to completion (not that they passed). blockers means ONLY things that stopped a check from running; put notes in deviations.`,
  { ...CODER, schema: BUILD, label: 'S2 measure', phase: 'Measure' })
if (!s2) return { stoppedAt: 'S2', s1 }

phase('Review')
const review = await agent(
  `Independently review the Talkie spike on branch ${s1.branch} in ${s1.worktree}. Read ${PLAN} Phase 0 and spike/REPORT.md. ` +
  `Try to refute every number and PASS in the report: rerun or read the scripts and raw outputs that produced it; flag any claim without evidence, ` +
  `any check measured differently from the plan, and any render on tragicomix beyond the five stills and the sync harness. Do not edit files.`,
  { ...REVIEWER, schema: REVIEW, label: 'SR review', phase: 'Review' })

let fixed = null
if (review && review.verdict === 'fix') {
  const must = review.findings.filter((f) => f.severity === 'CRITICAL' || f.severity === 'HIGH')
  if (must.length) fixed = await agent(
    `In worktree ${s1.worktree} (branch ${s1.branch}), fix these review findings on the Talkie spike, rerun what is needed, update spike/REPORT.md and commit. ${RULES}\n\n${JSON.stringify(must, null, 1)}`,
    { ...CODER, schema: BUILD, label: 'SR fix', phase: 'Review' })
}

phase('Integrate')
const merged = await agent(
  `cd ${MAIN} (branch ${BASE}; it must be clean, otherwise stop and report). Run: git merge --no-ff ${s1.branch} -m "Merge Talkie Phase 0 spike". ` +
  `Then git worktree remove ${s1.worktree} and git branch -d ${s1.branch}. Return the new HEAD SHA and the full text of spike/REPORT.md.`,
  { ...CODER, label: 'merge spike', phase: 'Integrate' })

return { s1, s2, review, fixed, merged }
