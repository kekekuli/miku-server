import styled from 'styled-components';
import { Heading, Text } from '@radix-ui/themes';
import { Page, Card } from './styles';
import type { SteamProfile } from '../shared/types';

const Avatar = styled.img`
	width: 100px;
	height: 100px;
	border-radius: 6px;
	border: 2px solid #66c0f4;
	margin-bottom: 1rem;
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

const toHours = (minutes: number) => Math.round(minutes / 60 * 10) / 10;

export default function ProfilePage({ profile }: Props) {
  const status = profile.squad44Status;
  const totalHours = status ? toHours(status.playtime_forever) : null;
  const recentHours = status?.playtime_2weeks !== undefined ? toHours(status.playtime_2weeks) : null;

  return (
    <Page>
      <Card>
        <Avatar src={profile.avatar} alt={profile.name} />
        <Heading size="5" mb="1">{profile.name}</Heading>
        {profile.countryCode && (
          <Flag
            src={`https://flagcdn.com/24x18/${profile.countryCode.toLowerCase()}.png`}
            alt={profile.countryCode}
            title={profile.countryCode}
          />
        )}
        <Meta>
          <Text size="1" color="gray" weight="medium" style={{ textTransform: 'uppercase', letterSpacing: '0.05em' }}>Steam ID</Text>
          <span>{profile.steamId}</span>
        </Meta>
        <Meta>
          <Text size="1" color="gray" weight="medium" style={{ textTransform: 'uppercase', letterSpacing: '0.05em' }}>Squad 44</Text>
          <span>总计 {totalHours !== null ? `${totalHours} 小时` : '—'}</span>
          <span>近两周 {recentHours !== null ? `${recentHours} 小时` : '—'}</span>
        </Meta>
        <Actions>
          <PrimaryBtn href={profile.profileUrl} target="_blank" rel="noreferrer">
            查看 Steam 个人资料
          </PrimaryBtn>
          <SecondaryBtn href="/auth/logout">退出登录</SecondaryBtn>
        </Actions>
      </Card>
    </Page>
  );
}
