import Imap, { type Box, type ImapMessage } from "imap";
import { simpleParser, ParsedMail, type EmailAddress, type AddressObject } from "mailparser";
import { EventEmitter } from "events";
import { type Config, type Mail, type DebugOptions } from "./types";

export class Client extends EventEmitter {
	private client: any;
	private currentBox: Box | null = null;
	private seenUIDs: Set<number> = new Set();
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
	}

	private debug(message: string, ...args: any[]) {
		if (this.debugOptions.enabled) {
			this.debugOptions.logger(message, ...args);
		}
	}

	public static async create(config: Config): Promise<Client> {
		const client = new Client(config);
		await client.connect();
		return client;
	}

	getCurrentBox(): Box | null {
		return this.currentBox;
	}

	getMailboxStatus(): { total: number; new: number; unseen: number } | null {
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

	async switchMailbox(mailboxName: string): Promise<Box> {
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

	private async connect(): Promise<void> {
		return new Promise((resolve, reject) => {
			this.client = new Imap({
				host: this.config.host,
				port: this.config.port,
				user: this.config.email,
				password: this.config.password,
				tls: true,
				tlsOptions: {
					rejectUnauthorized: false,
				},
				debug: this.config.debug?.enabled ? this.config.debug.logger : undefined,
			});

			// Capture any connection errors
			const errorHandler = (err: Error) => {
				this.debug("IMAP connection error", err);
				this.currentBox = null;
				reject(err);
			};

			// Add error listener
			this.client.once("error", errorHandler);

			this.client.once("ready", () => {
				// Remove error listener once connection is successful
				this.client.removeListener("error", errorHandler);

				this.client.openBox(this.config.mailbox || "INBOX", false, (err: Error | null, box: Box) => {
					if (err) {
						this.debug("Error opening mailbox", err);
						reject(err);
						return;
					}
					this.currentBox = box;
					this.setupListeners();
					resolve();
				});
			});

			// Initiate connection
			try {
				this.client.connect();
			} catch (err) {
				reject(err);
			}
		});
	}

	private setupListeners(): void {
		this.client.on("mail", (numNew: number) => {
			this.debug(`New mail received: ${numNew} messages`);
			if (this.currentBox) {
				this.currentBox.messages.total += numNew;
				this.currentBox.messages.new += numNew;
			}
			this.fetchNewMails();
		});

		this.client.on("update", (seqno: number, info: any) => {
			// Update currentBox flags if needed
			if (info.flags && this.currentBox) {
				this.debug("Mailbox flags updated", {
					seqno,
					flags: info.flags,
				});
				this.emit("flagsUpdate", { seqno, flags: info.flags });
			}
		});
	}

	public async getUnseenMails(): Promise<void> {
		if (!this.client) {
			this.debug("Attempted to get unseen mails with no client");
			throw new Error("Client not connected");
		}

		if (!this.currentBox) {
			this.debug("Attempted to get unseen mails with no mailbox selected");
			throw new Error("No mailbox selected");
		}

		return new Promise((resolve, reject) => {
			this.client.search(["UNSEEN"], async (err: Error | null, uids: number[]) => {
				if (err) {
					this.debug("Error searching for unseen messages:", err);
					reject(err);
					return;
				}

				this.debug(`Found unseen messages: ${uids.length}`);

				if (uids.length === 0) {
					resolve();
					return;
				}

				// Filter out UIDs we've already processed
				const newUIDs = uids.filter((uid) => !this.seenUIDs.has(uid));

				this.debug(`New unseen messages (not previously processed): ${newUIDs.length}`);

				if (newUIDs.length === 0) {
					resolve();
					return;
				}

				try {
					await this.fetchMessages(newUIDs);
					resolve();
				} catch (error) {
					this.debug("Error fetching messages:", error);
					reject(error);
				}
			});
		});
	}

	private async fetchMessages(uids: number[]): Promise<void> {
		this.debug(`Fetching messages for UIDs: ${uids}`);
		return new Promise((resolve, reject) => {
			const fetch = this.client.fetch(uids, {
				bodies: ["HEADER.FIELDS (FROM TO SUBJECT DATE)", "TEXT"],
				struct: true,
			});

			let messagePromises: Promise<void>[] = [];

			fetch.on("message", (msg: ImapMessage, seqno: number) => {
				this.debug(`Processing message: ${seqno}`);

				const messageData: Partial<ParsedMail> = {};
				const buffers: { [key: string]: Buffer[] } = {
					header: [],
					body: [],
				};

				messagePromises.push(
					new Promise<void>((resolveMessage) => {
						msg.on("body", (stream, info) => {
							const type = info.which === "TEXT" ? "body" : "header";

							stream.on("data", (chunk: Buffer) => {
								buffers[type].push(chunk);
							});
						});

						msg.once("attributes", (attrs) => {
							messageData.messageId = attrs.uid;
						});

						msg.once("end", async () => {
							try {
								const headerBuffer = Buffer.concat(buffers.header);
								const bodyBuffer = Buffer.concat(buffers.body);

								const parsedHeader = await simpleParser(headerBuffer);
								const parsedBody = await simpleParser(bodyBuffer);

								const mail: Mail = {
									uid: parseInt(messageData.messageId!) || 0,
									from: this.extractAddresses(parsedHeader.from || []),
									to: this.extractAddresses(parsedHeader.to),
									subject: parsedHeader.subject || "",
									date: parsedHeader.date || new Date(),
									plain: Buffer.from(parsedBody.text || ""),
									html: Buffer.from(parsedBody.html || ""),
								};

								this.debug("Parsed mail message", {
									uid: mail.uid,
									from: mail.from,
									subject: mail.subject,
								});

								this.seenUIDs.add(mail.uid);
								this.emit("mail", mail);
								resolveMessage();
							} catch (error) {
								this.debug("Error processing message:", error);
								resolveMessage();
							}
						});
					})
				);
			});

			fetch.once("error", (err: Error) => {
				this.debug("Fetch error:", err);
				reject(err);
			});

			fetch.once("end", async () => {
				this.debug("Finished fetching messages");
				try {
					await Promise.all(messagePromises);
					resolve();
				} catch (error) {
					this.debug("Error in message processing:", error);
					reject(error);
				}
			});
		});
	}

	extractAddresses = (addressObj?: AddressObject | AddressObject[]): EmailAddress[] => {
		if (!addressObj) return [];

		if (Array.isArray(addressObj)) {
			return addressObj.flatMap((obj) => obj.value);
		}

		return addressObj.value;
	};

	private async fetchNewMails(): Promise<void> {
		try {
			this.debug("Fetching new mails");
			await this.getUnseenMails();
		} catch (error) {
			this.debug("Error fetching new mails:", error);
		}
	}

	public async close(): Promise<void> {
		this.debug("Closing IMAP connection");
		return new Promise((resolve) => {
			this.client.end();
			resolve();
		});
	}
}
