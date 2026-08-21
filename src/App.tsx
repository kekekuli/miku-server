import { Flex } from '@radix-ui/themes';
import { Routes, Route, Navigate } from 'react-router-dom';
import Header from './components/Header';
import LoginPage from './pages/login';
import ProfilePage from './pages/profile';
import VotePage from './pages/vote';
import AdminPage from './pages/admin';
import TeamSwapPage from './pages/teamswap';
import SignupPage from './pages/signup';
import AccountPage from './pages/account';
import ModalProvider from './components/ModalProvider';
import { useAccount, useProfile } from './hooks/useSession';

export default function App() {
  const { profile, isLoading } = useProfile();
  const { account } = useAccount();

  if (isLoading) return null;

  return (
    <Flex direction="column" style={{ minHeight: '100vh' }}>
      <ModalProvider />
      <Header />
      <Routes>
        <Route path="/signup" element={<SignupPage />} />
{profile || account ? (
          <>
            <Route path="/" element={profile ? <ProfilePage /> : <AccountPage />} />
            <Route path="/account" element={<AccountPage />} />
            {profile && <Route path="/vote" element={<VotePage />} />}
            {profile && <Route path="/team-swap" element={<TeamSwapPage />} />}
            {profile && <Route path="/admin" element={<AdminPage />} />}
            <Route path="*" element={<Navigate to="/" replace />} />
          </>
        ) : (
          <Route path="*" element={<LoginPage />} />
        )}
      </Routes>
    </Flex>
  );
}
