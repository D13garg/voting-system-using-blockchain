# ADR-001: Use MongoDB Instead of a Relational Database

## Status
Accepted — Architecture v3.0

## Context
The system's off-chain data is dominated by two patterns: append-heavy event
logs mirrored from the blockchain (`IndexedVoteEvent`), and election-scoped
metadata that is always read together with its small, bounded list of
candidates. Relational databases (e.g., PostgreSQL) are a common default for
this kind of structured data and pair well with ORMs like Prisma. The
developer is also more experienced with MongoDB than PostgreSQL, which is a
legitimate input into a portfolio-project decision, not just a technical one.

## Decision
Use MongoDB with Mongoose as the off-chain database and ODM.

## Rationale
- Event logs and election metadata are naturally schema-flexible and
  document-shaped; candidates embed cleanly inside an election document
  (small, bounded, always read together — Section 10).
- MongoDB Change Streams give the event-driven design (Section 3, Section 8)
  a native reactive primitive, removing the need for a separate
  notification/polling mechanism to detect new data.
- The blockchain itself is the system of record for anything requiring
  relational integrity (vote validity, eligibility, roles — see
  ADR-003 and Section 11). MongoDB only ever mirrors or derives data that the
  chain has already made authoritative, so the lack of native foreign-key
  constraints is not a meaningful risk here.
- Free-tier MongoDB Atlas hosting matches the project's cost constraints
  (Section 2).
- Developer familiarity reduces implementation risk on a project where the
  blockchain layer is already the highest-complexity, highest-learning-value
  component; there's no pedagogical reason to *also* make the database layer
  unfamiliar.

## Alternatives Considered
**PostgreSQL + Prisma** — Strong fit for systems with deep relational
integrity needs (e.g., banking, ERP) where joins and ACID guarantees across
many tables are central. Rejected because this project's relational
complexity is low — most "joins" a relational schema would need (e.g.,
candidate ↔ election) are better modeled as embedding, and the one thing
that *does* need strict integrity (vote validity) is enforced on-chain, not
in the off-chain database.

## Consequences
- No native cross-collection foreign-key constraints; referential integrity
  between collections (e.g., `RegistrationRequest.walletAddress` existing in
  `AdminUser`) must be enforced in application code, not the database layer.
- Mongoose schemas + TypeScript types must be kept manually in sync; there is
  no automatic compile-time guarantee the way a generated Prisma client
  would provide.
- This decision requires the explicit on-chain/off-chain data table
  (Section 11) to do the job a relational schema's constraints would
  otherwise do implicitly — the table is now load-bearing documentation, not
  optional.
