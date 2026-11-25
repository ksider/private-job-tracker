# Cold Outreach implementation map

Phase 0 architecture audit for the requirements in `cold_outreach.md`. This
document maps those requirements to the current implementation; it does not
replace or amend the specification.

## Feasibility decision

The feature is feasible by extending the existing `jobs` record, timeline,
inspector, IMAP, email review, AI routing, appointment, and analytics paths.
No working core subsystem needs to be replaced.

The current mailbox-local identity `(uid_validity, imap_uid)` is insufficient
for cross-folder message deduplication and conversation tracking. The minimum
safe extension is canonical RFC message identity plus mailbox-location,
technical-thread, and logical-conversation relationships. Existing
`email_records` remain the message store; message bodies and dates must not be
copied into a second store.

## Existing infrastructure to retain

| Area | Existing implementation | Reuse decision |
| --- | --- | --- |
| Records | `jobs`, `JobRow`, `/api/jobs`, list/search/update helpers | Add a record discriminator and outreach-only nullable metadata. Keep one logical outreach conversation as one record. |
| Lifecycle | `jobs.status`, `job_events`, `last_activity_at`, timeline reconciliation | Reuse the record/event mechanics. Add outreach event/status values explicitly; never reinterpret application events as outreach events. |
| Kanban | shared list query, filters, sorting, cards, board columns, drag-and-drop | Extend the existing projections and renderers by record type. Keep one filtering/sorting/DnD path with record-type-specific valid transitions. |
| Inspector | `/api/jobs/:id`, shared inspector, notes, timeline, appointments | Add outreach presentation and a conversation section to the existing inspector. Hide vacancy-only controls for outreach records. |
| Email messages | `email_records`, `email_effects`, review/log endpoints | Keep `email_records` as the canonical stored message. Preserve application matching/effects separately from outreach associations. |
| IMAP | `EmailSyncService`, per-mailbox sync state, lease, read-only mailbox locks | Extend the one worker. Add configured bounded folders and canonical message deduplication; do not add another synchronizer. |
| Email Review | existing pending/applied/ignored/reverted review lifecycle | Add outreach association candidates and manual decisions without weakening application classification/reversal. |
| AI | `ai_providers`, ordered child models, `ai_function_routes`, `AiRouter` | Add one independent `outreach_email` function route and a schema-validated cached analysis. Run outside the critical IMAP ingestion transaction. |
| Meetings | `interview_appointments` and proposed/confirmed/cancelled state | Generalize ownership so an outreach meeting may belong to an outreach record without inventing a vacancy or application progression. |
| Statistics | application queries derive population from application events/status | Keep application endpoints and formulas unchanged in meaning, and explicitly restrict them to application records. Add separate outreach aggregates over canonical conversations. |
| Backup/restore | portable backup schema and transactional restore | Include every new table/column in portable backup and restore before a phase is complete. Preserve local secrets. |

## Minimum data-model extension

Phase 1 should make only additive, backward-compatible changes:

1. Add `record_type` to `jobs` with default `application`, so every historical
   row remains an application. Outreach rows may keep vacancy-only nullable
   fields empty; no job title or match score is synthesized.
2. Add outreach contact/summary fields only where they belong to the logical
   record. Reuse `created_at`, `updated_at`, `last_activity_at`, `notes`, and
   existing status/event dates instead of adding parallel date columns.
3. Extend `email_records` with parsed immutable envelope identity and content
   needed by the conversation UI: normalized RFC Message-ID, In-Reply-To,
   References, provider thread identifier, subject, sender/recipients,
   direction, safe original-content metadata, and an optional technical-thread
   reference. Existing rows remain valid with null/default values.
4. Add an `email_locations` relation for mailbox/UID provenance. Backfill the
   current mailbox-local identity into one location per existing message. This
   permits one canonical message to appear in several folders without copying
   its body.
5. Add a technical-thread relation and associate each thread with at most one
   active outreach record. A logical outreach record may own many technical
   threads. Application association continues to use `proposed_job_id`; it is
   not overloaded for outreach.
6. Reserve canonical-record and audited merge relations for Phase 7 so merged
   identities remain resolvable and reversible. Do not encode merge by deleting
   a record or its messages.

