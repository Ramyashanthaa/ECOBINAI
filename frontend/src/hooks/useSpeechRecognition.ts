import { useCallback, useEffect, useRef, useState } from "react";

const YES_WORDS = ["yes", "yeah", "yep", "yup", "clean", "empty", "sure", "correct", "recycle"];
const NO_WORDS  = ["no", "nope", "nah", "dirty", "not clean", "trash", "contaminated", "residue"];

export type YesNoResult = "yes" | "no" | "unclear";

function parseYesNo(transcript: string): YesNoResult {
  const t = transcript.toLowerCase();
  const hasYes = YES_WORDS.some((w) => t.includes(w));
  const hasNo  = NO_WORDS.some((w) => t.includes(w));
  if (hasYes && !hasNo) return "yes";
  if (hasNo  && !hasYes) return "no";
  return "unclear";
}

interface Options {
  onAnswer: (answer: YesNoResult, transcript: string) => void;
}

export function useSpeechRecognition({ onAnswer }: Options) {
  const [isListening, setIsListening] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recRef = useRef<any>(null);

  const start = useCallback(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const SR = (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition;
    if (!SR) return;

    const rec = new SR();
    rec.lang = "en-US";
    rec.continuous = false;
    rec.interimResults = false;
    rec.maxAlternatives = 3;

    rec.onstart  = () => setIsListening(true);
    rec.onend    = () => setIsListening(false);
    rec.onerror  = () => setIsListening(false);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rec.onresult = (event: any) => {
      const transcripts: string[] = [];
      for (let i = 0; i < event.results.length; i++) {
        for (let j = 0; j < event.results[i].length; j++) {
          transcripts.push(event.results[i][j].transcript);
        }
      }
      const combined = transcripts.join(" ");
      onAnswer(parseYesNo(combined), combined);
    };

    recRef.current = rec;
    rec.start();
  }, [onAnswer]);

  const stop = useCallback(() => {
    recRef.current?.stop();
    setIsListening(false);
  }, []);

  useEffect(() => () => { recRef.current?.abort(); }, []);

  return { start, stop, isListening };
}
