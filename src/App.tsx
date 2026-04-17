import LoginPage from './LoginPage';

export interface SteamProfile {
  steamId: string;
  name: string;
  avatar: string;
  profileUrl: string;
  countryCode: string | null;
  squad44Hours: number | null;
}

export default function App() {
  return <LoginPage />;
}
