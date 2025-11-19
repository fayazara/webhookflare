import { DurableObject } from 'cloudflare:workers';

/**
 * WebhookBin - A webhook tester powered by Cloudflare Durable Objects
 *
 * Each webhook endpoint is a separate Durable Object instance that:
 * - Stores incoming webhook requests in SQLite
 * - Maintains WebSocket connections for real-time updates
 * - Broadcasts new requests to all connected viewers
 */

// ============================================================================
// TYPES
// ============================================================================

interface WebhookRequest {
	id: number;
	timestamp: string;
	method: string;
	headers: string;
	body: string;
	query: string;
	metadata: string;
}

interface CapturedMetadata {
	city?: string | unknown;
	postalCode?: string | unknown;
	region?: string | unknown;
	regionCode?: string | unknown;
	country?: string | unknown;
	continent?: string | unknown;
	timezone?: string | unknown;
	latitude?: number | unknown;
	longitude?: number | unknown;
	asOrganization?: string | unknown;
	userIP?: string | null;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const CONFIG = {
	TTL_MS: 6 * 60 * 60 * 1000, // 6 hours
	// TTL_MS: 1 * 60 * 1000, // 1 min --- LOCAL TESTING ---
	REQUEST_LIMIT: 100,
};

const CORS_HEADERS = {
	'Access-Control-Allow-Origin': '*',
	'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
	'Access-Control-Allow-Headers': 'Content-Type',
};

const ROUTES = {
	API_NEW: '/api/new',
	API_BIN: '/api/bin/',
	WEBSOCKET: '/ws/',
	WEBHOOK: '/hook/',
	INIT: '/init',
};

const RESPONSES = {
	INVALID_BIN_ID: 'Invalid bin ID',
	INVALID_WEBHOOK_ID: 'Invalid webhook ID',
	EXPECTED_WEBSOCKET: 'Expected WebSocket',
	INITIALIZED: 'initialized',
	WEBHOOK_CAPTURED: 'Webhook captured',
};

/** WebhookBin Durable Object - stores and broadcasts webhook requests */
export class WebhookBin extends DurableObject {
	private sessions: Set<WebSocket>;

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

	// ========================================================================
	// Storage & Scheduling
	// ========================================================================

	/**
	 * Ensure this Durable Object has a createdAt timestamp and a scheduled alarm
	 */
	private async ensureScheduled(): Promise<void> {
		const createdAt = (await this.ctx.storage.get('createdAt')) as number | undefined;
		if (!createdAt) {
			const now = Date.now();
			await this.ctx.storage.put('createdAt', now);
			await this.ctx.storage.setAlarm(now + CONFIG.TTL_MS);
			return;
		}

		// If alarm missing for some reason, re-create it based on createdAt
		const alarm = await this.ctx.storage.getAlarm();
		if (alarm == null) {
			await this.ctx.storage.setAlarm(createdAt + CONFIG.TTL_MS);
		}
	}

	// ========================================================================
	// Data Operations
	// ========================================================================

