import { Flex } from '@radix-ui/themes';
import { Routes, Route, Navigate } from 'react-router-dom';
import Header from './components/Header';
import LoginPage from './pages/login';
import ProfilePage from './pages/profile';
import VotePage from './pages/vote';
import ModalProvider from './components/ModalProvider';
import { useGetMeQuery } from './lib/api';

export default function App() {
  const { data: profile, isLoading } = useGetMeQuery();

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
            <Route path="*" element={<Navigate to="/" replace />} />
          </>
        ) : (
          <Route path="*" element={<LoginPage />} />
        )}
      </Routes>
    </Flex>
  );
}
