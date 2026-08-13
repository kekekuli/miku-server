import { Flex } from '@radix-ui/themes';
import { Routes, Route, Navigate } from 'react-router-dom';
import Header from './components/Header';
import LoginPage from './pages/login';
import ProfilePage from './pages/profile';
import VotePage from './pages/vote';
import AdminPage from './pages/admin';
import TeamSwapPage from './pages/teamswap';
import ModalProvider from './components/ModalProvider';
import { useProfile } from './hooks/useSession';

export default function App() {
  const { profile, isLoading } = useProfile();

  if (isLoading) return null;

  return (
    <Flex direction="column" style={{ minHeight: '100vh' }}>
      <ModalProvider />
      <Header />
      <Routes>
{profile ? (
          <>
            <Route path="/" element={<ProfilePage />} />
            <Route path="/vote" element={<VotePage />} />
            <Route path="/team-swap" element={<TeamSwapPage />} />
            <Route path="/admin" element={<AdminPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </>
        ) : (
          <Route path="*" element={<LoginPage />} />
        )}
      </Routes>
    </Flex>
  );
}
