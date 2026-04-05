"""
Ollama LLM client using the OpenAI-compatible API.

Gemma 4 on Ollama exposes an OpenAI-compatible endpoint at /v1.
This lets us use the standard openai Python client, making it easy
to swap to any other provider later.

Key Gemma 4 features we leverage:
- Native system prompt support (unlike Gemma 3)
- Native function calling / tool use
- Configurable thinking mode via <|think|> token
"""

import json
import time
from typing import Any

import httpx
import structlog
from openai import AsyncOpenAI
from tenacity import retry, stop_after_attempt, wait_exponential

from ..config import settings

def _is_anthropic() -> bool:
    return "anthropic.com" in settings.llm_base_url

logger = structlog.get_logger()

# Lazy import to avoid circular dependency
def _push(event: dict):
    try:
        from ..api.debug import push_event
        push_event(event)
    except Exception:
        pass


class OllamaClient:
    """Async wrapper around Ollama's OpenAI-compatible API."""

    def __init__(
        self,
        base_url: str | None = None,
        model: str | None = None,
    ):
        self.base_url = base_url or settings.llm_base_url
        self.model = model or settings.llm_model
        self.ollama_url = settings.ollama_base_url
        self.use_anthropic = _is_anthropic()

        if self.use_anthropic:
            from anthropic import AsyncAnthropic
            self._anthropic = AsyncAnthropic(api_key=settings.llm_api_key)
            self.client = None
        else:
            self._anthropic = None
            self.client = AsyncOpenAI(
                base_url=self.base_url,
                api_key=settings.llm_api_key,
            )

    async def check_model(self) -> bool:
        """Verify the configured model is reachable."""
        if self.use_anthropic:
            # Just verify the API key works
            try:
                msg = await self._anthropic.messages.create(
                    model=self.model, max_tokens=5,
                    messages=[{"role": "user", "content": "hi"}]
                )
                return True
            except Exception as e:
                logger.error("Anthropic API check failed", error=str(e))
                return False
        try:
            async with httpx.AsyncClient() as http:
                resp = await http.get(f"{self.ollama_url}/api/tags", timeout=5)
                if resp.status_code != 200:
                    return False
                data = resp.json()
                model_names = [m["name"] for m in data.get("models", [])]
                target = self.model.split(":")[0] if ":" not in self.model else self.model
                return any(target in name for name in model_names)
        except Exception as e:
            logger.error("Ollama health check failed", error=str(e))
            return False

    @retry(stop=stop_after_attempt(2), wait=wait_exponential(min=1, max=5))
    async def chat(
        self,
        messages: list[dict[str, str]],
        temperature: float = 0.3,
        max_tokens: int = 4096,
        tools: list[dict] | None = None,
    ) -> str:
        """
        Send a chat completion request to Ollama.

        Args:
            messages: List of {"role": "system"|"user"|"assistant", "content": "..."}
            temperature: Sampling temperature (lower = more deterministic)
            max_tokens: Max tokens in response
            tools: Optional tool/function definitions for function calling

        Returns:
            The assistant's response text.
        """
        kwargs: dict[str, Any] = {
            "model": self.model,
            "messages": messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
        }
        if tools:
            kwargs["tools"] = tools

        logger.debug(
            "LLM request",
            model=self.model,
            msg_count=len(messages),
            has_tools=bool(tools),
        )

        # Capture request for debug panel
        user_msg = next((m["content"] for m in reversed(messages) if m["role"] == "user"), "")
        sys_msg = next((m["content"] for m in messages if m["role"] == "system"), "")
        t0 = time.time()
        _push({
            "type": "request",
            "ts": t0,
            "model": self.model,
            "system": sys_msg[:300],
            "user": user_msg[:300],
            "max_tokens": max_tokens,
        })

        if self.use_anthropic:
            # Anthropic native API — extract system message separately
            system_content = next((m["content"] for m in messages if m["role"] == "system"), None)
            non_system = [m for m in messages if m["role"] != "system"]
            anthropic_kwargs: dict[str, Any] = {
                "model": self.model,
                "max_tokens": max_tokens,
                "messages": non_system,
            }
            if system_content:
                anthropic_kwargs["system"] = system_content
            response = await self._anthropic.messages.create(**anthropic_kwargs)
            content = response.content[0].text if response.content else ""
            elapsed = round(time.time() - t0, 1)
            finish = response.stop_reason or "stop"
            out_tokens = response.usage.output_tokens if response.usage else "?"
        else:
            response = await self.client.chat.completions.create(**kwargs)
            elapsed = round(time.time() - t0, 1)
            choice = response.choices[0]
            if choice.message.tool_calls:
                content = json.dumps([
                    {"name": tc.function.name, "arguments": json.loads(tc.function.arguments)}
                    for tc in choice.message.tool_calls
                ])
            else:
                content = choice.message.content or ""
            finish = choice.finish_reason
            out_tokens = getattr(response.usage, "completion_tokens", "?")

        _push({
            "type": "response",
            "ts": time.time(),
            "elapsed_s": elapsed,
            "finish_reason": finish,
            "tokens": out_tokens,
            "response": content[:600],
        })

        return content

    @retry(stop=stop_after_attempt(2), wait=wait_exponential(min=1, max=5))
    async def chat_json(
        self,
        messages: list[dict[str, str]],
        temperature: float = 0.2,
        max_tokens: int = 8192,
    ) -> dict:
        """
        Chat completion that forces JSON output.

        Adds an instruction to output only valid JSON and parses the result.
        """
        # Append JSON instruction to system message
        json_instruction = (
            "\n\nIMPORTANT: You MUST respond with ONLY valid JSON. "
            "No markdown, no backticks, no explanation — just the JSON object."
        )

        enhanced_messages = []
        for msg in messages:
            if msg["role"] == "system":
                enhanced_messages.append(
                    {"role": "system", "content": msg["content"] + json_instruction}
                )
            else:
                enhanced_messages.append(msg)

        # If no system message existed, add one
        if not any(m["role"] == "system" for m in enhanced_messages):
            enhanced_messages.insert(
                0,
                {"role": "system", "content": "Respond with valid JSON only." + json_instruction},
            )

        raw = await self.chat(
            messages=enhanced_messages,
            temperature=temperature,
            max_tokens=max_tokens,
        )

        # Strip markdown fences if present
        cleaned = raw.strip()
        if cleaned.startswith("```"):
            # Remove ```json ... ``` wrapper
            lines = cleaned.split("\n")
            if lines[0].startswith("```"):
                lines = lines[1:]
            if lines and lines[-1].strip() == "```":
                lines = lines[:-1]
            cleaned = "\n".join(lines)

        try:
            return json.loads(cleaned)
        except json.JSONDecodeError:
            # Try to recover truncated JSON by finding the last valid complete object
            repaired = _repair_truncated_json(cleaned)
            if repaired is not None:
                logger.warning("LLM returned truncated JSON — repaired", chars=len(cleaned))
                return repaired
            logger.error(
                "LLM returned invalid JSON",
                error=str(json.JSONDecodeError),
                raw_response=raw[:500],
            )
            raise ValueError("LLM did not return valid JSON") from None


