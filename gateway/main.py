import json
import logging
import re

from curl_cffi import requests
from fastapi import FastAPI, Request
from fastapi.responses import Response, StreamingResponse

# ================= 配置日志 =================
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("Gateway")

app = FastAPI()

# 定义需要剔除的逐跳 Header 和 压缩 Header
HOP_BY_HOP_HEADERS = {
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
    "content-encoding",
    "content-length",
    "host",
}
# 网关私有 Header，转发前需要移除
GATEWAY_PRIVATE_HEADERS = {"x-target-url", "x-proxy-url"}


def mask_proxy_url(proxy_url: str) -> str:
    """脱敏日志中的代理密码"""
    if not proxy_url:
        return "None"
    return re.sub(r":([^:@]+)@", ":***@", proxy_url)


async def stream_with_cleanup(response, session):
    """
    流式生成器：
    1. 把上游的数据一点点吐给前端。
    2. 在 try...finally 中确保传输结束/报错时关闭 session。
    """
    try:
        async for chunk in response.aiter_content():
            yield chunk
    except Exception as exc:  # noqa: BLE001
        logger.error("Stream Transmission Error: %s", exc)
    finally:
        await session.close()


@app.post("/proxy")
async def proxy_handler(request: Request):
    inbound_headers = dict(request.headers)

    # 1. 获取目标地址
    target_url = inbound_headers.get("x-target-url")
    if not target_url:
        return Response(content='{"error": "Missing x-target-url header"}', status_code=400)

    # 2. 获取代理配置
    proxy_url = inbound_headers.get("x-proxy-url")
    proxies = {"http": proxy_url, "https": proxy_url} if proxy_url else None

    # 3. 创建高仿 Session (模拟 Chrome 120)
    # 注意：Session 不在 with 块中，需手动管理关闭
    session = requests.AsyncSession(impersonate="chrome120", proxies=proxies)

    # 4. 清洗 Header (防指纹泄露 + 防乱码)
    clean_headers = {}
    for key, value in inbound_headers.items():
        lower = key.lower()
        # 剔除逐跳头、私有头，以及 accept-encoding (防止服务器返回 gzip 导致乱码)
        if (
            lower not in HOP_BY_HOP_HEADERS
            and lower not in GATEWAY_PRIVATE_HEADERS
            and lower != "accept-encoding"
        ):
            clean_headers[key] = value

    # 强制覆盖 UA，伪装到底
    clean_headers[
        "User-Agent"
    ] = (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/120.0.0.0 Safari/537.36"
    )

    try:
        # 读取原始请求体
        body = await request.body()

        # ================= 🚀 全能流式判定逻辑 (增强版) =================
        is_stream = False

        # A. URL 特征判定 (针对 Gemini/Google Vertex AI)
        # Gemini 的 URL 经常包含 :streamGenerateContent
        if "stream" in target_url.lower():
            is_stream = True

        # B. Header 特征判定 (针对标准 SSE)
        if not is_stream:
            accept_header = inbound_headers.get("accept", "").lower()
            if "text/event-stream" in accept_header or "application/x-ndjson" in accept_header:
                is_stream = True

        # C. Body 特征判定 (针对 OpenAI / Claude)
        if not is_stream:
            try:
                content_type = inbound_headers.get("content-type", "").lower()
                if "application/json" in content_type and len(body) > 0:
                    body_json = json.loads(body)
                    if body_json.get("stream") is True:
                        is_stream = True
            except Exception:  # noqa: BLE001
                # 解析失败就不算流式，降级为普通请求
                pass
        # =============================================================

        # 5. 发起请求
        # allow_redirects=False: 网关通常不自动跟随重定向，而是把重定向透传给客户端
        upstream_response = await session.post(
            target_url,
            data=body,
            headers=clean_headers,
            stream=is_stream,
            timeout=600,
            allow_redirects=False,
        )

        # 6. 处理响应头
        response_headers = {}
        for key, value in upstream_response.headers.items():
            lower = key.lower()
            if lower not in HOP_BY_HOP_HEADERS and lower != "content-encoding":
                response_headers[key] = value

        # 打上标记，证明经过了 Python 网关
        response_headers["X-Gateway-By"] = "Python-Sidecar-v2"

        # 7. 返回结果
        if is_stream:
            # 流式：移交控制权给生成器，Session 关闭操作在生成器里
            return StreamingResponse(
                stream_with_cleanup(upstream_response, session),
                status_code=upstream_response.status_code,
                headers=response_headers,
                media_type="text/event-stream",
            )

        # 非流式：一次性读取，手动关闭 Session
        content = await upstream_response.content
        await session.close()

        # 兼容处理：如果没有 content-type，默认 json
        media_type = upstream_response.headers.get("content-type", "application/json")
        return Response(
            content=content,
            status_code=upstream_response.status_code,
            headers=response_headers,
            media_type=media_type,
        )

    except Exception as exc:  # noqa: BLE001
        # 异常兜底：务必关闭 Session，防止连接泄漏
        await session.close()

        safe_proxy = mask_proxy_url(proxy_url)
        logger.error("🔥 Gateway Error: %s | Target: %s | Proxy: %s", str(exc), target_url, safe_proxy)
        return Response(
            content=json.dumps({"error": str(exc)}),
            status_code=502,
            media_type="application/json",
        )


if __name__ == "__main__":
    import uvicorn

    # 生产环境建议 log_level 设为 warning，减少刷屏
    uvicorn.run(app, host="0.0.0.0", port=8080, log_level="warning")
