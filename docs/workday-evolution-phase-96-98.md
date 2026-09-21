# Workday evolution correction

Phase 92 correctly established a single logical identity but intentionally only
allowed creation and exact replay. That is insufficient for a real shift: a
later canonical exit changes the calculated snapshot for the same workday.

Phase 97 introduces the explicit results `INSERTED`, `UPDATED`, `UNCHANGED`,
and `STALE`.

- `INSERTED`: first canonical snapshot for the identity.
- `UPDATED`: evidence advanced and the current snapshot was atomically replaced;
  a new append-only history fact is inserted with action `UPDATED`.
- `UNCHANGED`: exact snapshot and evidence replay; no row or history write.
- `STALE`: the candidate has an older source watermark or fewer canonical
  events; no row or history write.

The monotonic authority is the maximum `registro_asistencia.verificado_at` in
the canonical calculation window plus the count of unique canonical registros.
It is not worker receipt time. Equal watermark/count but a different snapshot
is a fail-closed `PERSIST_SNAPSHOT_CONFLICT`.

Production correction order, with authorization closed:

1. Run Phase 96 read-only and require pass.
2. Deploy the runtime/dispatcher code carrying the 18-argument RPC contract as
   a candidate. Do not enable the tenant.
3. Apply Phase 97. The old 16-argument RPC loses `service_role` execute, so an
   old runtime cannot write accidentally.
4. Run Phase 98 read-only and require pass.
5. Validate candidate health/ready and the dispatcher closed-gate run.
6. Only after approval, run Phase 93 again to reopen the pilot tenant.

Emergency rollback remains Phase 95. It closes authorization immediately and
does not revert or erase already-evolved workday facts.
