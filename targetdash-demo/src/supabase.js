import { createClient } from '@supabase/supabase-js'

const URL = "https://nghlvfngpfrhhigkoeem.supabase.co"
const KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5naGx2Zm5ncGZyaGhpZ2tvZWVtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM2NDQyMTgsImV4cCI6MjA4OTIyMDIxOH0.Y4JF1x0m5BKa-btWkQAr1wY1EyTK30nck-hSL2eSNPE"

export const supabase = createClient(URL, KEY)