SQLite constraints require special care: `jobs.source`, `jobs.source_url`,
`jobs.captured_at`, and `jobs.last_activity_at` are currently `NOT NULL`.
Outreach creation must satisfy them deterministically without rebuilding the
table. A generated internal source identity may be stored in the existing
source fields, but the vacancy URL control must not be displayed as a real job
source. The existing unique indexes remain untouched.

## Phase map and gates

### Phase 1 — data model

- Implement additive migrations, row types, backup/restore coverage, and
  database invariants.
- Prove migration over both a fresh database and a pre-feature fixture.
- Prove historical application rows and application statistics are unchanged.

### Phase 2 — Kanban and inspector

- Extend the existing list/detail payloads and shared renderers.
- Add record-type filtering and outreach-specific appearance without a second
  board implementation.
- Define a server-side transition matrix and use it for both PATCH and DnD.
- Mandatory gate: exercise both record types in the combined browser UI before
  proceeding.

### Phase 3 — identity and relationships

- Parse and normalize RFC headers and provider identifiers in the current IMAP
  ingestion path.
- Upsert canonical messages, record every mailbox location, resolve technical
  threads deterministically, and attach known threads to their logical record.
- Domain, subject, participant, recency, or AI similarity alone may produce a
  review candidate but never an automatic link.

### Phase 4 — conversation UI

- Return a deduplicated chronological projection from existing messages across
  all associated threads.
- Render it in the existing inspector with safe HTML/text handling, original
  message access, direction, participants, and bounded incremental rendering.

### Phase 5 — AI processing

- Add `outreach_email` to the existing registry/router/settings UI.
- Store schema-validated results keyed by message content plus prompt/model
  version so repeated sync does not repeat work.
- Queue analysis after message persistence; an AI timeout must not roll back or
  abort mailbox synchronization. AI output is advisory only.

### Phase 6 — IMAP and Email Review

- Extend configured synchronization scope to bounded outreach, INBOX, and Sent
  folders; retain read-only operation and per-mailbox cursors.
- Support outgoing direction and probable/manual outreach decisions in the
  existing review center while preserving application classification/effects.
- Mandatory gate: use a small controlled mailbox/label before real mail.

### Phase 7 — linking and merging

- Add transactional link/move/merge operations, explicit conflict preview,
  canonical aliases, and an undo audit.
- Move associations, never message bodies; retain notes, edited summaries,
  timestamps, participants, provenance, events, and old thread identifiers.
- Mandatory gate: after merge, sync a new reply to an old thread and verify it
  resolves to the canonical destination.

### Phase 8 — lifecycle and meetings

- Add outreach-specific events and statuses to the shared lifecycle while
  keeping application stages semantically separate.
- Generalize appointment ownership and explicitly preserve proposed versus
  confirmed meetings. Related application links remain optional and explicit.

### Phase 9 — statistics and regression

- Explicitly filter all current application analytics to `record_type =
  'application'`.
- Count only canonical outreach records and the first meaningful external
  response per conversation in separate outreach statistics.
- Complete restart, repeated-sync, merge, post-merge-arrival, sorting, date,
  backup/restore, and historical-regression tests.

## High-risk checks

- Migration: no table rebuild or destructive rewrite; preserve all existing
  rows and current `NOT NULL` values.
- Identity: RFC Message-ID is primary cross-folder evidence; mailbox UID remains
  provenance and sync state, not global identity. Missing/malformed IDs require
  a conservative fallback and review.
- Association: explicit message/thread references may auto-link; company domain
  alone never may.
- Merge: source records become canonical aliases only after the transaction
  succeeds. No original email, event, or provenance is deleted.
- Analytics: application population and numerators/denominators must remain
  byte-for-byte equivalent for the same historical fixture after Phase 1 and
  semantically equivalent after every later phase.
- Runtime validation: builds and injected API tests do not satisfy the Phase 2,
  Phase 6, or Phase 7 mandatory interaction checkpoints.

## Phase 0 conclusion

Proceed with Phase 1. None of the stop conditions is currently met. The three
mandatory runtime checkpoints require browser/mailbox access in their
respective phases and cannot be inferred from static tests.
