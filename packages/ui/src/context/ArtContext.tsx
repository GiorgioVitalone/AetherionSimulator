/**
 * ArtContext — provides the base URL for card art resolution.
 * Consumers wrap their app in <ArtProvider value="http://...">
 * so the ui package stays decoupled from environment variables.
 */
import { createContext, useContext } from 'react';

const ArtContext = createContext<string>('');

export const ArtProvider = ArtContext.Provider;

export function useArtBaseUrl(): string {
  return useContext(ArtContext);
}
