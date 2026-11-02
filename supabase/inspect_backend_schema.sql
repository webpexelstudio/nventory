-- Read-only inspection for the Inventory app.
-- Run each SELECT separately in the Supabase SQL Editor and share the results.
-- These queries return database structure and permissions, not inventory records.

-- 1. Tables and columns used by the app.
SELECT
  table_name,
  column_name,
  data_type,
  is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN (
    'component_type_options',
    'filling_material_returns',
    'filling_requests',
    'inventory',
    'inventory_logs',
    'master_carton_options',
    'master_carton_product_settings',
    'parties',
    'party_access',
    'product_bom',
    'production_data_sheets',
    'production_sheet_options',
    'products',
    'transportation_drivers',
    'transportation_rents',
    'transportation_trip_details',
    'transportation_vehicles'
  )
ORDER BY table_name, ordinal_position;

-- 2. Row-level security status for those tables.
SELECT
  schemaname,
  tablename,
  rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN (
    'component_type_options',
    'filling_material_returns',
    'filling_requests',
    'inventory',
    'inventory_logs',
    'master_carton_options',
    'master_carton_product_settings',
    'parties',
    'party_access',
    'product_bom',
    'production_data_sheets',
    'production_sheet_options',
    'products',
    'transportation_drivers',
    'transportation_rents',
    'transportation_trip_details',
    'transportation_vehicles'
  )
ORDER BY tablename;

-- 3. Existing row-level security policies.
SELECT
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN (
    'component_type_options',
    'filling_material_returns',
    'filling_requests',
    'inventory',
    'inventory_logs',
    'master_carton_options',
    'master_carton_product_settings',
    'parties',
    'party_access',
    'product_bom',
    'production_data_sheets',
    'production_sheet_options',
    'products',
    'transportation_drivers',
    'transportation_rents',
    'transportation_trip_details',
    'transportation_vehicles'
  )
ORDER BY tablename, policyname;

-- 4. Existing grants to browser-facing Supabase roles.
SELECT
  table_name,
  grantee,
  string_agg(privilege_type, ', ' ORDER BY privilege_type) AS privileges
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND grantee IN ('anon', 'authenticated')
  AND table_name IN (
    'component_type_options',
    'filling_material_returns',
    'filling_requests',
    'inventory',
    'inventory_logs',
    'master_carton_options',
    'master_carton_product_settings',
    'parties',
    'party_access',
    'product_bom',
    'production_data_sheets',
    'production_sheet_options',
    'products',
    'transportation_drivers',
    'transportation_rents',
    'transportation_trip_details',
    'transportation_vehicles'
  )
GROUP BY table_name, grantee
ORDER BY table_name, grantee;
