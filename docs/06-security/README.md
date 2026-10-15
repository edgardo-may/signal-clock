# 06 — Security

**Estado:** IMPLEMENTADO in code/SQL candidates; Production state is partly operator-reported and not rechecked here.

Security boundaries include tenant-scoped PostgreSQL RLS, server-only secrets, Employee HttpOnly session cookie, service-side Employee RPC, restricted runtime routes, and ADMS identity/device contracts. Never place secrets in `VITE_*`, publish tokens or PINs, or infer installed policy/grant state from a candidate SQL file.

Employee remains in maintenance because the operator reports `public.fn_employee_portal` missing. The candidate function is SECURITY DEFINER and its proposed EXECUTE grant is service_role-only; verify actual owner and ACL before any installation.
