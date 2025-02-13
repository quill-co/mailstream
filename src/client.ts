import Imap, { type Box, type ImapMessage } from "imap";
import { simpleParser, type EmailAddress, type AddressObject } from "mailparser";
import { EventEmitter } from "events";
import { type Config, type Mail, type DebugOptions } from "./types";

/**
 * IMAP Email Client for streaming and retrieving emails
 */
export class Client extends EventEmitter {
	private client: any;
	private currentBox: Box | null = null;
	private numMessages: number = 0;
	private mailListeners: Array<(mail: Mail) => void> = [];
	private debugOptions: Required<DebugOptions>;

	constructor(private config: Config) {
		super();
		this.debugOptions = {
			enabled: config.debug?.enabled ?? false,
			logger: config.debug?.logger ?? console.log,
			connectionDebug: config.debug?.connectionDebug ?? false,
		};
		this.debug("Client initialized with config", {
			host: config.host,
			email: config.email,
			mailbox: config.mailbox,
		});
		this.config.mailbox = config.mailbox || "INBOX";
	}

	/**
	 * Create and connect a new IMAP client
	 * @param config - IMAP client configuration
	 * @returns Initialized IMAP client
	 */
	public static async create(config: Config): Promise<Client> {
		const client = new Client(config);
		await client.connect();
		return client;
	}

	/**
	 * Debugging method with configurable logging
	 * @param message - Log message
	 * @param args - Additional log arguments
	 */
	private debug(message: string, ...args: any[]): void {
		if (this.debugOptions.enabled) {
			const logger = this.debugOptions.logger || console.log;

			if (args.length > 0) {
				logger(message, ...args);
			} else {
				logger(message);
			}
		}
	}

	/**
	 * Get the current mailbox
	 * @returns Current mailbox or null
	 */
	public getCurrentBox(): Box | null {
		return this.currentBox;
	}

	/**
	 * Get the mailbox status
	 * @returns Mailbox status object or null
	 */
	public getMailboxStatus(): { total: number; new: number; unseen: number } | null {
		if (!this.currentBox) {
			this.debug("Attempted to get mailbox status with no current box");
			return null;
		}
		const status = {
			total: this.currentBox.messages.total,
			new: this.currentBox.messages.new,
			unseen: this.currentBox.messages.unseen,
		};
		this.debug("Mailbox status", status);
		return status;
	}

	/**
	 * Switch to a different mailbox
	 * @param mailboxName - Name of the mailbox to switch to
	 * @returns Promise resolving to the new mailbox
	 */
	public async switchMailbox(mailboxName: string): Promise<Box> {
		this.debug(`Switching to mailbox: ${mailboxName}`);
		return new Promise((resolve, reject) => {
			this.client.openBox(mailboxName, false, (err: Error | null, box: Box) => {
				if (err) {
					this.debug(`Error switching to mailbox ${mailboxName}:`, err);
					reject(err);
					return;
				}
				this.currentBox = box;
				this.debug("Mailbox switched successfully", {
					name: box.name,
					total: box.messages.total,
				});
				resolve(box);
			});
		});
	}

	/**
	 * Establish connection to IMAP server
	 * @returns Promise resolving when connected
	 */
	private async connect(): Promise<void> {
		return new Promise((resolve, reject) => {
			this.debug(`Connecting to IMAP server ${this.config.host}:${this.config.port}`);

			this.client = new Imap({
				host: this.config.host,
				port: this.config.port,
				user: this.config.email,
				password: this.config.password,
				tls: true,
				tlsOptions: { rejectUnauthorized: false },
				debug: this.config.debug?.connectionDebug
					? (msg: string) => this.debug(`IMAP Connection: ${msg}`)
					: undefined,
			});

			const errorHandler = (err: Error) => {
				this.debug("IMAP connection error", err);
				reject(err);
			};

			this.client.once("error", errorHandler);

			this.client.once("ready", () => {
				this.debug("Connected to IMAP server successfully");
				this.client.removeListener("error", errorHandler);

				this.client.openBox(this.config.mailbox, false, (err: Error | null, box: Box) => {
					if (err) {
						this.debug(`Error opening mailbox ${this.config.mailbox}: ${err.message}`, err);
						reject(err);
						return;
					}

					this.currentBox = box;
					this.numMessages = box.messages.total;
					this.debug(`Opened mailbox ${this.config.mailbox}`, {
						totalMessages: this.numMessages,
						newMessages: box.messages.new,
						unseenMessages: box.messages.unseen,
					});

					this.setupListeners();
					resolve();
				});
			});

			try {
				this.client.connect();
			} catch (err) {
				reject(err);
			}
		});
	}

	/**
	 * Set up event listeners for new mail
	 */
	private setupListeners(): void {
		this.client.on("mail", (numNew: number) => {
			this.debug(`New mail received: ${numNew} messages`, {
				currentMessageCount: this.numMessages,
				newMessageCount: numNew,
			});
			this.fetchNewMessages(numNew);
		});
	}

