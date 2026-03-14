export default function LoginPage() {
	return (
		<div className="page">
			<div className="card">
				<h1>Miku Server</h1>
				<p>Sign in with your Steam account to continue.</p>
				<a href="/auth/steam" className="steam-btn">
					<img
						src="https://community.fastly.steamstatic.com/public/images/signinthroughsteam/sits_01.png"
						alt="Sign in through Steam"
					/>
				</a>
			</div>
		</div>
	);
}
