-- Add admin role for asannie74@gmail.com
INSERT INTO public.user_roles (user_id, role)
VALUES ('a396ecd9-14b9-419f-93bf-c49ac8869b69', 'admin')
ON CONFLICT (user_id, role) DO NOTHING;