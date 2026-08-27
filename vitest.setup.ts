import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// Unmount between tests. Without this a component from a previous test is still
// in the document and `getByRole` finds two of everything.
afterEach(cleanup);
