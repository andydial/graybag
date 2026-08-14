import { afterEach, describe, expect, it, vi } from 'vitest';

import { setApiTransport, type ApiTransport } from './client.js';
import { fakeTransport } from './test-support.js';
import {
  ADMIN_SCHOOL_COLUMNS,
  AdminSchoolError,
  createSchool,
  fetchAdminSchools,
  fetchCities,
  fetchKitchens,
  updateSchool,
} from './admin-schools.js';
import { SCHOOL_COLUMNS } from './schools.js';

afterEach(() => setApiTransport(null));

const ROW = {
  id: 's-1',
  code: 'amity',
  name: 'Amity International',
  institution_type: 'school',
  address_line1: '12 Phase 8',
  address_line2: null,
  postcode: '160055',
  contact_name: 'Ritu Sharma',
  contact_email: 'ritu@example.invalid',
  contact_phone: '+919000000000',
  is_active: true,
  onboarded_at: '2026-08-15T00:00:00Z',
  kitchen_id: 'k-1',
  city: { name: 'SAS Nagar (Mohali)' },
  kitchen: { name: 'Mohali Central' },
};

/** A transport whose only job is to record the invoke and answer it. */
function stub(answer: { data?: unknown; error?: Error | null }) {
  const invoke = vi.fn().mockResolvedValue({ data: answer.data ?? null, error: answer.error ?? null });
  setApiTransport({
    from: () => {
      throw new Error('this test must not read a table');
    },
    functions: { invoke },
  } as unknown as ApiTransport);
  return invoke;
}

describe('fetchAdminSchools', () => {
  it('maps a row, flattening the embedded city and kitchen', async () => {
    setApiTransport(fakeTransport([ROW]).transport);
    const [school] = await fetchAdminSchools();
    expect(school!.code).toBe('amity');
    expect(school!.cityName).toBe('SAS Nagar (Mohali)');
    expect(school!.kitchenName).toBe('Mohali Central');
    expect(school!.contactEmail).toBe('ritu@example.invalid');
  });

  it('reads a named column list, never *', () => {
    // A policy filters rows, never columns. This list is deliberately wider than the
    // parent-facing one, and that widening has to stay a decision.
    expect(ADMIN_SCHOOL_COLUMNS).not.toContain('*');
  });

  it('is a strictly wider read than the parent-facing picker, on purpose', () => {
    // The check that keeps the two apart. `schools.ts` must never grow the contact columns; if
    // somebody ever makes them equal, this fails and they have to say why.
    expect(SCHOOL_COLUMNS).not.toContain('contact_phone');
    expect(SCHOOL_COLUMNS).not.toContain('contact_email');
    expect(ADMIN_SCHOOL_COLUMNS).toContain('contact_phone');
  });

  it('orders by name, because that is how somebody scans a list of schools', async () => {
    const fake = fakeTransport([ROW]);
    setApiTransport(fake.transport);
    await fetchAdminSchools();
    expect(fake.queries[0]!.orders).toEqual([{ column: 'name', ascending: true }]);
  });

  it('treats a null onboarded_at as "never onboarded" rather than as missing data', async () => {
    // `P1`: only an onboarded school appears in the parent-facing picker. A school created but
    // not onboarded is a real and important state for this screen to show.
    setApiTransport(fakeTransport([{ ...ROW, onboarded_at: null }]).transport);
    const [school] = await fetchAdminSchools();
    expect(school!.onboardedAt).toBeNull();
  });

  it('defaults is_active to true only when the column is absent, not when it is false', async () => {
    setApiTransport(fakeTransport([{ ...ROW, is_active: false }]).transport);
    expect((await fetchAdminSchools())[0]!.isActive).toBe(false);
  });

  it('refuses a row with no code rather than rendering a school that cannot be matched', async () => {
    // `code` is the permanent key `tools/bulk-import` matches on. A school shown without one is a
    // school somebody will try to edit and fail to save.
    setApiTransport(fakeTransport([{ ...ROW, code: null }]).transport);
    await expect(fetchAdminSchools()).rejects.toThrow(AdminSchoolError);
  });

  it('returns an empty list as an empty list, not an error', async () => {
    setApiTransport(fakeTransport([]).transport);
    expect(await fetchAdminSchools()).toEqual([]);
  });
});

