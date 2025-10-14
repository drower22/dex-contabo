import os
from typing import Optional

try:
    import google.generativeai as genai
except Exception as e:
    genai = None


class GeminiProvider:
    def __init__(self, model: Optional[str] = None):
        if genai is None:
            raise RuntimeError("google-generativeai não instalado")
        api_key = os.getenv("GEMINI_API_KEY")
        if not api_key:
            raise RuntimeError("GEMINI_API_KEY não definido")
        genai.configure(api_key=api_key)
        self.model_name = model or os.getenv("GEMINI_MODEL", "gemini-1.5-pro")
        self.model = genai.GenerativeModel(self.model_name)

    def generate_sql(self, prompt: str) -> str:
        resp = self.model.generate_content(prompt)
        text = resp.text.strip()
        # Alguns modelos retornam ```sql ...```
        if text.startswith("```"):
            text = text.strip("`\n ")
            if text.lower().startswith("sql"):
                text = text[3:].lstrip("\n")
        return text.strip()
