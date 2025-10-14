import os
from typing import Optional

try:
    from openai import OpenAI
except Exception:
    OpenAI = None  # type: ignore


class OpenAIProvider:
    """Simple wrapper for OpenAI Chat Completions-style text generation.
    Accepts any model via env OPENAI_MODEL (default: gpt-4o-mini). If you want to use
    an experimental model like 'gpt-5-nano', set OPENAI_MODEL=gpt-5-nano in the service env.
    """

    def __init__(self, model: Optional[str] = None):
        if OpenAI is None:
            raise RuntimeError("openai sdk não instalado")
        api_key = os.getenv("OPENAI_API_KEY")
        if not api_key:
            raise RuntimeError("OPENAI_API_KEY não definido")
        self.client = OpenAI(api_key=api_key)
        self.model_name = model or os.getenv("OPENAI_MODEL", "gpt-4o-mini")

    def generate_sql(self, prompt: str) -> str:
        # Keep the response concise; we only want SQL text.
        system = (
            "Você é um assistente que gera exclusivamente SQL PostgreSQL válido. "
            "Responda APENAS com o SQL bruto, sem comentários, explicações nem markdown."
        )
        # Use responses.create for the new SDK
        resp = self.client.chat.completions.create(
            model=self.model_name,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": prompt},
            ],
        )
        text = resp.choices[0].message.content or ""
        text = text.strip()
        # Remove cercas de código se vierem
        if text.startswith("```"):
            text = text.strip("`\n ")
            if text.lower().startswith("sql"):
                text = text[3:].lstrip("\n")
        return text.strip()

    def generate_text(self, history: list[dict]) -> str:
        """history: list of {role, content}. Returns assistant text."""
        system_default = (
            "Você é um assistente útil. Responda de forma objetiva."
        )
        # Load system prompt from env or file if provided
        sys_prompt = os.getenv("OPENAI_SYSTEM_PROMPT")
        sys_prompt_file = os.getenv("OPENAI_SYSTEM_PROMPT_FILE")
        if not sys_prompt and sys_prompt_file and os.path.isfile(sys_prompt_file):
            try:
                with open(sys_prompt_file, "r", encoding="utf-8") as f:
                    sys_prompt = f.read().strip()
                print(f"[DEBUG] OpenAIProvider: loaded system prompt from file {sys_prompt_file}")
            except Exception as e:
                print(f"[WARN] OpenAIProvider: failed to load system prompt from file {sys_prompt_file}: {e}")
                sys_prompt = None
        elif sys_prompt:
            print("[DEBUG] OpenAIProvider: loaded system prompt from env var OPENAI_SYSTEM_PROMPT")
        else:
            print("[DEBUG] OpenAIProvider: using default system prompt")
        messages = []
        # Prepend system if not present
        if not history or history[0].get("role") != "system":
            messages.append({"role": "system", "content": sys_prompt or system_default})
        messages.extend(history)
        resp = self.client.chat.completions.create(
            model=self.model_name,
            messages=messages,
        )
        return (resp.choices[0].message.content or "").strip()
