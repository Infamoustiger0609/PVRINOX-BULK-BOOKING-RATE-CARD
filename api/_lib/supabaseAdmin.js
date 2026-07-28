import { createClient } from '@supabase/supabase-js';

// Service-role client — bypasses Row Level Security, so this must only ever
// be imported by server-side code under /api, never shipped to the browser.
export const supabaseAdmin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});
