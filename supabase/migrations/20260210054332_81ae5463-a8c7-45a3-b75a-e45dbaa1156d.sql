INSERT INTO public.customers (email, first_name, last_name, referral_code, phone, address, city, state, zip)
VALUES ('test-webhook@novaracleaning.com', 'Test', 'Customer', 'TESTREF50', '555-0123', '123 Test Street', 'Test City', 'CA', '90210')
ON CONFLICT (email) DO UPDATE SET referral_code = 'TESTREF50';