	/**
	 * Store a webhook request and broadcast to all connected WebSocket clients
	 */
	async captureRequest(
		method: string,
		headers: Record<string, string>,
		body: string,
		query: string,
		metadata: string
	): Promise<number> {
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

		this.broadcastMessage({ type: 'new_request', data: request });

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
			 LIMIT ?`,
				CONFIG.REQUEST_LIMIT
			)
			.toArray() as unknown as WebhookRequest[];

		return results;
	}

	// ========================================================================
	// WebSocket Handling
	// ========================================================================

	/**
	 * Handle WebSocket connections for real-time updates and lightweight init
	 */
	async fetch(request: Request): Promise<Response> {
		const url = new URL(request.url);

		// Lightweight init route: ensure alarm is scheduled on creation
		if (url.pathname === ROUTES.INIT) {
			await this.ensureScheduled();
			return new Response(RESPONSES.INITIALIZED, { status: 200 });
		}

		// Handle WebSocket upgrade
		if (request.headers.get('Upgrade') === 'websocket') {
			return this.handleWebSocketConnection(request);
		}

		return new Response(RESPONSES.EXPECTED_WEBSOCKET, { status: 400 });
	}

	/**
	 * Handle a new WebSocket connection
	 */
	private async handleWebSocketConnection(request: Request): Promise<Response> {
		// Ensure scheduling (if object was cold)
		await this.ensureScheduled();

		const pair = new WebSocketPair();
		const [client, server] = Object.values(pair);

		// Accept the WebSocket connection
		server.accept();
		this.sessions.add(server);

		// Send existing requests on connection
		const requests = await this.getRequests();
		const createdAt = (await this.ctx.storage.get('createdAt')) as number;
		const expiresAt = createdAt ? createdAt + CONFIG.TTL_MS : Date.now() + CONFIG.TTL_MS;

		server.send(JSON.stringify({
			type: 'initial_data',
			data: requests,
			expiresAt: expiresAt
		}));

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

	/**
	 * Broadcast message to all connected WebSocket clients
	 */
	private broadcastMessage(data: unknown): void {
		this.broadcast(JSON.stringify(data));
	}

	/**
	 * Send a message to all connected WebSocket clients
	 */
	private broadcast(message: string): void {
		this.sessions.forEach((session) => {
			try {
				session.send(message);
			} catch (err) {
				// Client disconnected, remove from sessions
				this.sessions.delete(session);
			}
		});
	}

	// ========================================================================
	// Lifecycle
	// ========================================================================

	/**
	 * Alarm handler - called when the object's alarm fires (TTL expiration)
	 */
	async alarm(): Promise<void> {
		try {
			// Broadcast deletion event to all connected clients
			this.broadcastMessage({ type: 'deleted', reason: 'expired' });

			// Close all WebSocket connections
			this.sessions.forEach((session) => {
				try {
					session.send(JSON.stringify({ type: 'deleted', reason: 'expired' }));
					session.close();
				} catch (err) {
					// Ignore errors during close
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
}


// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Generate a random webhook ID (8 random alphanumeric characters)
 */
function generateWebhookId(): string {
	return Array.from({ length: 8 }, () => Math.random().toString(36).charAt(2)).join('');
}

/**
 * Extract ID from a path like /ws/{id} or /api/bin/{id}
 */
function extractIdFromPath(path: string, position: number = 2): string | null {
	const parts = path.split('/');
	return parts[position] || null;
}

/**
 * Create a JSON response with CORS headers
 */
function createJsonResponse(data: unknown, status: number = 200): Response {
	return new Response(JSON.stringify(data), {
		status,
		headers: {
			'Content-Type': 'application/json',
			...CORS_HEADERS,
		},
	});
}

/**
 * Create an error response with CORS headers
 */
function createErrorResponse(message: string, status: number = 400): Response {
	return createJsonResponse({ error: message }, status);
}

/**
 * Create a CORS preflight response
 */
function createCorsPreflightResponse(): Response {
	return new Response(null, {
		status: 204,
		headers: CORS_HEADERS,
	});
}

/**
 * Extract all headers from a request as a record
 */
function extractHeaders(request: Request): Record<string, string> {
	const headers: Record<string, string> = {};
	request.headers.forEach((value, key) => {
		headers[key] = value;
	});
	return headers;
}

/**
 * Build metadata object from Cloudflare request metadata
 */
function buildMetadata(request: Request): CapturedMetadata {
	return {
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
		userIP: request.headers.get('CF-Connecting-IP') || undefined,
	};
}

// ============================================================================
// ROUTE HANDLERS
// ============================================================================

/**
 * Handle: POST /api/new
 * Generate a new webhook ID and initialize its Durable Object
 */
async function handleCreateWebhook(env: Env): Promise<Response> {
	if (!env.MY_DURABLE_OBJECT) {
		console.error('MY_DURABLE_OBJECT binding is not configured');
		return createErrorResponse('Service unavailable - Durable Object not configured', 503);
	}

	const id = generateWebhookId();

	// Initialize the Durable Object now so it sets its createdAt + alarm immediately
	const stub = env.MY_DURABLE_OBJECT.get(
		env.MY_DURABLE_OBJECT.idFromName(id)
	) as DurableObjectStub<WebhookBin>;

	try {
		// Call a lightweight init route on the DO
		await stub.fetch(new Request('https://init/'));
	} catch (err) {
		// Non-fatal; DO may still be initialized on first real use
		console.error('DO init failed', err);
	}

	return createJsonResponse({ id });
}

/**
 * Handle: GET /api/bin/{id}
 * Retrieve all captured requests for a specific webhook bin
 */
async function handleGetBinRequests(env: Env, id: string): Promise<Response> {
	if (!id) {
		return createErrorResponse(RESPONSES.INVALID_BIN_ID);
	}

	if (!env.MY_DURABLE_OBJECT) {
		console.error('MY_DURABLE_OBJECT binding is not configured');
		return createErrorResponse('Service unavailable - Durable Object not configured', 503);
	}

	const stub = env.MY_DURABLE_OBJECT.get(
		env.MY_DURABLE_OBJECT.idFromName(id)
	) as DurableObjectStub<WebhookBin>;

	try {
		const requests = await stub.getRequests();
		return createJsonResponse(requests);
	} catch (err) {
		console.error(`Failed to get requests for bin ${id}:`, err);
		return createErrorResponse('Failed to retrieve requests', 500);
	}
}

/**
 * Handle: WS /ws/{id}
 * Establish WebSocket connection for real-time updates
 */
async function handleWebSocketConnection(env: Env, id: string, request: Request): Promise<Response> {
	if (!id) {
		return createErrorResponse(RESPONSES.INVALID_BIN_ID);
	}

	if (!env.MY_DURABLE_OBJECT) {
		console.error('MY_DURABLE_OBJECT binding is not configured');
		return createErrorResponse('Service unavailable - Durable Object not configured', 503);
	}

	const stub = env.MY_DURABLE_OBJECT.get(
		env.MY_DURABLE_OBJECT.idFromName(id)
	) as DurableObjectStub<WebhookBin>;

	try {
		return await stub.fetch(request);
	} catch (err) {
		console.error(`Failed to establish WebSocket for bin ${id}:`, err);
		return createErrorResponse('Failed to establish WebSocket connection', 500);
	}
}

/**
 * Handle: POST /hook/{id}
 * Capture an incoming webhook request
 */
async function handleWebhookCapture(
	env: Env,
	id: string,
	request: Request
): Promise<Response> {
	if (!id) {
		return createErrorResponse(RESPONSES.INVALID_WEBHOOK_ID);
	}

	try {
		// Validate that the Durable Object binding exists
		if (!env.MY_DURABLE_OBJECT) {
			console.error('MY_DURABLE_OBJECT binding is not configured');
			return createErrorResponse('Service unavailable - Durable Object not configured', 503);
		}

		// Apply rate limiting to the webhook endpoint
		if (env.WEBHOOK_RATE_LIMITER) {
			const { success } = await env.WEBHOOK_RATE_LIMITER.limit({ key: id });
			if (!success) {
				return createErrorResponse(`Rate limit exceeded for webhook ${id}`, 429);
			}
		}

		// Extract request details
		const headers = extractHeaders(request);
		const body = await request.text();
		const query = new URL(request.url).search;
		const metadata = JSON.stringify(buildMetadata(request));

		// Store in Durable Object
		const stub = env.MY_DURABLE_OBJECT.get(
			env.MY_DURABLE_OBJECT.idFromName(id)
		) as DurableObjectStub<WebhookBin>;

		const requestId = await stub.captureRequest(request.method, headers, body, query, metadata);

		return createJsonResponse({
			success: true,
			message: RESPONSES.WEBHOOK_CAPTURED,
			requestId,
		});
	} catch (err) {
		console.error(`Failed to capture webhook for ID ${id}:`, err);
		return createErrorResponse('Failed to capture webhook', 500);
	}
}

// ============================================================================
// MAIN HANDLER
// ============================================================================

export default {
	/**
	 * Worker fetch handler - routes requests to appropriate handlers
	 */
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		try {
			const url = new URL(request.url);
			const path = url.pathname;

			// Handle CORS preflight
			if (request.method === 'OPTIONS') {
				return createCorsPreflightResponse();
			}

			// Route to appropriate handler
			if (path === ROUTES.API_NEW) {
				return handleCreateWebhook(env);
			}

			if (path.startsWith(ROUTES.API_BIN)) {
				const id = extractIdFromPath(path, 3);
				return handleGetBinRequests(env, id || '');
			}

			if (path.startsWith(ROUTES.WEBSOCKET)) {
				const id = extractIdFromPath(path, 2);
				return handleWebSocketConnection(env, id || '', request);
			}

			if (path.startsWith(ROUTES.WEBHOOK)) {
				const id = extractIdFromPath(path, 2);
				return handleWebhookCapture(env, id || '', request);
			}

			// Serve static assets for root and other paths
			const assets = (env as any).ASSETS;
			if (assets) {
				return assets.fetch(request);
			}

			// Fallback: return 404 if no ASSETS binding
			return createErrorResponse('Not found', 404);
		} catch (err) {
			console.error('Unhandled error in fetch handler:', err);
			return createErrorResponse('Internal server error', 500);
		}
	},
} satisfies ExportedHandler<Env>;
