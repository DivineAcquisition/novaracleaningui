-- Add INSERT policy for cleaners table to allow authenticated users to create their own profile
CREATE POLICY "Cleaners can create own profile"
ON public.cleaners
FOR INSERT
TO authenticated
WITH CHECK (user_id = auth.uid());