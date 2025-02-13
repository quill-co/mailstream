// client.test.ts
import { Client, Config } from "../src";
import Imap, { ImapFetch, Box, ImapMessage } from "imap";
import { EventEmitter } from "events";

// Mock imap
jest.mock("imap");

class MockImapFetch extends EventEmitter implements Partial<ImapFetch> {}
class MockMessageEmitter extends EventEmitter implements Partial<ImapMessage> {}

type BoxCallback = (error: Error, mailbox: Box) => void;
type SearchCallback = (error: Error, uids: number[]) => void;

describe("Client", () => {
	let config: Config;
	let mockImap: jest.Mocked<Imap> & EventEmitter;
	let mockFetch: MockImapFetch;
	let resolveReady: () => void;
	let readyPromise: Promise<void>;

	const mockBox: Box = {
		name: "INBOX",
		readOnly: false,
		uidvalidity: 1,
		uidnext: 1,
		flags: [],
		permFlags: [],
		persistentUIDs: true,
		messages: {
			total: 100,
			new: 10,
			unseen: 5,
		},
		newKeywords: false,
		highestmodseq: "",
	};

	beforeEach(() => {
		jest.clearAllMocks();

		config = {
			host: "imap.test.com",
			port: 993,
			email: "test@test.com",
			password: "password",
			debug: { enabled: false },
		};

		mockFetch = new MockImapFetch();
		readyPromise = new Promise((resolve) => {
			resolveReady = resolve;
		});

		mockImap = new EventEmitter() as jest.Mocked<Imap> & EventEmitter;
		mockImap.connect = jest.fn(() => {
			Promise.resolve().then(() => {
				mockImap.emit("ready");
				resolveReady();
			});
		});

		const openBoxMock = jest.fn();
		openBoxMock.mockImplementation((...args: any[]) => {
			const callback = args[args.length - 1] as BoxCallback;
			Promise.resolve().then(() => {
				callback(undefined as any, mockBox);
			});
		});
		mockImap.openBox = openBoxMock as any;

		const searchMock = jest.fn();
		searchMock.mockImplementation((criteria: any[], callback: SearchCallback) => {
			Promise.resolve().then(() => {
				callback(undefined as any, [1, 2, 3]);
			});
		});
		mockImap.search = searchMock as any;

		mockImap.fetch = jest.fn().mockReturnValue(mockFetch);
		mockImap.seq = { fetch: jest.fn().mockReturnValue(mockFetch) } as any;
		mockImap.end = jest.fn(() => {
			Promise.resolve().then(() => {
				mockImap.emit("end");
			});
		});

		(Imap as jest.MockedClass<typeof Imap>).mockImplementation(() => mockImap);
	});

	describe("initialization", () => {
		it("should create and connect client successfully", async () => {
			const connectPromise = Client.create(config);
			await readyPromise;
			const client = await connectPromise;

			expect(client).toBeInstanceOf(Client);
			expect(mockImap.connect).toHaveBeenCalled();
		});

		it("should handle connection errors", async () => {
			const error = new Error("Connection failed");
			mockImap.connect = jest.fn().mockImplementation(() => {
				// Immediately trigger the error event
				process.nextTick(() => {
					mockImap.emit("error", error);
				});
				return mockImap;
			});

			await expect(Client.create(config)).rejects.toThrow("Connection failed");
		});

		it("should handle mailbox opening errors", async () => {
			const error = new Error("Failed to open mailbox");
			mockImap.openBox = jest.fn().mockImplementation((...args: any[]) => {
				const callback = args[args.length - 1] as BoxCallback;
				Promise.resolve().then(() => {
					callback(error as any, undefined as any);
				});
			});

			await expect(Client.create(config)).rejects.toThrow("Failed to open mailbox");
		});
	});

	describe("getUnseenMails", () => {
		it("should fetch unseen emails successfully", async () => {
			const client = await Client.create(config);
			await readyPromise;

			const mailPromise = new Promise<void>((resolve) => {
				mockFetch.on("end", () => resolve());
			});

			const fetchPromise = client.getUnseenMails();

			Promise.resolve().then(() => {
				[1, 2, 3].forEach((seqno) => {
					const msgEmitter = new MockMessageEmitter();
					mockFetch.emit("message", msgEmitter, seqno);

					const headerStream = new EventEmitter();
					const bodyStream = new EventEmitter();

					msgEmitter.emit("body", headerStream, { which: "HEADER.FIELDS (FROM TO SUBJECT DATE)" });
					msgEmitter.emit("body", bodyStream, { which: "TEXT" });

					headerStream.emit(
						"data",
						Buffer.from(
							"From: test@example.com\r\n" +
								"To: recipient@example.com\r\n" +
								"Subject: Test Email\r\n" +
								"Date: Mon, 15 Dec 2024 10:00:00 +0000\r\n"
						)
					);
					headerStream.emit("end");

					bodyStream.emit("data", Buffer.from("Test content"));
					bodyStream.emit("end");

					msgEmitter.emit("attributes", { uid: seqno });
					msgEmitter.emit("end");
				});

				mockFetch.emit("end");
			});

			await Promise.all([fetchPromise, mailPromise]);

			expect(mockImap.search).toHaveBeenCalledWith(["UNSEEN"], expect.any(Function));
		});

		it("should handle fetch errors", async () => {
			const client = await Client.create(config);
			await readyPromise;

			const searchMock = jest.fn();
			searchMock.mockImplementation((criteria: any[], callback: SearchCallback) => {
				Promise.resolve().then(() => {
					callback(new Error("Search failed"), [] as any);
				});
			});
			mockImap.search = searchMock as any;

			await expect(client.getUnseenMails()).rejects.toThrow("Search failed");
		});

		it("should handle empty search results", async () => {
			const client = await Client.create(config);
			await readyPromise;

			mockImap.search = jest.fn().mockImplementation((criteria: any[], callback: SearchCallback) => {
				Promise.resolve().then(() => {
					callback(undefined as any, []);
				});
			});

			await client.getUnseenMails();
			expect(mockImap.fetch).not.toHaveBeenCalled();
		});
	});

	describe("mail events", () => {
		it("should emit mail events for new messages", async () => {
			mockImap.search = jest.fn().mockImplementation((criteria: any[], callback: SearchCallback) => {
				callback(undefined as any, [1]);
			});

			const client = await Client.create(config);

			const mailPromise = new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(() => {
					reject(new Error("Timeout waiting for mail event"));
				}, 1000);

				client.on("mail", (mail) => {
					clearTimeout(timeout);
					try {
						expect(mail.uid).toBe(1);
						expect(mail.subject).toBe("Test Email");
						resolve();
					} catch (error) {
						reject(error);
					}
				});

				// Send test email events
				Promise.resolve().then(() => {
					const msgEmitter = new MockMessageEmitter();
					mockFetch.emit("message", msgEmitter, 1);

					const headerStream = new EventEmitter();
					const bodyStream = new EventEmitter();

					msgEmitter.emit("body", headerStream, { which: "HEADER.FIELDS (FROM TO SUBJECT DATE)" });
					msgEmitter.emit("body", bodyStream, { which: "TEXT" });

					headerStream.emit(
						"data",
						Buffer.from(
							"From: test@example.com\r\n" +
								"To: recipient@example.com\r\n" +
								"Subject: Test Email\r\n" +
								"Date: Mon, 15 Dec 2024 10:00:00 +0000\r\n"
						)
					);
					headerStream.emit("end");

					bodyStream.emit("data", Buffer.from("Test content"));
					bodyStream.emit("end");

					msgEmitter.emit("attributes", { uid: 1 });
					msgEmitter.emit("end");
					mockFetch.emit("end");
				});
			});

			const fetchPromise = client.getUnseenMails();
			await Promise.all([fetchPromise, mailPromise]);
			await client.close();
		});

		it("should handle multiple messages", async () => {
			const client = await Client.create(config);

			const messages = [
				{ uid: 1, subject: "First Email" },
				{ uid: 2, subject: "Second Email" },
				{ uid: 3, subject: "Third Email" },
			];

			mockImap.search = jest.fn().mockImplementation((criteria: any[], callback: SearchCallback) => {
				callback(
					undefined as any,
					messages.map((m) => m.uid)
				);
			});

			const receivedMails: Array<{ uid: number; subject: string }> = [];

			const processedUids = new Set<number>();

			const allMailsPromise = new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(() => {
					reject(new Error("Timeout waiting for all mails"));
				}, 2000);

				client.on("mail", (mail) => {
					// Only process each UID once
					if (!processedUids.has(mail.uid)) {
						processedUids.add(mail.uid);
						receivedMails.push({ uid: mail.uid, subject: mail.subject });

						// Resolve when we've received all unique messages
						if (processedUids.size === messages.length) {
							clearTimeout(timeout);
							resolve();
						}
					}
				});

				// Send test email events
				Promise.resolve().then(() => {
					messages.forEach(({ uid, subject }) => {
						const msgEmitter = new MockMessageEmitter();
						mockFetch.emit("message", msgEmitter, uid);

						const headerStream = new EventEmitter();
						const bodyStream = new EventEmitter();

						msgEmitter.emit("body", headerStream, { which: "HEADER.FIELDS (FROM TO SUBJECT DATE)" });
						msgEmitter.emit("body", bodyStream, { which: "TEXT" });

						headerStream.emit(
							"data",
							Buffer.from(
								"From: test@example.com\r\n" +
									"To: recipient@example.com\r\n" +
									`Subject: ${subject}\r\n` +
									"Date: Mon, 15 Dec 2024 10:00:00 +0000\r\n"
							)
						);
						headerStream.emit("end");

						bodyStream.emit("data", Buffer.from("Test content"));
						bodyStream.emit("end");

						msgEmitter.emit("attributes", { uid });
						msgEmitter.emit("end");
					});

					mockFetch.emit("end");
				});
			});

			const fetchPromise = client.getUnseenMails();
			await Promise.all([fetchPromise, allMailsPromise]);

			expect(receivedMails).toEqual(messages);
			await client.close();
		});
	});
});
