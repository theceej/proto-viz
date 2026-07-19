import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export const TOUR_COMPLETE_KEY = 'pv-builder-tour-complete';

const STEPS = [
  { path: '/builder', title: 'Build a protocol stack', text: 'Start with a preset, add layers, or generate a valid random stack. The strip checks whether each protocol can legally carry the next.' },
  { path: '/builder', title: 'Edit and inspect', text: 'Edit fields on the left, read the synchronized bit diagram, and select exact hex or ASCII bytes on the right. Compact, Explain, and Deep control how much interpretation you see.' },
  { path: '/library', title: 'Browse the protocol library', text: 'Explore built-in and imported protocols, their field layouts, encapsulation rules, and source references.' },
  { path: '/import', title: 'Import a specification', text: 'Turn a TXT, HTML, DOCX, or PDF packet diagram into a reviewable custom protocol without uploading it anywhere.' },
  { path: '/help', title: 'Help is always here', text: 'Find workflows, privacy details, and keyboard shortcuts here. You can restart this tour whenever you like.' },
];

export default function BuilderTour({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState(0);
  const nextRef = useRef<HTMLButtonElement>(null);
  const navigate = useNavigate();
  const current = STEPS[step]!;

  useEffect(() => {
    navigate(current.path);
    nextRef.current?.focus();
  }, [current.path, navigate]);

  const finish = () => {
    localStorage.setItem(TOUR_COMPLETE_KEY, 'true');
    onClose();
  };

  return (
    <aside
      className="fixed right-4 bottom-4 z-40 w-[min(24rem,calc(100vw-2rem))] rounded-xl border border-cyan-800 bg-zinc-950 p-4 shadow-2xl shadow-black/70"
      role="region"
      aria-labelledby="app-tour-title"
    >
      <button
        className="absolute top-2 right-2 cursor-pointer rounded p-1 text-zinc-500 hover:text-zinc-200"
        aria-label="Skip guided tour"
        onClick={finish}
      >
        <X className="size-4" />
      </button>
      <p className="text-[10px] font-medium tracking-widest text-zinc-500 uppercase">
        Quick tour · {step + 1} of {STEPS.length}
      </p>
      <h2 id="app-tour-title" className="mt-1 text-sm font-semibold text-zinc-100">
        {current.title}
      </h2>
      <p className="mt-2 text-[12px] leading-relaxed text-zinc-400">{current.text}</p>
      <div className="mt-4 flex items-center gap-1.5">
        {STEPS.map((item, index) => (
          <span
            key={item.title}
            className={`h-1.5 rounded-full ${index === step ? 'w-5 bg-cyan-400' : 'w-1.5 bg-zinc-700'}`}
          />
        ))}
        <button
          className="ml-auto cursor-pointer rounded-md bg-cyan-700 px-3 py-1.5 text-[12px] font-medium text-white hover:bg-cyan-600"
          ref={nextRef}
          onClick={() => (step === STEPS.length - 1 ? finish() : setStep(step + 1))}
        >
          {step === STEPS.length - 1 ? 'Start exploring' : 'Next'}
        </button>
      </div>
    </aside>
  );
}
