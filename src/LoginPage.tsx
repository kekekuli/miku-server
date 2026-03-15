import styled from 'styled-components';
import { Page, Card } from './styles';

const Title = styled.h1`
	font-size: 1.8rem;
	color: #ffffff;
	margin-bottom: 0.5rem;
`;

const Subtitle = styled.p`
	color: #8f98a0;
	margin-bottom: 1.5rem;
	font-size: 0.95rem;
`;

const SteamBtn = styled.a`
	display: inline-block;
	transition: opacity 0.15s;

	&:hover {
		opacity: 0.85;
	}
`;

export default function LoginPage() {
	return (
		<Page>
			<Card>
				<Title>Miku Server</Title>
				<Subtitle>使用你的 Steam 账号登录以继续。</Subtitle>
				<SteamBtn href="/auth/steam">
					<img
						src="https://community.fastly.steamstatic.com/public/images/signinthroughsteam/sits_01.png"
						alt="通过 Steam 登录"
					/>
				</SteamBtn>
			</Card>
		</Page>
	);
}
