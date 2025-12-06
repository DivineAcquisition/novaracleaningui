-- Add admin role for contact@novaracleaning.com
INSERT INTO public.user_roles (user_id, role)
VALUES ('a2f3fdb0-0aed-4cbf-8fe6-51d3c861f304', 'admin')
ON CONFLICT (user_id, role) DO NOTHING;