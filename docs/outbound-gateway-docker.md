# Outbound Gateway Docker Notes

- **Env flags (app container)**  
  - `OUTBOUND_GATEWAY_ENABLED=true`  
  - `OUTBOUND_GATEWAY_URL=http://gateway:8080/proxy` (use service name if on same Docker network)  
  - `OUTBOUND_GATEWAY_FORWARD_PROXY_HEADER=true` (default) to pass account proxy as `x-proxy-url`

- **Compose example (sidecar + app)**  
  ```yaml
  services:
    gateway:
      image: ghcr.io/love-gwen2025/claude-relay-gateway:latest
      ports:
        - "8080:8080"
    app:
      image: claude-relay-service:latest
      depends_on:
        - gateway
      environment:
        OUTBOUND_GATEWAY_ENABLED: "true"
        OUTBOUND_GATEWAY_URL: "http://gateway:8080/proxy"
        OUTBOUND_GATEWAY_FORWARD_PROXY_HEADER: "true"
      # mount config/.env/redis/etc as your deployment requires
  ```

- **Container networking tips**  
  - In Docker, `127.0.0.1` is the container itself; use the service name (`gateway`) for cross-container traffic.  
  - Keep the two services on the same user-defined network for name resolution and stable connectivity.  
  - If you bind gateway to the host (`8080:8080`) and run app on the host, set URL to `http://127.0.0.1:8080/proxy`.
  - CI 构建：`.github/workflows/docker-build.yml` 会同时构建/推送 `claude-relay-service` 与 `claude-relay-gateway` 两个镜像（latest + sha 标签）。

- **Health & timeout**  
  - App respects `REQUEST_TIMEOUT` (default 600s) for gateway calls; ensure gateway timeout is ≥ app timeout.  
  - Consider adding a lightweight `/health` endpoint in the gateway and a `healthcheck` in Compose.

- **Proxy forwarding**  
  - Account-level proxies are serialized to `x-proxy-url`; set `OUTBOUND_GATEWAY_FORWARD_PROXY_HEADER=false` to disable if not needed.
