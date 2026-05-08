import LoginPage from './LoginPage';
import ProfilePage from './ProfilePage';
import { useGetMeQuery } from './api';

export interface SteamProfile {
  steamId: string;
  name: string;
  avatar: string;
  profileUrl: string;
  countryCode: string | null;
  squad44Hours: number | null;
}

export default function App() {
  const { data: profile, isLoading } = useGetMeQuery();

  if (isLoading) return null;
  if (profile) return <ProfilePage profile={profile} />;
  return <LoginPage />;
}
