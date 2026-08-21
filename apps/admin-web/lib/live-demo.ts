export const LIVE_DEMO_REGISTRATION_NUMBERS = [
  'DEMO-TARGET-0001',
  'DEMO-TARGET-PHARMACY',
  'DEMO-TARGET-0026',
] as const;

export function isLiveDemoFacility(facility: {
  is_demo?: boolean | null;
  business_registration_number?: string | null;
} | null | undefined) {
  return Boolean(
    facility?.is_demo
      && facility.business_registration_number
      && LIVE_DEMO_REGISTRATION_NUMBERS.includes(
        facility.business_registration_number as typeof LIVE_DEMO_REGISTRATION_NUMBERS[number],
      ),
  );
}

export function isLiveDemoShift(notes: string | null | undefined) {
  return Boolean(notes?.startsWith('LIVE-SALES-DEMO-'));
}