	/**
	 * Fetch newly arrived messages
	 * @param numNew - Number of new messages
	 * @returns Promise resolving when messages are fetched
	 */
	private async fetchNewMessages(numNew: number): Promise<void> {
		if (!this.client) {
			this.debug("Attempted to fetch messages with no client");
			return;
		}

		return new Promise((resolve, reject) => {
			const seqStart = this.numMessages + 1;
			const seqEnd = this.numMessages + numNew;

			this.debug(`Fetching new messages`, {
				sequenceStart: seqStart,
				sequenceEnd: seqEnd,
				numberOfMessages: numNew,
			});

			const fetch = this.client.seq.fetch(`${seqStart}:${seqEnd}`, {
				bodies: ["HEADER.FIELDS (FROM TO SUBJECT DATE)", "TEXT"],
				markSeen: false,
			});

			const messagePromises: Promise<Mail>[] = [];

			fetch.on("message", (msg: ImapMessage, seqno: number) => {
				this.debug(`Processing message`, { messageSequence: seqno });
				messagePromises.push(this.processSingleMessage(msg));
			});

			fetch.once("error", (err: Error) => {
				this.debug(`Fetch error: ${err.message}`, err);
				reject(err);
			});

			fetch.once("end", async () => {
				try {
					const mails = await Promise.all(messagePromises);

					this.debug(`Processed ${mails.length} new messages`, {
						messageUids: mails.map((mail) => mail.uid),
					});

					mails.forEach((mail) => {
						this.emit("mail", mail);
						this.mailListeners.forEach((listener) => listener(mail));
					});

					this.debug("Finished fetching new messages");
					this.numMessages += numNew;
					resolve();
				} catch (error) {
					this.debug(`Error processing messages: ${error}`, error);
					reject(error);
				}
			});
		});
	}

	/**
	 * Process a single IMAP message
	 * @param msg - IMAP message to process
	 * @returns Promise resolving to parsed Mail object
	 */
	private processSingleMessage(msg: ImapMessage): Promise<Mail> {
		return new Promise((resolve, reject) => {
			const chunks: Buffer[] = [];

			let uid: number | undefined;

			msg.on("body", (stream, info) => {
				stream.on("data", (chunk: Buffer) => {
					chunks.push(chunk);
				});
			});

			msg.once("attributes", (attrs) => {
				uid = attrs.uid;
				this.debug(`Message attributes`, {
					uid,
					seq: attrs.seqno,
					flags: attrs.flags,
				});
			});

			msg.once("end", async () => {
				try {
					const fullMessage = Buffer.concat(chunks);
					const parsed = await simpleParser(fullMessage);

					const mail: Mail = {
						uid: uid || 0,
						from: this.extractAddresses(parsed.from),
						to: this.extractAddresses(parsed.to),
						subject: parsed.subject || "",
						date: parsed.date ? new Date(parsed.date) : new Date(),
						plain: Buffer.from(parsed.text || ""),
                    	html: parsed.html ? Buffer.from(parsed.html) : undefined,
					};
	
					this.debug("Parsed mail message", {
						uid: mail.uid,
						from: mail.from.map((f) => f.address).join(", "),
						subject: mail.subject,
						date: mail.date.toISOString(),
					});

					resolve(mail);
				} catch (error) {
					this.debug(`Error processing single message: ${error}`, error);
					reject(error);
				}
			});
		});
	}

	/**
	 * Retrieve all unseen messages
	 * @returns Promise resolving when unseen messages are processed
	 */
	public async getUnseenMails(): Promise<void> {
		if (!this.client) {
			this.debug("Attempted to get unseen mails with no client");
			throw new Error("Client not connected");
		}

		return new Promise((resolve, reject) => {
			this.debug("Searching for unseen messages");

			this.client.search(["UNSEEN"], (err: Error | null, uids: number[]) => {
				if (err) {
					this.debug(`Error searching for unseen messages: ${err.message}`, err);
					reject(err);
					return;
				}

				this.debug(`Found ${uids.length} unseen messages`, { uids });

				if (uids.length === 0) {
					this.debug("No unseen messages found");
					resolve();
					return;
				}

				const fetch = this.client.seq.fetch(uids.join(","), {
					bodies: ["HEADER.FIELDS (FROM TO SUBJECT DATE)", "TEXT"],
					markSeen: false,
				});

				const messagePromises: Promise<Mail>[] = [];

				fetch.on("message", (msg: ImapMessage) => {
					messagePromises.push(this.processSingleMessage(msg));
				});

				fetch.once("error", (err: Error) => {
					this.debug(`Fetch error: ${err.message}`, err);
					reject(err);
				});

				fetch.once("end", async () => {
					try {
						const mails = await Promise.all(messagePromises);

						this.debug(`Processed ${mails.length} unseen messages`, {
							messageUids: mails.map((mail) => mail.uid),
						});

						mails.forEach((mail) => {
							this.emit("mail", mail);
							this.mailListeners.forEach((listener) => listener(mail));
						});

						resolve();
					} catch (error) {
						this.debug(`Error processing unseen messages: ${error}`, error);
						reject(error);
					}
				});
			});
		});
	}

	/**
	 * Add an event listener for mail events
	 * @param event - Event name (currently only 'mail')
	 * @param listener - Callback function for mail events
	 * @returns The client instance
	 */
	public on(event: "mail", listener: (mail: Mail) => void): this {
		super.on(event, listener);
		this.mailListeners.push(listener);
		return this;
	}

	/**
	 * Remove a specific mail listener
	 * @param listener - Callback function to remove
	 * @returns The client instance
	 */
	public removeMailListener(listener: (mail: Mail) => void): this {
		const index = this.mailListeners.indexOf(listener);
		if (index !== -1) {
			this.mailListeners.splice(index, 1);
		}
		return this;
	}

	/**
	 * Extract email addresses from parsed address objects
	 * @param addressObj - Parsed address object
	 * @returns Array of email addresses
	 */
	private extractAddresses = (addressObj?: AddressObject | AddressObject[]): EmailAddress[] => {
		if (!addressObj) return [];

		if (Array.isArray(addressObj)) {
			return addressObj.flatMap((obj) => obj.value);
		}

		return addressObj.value;
	};

	/**
	 * Close the IMAP connection
	 * @returns Promise resolving when connection is closed
	 */
	public async close(): Promise<void> {
		this.debug("Closing IMAP connection");
		return new Promise((resolve) => {
			this.client.end();
			resolve();
		});
	}
}
