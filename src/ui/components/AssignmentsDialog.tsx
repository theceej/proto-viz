import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { serializeStack } from '../../core/serialize';
import { QUIZ_APP, QUIZ_KIND, QUIZ_VERSION, exportQuizPackage, generateAssignmentQuestions, packageFilename, parseQuizPackage, type ParsedQuizPackage, type QuizPackage } from '../../core/assignmentQuiz';
import { answerQuestion, buildPrintableResult, createAttempt, moveAttempt, reviewAttempt, shuffledChoices, submitAttempt, validateIdentity, type QuizAttempt } from '../../core/quizAttempt';
import { loadQuizAttempt, saveQuizAttempt, saveQuizDraft } from '../../store/persistence';
import { useLibraryStore } from '../../store/libraryStore';
import { useStackStore } from '../../store/stackStore';
import { useHighlightStore } from '../../store/highlightStore';
import PlainHexView from './PlainHexView';

type Screen = 'home' | 'create' | 'identity' | 'resume' | 'attempt' | 'result';
const button = 'rounded-md border border-zinc-700 px-3 py-2 text-[13px] text-zinc-200 hover:border-cyan-600 hover:text-cyan-300';
const input = 'rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-[13px] text-zinc-100 outline-none focus:border-cyan-600';

export default function AssignmentsDialog({ onClose }: { onClose(): void }) {
  const registry = useLibraryStore((state) => state.registry); const custom = useLibraryStore((state) => state.custom);
  const layers = useStackStore((state) => state.layers); const trailingPayload = useStackStore((state) => state.trailingPayload);
  const [screen, setScreen] = useState<Screen>('home'); const [parsed, setParsed] = useState<ParsedQuizPackage | null>(null); const [attempt, setAttempt] = useState<QuizAttempt | null>(null); const [error, setError] = useState(''); const [identity, setIdentity] = useState({ name: '', email: '' });
  const [meta, setMeta] = useState({ title: '', description: '', educator: '', course: '', feedbackMode: 'instant' as QuizPackage['feedbackMode'] });
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => { const key = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); }; window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key); }, [onClose]);
  const persist = (next: QuizAttempt) => { setAttempt(next); void saveQuizAttempt(next).then((result) => { if (!result.ok) setError(`Could not save progress (${result.errorName}).`); }); };

  const openFile = async (file?: File) => {
    if (!file) return; setError('');
    if (!file.name.endsWith('.protoviz-quiz') && !file.name.endsWith('.json')) { setError('Choose a .protoviz-quiz or .json file.'); return; }
    try { const next = parseQuizPackage(await file.text()); setParsed(next); const saved = await loadQuizAttempt(next.fingerprint); if (saved.ok && saved.data) { setAttempt(saved.data); setScreen('resume'); } else setScreen('identity'); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not open package.'); }
  };
  const start = () => { if (!parsed || !validateIdentity(identity)) return; const next = createAttempt(parsed.quiz, parsed.fingerprint, identity); persist(next); setScreen('attempt'); };
  const create = () => {
    setError('');
    try {
      if (!meta.title.trim() || layers.length === 0) throw new Error('Add a title and ensure the Builder has at least one layer.');
      const stack = { layers, trailingPayload }; const packetBytes = serializeStack(stack, registry).bytes; const referenced = new Set(layers.map((layer) => layer.protocolId));
      const packet = { id: crypto.randomUUID(), label: 'Builder packet', source: { kind: 'builder' as const }, stack, expectedBytes: packetBytes };
      const quiz: QuizPackage = { app: QUIZ_APP, kind: QUIZ_KIND, version: QUIZ_VERSION, quizId: crypto.randomUUID(), ...meta, createdAt: new Date().toISOString(), customProtocols: custom.filter((definition) => referenced.has(definition.id)), packets: [packet], questions: generateAssignmentQuestions(packet, registry).slice(0, 20) };
      if (quiz.questions.length === 0) throw new Error('No valid questions could be generated from this stack.');
      const json = exportQuizPackage(quiz); void saveQuizDraft({ id: quiz.quizId, updatedAt: new Date().toISOString(), quiz });
      const link = document.createElement('a'); link.href = URL.createObjectURL(new Blob([json], { type: 'application/json' })); link.download = packageFilename(quiz.title); link.click(); URL.revokeObjectURL(link.href);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not create assignment.'); }
  };

  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section role="dialog" aria-modal="true" aria-labelledby="assignment-title" className="max-h-[92vh] w-full max-w-4xl overflow-auto rounded-xl border border-zinc-700 bg-zinc-900 p-5 text-zinc-200 shadow-2xl">
      <header className="mb-4 flex items-center justify-between"><h2 id="assignment-title" className="text-lg font-semibold">Assignments</h2><button className={button} onClick={onClose} aria-label="Close assignments">Close</button></header>
      {error && <p role="alert" className="mb-4 rounded-md border border-rose-700 bg-rose-950/30 p-3 text-[13px] text-rose-300">{error}</p>}
      {screen === 'home' && <div className="grid gap-3 sm:grid-cols-2"><button className={button} onClick={() => setScreen('create')}>Create assignment</button><button className={button} onClick={() => fileRef.current?.click()}>Open package</button><input ref={fileRef} className="sr-only" type="file" accept=".protoviz-quiz,.json,application/json" onChange={(event) => void openFile(event.target.files?.[0])} /><p className="sm:col-span-2 text-[12px] text-zinc-500">Packages are transparent local learning files. Answer keys are readable JSON; this is not a secure or proctored exam system.</p></div>}
      {screen === 'create' && <div className="grid gap-3"><p className="text-[13px] text-zinc-400">Create from the current Stack Builder packet. Candidate questions are generated from its serialized fields and layer boundaries.</p><label className="grid gap-1 text-[12px]">Title<input className={input} value={meta.title} onChange={(e) => setMeta({ ...meta, title: e.target.value })} /></label><label className="grid gap-1 text-[12px]">Description<textarea className={input} value={meta.description} onChange={(e) => setMeta({ ...meta, description: e.target.value })} /></label><div className="grid gap-3 sm:grid-cols-2"><label className="grid gap-1 text-[12px]">Educator<input className={input} value={meta.educator} onChange={(e) => setMeta({ ...meta, educator: e.target.value })} /></label><label className="grid gap-1 text-[12px]">Course<input className={input} value={meta.course} onChange={(e) => setMeta({ ...meta, course: e.target.value })} /></label></div><label className="grid gap-1 text-[12px]">Feedback<select className={input} value={meta.feedbackMode} onChange={(e) => setMeta({ ...meta, feedbackMode: e.target.value as QuizPackage['feedbackMode'] })}><option value="instant">Instant</option><option value="on-submit">After submission</option></select></label><div className="flex gap-2"><button className={button} onClick={create}>Validate and download</button><button className={button} onClick={() => setScreen('home')}>Back</button></div></div>}
      {screen === 'resume' && attempt && <div className="grid gap-3"><p>A saved attempt for <strong>{attempt.quiz.title}</strong> was found.</p><div className="flex gap-2"><button className={button} onClick={() => setScreen(attempt.submittedAt ? 'result' : 'attempt')}>Resume</button><button className={button} onClick={() => { setAttempt(null); setIdentity({ name: '', email: '' }); setScreen('identity'); }}>Restart</button></div></div>}
      {screen === 'identity' && parsed && <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); start(); }}><h3 className="font-medium">{parsed.quiz.title}</h3><p className="text-[13px] text-zinc-400">{parsed.quiz.description}</p><label className="grid gap-1 text-[12px]">Student name<input autoFocus className={input} required value={identity.name} onChange={(e) => setIdentity({ ...identity, name: e.target.value })} /></label><label className="grid gap-1 text-[12px]">Student email<input className={input} required type="email" value={identity.email} onChange={(e) => setIdentity({ ...identity, email: e.target.value })} /></label><button className={button} disabled={!validateIdentity(identity)}>Start assignment</button></form>}
      {screen === 'attempt' && attempt && <AttemptView attempt={attempt} onChange={persist} onDone={(next) => { persist(next); setScreen('result'); }} />}
      {screen === 'result' && attempt?.submittedAt && <ResultView attempt={attempt} />}
    </section>
  </div>;
}