def _repair_truncated_json(s: str) -> dict | None:
    """
    Attempt to recover a truncated JSON object by progressively
    trimming trailing chars and closing open brackets.
    """
    # Try closing with increasing numbers of brackets/braces
    for suffix in ["}]}", "}]", "]}", "}}", "}"]:
        candidate = s.rstrip().rstrip(",") + suffix
        try:
            return json.loads(candidate)
        except json.JSONDecodeError:
            continue
    # Last resort: find last complete top-level key by truncating to last '}'
    idx = s.rfind("},")
    if idx > 0:
        candidate = s[:idx] + "}]}"
        try:
            return json.loads(candidate)
        except json.JSONDecodeError:
            pass
    return None

    @retry(stop=stop_after_attempt(2), wait=wait_exponential(min=1, max=5))
    async def chat_with_tools(
        self,
        messages: list[dict[str, str]],
        tools: list[dict],
        temperature: float = 0.3,
        max_tokens: int = 4096,
    ) -> dict:
        """
        Chat with function calling / tool use.

        Gemma 4 has native function calling support.
        Returns the full response object including any tool calls.
        """
        response = await self.client.chat.completions.create(
            model=self.model,
            messages=messages,
            tools=tools,
            temperature=temperature,
            max_tokens=max_tokens,
        )

        choice = response.choices[0]

        result: dict[str, Any] = {
            "content": choice.message.content or "",
            "tool_calls": [],
            "finish_reason": choice.finish_reason,
        }

        if choice.message.tool_calls:
            result["tool_calls"] = [
                {
                    "id": tc.id,
                    "name": tc.function.name,
                    "arguments": json.loads(tc.function.arguments),
                }
                for tc in choice.message.tool_calls
            ]

        return result
