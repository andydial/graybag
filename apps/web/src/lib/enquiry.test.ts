import { describe, expect, it } from 'vitest';

import {
  EMPTY_ENQUIRY,
  HONEYPOT_FIELD,
  LIMITS,
  MIN_FILL_MS,
  ROLES,
  isValid,
  looksAutomated,
  looksLikeEmail,
  normalisePhone,
  tidy,
  toPayload,
  validateEnquiry,
  type EnquiryInput,
} from './enquiry.js';

/** A valid enquiry, so each test can change exactly one thing and say what it is testing. */
const good: EnquiryInput = {
  name: 'Sunita Rao',
  role: 'principal',
  school: 'Amity International School',
  city: 'Mohali',
  email: 'principal@example.edu.in',
  phone: '9876543210',
  message: 'We serve about 900 children and the canteen queue is our worst 20 minutes.',
};

describe('tidy', () => {
  it('trims and collapses the whitespace a paste from a PDF brings with it', () => {
    expect(tidy('  Gem   Public\n\tSchool  ')).toBe('Gem Public School');
  });

  it('leaves an already-clean string alone', () => {
    expect(tidy('Mohali')).toBe('Mohali');
  });
});

describe('looksLikeEmail', () => {
  it.each([
    'principal@example.edu.in',
    'a.b-c+tag@sub.domain.co.in',
    "o'brien@school.org",
  ])('accepts %s', (value) => {
    expect(looksLikeEmail(value)).toBe(true);
  });

  it.each([
    ['no at sign', 'principal.example.edu.in'],
    ['no dot in the domain', 'principal@example'],
    ['a space', 'principal @example.edu.in'],
    ['a trailing comma from a copy-paste', 'principal@example.edu.in,'],
    ['nothing before the at', '@example.edu.in'],
  ])('rejects %s', (_why, value) => {
    expect(looksLikeEmail(value)).toBe(false);
  });

  it('rejects an address longer than the RFC maximum', () => {
    expect(looksLikeEmail(`${'a'.repeat(LIMITS.email.max)}@example.com`)).toBe(false);
  });
});

describe('normalisePhone', () => {
  it.each([
    ['bare ten digits', '9876543210'],
    ['spaced', '98765 43210'],
    ['hyphenated', '98765-43210'],
    ['with +91', '+919876543210'],
    ['with +91 and a space', '+91 98765 43210'],
    ['with a leading zero', '09876543210'],
    ['with 0091', '00919876543210'],
    ['with a bare 91 prefix', '919876543210'],
    ['bracketed', '(+91) 98765.43210'],
  ])('normalises %s to +919876543210', (_why, value) => {
    expect(normalisePhone(value)).toBe('+919876543210');
  });

  it.each([
    ['too short', '987654321'],
    ['too long', '98765432101'],
    ['a landline that does not start 6-9', '1725012345'],
    ['starts with 5', '5876543210'],
    ['letters', '98765abcde'],
    ['empty', ''],
  ])('rejects %s', (_why, value) => {
    expect(normalisePhone(value)).toBeNull();
  });

  it('does not mistake a ten-digit number starting 91 for a country code', () => {
    // 9176543210 is a valid mobile beginning 9; stripping "91" would corrupt it.
    expect(normalisePhone('9176543210')).toBe('+919176543210');
  });
});

describe('validateEnquiry', () => {
  it('accepts a complete enquiry', () => {
    expect(validateEnquiry(good)).toEqual({});
    expect(isValid(validateEnquiry(good))).toBe(true);
  });

  it('accepts an enquiry with no message — only the message is optional', () => {
    expect(validateEnquiry({ ...good, message: '' })).toEqual({});
  });

  it('reports every empty required field at once rather than one at a time', () => {
    const errors = validateEnquiry(EMPTY_ENQUIRY);
    expect(Object.keys(errors).sort()).toEqual(['email', 'name', 'phone', 'role', 'school']);
    // `city` is pre-filled with Mohali, which is the only city we serve (SC1).
    expect(errors.city).toBeUndefined();
  });

  it.each(ROLES.map((r) => r.value))('accepts the role %s', (role) => {
    expect(validateEnquiry({ ...good, role })).toEqual({});
  });

  it('rejects a role that is not on the list', () => {
    expect(validateEnquiry({ ...good, role: 'headmaster' }).role).toBeDefined();
  });

  it('treats a whitespace-only name as missing', () => {
    expect(validateEnquiry({ ...good, name: '   ' }).name).toBeDefined();
  });

  it.each([
    ['name', 'name', LIMITS.name.max],
    ['school', 'school', LIMITS.school.max],
    ['city', 'city', LIMITS.city.max],
  ] as const)('rejects an over-long %s', (_label, field, max) => {
    expect(validateEnquiry({ ...good, [field]: 'a'.repeat(max + 1) })[field]).toBeDefined();
    expect(validateEnquiry({ ...good, [field]: 'a'.repeat(max) })[field]).toBeUndefined();
  });

  it('rejects an over-long message but accepts one exactly at the limit', () => {
    expect(validateEnquiry({ ...good, message: 'a'.repeat(LIMITS.message.max + 1) }).message).toBeDefined();
    expect(validateEnquiry({ ...good, message: 'a'.repeat(LIMITS.message.max) }).message).toBeUndefined();
  });

  it('gives a message that says what to do, not what is wrong', () => {
    expect(validateEnquiry({ ...good, phone: '12345' }).phone).toBe(
      'Enter a 10-digit Indian mobile number.',
    );
  });
});

describe('toPayload', () => {
  it('tidies, lowercases the email and normalises the phone', () => {
    expect(
      toPayload({
        ...good,
        name: '  Sunita   Rao ',
        school: 'Gem  Public\tSchool',
        email: 'Principal@Example.EDU.in',
        phone: '+91 98765-43210',
      }),
    ).toEqual({
      name: 'Sunita Rao',
      role: 'principal',
      school: 'Gem Public School',
      city: 'Mohali',
      email: 'principal@example.edu.in',
      phone: '+919876543210',
      message: good.message,
    });
  });

  it('sends null rather than an empty string for an absent message', () => {
    expect(toPayload({ ...good, message: '   ' }).message).toBeNull();
  });

  it('refuses to build a payload from an invalid enquiry', () => {
    expect(() => toPayload({ ...good, email: 'nope' })).toThrow(/email/);
  });

  it('names every invalid field in the throw, so a caller bug is diagnosable', () => {
    expect(() => toPayload(EMPTY_ENQUIRY)).toThrow(/name.*role.*school.*email.*phone/);
  });
});

describe('looksAutomated', () => {
  it('passes a human who took their time and left the honeypot alone', () => {
    expect(looksAutomated('', MIN_FILL_MS + 1)).toBe(false);
  });

  it('catches anything that filled the honeypot, however slowly', () => {
    expect(looksAutomated('http://spam.example', 60_000)).toBe(true);
  });

  it('catches a submission faster than a person can type', () => {
    expect(looksAutomated('', MIN_FILL_MS - 1)).toBe(true);
  });

  it('treats a whitespace-only honeypot as untouched — some browsers autofill a space', () => {
    expect(looksAutomated('  ', MIN_FILL_MS + 1)).toBe(false);
  });

  it('names a honeypot field that no real field is called', () => {
    expect(Object.keys(EMPTY_ENQUIRY)).not.toContain(HONEYPOT_FIELD);
  });
});
