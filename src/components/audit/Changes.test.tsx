import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Changes } from '@/components/audit/Changes';

describe('Changes', () => {
  it('renders a before/after pair as a diff', () => {
    render(<Changes changes={{ price: ['120.00', '110.00'] }} />);
    expect(screen.getByText('price')).toBeInTheDocument();
    expect(screen.getByText('120.00')).toHaveClass('line-through');
    expect(screen.getByText('110.00')).toBeInTheDocument();
  });

  it('does not crash on a scalar flag beside the pairs', () => {
    // The API's auto-assign row: `{"delivery_boy_id": [null, 4], "auto": true}`.
    render(<Changes changes={{ delivery_boy_id: [null, 4], auto: true }} />);
    expect(screen.getByText('delivery_boy_id')).toBeInTheDocument();
    expect(screen.getByText('4')).toBeInTheDocument();
    expect(screen.getByText('auto')).toBeInTheDocument();
    expect(screen.getByText('yes')).toBeInTheDocument();
  });

  it('shows a dash for a null side', () => {
    render(<Changes changes={{ image_url: [null, '/uploads/a.png'] }} />);
    expect(screen.getByText('—')).toHaveClass('line-through');
  });
});
