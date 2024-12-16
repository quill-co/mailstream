import { type EmailAddress } from "mailparser";

export interface DebugOptions {
	enabled?: boolean;
	logger?: (info: string, ...args: any[]) => void;
	connectionDebug?: boolean; // For low-level IMAP connection debugging
}

export interface Config {
	host: string;
	port: number;
	email: string;
	password: string;
	mailbox?: string;
	debug?: DebugOptions;
}

export interface IMAPAddress {
	name?: string;
	mailbox: string;
	host: string;
}

export interface Mail {
	uid: number;
	from: EmailAddress[];
	to: EmailAddress[];
	subject: string;
	date: Date;
	plain?: Buffer;
	html?: Buffer;
}
