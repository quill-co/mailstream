import { Client, Config, Mail } from "../src";

class EmailMonitor {
	private client: Client;
	private checkInterval: NodeJS.Timeout | null = null;

	constructor(
		private config: Config,
		private checkIntervalMs: number = 60000
	) {}

	async start() {
		this.client = await Client.create(this.config);

		this.client.on("mail", this.handleNewEmail);

		// Initial check
		await this.client.getUnseenMails();

		// Set up periodic checks
		this.checkInterval = setInterval(async () => {
			await this.client.getUnseenMails();
		}, this.checkIntervalMs);
	}

	private handleNewEmail = (mail: Mail) => {
		console.log("\n=== New Email ===");
		console.log(`From: ${mail.from.map((f: any) => f.address).join(", ")}`);
		console.log(`Subject: ${mail.subject}`);
		console.log(`Date: ${mail.date}`);
		if (mail.plain) {
			console.log("Content:", mail.plain.toString().substring(0, 100));
		}
	};

	async stop() {
		if (this.checkInterval) {
			clearInterval(this.checkInterval);
		}
		if (this.client) {
			await this.client.close();
		}
	}
}

// Example usage
async function monitorExample() {
	const config: Config = {
		host: "imap.gmail.com",
		port: 993,
		email: "your.email@gmail.com",
		password: "your-app-specific-password",
		debug: {
			enabled: true,
			logger: (message, ...args) => {
				console.log(`[${new Date().toISOString()}] ${message}`, ...args);
			},
		},
	};

	const monitor = new EmailMonitor(config, 30000); // Check every 30 seconds
	await monitor.start();

	// Handle shutdown
	process.on("SIGINT", async () => {
		await monitor.stop();
		process.exit(0);
	});
}
