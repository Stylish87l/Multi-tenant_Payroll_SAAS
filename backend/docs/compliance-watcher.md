# Compliance Watcher

## Scope of this foundation

This change introduces the persistence layer for a controlled statutory-compliance workflow. It does not yet fetch external websites, interpret legislation, expose API routes, send compliance notifications, or apply statutory configuration changes.

## Data model

- `ComplianceSource` registers an authority/source, jurisdiction, URL, source type, active/paused status, and last-check health metadata.
- `ComplianceChange` stores a detected announcement with its source, publication/effective dates, evidence, content hash, severity, review status, and an optional proposed configuration.
- `ComplianceReview` stores each reviewer decision and comment as an append-only record.
- `ComplianceImpact` records the impact of a change for an individual tenant, with its own severity, details, and acknowledgement/resolution lifecycle.

## Workflow states

A detected change begins as `DETECTED`, may move to `UNDER_REVIEW`, and can be `APPROVED`, `REJECTED`, or `SCHEDULED`. A scheduled change can later be marked `ACTIVE` or `SUPERSEDED` by a future controlled activation workflow.

Tenant impacts are tracked separately as `OPEN`, `ACKNOWLEDGED`, or `RESOLVED`. A tenant acknowledging an impact does not approve a statutory change.

## Safety invariants for subsequent stages

1. Source evidence and the source URL must be retained so reviewers can inspect the original publication.
2. Content hashes and source identifiers support duplicate detection; external identifiers are also unique per source when supplied.
3. Review decisions are append-only. Corrections must be recorded as a new decision, not by rewriting history.
4. Tenant impact records are scoped by `companyId`; tenant-facing queries must always include the authenticated tenant context.
5. Detection, AI summaries, and impact assessment are advisory. They must not mutate `TaxConfig`, recalculate historical payroll, finalize payroll, or initiate payouts.
6. Any future statutory configuration activation must be a separate, explicitly authorized workflow with effective-date validation, audit logging, and human approval.

## Next implementation stages

1. Add a source registry and controlled ingestion interface for verified official Ghanaian sources.
2. Implement scheduled polling and duplicate-safe announcement detection.
3. Add deterministic impact assessment against effective-dated `TaxConfig` rows and payroll periods, without changing them.
4. Add platform review APIs, tenant impact APIs, audit events, and notification delivery.
5. Add a dashboard and tests for authorization, tenant isolation, duplicate detection, and the no-automatic-mutation invariant.
