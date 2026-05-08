import styled from 'styled-components';
import { Heading, Text } from '@radix-ui/themes';
import { Page, Card } from './styles';

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
				<Heading size="7" mb="2">Miku Server</Heading>
				<Text as="p" size="2" color="gray" mb="5">使用你的 Steam 账号登录以继续。</Text>
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