function AttemptView({ attempt, onChange, onDone }: { attempt: QuizAttempt; onChange(value: QuizAttempt): void; onDone(value: QuizAttempt): void }) {
  const question = attempt.quiz.questions[attempt.currentPosition]!; const packet = attempt.quiz.packets.find((item) => item.id === question.packetId)!; const response = attempt.responses[question.id]; const reveal = attempt.quiz.feedbackMode === 'instant' && !!response; const choices = shuffledChoices(question, attempt.seed);
  return <div className="grid gap-5 lg:grid-cols-2"><section className="grid content-start gap-3"><p className="font-mono text-[11px] text-zinc-500">Question {attempt.currentPosition + 1} of {attempt.quiz.questions.length}</p><h3>{question.prompt}</h3>{choices.map((choice) => <button key={choice.id} disabled={response?.locked} className={`${button} text-left ${response?.choiceId === choice.id ? 'border-cyan-500' : ''} ${reveal && choice.id === question.correctChoiceId ? 'bg-emerald-950/40' : ''}`} onClick={() => onChange(answerQuestion(attempt, question.id, choice.id))}>{choice.label}</button>)}{reveal && <div role="status" className="rounded-md border border-zinc-700 p-3 text-[13px]"><p className={response.choiceId === question.correctChoiceId ? 'text-emerald-300' : 'text-rose-300'}>{response.choiceId === question.correctChoiceId ? 'Correct.' : 'Incorrect.'}</p><p>{question.explanation}</p><InspectButton attempt={attempt} /></div>}<div className="flex flex-wrap gap-2"><button className={button} disabled={attempt.currentPosition === 0} onClick={() => onChange(moveAttempt(attempt, attempt.currentPosition - 1))}>Previous</button><button className={button} disabled={attempt.currentPosition + 1 >= attempt.quiz.questions.length} onClick={() => onChange(moveAttempt(attempt, attempt.currentPosition + 1))}>Next</button><button className={button} onClick={() => onDone(submitAttempt(attempt))}>Submit assignment</button></div></section><section aria-label="Packet bytes" className="min-w-0 rounded-lg border border-zinc-800 bg-zinc-950/40 p-3"><PlainHexView bytes={packet.expectedBytes} ranges={[question.focus.byteRange]} muted={!reveal} /></section></div>;
}

