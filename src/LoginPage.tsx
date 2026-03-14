export default function LoginPage() {
	return (
		<div className="page">
			<div className="card">
				<h1>Miku Server</h1>
				<p>使用你的 Steam 账号登录以继续。</p>
				<a href="/auth/steam" className="steam-btn">
					<img
						src="https://community.fastly.steamstatic.com/public/images/signinthroughsteam/sits_01.png"
						alt="通过 Steam 登录"
					/>
				</a>
			</div>
		</div>
	);
}
