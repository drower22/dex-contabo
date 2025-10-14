import os
from typing import Optional

try:
    from groq import Groq
except Exception:
    Groq = None


class GroqLlamaProvider:
    def __init__(self, model: Optional[str] = None):
        if Groq is None:
            raise RuntimeError("groq SDK não instalado")
        api_key = os.getenv("GROQ_API_KEY")
        if not api_key:
            raise RuntimeError("GROQ_API_KEY não definido")
        self.client = Groq(api_key=api_key)
        self.model = model or os.getenv("GROQ_MODEL", "llama-3.1-70b-versatile")

    def generate_sql(self, prompt: str) -> str:
        resp = self.client.chat.completions.create(
            model=self.model,
            messages=[{"role":"user","content": prompt}],
            temperature=0.1,
            max_tokens=512,
        )
        text = resp.choices[0].message.content.strip()
        if text.startswith("```"):
            text = text.strip("`\n ")
            if text.lower().startswith("sql"):
                text = text[3:].lstrip("\n")
        return text.strip()
