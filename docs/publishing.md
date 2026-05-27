# Publishing SourceScout MCP

This checklist publishes SourceScout MCP where other teams can discover and install it.

## Official MCP Registry

SourceScout is published as a Docker/OCI package. The registry verifies OCI package ownership by reading the `io.modelcontextprotocol.server.name` label from the image, so build and push the image before publishing `server.json`.

```bash
docker build -t rogo16/sourcescout-mcp:v0.0.10 .
docker push rogo16/sourcescout-mcp:v0.0.10
```

Install `mcp-publisher` if needed:

```bash
curl -L "https://github.com/modelcontextprotocol/registry/releases/latest/download/mcp-publisher_$(uname -s | tr '[:upper:]' '[:lower:]')_$(uname -m | sed 's/x86_64/amd64/;s/aarch64/arm64/').tar.gz" | tar xz mcp-publisher
sudo mv mcp-publisher /usr/local/bin/
```

Authenticate with GitHub and publish from the repository root:

```bash
mcp-publisher login github
mcp-publisher publish
```

Verify the published metadata:

```bash
curl "https://registry.modelcontextprotocol.io/v0.1/servers?search=io.github.rodrigoGA/sourcescout-mcp"
```

## After the Official Registry

Once the official registry entry is live, submit the GitHub repository to:

- GitHub MCP Registry / VS Code discovery: request inclusion via `partnerships@github.com`.
- Glama: submit the GitHub repository for indexing.
- mcp.so: submit through their GitHub issue flow.
- mcpservers.org: submit through the free server submission form.
- Awesome MCP Servers: open a PR to `punkpeye/awesome-mcp-servers`.
