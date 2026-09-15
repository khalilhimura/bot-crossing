# Nous MVP — design decisions

Updated 15 September 2026. Records user-approved product direction from the
planning conversation. This is a decision log, not a complete implementation
specification. The Nous interface and provider integrations remain planned. The
standalone SovMem mock CLI is implemented and merged; see the delivery status below.

## MVP thinking framework: dialectical inquiry

Use dialectical inquiry to examine evidence, context, change and opposing
positions. The everyday user-facing prompt is **Explore the tension**.

The first mission examines an existing SovMem claim using existing, authorized
SovMem sources. Missing evidence is an explicit gap; web research is deferred.
Provide a guided first assessment, optional follow-up conversation, and an
editable assessment card before review.

The inquiry asks:

1. What supports each position?
2. Do the positions apply under different conditions?
3. Do they genuinely contradict each other?
4. What evidence would change the user's judgment?
5. Should understanding change, or should the tension remain open?

Synthesis is optional. Do not force compromise, equal evidential weight, or the
conclusion that both positions are true. Evidence may support rejecting a
position. SovMem records the user's currently endorsed understanding; endorsement
does not establish objective truth.

### Assessment and approval

- Assessment conclusions: Supported / Challenged / Inconclusive.
- User actions on the assessment: Accept / Reject / KIV (Keep in View).
- The card includes the original claim, conclusion, finding, expandable evidence,
  scope or conditions, and exact proposed memory change.
- Accept proceeds through SovMem's protected human-approval boundary. Show durable
  acceptance only after verified commitment, not on submission or animation.
- Reject declines the finding; preserve mission evidence and the reason.
- KIV saves the draft for manual revisiting and leaves current understanding
  unchanged.
- Append each approved finding with provenance to the exact examined revision,
  evidence, mission and human verdict. Preserve earlier records. Superseding a
  claim is a separate recorded decision.

### Representation of nuance

The 3D world presents current endorsed understanding with historical connections
hidden. It must accommodate multiple endorsed, conflicting positions. A newer
record does not automatically replace an older position. Evidence attachments do
not automatically endorse the claims they contain.

**Approved representation: one topic per 3D object, multiple claims within.**
Selecting a topic reveals its current endorsed positions, their scope and evidence.
A mission examines a selected claim within the topic. Topic grouping is a
presentation decision; it does not establish a new canonical SovMem record kind.
A separate trace view
reveals related artifacts, missions, revisions and verdicts progressively. Do not
add a world object for every historical finding. Conflicting positions can share
one topic without being merged or treated as equally supported.

### Approved topic creation and grouping

The user creates and names a topic. Nous suggests relevant existing claims from
authorized context; the user confirms which claims belong. Grouping changes the
presentation only, not a claim's meaning, approval state or canonical authority.
Suggestions do not become confirmed membership automatically.

A claim may belong to multiple topics. Each membership references the same
SovMem record, with shared evidence, revision and verdict history; it does not
create a separate copy of the claim. Removing membership removes only the topic
grouping. It does not delete or retire the underlying record.

### Approved pilot example

- Topic: **AI and independent work**.
- Claim to examine: **Using AI improves my ability to work independently.**
- Illustrative positions to investigate: AI helps complete unfamiliar tasks;
  assistance can reduce practice of independent reasoning; effects may depend
  on delegating work versus using AI to learn.

The pilot and topic representation are approved design choices. The illustrative
positions are not established findings or approved canonical claims. No matching
real SovMem artifact or evidence collection has yet been identified for this pilot.
The mock now supplies explicitly synthetic claims and supporting, challenging and
contextual sources in `mock-sovmem/fixtures/bundle/`.

### Approved evidence attachment model

For the MVP, attach existing authorized SovMem source artifacts to a claim or
mission. An attachment may include an excerpt and a short relevance note, and
distinguishes support, challenge or additional context. Preserve the exact source
revision examined. These evidence-role labels do not automatically create
canonical typed relationships.

New attachments remain proposed evidence until reviewed. Attachment alone does
not change the user's endorsed understanding or establish the source's truth.
New file uploads and web capture are deferred to a later SovMem intake flow.

### Approved mission persistence and resume behaviour

Save the mission question, selected evidence, conversation and draft assessment
within the authorized persistence boundary. Returning to the ship leaves the
mission resumable. KIV retains an assessment awaiting the user's decision.

On resume, flag changes to the examined claim or its sources; refreshing evidence
creates a new assessment draft rather than silently changing the prior one.
Recheck authorization when resolving saved context. A failed investigation keeps
the saved work and offers Retry; retries must not duplicate proposals or verdicts.

The ship shows one quiet **Continue mission** action. Other saved missions are
accessible through a secondary list. Precise storage and active-run cancellation
semantics remain implementation-design decisions; returning home is not itself
authorization for background execution.

### Approved focused provenance view

**Trace provenance** opens a separate graph centred on the selected claim or
mission. Initially show the relevant current endorsed positions, including
contradictions, their directly attached evidence, and the mission and human verdict
behind each approved finding. Preserve the distinction between proposals and
approved findings when tracing an unfinished mission.

Older revisions and further connections expand on demand, within authorized
scope. Selecting a node opens its details. Returning restores the previous 3D
view. The initial view is focused rather than an automatic expansion of every
reachable node; the history remains accessible through progressive exploration.

## Approved MVP acceptance target

Complete this pilot against the required verified SovMem interfaces:

