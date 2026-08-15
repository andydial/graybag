/**
 * A school list the a11y audit and a designer can open without a session — `E10-01`.
 *
 * Same reasoning as `config-fixture.ts`: without `?state=demo` the audit sees the sign-in
 * redirect rather than the screen it is meant to be checking.
 *
 * The shape is the interesting one, not the tidy one — an onboarded school, one created but
 * **not** onboarded (invisible to every parent, `P1`), and one deactivated. Those three states
 * look identical in a list that only shows names, which is the whole reason this screen labels
 * them.
 */
import type { api } from '@graybag/shared';

export const SCHOOLS_FIXTURE: {
  schools: api.AdminSchool[];
  kitchens: api.Kitchen[];
  cities: api.City[];
} = {
  schools: [
    {
      id: 'demo-1', code: 'amity', name: 'Amity International, Mohali',
      cityName: 'SAS Nagar (Mohali)', kitchenId: 'k-1', kitchenName: 'Mohali Central',
      institutionType: 'school', addressLine1: '12 Phase 8', addressLine2: null,
      postcode: '160055', contactName: 'Ritu Sharma', contactEmail: 'ritu@example.invalid',
      contactPhone: '+919000000001', isActive: true, onboardedAt: '2026-08-01T00:00:00Z',
    },
    {
      id: 'demo-2', code: 'gem', name: 'Gem Public School',
      cityName: 'SAS Nagar (Mohali)', kitchenId: 'k-1', kitchenName: 'Mohali Central',
      institutionType: 'school', addressLine1: null, addressLine2: null,
      postcode: null, contactName: null, contactEmail: null, contactPhone: null,
      // Created, never onboarded. Invisible in the parent-facing picker, and the list says so.
      isActive: true, onboardedAt: null,
    },
    {
      id: 'demo-3', code: 'paragon', name: 'Paragon Senior Secondary',
      cityName: 'SAS Nagar (Mohali)', kitchenId: 'k-1', kitchenName: 'Mohali Central',
      institutionType: 'college', addressLine1: null, addressLine2: null,
      postcode: null, contactName: 'A Sharma', contactEmail: null, contactPhone: null,
      isActive: false, onboardedAt: '2026-07-01T00:00:00Z',
    },
  ],
  kitchens: [{ id: 'k-1', code: 'mohali_central', name: 'Mohali Central' }],
  cities: [{ id: 'c-1', code: 'sas_nagar', name: 'SAS Nagar (Mohali)' }],
};
