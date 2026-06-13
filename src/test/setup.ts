import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';

// Mock fetch globally
global.fetch = vi.fn();

// Mock navigator.clipboard
Object.defineProperty(navigator, 'clipboard', {
  value: {
    writeText: vi.fn().mockResolvedValue(undefined),
    readText: vi.fn().mockResolvedValue(''),
  },
  writable: true,
});

// Mock URL.createObjectURL and revokeObjectURL
global.URL.createObjectURL = vi.fn(() => 'blob:mock-url');
global.URL.revokeObjectURL = vi.fn();

// Mock performance.now
vi.spyOn(performance, 'now').mockReturnValue(0);

// Mock scrollIntoView
Element.prototype.scrollIntoView = vi.fn();

// Mock AbortController
class MockAbortController {
  signal = { aborted: false };
  abort() {
    this.signal.aborted = true;
  }
}
global.AbortController = MockAbortController as any;

// Reset mocks between tests
beforeEach(() => {
  vi.clearAllMocks();
});
