import { useGetSessionQuery } from '../lib/api';
import type { SteamProfile, AdminMe, AccountMe, SessionMe } from '../../shared/types';

/**
 * Profile and admin permissions arrive together from GET /api/me, so every consumer
 * below shares one cache entry and one request. `selectFromResult` narrows the slice
 * each consumer subscribes to, so a profile-only component does not re-render when
 * the admin half changes.
 */

export function useProfile(): { profile: SteamProfile | null; isLoading: boolean } {
  return useGetSessionQuery(undefined, {
    selectFromResult: ({ data, isLoading }) => ({ profile: data?.profile ?? null, isLoading }),
  });
}

export function useAdmin(): { admin: AdminMe | null; isLoading: boolean } {
  return useGetSessionQuery(undefined, {
    selectFromResult: ({ data, isLoading }) => ({ admin: data?.admin ?? null, isLoading }),
  });
}

export function useAccount(): { account: AccountMe | null; isLoading: boolean } {
  return useGetSessionQuery(undefined, {
    selectFromResult: ({ data, isLoading }) => ({ account: data?.account ?? null, isLoading }),
  });
}

export function useSessionInfo(): { session: SessionMe | null; isLoading: boolean } {
  return useGetSessionQuery(undefined, {
    selectFromResult: ({ data, isLoading }) => ({ session: data?.session ?? null, isLoading }),
  });
}
