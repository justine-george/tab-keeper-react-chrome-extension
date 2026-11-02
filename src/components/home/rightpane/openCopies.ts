import { createContext, useContext } from 'react';

export const NO_OPEN_COPIES: ReadonlySet<string> = new Set();

// KAN-890. The addresses with an open copy; empty outside a provider or before the first read.
export const OpenCopyAddresses =
  createContext<ReadonlySet<string>>(NO_OPEN_COPIES);

export function useOpenCopyAddresses(): ReadonlySet<string> {
  return useContext(OpenCopyAddresses);
}
