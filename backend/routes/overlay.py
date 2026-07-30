import logging
from fastapi import APIRouter, Request
from pydantic import BaseModel
from google import genai
from ..config import load_config

logger = logging.getLogger(__name__)
router = APIRouter()

class ClarifyRequest(BaseModel):
    content: str | None = None
    audio: str | None = None  # Base64 encoded audio

@router.post("/clarify")
async def clarify_intent(req: ClarifyRequest, request: Request):
    try:
        config = request.app.state.config
        api_key = config.get("GEMINI_API_KEY")
        
        if not api_key:
            return {"clarification": "GEMINI_API_KEY is not configured."}

        client = genai.Client(api_key=api_key)
        
        contents = []
        if req.audio:
            import base64
            audio_bytes = base64.b64decode(req.audio)
            contents.append(
                genai.types.Part.from_bytes(data=audio_bytes, mime_type='audio/webm')
            )
        
        if req.content:
            contents.append(f"The user has provided the following text input:\n\"{req.content}\"\n\n")
        else:
            contents.append(f"The user has provided the attached audio input.\n\n")
            
        contents.append(
            "Generate a single, concise clarifying question to better understand their intent, "
            "or a short helpful response if their intent is obvious. Keep it under 15 words. "
            "Do not include quotes or conversational filler."
        )

        model_name = config.get("GEMINI_MODEL", "gemini-2.5-flash")
        
        # Live preview models do not support the generateContent API
        if "live-preview" in model_name or "native-audio" in model_name:
            model_name = "gemini-2.5-flash"
            
        gen_config = genai.types.GenerateContentConfig(
            system_instruction="You are Woxus, a smart and helpful desktop AI assistant. Keep responses very concise and helpful."
        )
        
        response = client.models.generate_content(
            model=model_name,
            contents=contents,
            config=gen_config,
        )

        return {"clarification": response.text.strip()}

    except Exception as e:
        logger.error(f"Error generating clarification: {e}")
        error_msg = str(e)
        if "429" in error_msg or "RESOURCE_EXHAUSTED" in error_msg:
            return {"clarification": "Your Gemini API key quota has been exceeded. Please check your billing or use a different key."}
        return {"clarification": "I'm having trouble understanding right now. Please try again."}
