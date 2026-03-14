import LoginPage from './LoginPage';
import ProfilePage from './ProfilePage';

export interface SteamProfile {
	steamId: string;
	name: string;
	avatar: string;
	profileUrl: string;
	countryCode: string | null;
	squad44Hours: number | null;
}

function parseProfile(): SteamProfile | null {
	const params = new URLSearchParams(window.location.search);
	const steamId = params.get('steamId');
	const name = params.get('name');
	const avatar = params.get('avatar');
	const profileUrl = params.get('profileUrl');

	if (!steamId || !name || !avatar || !profileUrl) return null;

	const rawHours = params.get('squad44Hours');

	return {
		steamId,
		name,
		avatar,
		profileUrl,
		countryCode: params.get('countryCode'),
		squad44Hours: rawHours !== null ? parseFloat(rawHours) : null,
	};
}

export default function App() {
	const profile = parseProfile();
	return profile ? <ProfilePage profile={profile} /> : <LoginPage />;
}