1. Create **AI and independent work** and select the pilot claim.
2. Attach existing authorized evidence and run an investigation.
3. Review the finding using Accept / Reject / KIV.
4. Accept a finding through SovMem's protected human-approval process.
5. See current endorsed positions, including any unresolved contradiction,
   within the same topic.
6. Trace the finding to its evidence and human verdict.
7. Restart, resume saved work, and reuse the finding in another inquiry.

The user can explain **what they currently believe, under which conditions, and
why**, using saved artifacts without needing the original conversation. Treat
this as a user-observed acceptance exercise, not an automated assertion that the
product improves cognition. Preserve disagreement when the evidence warrants it;
do not fabricate a contradiction just to complete the exercise.

Verify rejection, deferral, failures and retries separately: each preserves the
correct state without unintended acceptance or duplicate commitments. These are
approved acceptance targets, not completed tests or delivered capabilities.

## Approved investigation runtime: direct model API with BYOK

Investigations use direct model APIs with **Bring Your Own Key (BYOK)** rather
than a coding-agent harness. The approved provider options are:

- OpenAI
- Anthropic
- Gemini
- OpenRouter
- OpenAI-compatible APIs

These are planned provider options, not implemented or verified integrations.
Provider selection does not grant canonical write authority: model output still
enters the ordinary proposal and protected human-review flow.

Following the Pi feasibility review, use embedded Pi agent core plus its provider
library as the candidate lightweight runtime for BYOK investigations. Keep it in
Nous's external adapter, outside the offline SovMem core. Provider compatibility,
bounded context, cancellation, persistence integration and credential handling
still require the isolated feasibility tests described in the review. This does
not establish a tested dependency version or authorize production integration.

Credential storage, request routing, model selection, custom-endpoint configuration,
provider-specific capability handling, context disclosure, usage limits and error
behaviour remain to be designed. Verify current provider documentation when
specifying the adapters; do not assume a shared protocol or identical capabilities
across these options. This decision authorizes no transmission of private context
or credentials during design work.

## Future product features — outside the MVP

These are captured future directions, not commitments to implement them now.

| Framework | Future feature | Boundary |
| --- | --- | --- |
| Janusian Thinking | A creative mission that deliberately explores simultaneous opposites to generate new possibilities. | Generated possibilities remain hypotheses or proposals; creativity does not confer evidential support or canonical authority. |
| Polarity Management | A mission for ongoing, interdependent needs: identify the benefits of each pole, costs of overemphasis, possible actions and warning signs. | First distinguish a recurring polarity from a factual dispute or a solvable problem; do not treat every contradiction as a polarity. |

Both approaches would reuse evidence, provenance, and human review. Their detailed
interaction designs and release timing remain undecided.

## Delivery status and build direction

The SovMem mock CLI is delivered on `main` in commit `c2b8aa96a352617fb9ab535b4579e5f44ef56620`.
It implements `sovmem-mock/v1` over actual OKF v0.2 Markdown/YAML documents,
with synthetic evidence, simulated review, exact-revision trace, topics, mission
persistence and export. The merged tree passed 53 tests (26 mock, 27 existing)
and `npm run build` on 15 September 2026. This is historical verification evidence;
recheck the checkout before starting a new build.

**Start Nous interface development against this mock now.** Production SovMem
v0.4/v0.5 completion is not a prerequisite for the demo build. It remains a
prerequisite to claim the corresponding real governance/security capabilities.
Acceptance controls must say **Demo memory · Simulated approval** while the mock
is active. The mock must never be switched to a private vault.

Build milestones:

1. Local browser-to-Node bridge to the mock, with a separate simulated review route.
2. One topic per 3D object, claim/evidence selection and a complete synthetic mission.
3. Assessment editing, Accept/Reject/KIV, reconciliation and restart/resume.
4. Focused provenance graph and evidence/source-change failure cases.
5. Isolated BYOK/Pi feasibility, then approved providers and live investigation UX.
6. User-observed demo acceptance; a separately verified real SovMem adapter and
   protected approval broker are required before a private-data pilot.

Milestones 1–4 use an explicitly labelled scripted assessment to validate the
interaction. They do not count as a live AI investigation or completion of the
full BYOK MVP. Keep the approved provider options and future frameworks in scope
for their respective milestones; do not expand the inherited harness monitor.

Read the [build handover](nous-mvp-build-handover.md) first in the next session,
then execute the [first bridge implementation plan](superpowers/plans/2026-09-15-nous-mvp-mock-bridge.md).
The [mock runbook](../mock-sovmem/README.md) and
[contract inventory](../mock-sovmem/contract.json) define the implemented boundary.
The [CLI readiness requirements](nous-mvp-sovmem-cli-readiness.md) retain the
stronger obligations for real SovMem. Provider credential/routing choices and
active investigation cancellation require explicit design during milestone 5.

## Framework references

- [Peng and Nisbett — Culture, Dialectics, and Reasoning About Contradiction](https://culcog.berkeley.edu/Publications/1999AmPsy_DT.pdf)
- [Albert Rothenberg — The Janusian Process in Creativity](https://www.psychologytoday.com/us/blog/creative-explorations/201506/the-janusian-process-in-creativity)
- [Barry Johnson — Polarity Management summary](https://workplaceconflict.ca/polarity-management/)

The framework selection and application above are product-design decisions, not
claims of demonstrated learning outcomes for Nous.
