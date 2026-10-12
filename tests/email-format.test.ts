import { describe, expect, it } from 'vitest';
import { isEmailShaped } from '../src/lib/emailFormat';

describe('isEmailShaped', () => {
  it.each(['a@b.co', 'first.last@mail.example.com', 'a@b..c', 'a@...'])('accepts %s', value => {
    expect(isEmailShaped(value)).toBe(true);
  });

  it.each([
    '',
    'a',
    '@b.co',
    'a@',
    'a@b',
    'a@.b',
    'a@b.',
    'a@@b.co',
    'a@b@c.d',
    'a b@c.d',
    'a@b .c',
  ])('rejects %s', value => {
    expect(isEmailShaped(value)).toBe(false);
  });

  it('agrees with the pattern it replaced on every short string', () => {
    const pattern = new RegExp(String.raw`^[^\s@]+@[^\s@]+\.[^\s@]+$`);
    const alphabet = ['a', '@', '.', ' '];
    const check = (value: string, depth: number) => {
      expect(isEmailShaped(value), JSON.stringify(value)).toBe(pattern.test(value));
      if (depth === 0) return;
      for (const char of alphabet) check(value + char, depth - 1);
    };
    check('', 7);
  });
});
