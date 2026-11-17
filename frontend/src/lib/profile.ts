const PROFILE_KEY = "haggle.profileId";
const PROFILE_ID = /^[0-9a-f]{32}$/;

type ProfileStorage = Pick<Storage, "getItem" | "setItem">;

let pageProfileId: string | null = null;

function createProfileId(): string {
  return globalThis.crypto.randomUUID().replace(/-/g, "");
}

export function isProfileId(value: string | null): value is string {
  return value !== null && PROFILE_ID.test(value);
}

export function getProfileId(
  storage?: ProfileStorage,
  createId: () => string = createProfileId,
): string {
  if (pageProfileId) return pageProfileId;

  try {
    const target = storage ?? window.localStorage;
    const stored = target.getItem(PROFILE_KEY);
    if (isProfileId(stored)) return stored;

    const id = createId();
    try {
      target.setItem(PROFILE_KEY, id);
    } catch {
      pageProfileId = id;
    }
    return id;
  } catch {
    pageProfileId ??= createId();
    return pageProfileId;
  }
}
