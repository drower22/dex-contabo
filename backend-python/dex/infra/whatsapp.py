import os
import requests
from typing import Optional, Dict, Any


class WhatsAppClient:
    def __init__(self,
                 phone_number_id: Optional[str] = None,
                 token: Optional[str] = None,
                 graph_version: Optional[str] = None):
        self.phone_number_id = phone_number_id or os.getenv("WHATSAPP_PHONE_ID")
        self.token = token or os.getenv("WHATSAPP_TOKEN")
        raw_version = graph_version or os.getenv("WHATSAPP_GRAPH_VERSION", "v19.0")
        # Normaliza: se vier uma URL completa (ex.: https://graph.facebook.com/v22.0), extrai só a versão
        if raw_version and raw_version.startswith("http"):
            try:
                raw_version = raw_version.rstrip('/').split('/')[-1]
            except Exception:
                pass
        self.graph_version = raw_version
        if not self.phone_number_id or not self.token:
            raise ValueError("WHATSAPP_PHONE_ID e WHATSAPP_TOKEN são obrigatórios no ambiente.")

        self.base_url = f"https://graph.facebook.com/{self.graph_version}/{self.phone_number_id}"
        # Diagnóstico do ambiente em produção (não loga token completo)
        token_mask = (self.token[:6] + "..." + self.token[-4:]) if len(self.token or "") >= 12 else "(short)"
        print(
            f"[DEBUG] WhatsAppClient env: phone_number_id={self.phone_number_id}, "
            f"graph_version={self.graph_version}, token={token_mask}"
        )
        print(f"[DEBUG] WhatsAppClient base_url: {self.base_url}")
        self.headers = {
            "Authorization": f"Bearer {self.token}",
            "Content-Type": "application/json"
        }

    def send_text(self, to: str, text: str, preview_url: bool = False) -> Dict[str, Any]:
        payload = {
            "messaging_product": "whatsapp",
            "to": to,
            "type": "text",
            "text": {"body": text, "preview_url": preview_url}
        }
        url = f"{self.base_url}/messages"
        print(f"[DEBUG] POST {url} payload={payload}")
        resp = requests.post(url, headers=self.headers, json=payload, timeout=30)
        print(f"[DEBUG] RESP status={resp.status_code} text={resp.text}")
        resp.raise_for_status()
        try:
            data = resp.json()
        except Exception:
            data = {"_non_json_body": resp.text}
        return data

    def send_template(self, to: str, template: str, language: str = "pt_BR", components: Optional[list] = None) -> Dict[str, Any]:
        payload: Dict[str, Any] = {
            "messaging_product": "whatsapp",
            "to": to,
            "type": "template",
            "template": {
                "name": template,
                "language": {"code": language}
            }
        }
        if components:
            payload["template"]["components"] = components
        url = f"{self.base_url}/messages"
        print(f"[DEBUG] POST {url} payload={payload}")
        resp = requests.post(url, headers=self.headers, json=payload, timeout=30)
        print(f"[DEBUG] RESP status={resp.status_code} text={resp.text}")
        resp.raise_for_status()
        try:
            data = resp.json()
        except Exception:
            data = {"_non_json_body": resp.text}
        return data

    def send_media_id(self, to: str, media_id: str, media_type: str = "image", caption: Optional[str] = None) -> Dict[str, Any]:
        # media_type: image|audio|video|document
        payload: Dict[str, Any] = {
            "messaging_product": "whatsapp",
            "to": to,
            "type": media_type,
            media_type: {"id": media_id}
        }
        if caption and media_type in ("image", "video", "document"):
            payload[media_type]["caption"] = caption
        url = f"{self.base_url}/messages"
        resp = requests.post(url, headers=self.headers, json=payload, timeout=60)
        resp.raise_for_status()
        return resp.json()
