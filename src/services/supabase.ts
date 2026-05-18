import { createClient } from '@supabase/supabase-js'
import { appConfig } from '../config'

export const supabase =
  appConfig.supabaseUrl && appConfig.supabaseAnonKey
    ? createClient(appConfig.supabaseUrl, appConfig.supabaseAnonKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
        },
      })
    : undefined

export function supabaseStatus() {
  if (!appConfig.supabaseUrl || !appConfig.supabaseAnonKey) {
    return 'Supabase is not connected yet. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY after running the SQL schema.'
  }
  return 'Supabase client configured.'
}
