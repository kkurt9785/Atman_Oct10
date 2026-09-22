export const GIGWORKER_MODE_KEY = 'atman_gigworker_mode';
export const WORKER_MODE_CHANGED_EVENT = 'atman:worker-mode-changed';

type FacilityRelation = {
  registration_source?: string | null;
};

type StaffLinkRelation = {
  facilities?: FacilityRelation | FacilityRelation[] | null;
};

export function getFacilityRegistrationSources(rows: unknown[] | null | undefined) {
  return (rows ?? []).flatMap((row) => {
    const facilities = (row as StaffLinkRelation)?.facilities;
    const facility = Array.isArray(facilities) ? facilities[0] : facilities;
    return facility?.registration_source ? [facility.registration_source] : [];
  });
}

export function hasGigworkerLink(sources: string[]) {
  return sources.includes('gigworker_trial');
}

export function getGigworkerModePreference() {
  return typeof window !== 'undefined' && window.localStorage.getItem(GIGWORKER_MODE_KEY) === '1';
}

export function shouldUseGigworkerMode(
  sources: string[],
  workerRole: string | null | undefined,
  preferred = getGigworkerModePreference(),
) {
  return hasGigworkerLink(sources) && (preferred || workerRole === 'other');
}

export function setGigworkerModePreference(enabled: boolean) {
  if (typeof window === 'undefined') return;
  if (enabled) window.localStorage.setItem(GIGWORKER_MODE_KEY, '1');
  else window.localStorage.removeItem(GIGWORKER_MODE_KEY);
  window.dispatchEvent(new Event(WORKER_MODE_CHANGED_EVENT));
}
