# Signum Clock documentation

This index is the entry point for current project documentation. Status labels distinguish implementation in source from validation and production evidence. Operational facts attributed to the operator were not rechecked by Codex during the documentation pass.

- [Project status](../PROJECT_STATUS.md)
- [Architecture overview](../ARCHITECTURE.md)
- [Module status and follow-up matrix](04-modules/module-status.md)
- [Module closeout template](11-releases/module-closeout-template.md)
- [Architecture decision record template](11-releases/adr-template.md)

## Areas

| Area | Purpose |
|---|---|
| [01 Project](01-project/README.md) | Scope, terminology, and source-of-truth rules |
| [02 Architecture](02-architecture/README.md) | System boundaries and current/target separation |
| [03 Database](03-database/README.md) | Schemas, migrations, RLS, and candidate status |
| [04 Modules](04-modules/README.md) | Module index, status, blockers, closure criteria |
| [05 Integrations](05-integrations/README.md) | ZKTeco, Consolide, Supabase, and API boundaries |
| [06 Security](06-security/README.md) | Tenant isolation, secrets, sessions, and security evidence |
| [07 Deployment](07-deployment/README.md) | Vercel and backend deployment units |
| [08 Testing](08-testing/README.md) | Test suites, scope, and evidence attribution |
| [09 Operations](09-operations/README.md) | Runbooks and operational gates |
| [10 Compliance](10-compliance/README.md) | Compliance references and evidence handling |
| [11 Releases](11-releases/README.md) | Release evidence, decisions, and templates |
| [12 User guides](12-user-guides/README.md) | End-user guidance; content to be developed from verified UI |

## Existing evidence

Existing reports remain in `docs/`, including [current stack](current-stack-zkteco.md), [cleanup report](current-stack-cleanup-report.md), [cleanup inventory](current-stack-cleanup-inventory.json), [migration notes](migrations/README.md), and [historical archive](archive/pre-zkteco-only/README.md). Historical reports describe their own date and are not deployment instructions. `docs/CURRENT_STATE.md` contains dated snapshots and points to the consolidated status for current facts.
