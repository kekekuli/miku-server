import styled from 'styled-components';
import { Page, Card } from './styles';
import type { SteamProfile } from './App';

const Avatar = styled.img`
	width: 100px;
	height: 100px;
	border-radius: 6px;
	border: 2px solid #66c0f4;
	margin-bottom: 1rem;
`;

const Name = styled.h2`
	font-size: 1.4rem;
	color: #ffffff;
	margin-bottom: 0.4rem;
`;

const Flag = styled.img`
	margin-bottom: 1rem;
	border-radius: 2px;
`;

const Meta = styled.div`
	display: flex;
	flex-direction: column;
	gap: 0.2rem;
	background: #1b2838;
	border-radius: 6px;
	padding: 0.75rem 1rem;
	margin-bottom: 1rem;
	font-size: 0.85rem;
`;

const Label = styled.span`
	color: #8f98a0;
	font-size: 0.75rem;
	text-transform: uppercase;
	letter-spacing: 0.05em;
`;

const Tip = styled.span`
	color: #8f98a0;
	font-style: italic;
	font-size: 0.82rem;
`;

const Actions = styled.div`
	display: flex;
	flex-direction: column;
	gap: 0.75rem;
	margin-top: 0.5rem;
`;

const PrimaryBtn = styled.a`
	display: block;
	padding: 0.6rem 1rem;
	border-radius: 4px;
	font-size: 0.9rem;
	text-decoration: none;
	background: #4c6b22;
	color: #c1d7ae;
	transition: background 0.15s;

	&:hover {
		background: #5c7a2a;
	}
`;

const SecondaryBtn = styled.a`
	display: block;
	padding: 0.6rem 1rem;
	border-radius: 4px;
	font-size: 0.9rem;
	text-decoration: none;
	background: transparent;
	color: #8f98a0;
	border: 1px solid #4e6b7c;
	transition: background 0.15s;

	&:hover {
		background: #1b2838;
	}
`;

interface Props {
	profile: SteamProfile;
}

export default function ProfilePage({ profile }: Props) {
	return (
		<Page>
			<Card>
				<Avatar src={profile.avatar} alt={profile.name} />
				<Name>{profile.name}</Name>
				{profile.countryCode && (
					<Flag
						src={`https://flagcdn.com/24x18/${profile.countryCode.toLowerCase()}.png`}
						alt={profile.countryCode}
						title={profile.countryCode}
					/>
				)}
				<Meta>
					<Label>Steam ID</Label>
					<span>{profile.steamId}</span>
				</Meta>
				<Meta>
					<Label>Squad 44</Label>
					{profile.squad44Hours !== null ? (
						<span>已游玩 {profile.squad44Hours} 小时</span>
					) : (
						<Tip>无法获取游戏时长 — 请将 Steam 隐私设置中的「游戏详情」设为公开。</Tip>
					)}
				</Meta>
				<Actions>
					<PrimaryBtn href={profile.profileUrl} target="_blank" rel="noreferrer">
						查看 Steam 个人资料
					</PrimaryBtn>
					<SecondaryBtn href="/">退出登录</SecondaryBtn>
				</Actions>
			</Card>
		</Page>
	);
}
