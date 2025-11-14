import { DurableObject } from 'cloudflare:workers';

/**
 * WebhookBin - A webhook tester powered by Cloudflare Durable Objects
 *
 * Each webhook endpoint is a separate Durable Object instance that:
 * - Stores incoming webhook requests in SQLite
 * - Maintains WebSocket connections for real-time updates
 * - Broadcasts new requests to all connected viewers
 */

interface WebhookRequest {
	id: number;
	timestamp: string;
	method: string;
	headers: string;
	body: string;
	query: string;
	metadata: string;
}

/** WebhookBin Durable Object - stores and broadcasts webhook requests */
export class WebhookBin extends DurableObject {
	private sessions: Set<WebSocket>;
	private static TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
	// private static TTL_MS = 1 * 60 * 1000; // 1 min --- LOCAL TESTING ---

	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);
		this.sessions = new Set();

		// Initialize SQLite table for storing webhook requests
		this.ctx.storage.sql.exec(`
			CREATE TABLE IF NOT EXISTS requests (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				timestamp TEXT NOT NULL,
				method TEXT NOT NULL,
				headers TEXT NOT NULL,
				body TEXT,
				query TEXT,
				metadata TEXT
			)
		`);
	}

	// Ensure this Durable Object has a createdAt timestamp and a scheduled alarm
	private async ensureScheduled() {
		const createdAt = (await this.ctx.storage.get('createdAt')) as number | undefined;
		if (!createdAt) {
			const now = Date.now();
			await this.ctx.storage.put('createdAt', now);
			await this.ctx.storage.setAlarm(now + WebhookBin.TTL_MS);
			return;
		}

		// If alarm missing for some reason, re-create it based on createdAt
		const alarm = await this.ctx.storage.getAlarm();
		if (alarm == null) {
			await this.ctx.storage.setAlarm(createdAt + WebhookBin.TTL_MS);
		}
	}

	/**
	 * Store a webhook request and broadcast to all connected WebSocket clients
	 */
	async captureRequest(method: string, headers: Record<string, string>, body: string, query: string, metadata: string): Promise<number> {
		const timestamp = new Date().toISOString();

		// Store in SQLite
		const result = this.ctx.storage.sql
			.exec(
				`INSERT INTO requests (timestamp, method, headers, body, query, metadata) 
			 VALUES (?, ?, ?, ?, ?, ?) 
			 RETURNING id`,
				timestamp,
				method,
				JSON.stringify(headers),
				body,
				query,
				metadata
			)
			.one() as { id: number };

		// Broadcast to all WebSocket connections
		const request: WebhookRequest = {
			id: result.id,
			timestamp,
			method,
			headers: JSON.stringify(headers),
			body,
			query,
			metadata,
		};

		this.broadcast(JSON.stringify({ type: 'new_request', data: request }));

		return result.id;
	}

	/**
	 * Get all stored requests for this webhook bin
	 */
	async getRequests(): Promise<WebhookRequest[]> {
		const results = this.ctx.storage.sql
			.exec(
				`SELECT id, timestamp, method, headers, body, query, metadata 
			 FROM requests 
			 ORDER BY id DESC 
			 LIMIT 100`
			)
			.toArray() as unknown as WebhookRequest[];

		return results;
	}

	/**
	 * Handle WebSocket connections for real-time updates and lightweight init
	 */
	async fetch(request: Request): Promise<Response> {
		const url = new URL(request.url);

		// Lightweight init route: ensure alarm is scheduled on creation
		if (url.pathname === '/init') {
			await this.ensureScheduled();
			return new Response('initialized', { status: 200 });
		}

		// Handle WebSocket upgrade
		if (request.headers.get('Upgrade') === 'websocket') {
			// Ensure scheduling (if object was cold)
			await this.ensureScheduled();

			const pair = new WebSocketPair();
			const [client, server] = Object.values(pair);

			// Accept the WebSocket connection
			server.accept();
			this.sessions.add(server);

			// Send existing requests on connection
			const requests = await this.getRequests();
			server.send(JSON.stringify({ type: 'initial_data', data: requests }));

			// Handle close event
			server.addEventListener('close', () => {
				this.sessions.delete(server);
			});

			// Handle error event
			server.addEventListener('error', () => {
				this.sessions.delete(server);
			});

			return new Response(null, { status: 101, webSocket: client });
		}

		return new Response('Expected WebSocket', { status: 400 });
	}

	/**
	 * Alarm handler - called when the object's alarm fires
	 */
	async alarm(alarmInfo?: any) {
		try {
			// Broadcast deletion event and close sockets
			this.broadcast(JSON.stringify({ type: 'deleted', reason: 'expired' }));
			this.sessions.forEach((s) => {
				try {
					s.send(JSON.stringify({ type: 'deleted', reason: 'expired' }));
					s.close();
				} catch (e) {
					// ignore
				}
			});
			this.sessions.clear();

			// Remove all storage (including sqlite state) to free space
			await this.ctx.storage.deleteAll();
		} catch (err) {
			// Let the system retry if this throws; alarms have automatic retries
			throw err;
		}
	}

	/**
	 * Broadcast message to all connected WebSocket clients
	 */
	private broadcast(message: string) {
		this.sessions.forEach((session) => {
			try {
				session.send(message);
			} catch (err) {
				// Client disconnected, remove from sessions
				this.sessions.delete(session);
			}
		});
	}
}

