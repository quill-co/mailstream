import { Client, Config } from "../src";

async function simpleExample() {
	const config: Config = {
		host: "imap.gmail.com",
		port: 993,
		email: "your.email@gmail.com",
		password: "your-app-specific-password",
		debug: {
			enabled: true,
		},
	};

	const client = await Client.create(config);

	// Listen for new emails
	client.on("mail", (mail) => {
		console.log("New email received:");
		console.log(`From: ${mail.from[0].address}`);
		console.log(`To: ${mail.to[0].address}`);
		console.log(`Subject: ${mail.subject}`);
		console.log(`Date: ${mail.date}`);
		console.log(`Content: ${mail.plain?.toString("utf-8").substring(0, 100)}...`);
	});

	// Keep the connection alive
	process.on("SIGINT", async () => {
		await client.close();
		process.exit(0);
	});
}

simpleExample();
