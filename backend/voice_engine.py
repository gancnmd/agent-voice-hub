"""
voice_engine.py - Text-to-Speech engine for AgentVoiceHub.

Uses Edge TTS for high-quality neural voice synthesis supporting
Chinese (Mandarin) and English voices. Provides a clean async API
for generating speech audio from text.
"""

import asyncio
import io
import logging
from typing import Optional

import edge_tts

logger = logging.getLogger(__name__)

# Default voices for common languages
DEFAULT_VOICES = {
    "zh-CN": "zh-CN-XiaoxiaoNeural",
    "en-US": "en-US-AriaNeural",
}

# Curated list of popular voices (full list fetched dynamically)
POPULAR_VOICES = [
    "zh-CN-XiaoxiaoNeural",
    "zh-CN-YunxiNeural",
    "zh-CN-YunjianNeural",
    "zh-CN-XiaoyiNeural",
    "zh-CN-YunyangNeural",
    "en-US-AriaNeural",
    "en-US-GuyNeural",
    "en-US-JennyNeural",
    "en-US-DavisNeural",
    "en-GB-SoniaNeural",
    "en-GB-RyanNeural",
    "ja-JP-NanamiNeural",
    "ko-KR-SunHiNeural",
]


class VoiceEngine:
    """Async TTS engine backed by Edge TTS."""

    def __init__(self) -> None:
        self._voice_cache: Optional[list[dict]] = None
        self._custom_voices: dict[str, str] = {}  # name -> path mapping

    async def list_voices(self, language: Optional[str] = None) -> list[dict]:
        """
        List available Edge TTS voices.

        Args:
            language: Optional language filter (e.g. "zh-CN", "en-US").

        Returns:
            List of voice dicts with keys: name, gender, language.
        """
        if self._voice_cache is None:
            try:
                voices = await edge_tts.list_voices()
                self._voice_cache = [
                    {
                        "name": v["ShortName"],
                        "gender": v["Gender"],
                        "language": v["Locale"],
                    }
                    for v in voices
                ]
            except Exception as e:
                logger.error("Failed to fetch voice list: %s", e)
                # Return popular voices as fallback
                self._voice_cache = [
                    {"name": name, "gender": "Unknown", "language": name.split("-")[0] + "-" + name.split("-")[1]}
                    for name in POPULAR_VOICES
                ]

        voices = self._voice_cache
        if language:
            voices = [v for v in voices if v["language"].startswith(language)]
        return voices

    async def synthesize(
        self,
        text: str,
        voice: str = "zh-CN-XiaoxiaoNeural",
        rate: str = "+0%",
        pitch: str = "+0Hz",
    ) -> bytes:
        """
        Synthesize speech audio from text.

        Args:
            text: Input text to synthesize.
            voice: Edge TTS voice name (e.g. "zh-CN-XiaoxiaoNeural").
            rate: Speech rate adjustment (e.g. "+20%", "-10%").
            pitch: Pitch adjustment (e.g. "+5Hz", "-2Hz").

        Returns:
            MP3 audio bytes.
        """
        if not text or not text.strip():
            raise ValueError("Text must not be empty")

        # Check custom voices first
        if voice in self._custom_voices:
            return await self._synthesize_custom(text, voice)

        try:
            communicate = edge_tts.Communicate(text=text, voice=voice, rate=rate, pitch=pitch)
            buffer = io.BytesIO()
            async for chunk in communicate.stream():
                if chunk["type"] == "audio":
                    buffer.write(chunk["data"])
            audio_bytes = buffer.getvalue()
            if not audio_bytes:
                raise RuntimeError("Edge TTS returned empty audio")
            return audio_bytes
        except Exception as e:
            logger.error("TTS synthesis failed for voice '%s': %s", voice, e)
            raise

    async def synthesize_stream(
        self,
        text: str,
        voice: str = "zh-CN-XiaoxiaoNeural",
        rate: str = "+0%",
        pitch: str = "+0Hz",
    ):
        """
        Stream synthesized audio chunks (for WebSocket use).

        Yields:
            Audio bytes in chunks.
        """
        communicate = edge_tts.Communicate(text=text, voice=voice, rate=rate, pitch=pitch)
        async for chunk in communicate.stream():
            if chunk["type"] == "audio":
                yield chunk["data"]

    def register_custom_voice(self, name: str, path: str) -> None:
        """
        Register a custom voice for future voice cloning.

        Args:
            name: Unique voice identifier.
            path: Path to voice model/sample file.
        """
        self._custom_voices[name] = path
        logger.info("Registered custom voice: %s -> %s", name, path)

    def list_custom_voices(self) -> dict[str, str]:
        """Return registered custom voices."""
        return dict(self._custom_voices)

    async def _synthesize_custom(self, text: str, voice_name: str) -> bytes:
        """
        Placeholder for custom voice synthesis (voice cloning).

        Currently falls back to default voice with a log warning.
        Future: integrate a voice cloning model (e.g. Coqui, Bark).
        """
        logger.warning(
            "Custom voice '%s' not yet implemented, using default. "
            "Voice cloning support is planned for a future release.",
            voice_name,
        )
        return await self.synthesize(text, voice=DEFAULT_VOICES["zh-CN"])
