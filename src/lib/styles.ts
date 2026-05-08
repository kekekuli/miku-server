import styled, { createGlobalStyle } from 'styled-components';

export const GlobalStyle = createGlobalStyle`
	html, body {
		margin: 0;
		background: #1b2838;
	}
`;

export const Page = styled.div`
	flex: 1;
	display: flex;
	align-items: center;
	justify-content: center;
	padding: 1rem;
	background: #1b2838;
`;

export const Card = styled.div`
	background: #2a475e;
	border-radius: 8px;
	padding: 2.5rem 2rem;
	text-align: center;
	max-width: 400px;
	width: 100%;
	box-shadow: 0 4px 24px rgba(0, 0, 0, 0.4);
`;
