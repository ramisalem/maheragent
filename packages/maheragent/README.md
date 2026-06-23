# maheragent

An agentic toolkit that gives an AI assistant direct control of a web app over
[MCP](https://modelcontextprotocol.io) — and checks the result against your Figma design.

```bash
npm install -g maheragent

cd /path/to/your-web-app
maheragent init        # register the MCP server + copy skills, then restart your editor
```

`maheragent` is the umbrella CLI; it routes to `@ramisalem/mcp`, `@ramisalem/cli`, and
`@ramisalem/installer`.

**Full documentation, architecture, and tool reference:**
https://github.com/ramisalem/maheragent#readme
