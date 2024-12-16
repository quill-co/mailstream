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

	client.on("mail", (mail) => {
		console.log("New email received:");
		console.log(`From: ${mail.from.map((f: any) => f.address).join(", ")}`);
		console.log(`Subject: ${mail.subject}`);
		console.log(`Content: ${mail.plain?.toString().substring(0, 100)}...`);
	});

	await client.getUnseenMails();

	// Keep the connection alive
	process.on("SIGINT", async () => {
		await client.close();
		process.exit(0);
	});
}
