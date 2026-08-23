/**
 * Where a `?next=` parameter is allowed to send someone.
 *
 * `ConsoleShell` bounces an expired session to `/login?next=<where they were>`
 * so signing in returns them to the screen they asked for. That parameter
 * arrives in a URL, which makes it attacker-supplied by definition: a link to
 * `/login?next=https://not-edawr.example/console` would, the moment a manager
 * finished typing a real password, hand them a convincing copy of this console
 * on somebody else's domain. The destination has to be inside this app.
 *
 * A leading `//` is the case worth naming, because it looks like a path and is
 * not: `//evil.example/x` is a protocol-relative URL and leaves the site just
 * as completely as `https://` does.
 */
export function safeNext(raw: string | null | undefined): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//')) return '/';
  return raw;
}
