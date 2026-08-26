/**
 * Where a `?next=` parameter is allowed to send someone.
 *
 * The sign-in and sign-up pages take `?next=<where they were>` so that
 * finishing returns the customer to the screen they asked for. That parameter
 * arrives in a URL, which makes it attacker-supplied by definition: a link to
 * `/signin?next=https://not-edawr.example/` would, the moment someone finished
 * typing a real password, hand them a convincing copy of this shop on
 * somebody else's domain. The destination has to be inside this app.
 *
 * Copied from `admin/src/lib/redirect.ts` rather than shared: the two packages
 * deploy separately and have never had a common module. Nine lines is the
 * cheaper duplication.
 *
 * A leading `//` is the case worth naming, because it looks like a path and is
 * not: `//evil.example/x` is a protocol-relative URL and leaves the site just
 * as completely as `https://` does.
 */
export function safeNext(raw: string | null | undefined): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//')) return '/';
  return raw;
}
