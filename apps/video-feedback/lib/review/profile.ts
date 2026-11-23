// What this browser remembers about its reviewer, for every review link on this site: their
// name, and whether they have said hello to the microphone check and done the practice. It
// lives in localStorage, so a redeploy or a new film does not ask again.

export interface ReviewerProfile {
  name: string;
  micChecked: boolean;
  practised: boolean;
}

export const PROFILE_KEY = 'vf:reviewer';

const EMPTY: ReviewerProfile = { name: '', micChecked: false, practised: false };

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    // Blocked outright (some private modes): every visit is a first visit.
    return null;
  }
}

/** The stored profile, or an empty one. Anything malformed counts as nothing stored. */
export function readProfile(): ReviewerProfile {
  let raw: string | null = null;
  try {
    raw = storage()?.getItem(PROFILE_KEY) ?? null;
  } catch {
    return { ...EMPTY };
  }
  if (raw === null) return { ...EMPTY };
  try {
    const v = JSON.parse(raw) as Partial<Record<keyof ReviewerProfile, unknown>> | null;
    if (v === null || typeof v !== 'object') return { ...EMPTY };
    return {
      name: typeof v.name === 'string' ? v.name.trim().slice(0, 80) : '',
      micChecked: v.micChecked === true,
      practised: v.practised === true,
    };
  } catch {
    return { ...EMPTY };
  }
}

/** Remembers part of the profile, keeping the rest. Quietly does nothing if storage fails. */
export function saveProfile(patch: Partial<ReviewerProfile>): void {
  try {
    storage()?.setItem(PROFILE_KEY, JSON.stringify({ ...readProfile(), ...patch }));
  } catch {
    // Full or blocked: the review works, it just asks again next time.
  }
}
