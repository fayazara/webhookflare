# WebhookFlare

A production-ready webhook testing and debugging tool built with Cloudflare Durable Objects, demonstrating the power of edge computing with persistent SQLite storage and real-time WebSocket updates.

> **Perfect for:** Testing webhooks from third-party services, debugging API integrations, monitoring webhook payloads, and learning Cloudflare Durable Objects.

## ✨ Features

- 🎯 **Instant Webhook URLs**: Generate unique webhook endpoints on-demand with zero configuration
- 📡 **Real-time Updates**: See incoming requests instantly via WebSocket connections
- 💾 **Persistent Storage**: All requests stored in SQLite (up to 100 most recent per webhook)
- 🔍 **Complete Request Details**: Captures method, headers, body, query parameters, and timestamps
- 🌍 **Cloudflare Metadata**: Automatic geolocation and network information for each request
- 🎨 **Modern UI**: Clean, responsive interface built with Tailwind CSS and Alpine.js
- 🎨 **Syntax Highlighting**: Beautiful code formatting with Shiki for JSON, XML, HTML, and more
- ⚡ **Edge Computing**: Runs on Cloudflare's global network for ultra-low latency worldwide
- 🚀 **Zero Database Setup**: SQLite is built into Durable Objects—no external database needed

## 🎥 Demo

