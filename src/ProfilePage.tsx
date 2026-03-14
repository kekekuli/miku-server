import type { SteamProfile } from './App';

interface Props {
	profile: SteamProfile;
}

export default function ProfilePage({ profile }: Props) {
	return (
		<div className="page">
			<div className="card profile">
				<img src={profile.avatar} alt={profile.name} className="avatar" />
				<h2>{profile.name}</h2>
				{profile.countryCode && (
					<img
						src={`https://flagcdn.com/24x18/${profile.countryCode.toLowerCase()}.png`}
						alt={profile.countryCode}
						title={profile.countryCode}
						className="flag"
					/>
				)}
				<div className="meta">
					<span className="label">Steam ID</span>
					<span>{profile.steamId}</span>
				</div>
				<div className="actions">
					<a href={profile.profileUrl} target="_blank" rel="noreferrer" className="btn-primary">
						View Steam Profile
					</a>
					<a href="/" className="btn-secondary">
						Sign out
					</a>
				</div>
			</div>
		</div>
	);
}