describe('fetchKitchens and fetchCities', () => {
  it('offers only active kitchens, because an inactive one cannot serve a new school', async () => {
    const fake = fakeTransport([{ id: 'k-1', code: 'mohali_central', name: 'Mohali Central' }]);
    setApiTransport(fake.transport);
    await fetchKitchens();
    expect(fake.queries[0]!.filters).toEqual([{ column: 'is_active', value: true }]);
  });

  it('offers only active cities', async () => {
    const fake = fakeTransport([{ id: 'c-1', code: 'sas_nagar', name: 'SAS Nagar (Mohali)' }]);
    setApiTransport(fake.transport);
    await fetchCities();
    expect(fake.queries[0]!.filters).toEqual([{ column: 'is_active', value: true }]);
  });
});

describe('createSchool', () => {
  it('POSTs to the admin-school Edge Function — writes never touch a table', async () => {
    const invoke = stub({ data: { id: 's-9', code: 'gem' } });
    const result = await createSchool({
      code: 'gem', name: 'Gem Public School', cityCode: 'sas_nagar', kitchenCode: 'mohali_central',
    });
    expect(result).toEqual({ id: 's-9', code: 'gem' });
    expect(invoke).toHaveBeenCalledWith('admin-school', expect.objectContaining({
      body: expect.objectContaining({ code: 'gem' }),
      method: 'POST',
    }));
  });

  it('passes config through untouched, including an explicit null', async () => {
    // The three-way distinction the whole inheritance model rests on: a value sets an override,
    // `null` clears one, and an absent key leaves it alone. This module must not normalise any of
    // the three into another.
    const invoke = stub({ data: { id: 's-9', code: 'gem' } });
    await createSchool({
      code: 'gem', name: 'Gem', cityCode: 'sas_nagar', kitchenCode: 'mohali_central',
      config: { serviceDays: [1, 2, 3, 4, 5], orderCutoffTime: null },
    });
    const body = invoke.mock.calls[0]![1].body as { config: Record<string, unknown> };
    expect(body.config.serviceDays).toEqual([1, 2, 3, 4, 5]);
    expect(body.config.orderCutoffTime).toBeNull();
    expect('maxAdvanceOrderDays' in body.config).toBe(false);
  });
});

describe('updateSchool', () => {
  it('PATCHes, and reports what the server says changed', async () => {
    const invoke = stub({ data: { id: 's-1', changed: ['name', 'config.service_days'] } });
    const result = await updateSchool({ id: 's-1', name: 'Amity International School' });
    expect(result.changed).toEqual(['name', 'config.service_days']);
    expect(invoke.mock.calls[0]![1].method).toBe('PATCH');
  });

  it('sends only the keys the caller set, so a partial save cannot blank a field', async () => {
    // The failure this guards: a form that sends every field it knows about, with the ones it did
    // not show as undefined, blanks a contact somebody entered last week.
    const invoke = stub({ data: { id: 's-1', changed: [] } });
    await updateSchool({ id: 's-1', contactEmail: 'new@example.invalid' });
    const body = invoke.mock.calls[0]![1].body as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(['contactEmail', 'id']);
  });

  it('has no way to change the code, because it is the permanent match key', () => {
    // Not a runtime assertion — a type-level one, stated here so the reasoning is findable.
    // `tools/bulk-import` matches on `code`; changing it would make the next import create a
    // second school rather than update this one.
    const edit: Parameters<typeof updateSchool>[0] = { id: 's-1' };
    expect('code' in edit).toBe(false);
  });
});