function InspectButton({ attempt }: { attempt: QuizAttempt }) { const navigate = useNavigate(); const restore = useStackStore((state) => state.restoreStack); const lock = useHighlightStore((state) => state.toggleLocked); const question = attempt.quiz.questions[attempt.currentPosition]!; const packet = attempt.quiz.packets.find((item) => item.id === question.packetId)!; return <button className={`${button} mt-2`} onClick={() => { restore(packet.stack.layers, packet.stack.trailingPayload); const layer = useStackStore.getState().layers[question.focus.layerIndex]; if (layer && question.focus.fieldId) lock({ layerUid: layer.uid, fieldId: question.focus.fieldId }); navigate('/builder'); }}>Inspect targeted field in Stack Builder</button>; }

function ResultView({ attempt }: { attempt: QuizAttempt }) { const result = buildPrintableResult(attempt); const reviews = reviewAttempt(attempt); return <article className="quiz-print grid gap-4"><h3 className="text-xl font-semibold">{result.quiz.title}</h3><p>{result.student.name} · {result.student.email}</p><p>{result.quiz.educator}{result.quiz.course ? ` · ${result.quiz.course}` : ''}</p><p className="text-lg">Score: {result.score.correct}/{result.score.total} ({result.score.percentage}%)</p><dl className="text-[12px] text-zinc-400"><dt>Started</dt><dd>{result.startedAt}</dd><dt>Submitted</dt><dd>{result.submittedAt}</dd><dt>Attempt ID</dt><dd>{result.attemptId}</dd><dt>Package fingerprint</dt><dd>{result.packageFingerprint}</dd></dl><ol className="grid gap-3">{reviews.map((review, index) => <li key={review.question.id} className="rounded-md border border-zinc-700 p-3 text-[13px]"><strong>{index + 1}. {review.question.prompt}</strong><p>Selected: {review.selected?.label ?? 'No answer'} · Correct: {review.correct.label} · {review.verdict}</p><p>{review.question.explanation}</p></li>)}</ol><p className="text-[12px] text-zinc-500">{result.disclosure}</p><button className={`${button} print:hidden`} onClick={() => window.print()}>Print or save as PDF</button></article>; }
