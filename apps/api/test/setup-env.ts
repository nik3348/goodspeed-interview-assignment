// Runs before the test modules are imported, because the API validates its
// environment as `AppModule` is loaded. The values are fictional: no test in
// this suite reaches Supabase.
process.env.SUPABASE_URL ??= 'https://project.supabase.co';
process.env.SUPABASE_PUBLISHABLE_KEY ??= 'sb_publishable_test';
process.env.SUPABASE_SECRET_KEY ??= 'sb_secret_test';
