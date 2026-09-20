import { describe, expect, it } from '@jest/globals';

import { validateEnvironment } from './environment';

const VALID = {
  SUPABASE_URL: 'https://project.supabase.co',
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
  SUPABASE_SECRET_KEY: 'sb_secret_test',
};

describe('validateEnvironment', () => {
  it('applies defaults for optional values', () => {
    const environment = validateEnvironment({ ...VALID });

    expect(environment.PORT).toBe(3000);
    expect(environment.NODE_ENV).toBe('development');
    expect(environment.WEB_ORIGINS).toEqual(['http://localhost:3001']);
  });

  it('coerces PORT from the string the process provides', () => {
    const environment = validateEnvironment({ ...VALID, PORT: '4000' });

    expect(environment.PORT).toBe(4000);
  });

  it('splits WEB_ORIGINS and ignores incidental whitespace', () => {
    const environment = validateEnvironment({
      ...VALID,
      WEB_ORIGINS: 'http://localhost:3001, https://app.example.com ,',
    });

    expect(environment.WEB_ORIGINS).toEqual([
      'http://localhost:3001',
      'https://app.example.com',
    ]);
  });

  it('fails fast when a required value is missing', () => {
    const { SUPABASE_PUBLISHABLE_KEY: _omitted, ...incomplete } = VALID;

    expect(() => validateEnvironment(incomplete)).toThrow(
      /SUPABASE_PUBLISHABLE_KEY/,
    );
  });

  it('treats a blank value as unset, as an unfilled .env placeholder is', () => {
    const environment = validateEnvironment({
      ...VALID,
      PORT: '',
      SUPABASE_SECRET_KEY: '   ',
    });

    expect(environment.PORT).toBe(3000);
    expect(environment.SUPABASE_SECRET_KEY).toBeUndefined();
  });

  it('starts without a secret key, which only privileged work needs', () => {
    const { SUPABASE_SECRET_KEY: _omitted, ...withoutSecret } = VALID;

    expect(
      validateEnvironment(withoutSecret).SUPABASE_SECRET_KEY,
    ).toBeUndefined();
  });

  it('rejects a Supabase URL that is not a URL', () => {
    expect(() =>
      validateEnvironment({ ...VALID, SUPABASE_URL: 'project.supabase.co' }),
    ).toThrow(/SUPABASE_URL/);
  });
});
