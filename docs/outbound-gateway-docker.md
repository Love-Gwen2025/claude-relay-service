# 出网网关 Docker 说明

- **应用容器环境变量**  
  - `OUTBOUND_GATEWAY_ENABLED=true`  
  - `OUTBOUND_GATEWAY_URL=http://gateway:8080/proxy`（同一 Docker 网络内用服务名 gateway）  
  - `OUTBOUND_GATEWAY_FORWARD_PROXY_HEADER=true`（默认）将账户代理写入 `x-proxy-url`

- **Compose 示例（侧车 + 主应用）**  
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
      # 视情况挂载 config/.env/redis 等
  ```

- **网络提示**  
  - Docker 内 `127.0.0.1` 仅指向容器自身，跨容器请用服务名 `gateway`。  
  - 让两服务处于同一自定义网络，便于解析和稳定连通。  
  - 若侧车映射到宿主机 (`8080:8080`) 且应用也跑在宿主机，URL 可设为 `http://127.0.0.1:8080/proxy`。  
  - CI 构建：`.github/workflows/docker-build.yml` 会同时构建/推送 `claude-relay-service` 与 `claude-relay-gateway` 两个镜像（latest + sha 标签）。

- **健康检查与超时**  
  - 应用侧调用网关受 `REQUEST_TIMEOUT`（默认 600s）约束，建议网关超时不小于该值。  
  - 可在网关加简单 `/health` 接口，并在 Compose 中配置 `healthcheck`。

- **代理透传**  
  - 账户级代理会序列化到 `x-proxy-url` 头；若不需要可设 `OUTBOUND_GATEWAY_FORWARD_PROXY_HEADER=false` 禁用。
