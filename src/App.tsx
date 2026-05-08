import LoginPage from './LoginPage';
import ProfilePage from './ProfilePage';
import { useGetMeQuery } from './api';

export default function App() {
  const { data: profile, isLoading } = useGetMeQuery();

  if (isLoading) return null;
  if (profile) return <ProfilePage profile={profile} />;
  return <LoginPage />;
}
