import { Client } from "./client";

const MAILSTREAM_KEY = "mailstream";

export function withContext(ctx: Record<string, any>, client: Client): Record<string, any> {
	return { ...ctx, [MAILSTREAM_KEY]: client };
}

export function fromContext(ctx: Record<string, any>): Client | null {
	return ctx[MAILSTREAM_KEY] || null;
}
