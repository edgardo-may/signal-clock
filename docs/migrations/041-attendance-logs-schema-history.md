# Migration 041 attendance_logs schema history

Migration 029 defines the canonical raw-log columns as `numero_serie`, `biometric_user_id`, and `timestamp`. Migration 041 creates an index using `device_serial` and `user_id`. No repository migration between them performs that rename.

The cause is not proven: 041 may have been applied manually against a drifted schema, or historical repository state may be incomplete. The canonical current contract is `numero_serie`, `biometric_user_id`, `timestamp`; no duplicate legacy columns are created. Historical migrations remain unchanged. New installations must use a generated baseline until an officially supported pre-041 bridge is established.
