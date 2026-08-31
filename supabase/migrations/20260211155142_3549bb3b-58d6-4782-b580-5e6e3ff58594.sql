INSERT INTO public.user_roles (user_id, role)
VALUES ('1661811f-46f7-4d2a-b768-3bd8597dddc7', 'admin')
ON CONFLICT (user_id, role) DO NOTHING;