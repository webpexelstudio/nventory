DO $$
DECLARE
  table_name regclass;
  id_type oid;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'public.production_data_sheets'::regclass,
    'public.production_sheet_options'::regclass
  ]
  LOOP
    SELECT atttypid
    INTO id_type
    FROM pg_attribute
    WHERE attrelid = table_name
      AND attname = 'id'
      AND NOT attisdropped;

    IF id_type <> 'uuid'::regtype THEN
      EXECUTE format('ALTER TABLE %s ALTER COLUMN id DROP DEFAULT', table_name);
      EXECUTE format('ALTER TABLE %s ALTER COLUMN id TYPE uuid USING id::uuid', table_name);
    END IF;

    EXECUTE format('ALTER TABLE %s ALTER COLUMN id SET DEFAULT gen_random_uuid()', table_name);
  END LOOP;
END
$$;

NOTIFY pgrst, 'reload schema';
