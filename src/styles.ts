import styled, { createGlobalStyle } from 'styled-components';

export const GlobalStyle = createGlobalStyle`
	*, *::before, *::after {
		box-sizing: border-box;
		margin: 0;
		padding: 0;
	}

	body {
		font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
		background: #1b2838;
		color: #c6d4df;
		min-height: 100vh;
	}
`;

export const Page = styled.div`
	min-height: 100vh;
	display: flex;
	align-items: center;
	justify-content: center;
	padding: 1rem;
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
