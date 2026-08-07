-- Admin / VA portal access is Novara-domain only.
-- Personal emails (e.g. gmail) must not pass is_admin_or_va / has_role(admin|va)
-- even if a stale user_roles row exists.

CREATE OR REPLACE FUNCTION public.is_admin_or_va(_uid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'auth', 'pg_temp'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles ur
    JOIN auth.users u ON u.id = ur.user_id
    WHERE ur.user_id = _uid
      AND ur.role IN ('admin'::app_role, 'va'::app_role)
      AND lower(coalesce(u.email, '')) LIKE '%@novaracleaning.com'
  );
$function$;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles ur
    JOIN auth.users u ON u.id = ur.user_id
    WHERE ur.user_id = _user_id
      AND ur.role = _role
      AND (
        _role NOT IN ('admin'::app_role, 'va'::app_role)
        OR lower(coalesce(u.email, '')) LIKE '%@novaracleaning.com'
      )
  );
$function$;
