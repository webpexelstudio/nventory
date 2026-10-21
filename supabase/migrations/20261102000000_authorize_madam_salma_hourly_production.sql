INSERT INTO public.filling_production_users (email, display_name, is_active)
VALUES ('madam_salma@gmail.com', 'Madam Salma', true)
ON CONFLICT (email) DO UPDATE
SET display_name = EXCLUDED.display_name,
    is_active = true;