/**
 * Generate a random webhook ID
 */
function generateId(): string {
	return Array.from({ length: 8 }, () => Math.random().toString(36).charAt(2)).join('');
}

export default {
	/**
	 * Worker fetch handler - routes requests to appropriate handlers
	 */
	async fetch(request, env, ctx): Promise<Response> {
		const url = new URL(request.url);
		const path = url.pathname;

		// CORS headers for API requests
		const corsHeaders = {
			'Access-Control-Allow-Origin': '*',
			'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
			'Access-Control-Allow-Headers': 'Content-Type',
		};

		// Handle CORS preflight
		if (request.method === 'OPTIONS') {
			return new Response(null, { headers: corsHeaders });
		}

		// API: Generate new webhook ID
		if (path === '/api/new') {
			const id = generateId();

			// Initialize the Durable Object now so it sets its createdAt + alarm immediately
			const stub = env.MY_DURABLE_OBJECT.get(env.MY_DURABLE_OBJECT.idFromName(id)) as DurableObjectStub<WebhookBin>;
			try {
				// call a lightweight init route on the DO
				await stub.fetch(new Request('https://init/'));
			} catch (err) {
				// non-fatal; DO may still be initialized on first real use
				console.error('DO init failed', err);
			}

			return new Response(JSON.stringify({ id }), {
				headers: { 'Content-Type': 'application/json', ...corsHeaders },
			});
		}

		// API: Get all requests for a webhook bin
		if (path.startsWith('/api/bin/')) {
			const id = path.split('/')[3];
			if (!id) {
				return new Response('Invalid bin ID', { status: 400 });
			}

			const stub = env.MY_DURABLE_OBJECT.get(env.MY_DURABLE_OBJECT.idFromName(id)) as DurableObjectStub<WebhookBin>;
			const requests = await stub.getRequests();

			return new Response(JSON.stringify(requests), {
				headers: { 'Content-Type': 'application/json', ...corsHeaders },
			});
		}

		// WebSocket: Real-time updates
		if (path.startsWith('/ws/')) {
			const id = path.split('/')[2];
			if (!id) {
				return new Response('Invalid bin ID', { status: 400 });
			}

			const stub = env.MY_DURABLE_OBJECT.get(env.MY_DURABLE_OBJECT.idFromName(id)) as DurableObjectStub<WebhookBin>;
			return stub.fetch(request);
		}

		// Webhook capture: Any request to /hook/{id}
		if (path.startsWith('/hook/')) {
			const id = path.split('/')[2];
			if (!id) {
				return new Response('Invalid webhook ID', { status: 400 });
			}

			// Capture request details
			const headers: Record<string, string> = {};
			request.headers.forEach((value, key) => {
				headers[key] = value;
			});

			const body = await request.text();
			const query = url.search;

			// Capture Cloudflare metadata
			const metadata = JSON.stringify({
				city: request.cf?.city,
				postalCode: request.cf?.postalCode,
				region: request.cf?.region,
				regionCode: request.cf?.regionCode,
				country: request.cf?.country,
				continent: request.cf?.continent,
				timezone: request.cf?.timezone,
				latitude: request.cf?.latitude,
				longitude: request.cf?.longitude,
				asOrganization: request.cf?.asOrganization,
				userIP: request.headers.get('CF-Connecting-IP'),
			});

			// Store in Durable Object
			const stub = env.MY_DURABLE_OBJECT.get(env.MY_DURABLE_OBJECT.idFromName(id)) as DurableObjectStub<WebhookBin>;
			const requestId = await stub.captureRequest(request.method, headers, body, query, metadata);

			return new Response(
				JSON.stringify({
					success: true,
					message: 'Webhook captured',
					requestId,
				}),
				{
					headers: { 'Content-Type': 'application/json', ...corsHeaders },
				}
			);
		}

		// Serve static assets for root and other paths
		return (env as any).ASSETS.fetch(request);
	},
} satisfies ExportedHandler<Env>;
