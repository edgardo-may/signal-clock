// Generates SELECT-only evidence SQL. Does not connect to any database.
const fs = require('node:fs');
const base = 'database/live-schema/ops/';
const oracle = JSON.parse(fs.readFileSync(base + 'attendance_surcacen_oct10_rpc20_input.json', 'utf8'));
const quote = value => "'" + value.replaceAll("'", "''") + "'";
const target = "x.cliente_id=p.tenant AND x.empleado_id=p.employee AND x.workday_date=p.target_date";
const mutationTables = ['workday_records','workday_record_history','workday_calculation_revisions','workday_revision_promotions'];
const targetRows = mutationTables.map(table => `${quote(table)},(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.id),'[]'::jsonb) FROM public.${table} x,p WHERE ${target})`).join(',\n');
const outside = mutationTables.map(table => `SELECT ${quote(table)} table_name,count(*) row_count,md5(coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.id),'[]'::jsonb)::text) digest FROM public.${table} x,p WHERE NOT (${target})`).join('\nUNION ALL\n');
const fields = Object.keys(oracle).filter(k => !['p_registro_id','p_evidence_manifest','p_context_manifest'].includes(k));
const actualFields = fields.map(key => `${quote(key)},to_jsonb(w)->${quote(key.slice(2))}`).join(',\n');
const pair = fs.readFileSync(base+'phase_b_surcacen_pair_readiness.sql','utf8').trim().replace(/;$/, '');
const sql = `-- SELECT ONLY: execute BEFORE and AFTER the single authorized persist.
-- Oracle is an unchanged copy of the approved RPC20 JSON. No write RPC is called.
WITH p AS (SELECT '3a4b9110-74c6-47f8-bd06-6b099834cf7f'::uuid tenant,
 '577c199c-b787-4f06-b7c7-685e84f8e0ad'::uuid employee,date '2026-10-10' target_date),
 candidate AS (${pair}),
 oracle AS (SELECT ${quote(JSON.stringify(oracle))}::jsonb args),
 w AS (SELECT x.* FROM public.workday_records x,p WHERE ${target}),
 rev AS (SELECT x.* FROM public.workday_calculation_revisions x JOIN w ON w.current_revision_id=x.id),
 outside_state AS (${outside}),
 reconstructed AS (SELECT jsonb_build_object(${actualFields},
 'p_registro_id',to_jsonb('7c4fd4f1-5c04-4dcc-badd-8ec65ef5ec6d'::text),
 'p_evidence_manifest',rev.evidence_manifest,'p_context_manifest',rev.context_manifest) args FROM w CROSS JOIN rev),
 comparison AS (SELECT key,expected.value expected,actual.args->key actual,
 CASE WHEN key IN ('p_first_in','p_last_out','p_source_observed_at')
 THEN (expected.value#>>'{}')::timestamptz IS NOT DISTINCT FROM (actual.args->>key)::timestamptz
 ELSE expected.value IS NOT DISTINCT FROM actual.args->key END matches,
 CASE WHEN key='p_registro_id' THEN 'REQUEST_INPUT; confirm runtime log separately'
 ELSE 'RECONSTRUCTED_FROM_PERSISTED_STATE; not RPC wire capture' END actual_origin
 FROM oracle CROSS JOIN LATERAL jsonb_each(oracle.args) expected LEFT JOIN reconstructed actual ON true)
SELECT clock_timestamp() checked_at,(SELECT to_jsonb(candidate) FROM candidate) candidate,
 jsonb_build_object(${targetRows}) target_rows,
 (SELECT jsonb_agg(to_jsonb(outside_state) ORDER BY table_name) FROM outside_state) unrelated_mutation_tables,
 (SELECT jsonb_build_object('count',count(*),'digest',md5(coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.id),'[]'::jsonb)::text)) FROM public.attendance_persist_outbox x) global_outbox,
 (SELECT jsonb_build_object('count',count(*),'digest',md5(coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.id),'[]'::jsonb)::text)) FROM public.registro_asistencia x) global_registros,
 (SELECT jsonb_build_object('count',count(*),'digest',md5(coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.id),'[]'::jsonb)::text)) FROM public.attendance_source_events x) global_sources,
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM public.attendance_source_events x WHERE x.id IN
 ('46a68412-a946-42bb-9c68-837c27743f82'::uuid,'bd5304f0-4260-4b66-a6b3-db77bb3f9e2e'::uuid)) sources,
 (SELECT jsonb_agg(to_jsonb(f) ORDER BY f.cliente_id,f.feature_key) FROM public.tenant_features f WHERE f.feature_key IN ('WORKDAY_PERSIST_ACTIVE','WORKDAY_PERSIST_CANARY')) persist_gates,
 (SELECT count(*) FROM public.tenant_features f WHERE f.enabled AND f.feature_key IN ('WORKDAY_PERSIST_ACTIVE','WORKDAY_PERSIST_CANARY')) active_gates,
 (SELECT jsonb_agg(to_jsonb(comparison) ORDER BY key) FROM comparison) rpc20_semantic_comparison;
`;
fs.writeFileSync(base+'phase_b_single_persist_audit.sql',sql);
console.log('Prepared SELECT-only phase_b_single_persist_audit.sql; approved oracle unchanged.');
