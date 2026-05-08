import { Flex } from '@radix-ui/themes';
import Header from './Header';
import LoginPage from './LoginPage';
import ProfilePage from './ProfilePage';
import { useGetMeQuery } from './api';

export default function App() {
  const { data: profile, isLoading } = useGetMeQuery();

  if (isLoading) return null;

  return (
    <Flex direction="column" style={{ minHeight: '100vh' }}>
      <Header />
      {profile ? <ProfilePage profile={profile} /> : <LoginPage />}
    </Flex>
  );
}
