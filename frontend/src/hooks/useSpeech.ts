import { useCallback, useEffect, useState } from "react";

// Preferred voices in priority order — first match wins
const PREFERRED_VOICES = [
  "Google US English",
  "Samantha",           // macOS built-in, warm and natural
  "Karen",              // macOS Australian
  "Moira",              // macOS Irish
  "Victoria",           // macOS
  "Microsoft Aria Online (Natural)",
  "Microsoft Jenny Online (Natural)",
  "Microsoft Zira - English (United States)",
];

function pickVoice(): SpeechSynthesisVoice | null {
  const voices = window.speechSynthesis.getVoices();
  for (const name of PREFERRED_VOICES) {
    const match = voices.find((v) => v.name === name);
    if (match) return match;
  }
  return voices.find((v) => v.lang.startsWith("en")) ?? null;
}

export function useSpeech() {
  const [isSpeaking, setIsSpeaking] = useState(false);

  // Trigger voice list load — browsers load voices async on first call
  useEffect(() => {
    if (window.speechSynthesis.getVoices().length === 0) {
      const handler = () => {};
      window.speechSynthesis.addEventListener("voiceschanged", handler);
      return () => window.speechSynthesis.removeEventListener("voiceschanged", handler);
    }
  }, []);

  const speak = useCallback((text: string, onEnd?: () => void) => {
    if (!window.speechSynthesis) return;
    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate   = 0.88;
    utterance.pitch  = 1.12;
    utterance.volume = 1;

    const voice = pickVoice();
    if (voice) utterance.voice = voice;

    // Chrome pauses speechSynthesis after ~15 s — resume() keeps it going
    const resumeTimer = setInterval(() => {
      if (window.speechSynthesis.paused) window.speechSynthesis.resume();
    }, 5000);

    utterance.onstart = () => setIsSpeaking(true);
    utterance.onend = () => {
      clearInterval(resumeTimer);
      setIsSpeaking(false);
      onEnd?.();
    };
    utterance.onerror = () => {
      clearInterval(resumeTimer);
      setIsSpeaking(false);
    };

    setIsSpeaking(true);
    window.speechSynthesis.speak(utterance);
  }, []);

  const cancel = useCallback(() => {
    window.speechSynthesis?.cancel();
    setIsSpeaking(false);
  }, []);

  useEffect(() => () => { window.speechSynthesis?.cancel(); }, []);

  return { speak, cancel, isSpeaking };
}
