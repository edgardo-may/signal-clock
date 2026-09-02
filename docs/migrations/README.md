# Migration routes

Existing environments upgrade through the historical migration chain already recorded for that environment. Fresh TEST/CI installations use the generated current baseline and only migrations newer than its `schema_revision`. Do not run both paths on the same database.

`npm run db:migrations:historical-diagnostic` is evidence-gathering only; it is expected to expose the documented 041 drift on a blank database. The supported fresh route is `npm run db:baseline:generate`, `npm run db:baseline:bootstrap`, then `npm run db:baseline:compare` against the known-good source.
