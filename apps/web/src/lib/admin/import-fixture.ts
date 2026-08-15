/**
 * A worked example for `/admin/import?state=demo` — `E10-29`.
 *
 * Deliberately not a clean file. Three rows that exercise the three outcomes the report exists to
 * tell apart, because a demo where everything is fine shows none of the page's actual work:
 *
 *   * `amity` — already there, unchanged, so it must appear as *unchanged* and not as an update;
 *   * `stjohns` — new, so a create;
 *   * `oakridge` — internally valid but names a kitchen that does not exist, which is a
 *     **blocker** rather than a validation error, and the difference is the whole reason the
 *     report separates them.
 *
 * The snapshot is the shape `tools/bulk-import/src/db.mjs` returns, trimmed to what `planSchools`
 * reads: schools, kitchens, cities.
 */
export const DEMO_IMPORT = {
  name: 'schools-example.csv',
  csv: [
    'code,name,city_code,kitchen_code,contact_name,contact_email',
    'amity,Amity International School,sas_nagar,mohali,,',
    'stjohns,St Johns High School,sas_nagar,mohali,Meera Nair,office@stjohns.example',
    'oakridge,Oakridge Academy,sas_nagar,chandigarh_north,,',
  ].join('\n'),

  snapshot: {
    cities: [{ id: 'c-1', code: 'sas_nagar', name: 'SAS Nagar (Mohali)' }],
    kitchens: [{ id: 'k-1', code: 'mohali' }],
    categories: [],
    allergens: [],
    schools: [
      {
        id: 's-1',
        code: 'amity',
        name: 'Amity International School',
        institutionType: 'school',
        addressLine1: null,
        addressLine2: null,
        postcode: null,
        contactName: null,
        contactEmail: null,
        contactPhone: null,
        isActive: true,
        onboardedAt: '2026-08-01',
        serviceDays: null,
        cutoffTime: null,
        cutoffDaysBefore: null,
      },
    ],
    dishes: [],
    menus: [],
    menuItems: [],
    breakTimes: [],
    raw: { cities: [], kitchens: [], categories: [], allergens: [] },
  },
};
