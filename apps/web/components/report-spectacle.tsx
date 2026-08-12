"use client";

import { useEffect, useState } from "react";

const BURSTS = Array.from({ length: 11 }, (_, index) => index + 1);
const SPARKS = Array.from({ length: 16 }, (_, index) => index + 1);
const CONFETTI = Array.from({ length: 24 }, (_, index) => index + 1);

export const REPORT_SPECTACLE_EVENT = "koeki:reports-spectacle";

export function ReportSpectacle() {
  const [round, setRound] = useState(0);
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const replay = () => { setVisible(true); setRound((current) => current + 1); };
    window.addEventListener(REPORT_SPECTACLE_EVENT, replay);
    return () => window.removeEventListener(REPORT_SPECTACLE_EVENT, replay);
  }, []);

  useEffect(() => {
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const timeout = window.setTimeout(() => setVisible(false), reduceMotion ? 1_500 : 7_300);
    return () => window.clearTimeout(timeout);
  }, [round]);

  if (!visible) return null;
  return <div key={round} className="report-spectacle" data-round={round} role="status" aria-live="polite" aria-atomic="true" aria-label="pour toi KON keur. Si c'est pas ce que tu veux alors j'ai R compris.">
    <div className="report-spectacle-sky" aria-hidden="true" />
    <div className="report-spectacle-copy">
      <span>pour toi KON *keur*</span>
      <strong aria-hidden="true">♥</strong>
      <p><b>*keur*</b> si c&apos;est pas ce que tu veux alors j&apos;ai R compris</p>
    </div>
    <div className="report-fireworks" aria-hidden="true">
      {BURSTS.map((burst) => <div className={`report-firework report-firework-${burst}`} key={burst}>
        {SPARKS.map((spark) => <i className={`report-spark report-spark-${spark}`} key={spark} />)}
      </div>)}
      {CONFETTI.map((piece) => <i className={`report-confetti report-confetti-${piece}`} key={piece} />)}
      <span className="report-spectacle-heart heart-one">♥</span>
      <span className="report-spectacle-heart heart-two">♥</span>
      <span className="report-spectacle-heart heart-three">♥</span>
      <span className="report-spectacle-heart heart-four">♥</span>
    </div>
  </div>;
}
