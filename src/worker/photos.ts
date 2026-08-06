/** R2 object keys for meal photos (#13).
 *
 *  Every key is `<userId>/<uuid>.jpg`, and that prefix is not decoration —
 *  it IS the authorization check, both for `GET /api/photos/:owner/:name` and
 *  for a `photo_key` arriving on a save. Ownership deliberately does not come
 *  from a `food_logs` row: the confirm sheet shows the photo *before* any row
 *  exists (the Worker writes R2 first so an analysis failure can't lose the
 *  photo), so there would be nothing to check against at the moment it
 *  matters most.
 */

/** `<userId>/<uuid>.jpg`. The name half carries no user input, so a key can
 *  never be steered outside its owner's prefix. */
const KEY =
  /^(?<owner>[^/]+)\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$/;

export function newPhotoKey(userId: string) {
  return `${userId}/${crypto.randomUUID()}.jpg`;
}

/** The key when it is well-formed AND belongs to this user, otherwise
 *  `undefined` — the validate.ts convention, so routes treat it like any
 *  other rejected field. */
export function ownedPhotoKey(value: unknown, userId: string) {
  if (typeof value !== "string") return undefined;
  const owner = KEY.exec(value)?.groups?.owner;
  return owner === userId ? value : undefined;
}
