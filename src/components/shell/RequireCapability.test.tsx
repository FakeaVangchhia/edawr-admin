import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { RequireCapability } from '@/components/shell/RequireCapability';
import { clearSession, writeSession } from '@/lib/session';

/**
 * The route guard, rendered.
 *
 * These are the first component tests in the repository — `@testing-library/react`
 * was never installed in the storefront, so its whole suite is pure logic and
 * nothing in `ManagerDashboard`, `ProductEditor` or `AdminLogin` is covered.
 * The guard is the right place to start: it is the piece where a mistake is
 * silent rather than loud, because getting it wrong shows a Manager a screen
 * that then fails one request at a time.
 *
 * Note what is being asserted: that the *message* is shown, not that access is
 * prevented. Prevention is the server's job and is tested there. If this file
 * were the only thing standing between a Manager and `/api/admins`, the design
 * would be wrong.
 */

beforeEach(() => {
  window.localStorage.clear();
  clearSession();
});

function signIn(role: 'admin' | 'manager') {
  writeSession({
    email: `${role}@edawr.test`,
    name: role === 'admin' ? 'Owner' : 'Manager',
    role,
    accessToken: 'a-token',
  });
}

describe('RequireCapability', () => {
  it('renders the screen for a role that holds the capability', () => {
    signIn('admin');
    render(
      <RequireCapability capability="accounts">
        <p>Console accounts</p>
      </RequireCapability>,
    );
    expect(screen.getByText('Console accounts')).toBeInTheDocument();
  });

  it('hides the screen from a Manager and explains why', () => {
    signIn('manager');
    render(
      <RequireCapability capability="accounts">
        <p>Console accounts</p>
      </RequireCapability>,
    );

    expect(screen.queryByText('Console accounts')).not.toBeInTheDocument();
    expect(screen.getByText(/Admin access required/i)).toBeInTheDocument();
    expect(screen.getByText(/limited to Admin accounts/i)).toBeInTheDocument();
  });

  it('never tells a Manager their session expired', () => {
    // The distinction the whole 401/403 split rests on. "You may not" and
    // "who are you?" are different answers, and conflating them is what signs
    // people out mid-shift for clicking the wrong link.
    signIn('manager');
    render(
      <RequireCapability capability="audit">
        <p>Activity log</p>
      </RequireCapability>,
    );

    expect(screen.queryByText(/expired/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/sign in again/i)).not.toBeInTheDocument();
  });

  it('names the account so the operator knows which one they are on', () => {
    signIn('manager');
    render(
      <RequireCapability capability="accounts">
        <p>Console accounts</p>
      </RequireCapability>,
    );
    expect(screen.getByText(/manager@edawr\.test/)).toBeInTheDocument();
  });

  it('lets a Manager through to a capability they do hold', () => {
    signIn('manager');
    render(
      <RequireCapability capability="products">
        <p>Products</p>
      </RequireCapability>,
    );
    expect(screen.getByText('Products')).toBeInTheDocument();
  });

  it('renders nothing while there is no session', () => {
    // The shell owns the signed-out case and its own placeholder. This must not
    // flash "Admin access required" at someone who is simply not signed in yet.
    const { container } = render(
      <RequireCapability capability="accounts">
        <p>Console accounts</p>
      </RequireCapability>,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