Visit the live demo: [webhookflare.fayaz.workers.dev](https://webhookflare.fayaz.workers.dev)

## 🎯 Use Cases

- **API Development**: Test webhooks during local development without exposing localhost
- **Integration Testing**: Verify webhook payloads from services like Stripe, GitHub, Shopify, etc.
- **Debugging**: Inspect exactly what data third-party services are sending
- **Monitoring**: Track webhook reliability and response times
- **Education**: Learn how Durable Objects, SQLite, and WebSockets work together

## 🏗️ Architecture

WebhookFlare showcases several Cloudflare Workers platform features:

### Durable Objects with SQLite

Each webhook endpoint is a separate **Durable Object** instance that:

- Automatically provisions a **SQLite database** on first access
- Stores up to 100 most recent requests with full details
- Maintains strong consistency within a single object
- Persists data across restarts and deploys
- Uses **RPC methods** (`captureRequest`, `getRequests`) for communication

### WebSocket Broadcasting

Real-time updates powered by:

- Native WebSocket support in Durable Objects
- Connection management across multiple viewers
- Instant broadcast of new requests to all connected clients
- Automatic reconnection handling

### Edge-Native Worker

The main Worker handles:

- Routing to Durable Object instances by webhook ID
- Serving static assets (HTML, CSS, JS)
- CORS headers for cross-origin requests
- Cloudflare metadata extraction (`request.cf` object)

### Frontend

Single-page application using:

- **Alpine.js** for reactive UI without build steps
- **Tailwind CSS** for styling
- **Shiki** for syntax highlighting
- **WebSocket API** for live updates

## 📦 Tech Stack

| Technology                                                                                 | Purpose                                   |
| ------------------------------------------------------------------------------------------ | ----------------------------------------- |
| [Cloudflare Workers](https://workers.cloudflare.com)                                       | Serverless edge compute platform          |
| [Durable Objects](https://developers.cloudflare.com/durable-objects/)                      | Stateful, coordinated compute with SQLite |
| [Workers Assets](https://developers.cloudflare.com/workers/static-assets/)                 | Static asset serving                      |
| [WebSockets](https://developers.cloudflare.com/durable-objects/examples/websocket-server/) | Real-time bidirectional communication     |
| [Alpine.js](https://alpinejs.dev)                                                          | Lightweight reactive framework            |
| [Tailwind CSS](https://tailwindcss.com)                                                    | Utility-first CSS framework               |
| [Shiki](https://shiki.style)                                                               | Beautiful syntax highlighting             |

## 🚀 Quick Start

### Prerequisites

- Node.js 18+ installed
- [pnpm](https://pnpm.io) package manager
- A [Cloudflare account](https://dash.cloudflare.com/sign-up) (free tier works!)
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/install-and-update/) installed globally or via pnpm

### Local Development

```bash
# Clone the repository
git clone https://github.com/yourusername/webhookflare.git
cd webhookflare

# Install dependencies
pnpm install

# Start local development server
pnpm run dev
```

Visit `http://localhost:8787` to see your webhook tester in action!

The development server will:

- Run your Worker locally with hot-reload
- Persist Durable Object data between restarts
- Simulate the production environment

### Deployment

```bash
# Authenticate with Cloudflare (first time only)
wrangler login

# Deploy to Cloudflare Workers
pnpm run deploy
```

Your webhook tester will be live at `https://durable-object-starter.<your-subdomain>.workers.dev`

## 📖 Usage

### Basic Usage

1. **Generate a webhook URL**: Open the app to automatically generate a unique endpoint
2. **Send test requests**: Use curl, Postman, or any HTTP client
3. **Watch in real-time**: Requests appear instantly in the dashboard

### Example Requests

**Basic POST request:**

```bash
curl -X POST https://your-app.workers.dev/hook/abc12345 \
  -H "Content-Type: application/json" \
  -d '{"event": "user.created", "userId": "12345"}'
```

**With query parameters:**

```bash
curl -X POST "https://your-app.workers.dev/hook/abc12345?source=api&version=v2" \
  -H "Content-Type: application/json" \
  -d '{"data": "test"}'
```

**Testing Stripe webhooks:**

```bash
curl -X POST https://your-app.workers.dev/hook/abc12345 \
  -H "Content-Type: application/json" \
  -H "Stripe-Signature: t=1234567890,v1=..." \
  -d '{"type": "payment_intent.succeeded", "data": {...}}'
```

**GET request with headers:**

```bash
curl -X GET https://your-app.workers.dev/hook/abc12345 \
  -H "X-Custom-Header: CustomValue" \
  -H "Authorization: Bearer token123"
```

### Sharing Webhook URLs

Each webhook URL is uniquely identified by its ID and can be:

- Shared with team members (via the `?id=` parameter)
- Used across multiple services simultaneously
- Bookmarked for repeated use
- Embedded in CI/CD pipelines

## 🛠️ API Endpoints

### Worker Endpoints

| Method | Endpoint        | Description                                |
| ------ | --------------- | ------------------------------------------ |
| `GET`  | `/`             | Homepage with webhook viewer UI            |
| `GET`  | `/api/new`      | Generate a new webhook ID                  |
| `GET`  | `/api/bin/{id}` | Fetch all requests for a webhook (JSON)    |
| `GET`  | `/ws/{id}`      | WebSocket connection for real-time updates |
| `ANY`  | `/hook/{id}`    | Capture any HTTP method to this webhook    |

### Durable Object RPC Methods

The `WebhookBin` Durable Object exposes:

```typescript
// Store a webhook request
captureRequest(
  method: string,
  headers: Record<string, string>,
  body: string,
  query: string,
  metadata: string
): Promise<number>

// Retrieve all requests (latest 100)
getRequests(): Promise<WebhookRequest[]>

// Handle WebSocket upgrades (via fetch)
fetch(request: Request): Promise<Response>
```

## 📁 Project Structure

```
webhookflare/
├── src/
│   └── index.ts              # Worker entry point + Durable Object class
├── public/
│   └── index.html            # Frontend SPA with Alpine.js
├── wrangler.jsonc            # Cloudflare Workers configuration
├── tsconfig.json             # TypeScript configuration
├── package.json              # Dependencies and scripts
└── README.md                 # This file
```

### Key Files

**`src/index.ts`** - Contains:

- `WebhookBin` Durable Object class with SQLite storage
- Worker fetch handler for routing
- RPC method implementations
- WebSocket connection management

**`public/index.html`** - Contains:

- Alpine.js reactive application
- WebSocket client implementation
- UI components and styling
- Shiki syntax highlighting integration

**`wrangler.jsonc`** - Configures:

- Durable Object bindings
- SQLite migrations
- Static assets directory
- Observability settings

## 🎓 Learning Resources

This project demonstrates several Cloudflare Workers platform concepts:

### Durable Objects Concepts

- **SQLite Storage**: Persistent database within each Durable Object
- **RPC Methods**: Calling methods on Durable Objects from Workers
- **WebSocket Handling**: Managing persistent connections
- **State Management**: Coordinating multiple WebSocket sessions
- **Naming**: Using `idFromName()` for deterministic object IDs

### Advanced Patterns

- **Request Capture**: Extracting and storing HTTP request details
- **Cloudflare Metadata**: Leveraging `request.cf` for geolocation
- **Broadcasting**: Sending messages to multiple WebSocket clients
- **Migrations**: Using SQLite migrations for schema management
- **Static Assets**: Serving frontend files with Workers Assets

### Recommended Reading

- [Durable Objects: Easy, Fast, Correct — Choose three](https://blog.cloudflare.com/durable-objects-easy-fast-correct-choose-three/)
- [Building a Distributed Chat Application](https://developers.cloudflare.com/durable-objects/examples/websocket-server/)
- [SQLite in Durable Objects](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/)
- [RPC Protocol for Durable Objects](https://developers.cloudflare.com/durable-objects/best-practices/access-durable-objects-from-workers/#call-rpc-methods)

## ⚙️ Configuration

### Wrangler Configuration

The `wrangler.jsonc` file configures your Worker:

```jsonc
{
	"name": "durable-object-starter",
	"main": "src/index.ts",
	"compatibility_date": "2025-11-11",

	// Define Durable Object bindings
	"durable_objects": {
		"bindings": [
			{
				"class_name": "WebhookBin",
				"name": "MY_DURABLE_OBJECT"
			}
		]
	},

	// SQLite migrations
	"migrations": [
		{
			"tag": "v1",
			"new_sqlite_classes": ["WebhookBin"]
		}
	],

	// Static assets configuration
	"assets": {
		"directory": "./public"
	},

	// Enable observability
	"observability": {
		"enabled": true
	}
}
```

### Environment Variables

No environment variables required! Everything runs out of the box.

### Custom Domains

To use a custom domain:

```bash
# Add a route in wrangler.jsonc
"routes": [
  { "pattern": "webhooks.yourdomain.com/*", "custom_domain": true }
]

# Deploy
pnpm run deploy
```

## 🔒 Security & Privacy Considerations

- **Data Isolation**: Each webhook ID creates a separate Durable Object instance
- **No Authentication**: URLs are generated randomly but are publicly accessible
- **Data Retention**: Only the 100 most recent requests are stored per webhook
- **CORS**: Enabled for all origins (modify in `src/index.ts` if needed)
- **Rate Limiting**: Not implemented (consider adding for production use)

### Production Recommendations

For production deployments, consider adding:

1. **Authentication**: Require API keys for webhook creation
2. **Rate Limiting**: Implement per-webhook request limits
3. **TTL**: Auto-expire webhooks after a certain time
4. **Webhook Secrets**: Verify webhook signatures (e.g., Stripe, GitHub)
5. **Access Control**: Password-protect webhook viewers

## 💰 Cost Considerations

WebhookFlare is designed to be cost-effective on Cloudflare's platform:

| Resource                  | Free Tier              | Pricing Beyond Free Tier |
| ------------------------- | ---------------------- | ------------------------ |
| **Worker Requests**       | 100,000/day            | $0.15/million requests   |
| **Durable Objects**       | First 1M requests free | $0.15/million requests   |
| **SQLite Storage**        | First 1 GB free        | $0.50/GB-month           |
| **WebSocket Connections** | No charge              | Included in DO requests  |

**Estimated costs for typical usage:**

- 1,000 webhooks/day with 10 viewers: ~$0.50/month
- Development/testing: Stays within free tier

Learn more: [Cloudflare Workers Pricing](https://developers.cloudflare.com/workers/platform/pricing/)

## 🐛 Troubleshooting

### WebSocket connection fails

- **Local dev**: Ensure you're using `ws://` not `wss://`
- **Production**: Check that WebSocket upgrade headers are not blocked by proxies
- **Browser**: Look for errors in the browser console

### Requests not appearing

- Check the webhook URL matches the ID in the browser (`?id=...`)
- Verify the request is reaching Cloudflare (check Workers logs)
- Ensure WebSocket is connected (green indicator in UI)

### SQLite errors during deployment

- Ensure migrations are properly configured in `wrangler.jsonc`
- Delete and redeploy if schema changed: `wrangler delete && pnpm run deploy`

### Local development issues

```bash
# Clear local Durable Object state
rm -rf .wrangler/state

# Restart dev server
pnpm run dev
```

## 🤝 Contributing

Contributions are welcome! This project serves as educational content for the Cloudflare developer community.

### Development Workflow

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/amazing-feature`
3. Make your changes
4. Test locally: `pnpm run dev`
5. Deploy to your Workers account: `pnpm run deploy`
6. Submit a pull request


## 🙋 Support & Questions

- **Cloudflare Community**: [community.cloudflare.com](https://community.cloudflare.com)
- **Discord**: [Cloudflare Developers Discord](https://discord.gg/cloudflaredev)
- **Docs**: [developers.cloudflare.com](https://developers.cloudflare.com)
- **Issues**: [GitHub Issues](https://github.com/yourusername/webhookflare/issues)

---

**Ready to build your own?** Check out the [Cloudflare Workers documentation](https://developers.cloudflare.com/workers/) to get started!
