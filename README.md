This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Supabase authentication and roles

The app uses Supabase Auth email/password accounts with database-enforced roles:
`admin`, `warehouse`, `inventory_viewer`, `filling`, and `client`. Inventory
viewers can view inventory and transportation records and add rent entries, but
cannot edit or pay existing rents. The client portal uses the same
authenticated login as staff and is restricted to the party linked to its
account. The former client username/PIN login is no longer used.

Before deploying the app changes:

1. Configure `SUPABASE_SERVICE_ROLE_KEY` as a server-only environment variable
   in local `.env.local` and the hosting provider. Use the Supabase secret/service
   role key; never prefix it with `NEXT_PUBLIC_` or expose it in browser code.
2. Back up the Supabase project and apply
   `supabase/migrations/20261117000000_add_authenticated_app_roles.sql` in the
   Supabase SQL Editor. It enables row-level security and removes direct
   anonymous table access from the app's tables.
3. Apply
   `supabase/migrations/20261118000000_add_user_profile_active_status.sql`.
   This adds database-enforced account disable/enable status.
4. Apply
   `supabase/migrations/20261119000000_add_inventory_viewer_role.sql`.
   This adds the inventory viewer role.
5. Apply
   `supabase/migrations/20261120000000_allow_inventory_viewer_rent_insert.sql`.
   This lets inventory viewers add rent entries without changing existing records.
6. Apply
   `supabase/migrations/20261121000000_grant_master_carton_options_select_authenticated.sql`.
   This restores authenticated read access to master carton options while keeping
   row-level security in place.
7. Apply
   `supabase/migrations/20261124000000_add_printed_batch_details_to_inventory_logs.sql`.
   This lets warehouse staff include printed packaging batch and date details in
   Stock IN records for the Filling page.
8. Apply
   `supabase/migrations/20261122000000_create_party_product_mrps.sql`,
   `supabase/migrations/20261123000000_add_batch_dates_to_party_product_mrps.sql`,
   and
   `supabase/migrations/20261125000000_add_batch_qty_and_prevent_duplicate_filling_batches.sql`
   in order. These add product batch settings, enforce configured batch
   quantities, and prevent reusing filling requisition batch numbers.
9. For **Admin → Daily Task Tracker**, apply
   `supabase/migrations/20261128000000_create_admin_daily_tasks.sql`,
   `supabase/migrations/20261129000000_fix_admin_daily_task_option_value.sql`,
   and
   `supabase/migrations/20261130000000_add_recurring_admin_daily_tasks.sql`
   in order. Tasks can repeat daily, every Monday, or on the first day of each
   month; completed and missed occurrences are recorded in task history. Task
   edits and removals are also recorded; removing a task archives it so its
   history remains available. If this migration was applied before, re-run its
   latest version to add task editing and archiving support.
10. Create the first administrator in **Authentication → Users** in the
   Supabase Dashboard. Copy that user's UID.
11. In the SQL Editor, assign the first admin role using the copied UID:

   ```sql
   INSERT INTO public.user_profiles (user_id, role)
   VALUES ('PASTE-AUTH-USER-UUID-HERE', 'admin');
   ```

12. Sign in to the app as that user. Create accounts, set/reset their passwords,
   assign roles and (for clients) parties, and enable/disable access in
   **Admin → User Access & Roles**. Passwords are managed by Supabase Auth.

The migration does not remove existing rows from `party_access`; it revokes
application access to that legacy PIN table. Existing client PINs will not
authenticate after the app is deployed. Create new Auth accounts and link each
one to its party before moving clients to the new login.

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
