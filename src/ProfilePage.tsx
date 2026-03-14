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
				<div className="meta">
					<span className="label">Squad 44</span>
					{profile.squad44Hours !== null ? (
						<span>已游玩 {profile.squad44Hours} 小时</span>
					) : (
						<span className="tip">
							无法获取游戏时长 — 请将 Steam 隐私设置中的「游戏详情」设为公开。
						</span>
					)}
				</div>
				<div className="actions">
					<a href={profile.profileUrl} target="_blank" rel="noreferrer" className="btn-primary">
						查看 Steam 个人资料
					</a>
					<a href="/" className="btn-secondary">
						退出登录
					</a>
				</div>
			</div>
		</div>
	);
}
