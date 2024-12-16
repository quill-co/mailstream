# MailStream

A TypeScript library for monitoring IMAP email accounts and handling new messages in real-time.

## Features

- Easy-to-use IMAP client with event-based architecture
- Support for monitoring unseen emails
- Configurable debug logging
- TypeScript support with full type definitions
- Promise-based API
- Automatic reconnection handling
- Custom event handling for new emails

## Installation

```bash
npm install mailstream
# or
yarn add mailstream
```

## Quick Start

```typescript
import { Client, Config } from "mailstream";

async function main() {
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
		console.log(`New email from ${mail.from[0].address}`);
		console.log(`Subject: ${mail.subject}`);
	});

	await client.getUnseenMails();
}

main().catch(console.error);
```

More examples can be found in [examples](examples/)

## Gmail Setup

1. Enable IMAP in Gmail Settings
2. If using 2FA, create an App Password:
    - Go to Google Account settings
    - Security
    - 2-Step Verification
    - App passwords
    - Generate new app password for "Mail"

## Configuration

```typescript
interface Config {
	host: string;
	port: number;
	email: string;
	password: string;
	mailbox?: string; // Defaults to 'INBOX'
	debug?: {
		enabled?: boolean;
		logger?: (message: string, ...args: any[]) => void;
		connectionDebug?: boolean;
	};
}
```

## Advanced Usage

### Email Monitor

```typescript
import { EmailMonitor } from "mailstream/monitor";

const monitor = new EmailMonitor(
	{
		host: "imap.gmail.com",
		port: 993,
		email: "your.email@gmail.com",
		password: "your-app-specific-password",
	},
	30000
); // Check every 30 seconds

await monitor.start();
```

### Custom Debug Logging

```typescript
const config: Config = {
	// ... other config options
	debug: {
		enabled: true,
		logger: (message, ...args) => {
			console.log(`[IMAP ${new Date().toISOString()}]`, message, ...args);
		},
		connectionDebug: true, // Enable low-level IMAP debugging
	},
};
```

## Mail Object Structure

```typescript
interface Mail {
	uid: number;
	from: EmailAddress[];
	to: EmailAddress[];
	subject: string;
	date: Date;
	plain?: Buffer; // Plain text content
	html?: Buffer; // HTML content
}

interface EmailAddress {
	name?: string;
	address: string;
}
```

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
