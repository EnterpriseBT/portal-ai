import '@testing-library/jest-dom';

// Extend Jest matchers with jest-dom
// This provides matchers like toBeInTheDocument(), toHaveClass(), etc.

// Optional: Add custom matchers or global test utilities here
// Example:
// global.customTestUtil = () => { ... };

// Optional: Mock window.matchMedia if components use media queries
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }),
});
