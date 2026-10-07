import { useEffect, useMemo, useRef, useState } from 'react';
import { createBuiltinRegistry } from '../../protocols';
import {
  createAssignmentDraft,
  createManualQuestion,
  referencedQuizProtocols,
  reviewAssignment,
  savedAssignmentStack,
  snapshotAssignmentPacket,
} from '../../core/assignmentAuthoring';
import {
  exportQuizPackage,
  generateAssignmentQuestions,
  packageFilename,
  QUIZ_MAX_PACKETS,
  QUIZ_MAX_QUESTIONS,
  type AssignmentPacket,
  type AssignmentQuestion,
  type QuizPackage,
} from '../../core/assignmentQuiz';
import { serializeStack } from '../../core/serialize';
import type { Registry } from '../../core/registry';
import { useLibraryStore } from '../../store/libraryStore';
import { useStackStore } from '../../store/stackStore';
import { loadComposedScenario } from '../../store/composedScenarioPersistence';
import {
  loadSavedStacks,
  saveQuizDraft,
  type QuizDraft,
  type SavedStack,
} from '../../store/persistence';

const button =
  'rounded-md border border-zinc-700 px-3 py-2 text-[13px] text-zinc-200 hover:border-cyan-600 hover:text-cyan-300 disabled:opacity-50';
const input =
  'w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-[13px] text-zinc-100 focus:outline-2 focus:outline-cyan-600';
const steps = ['details', 'packets', 'questions', 'review'] as const;
type Step = (typeof steps)[number];
const stepLabels = {
  details: 'Details',
  packets: 'Packets',
  questions: 'Questions',
  review: 'Review',
};

export default function AssignmentAuthoring({
  draft,
  onBack,
}: {
  draft: QuizDraft | null;
  onBack(): void;
}) {
  const [quiz, setQuiz] = useState(() => draft?.quiz ?? createAssignmentDraft());
  const [step, setStep] = useState<Step>(() => draft?.authoringStep ?? 'details');
  const [selectedQuestion, setSelectedQuestion] = useState(() =>
    Math.max(
      0,
      draft?.quiz.questions.findIndex((item) => item.id === draft.authoringQuestionId) ?? 0,
    ),
  );
  const [savedStacks, setSavedStacks] = useState<SavedStack[]>([]);
  const [scenario, setScenario] = useState(loadComposedScenario);
  const [sourceStatus, setSourceStatus] = useState('Loading saved packets…');
  const [error, setError] = useState('');
  const [saveStatus, setSaveStatus] = useState('Saving draft…');
  const heading = useRef<HTMLHeadingElement>(null);
  const latestDraft = useRef<QuizDraft | null>(null);
  const revision = useRef(0);
  const custom = useLibraryStore((state) => state.custom);
  const layers = useStackStore((state) => state.layers);
  const trailingPayload = useStackStore((state) => state.trailingPayload);
  // A resumed draft keeps its own protocol definitions even if the library
  // has since changed or removed them.
  const definitions = useMemo(
    () => [
      ...custom.filter((item) => !quiz.customProtocols.some((bundled) => bundled.id === item.id)),
      ...quiz.customProtocols,
    ],
    [custom, quiz.customProtocols],
  );
  const registry = useMemo(() => createBuiltinRegistry(definitions), [definitions]);

  const loadSources = () => {
    setScenario(loadComposedScenario());
    void loadSavedStacks().then((result) => {
      if (result.ok) {
        setSavedStacks(result.data);
        setSourceStatus('');
      } else setSourceStatus(`Could not read saved packets (${result.errorName}).`);
    });
  };
  useEffect(() => {
    let active = true;
    void loadSavedStacks().then((result) => {
      if (!active) return;
      if (result.ok) {
        setSavedStacks(result.data);
        setSourceStatus('');
      } else setSourceStatus(`Could not read saved packets (${result.errorName}).`);
    });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    heading.current?.focus();
  }, [step]);

  useEffect(() => {
    const current = ++revision.current;
    const record: QuizDraft = {
      id: quiz.quizId,
      updatedAt: new Date().toISOString(),
      quiz,
      authoringStep: step,
      authoringQuestionId:
        quiz.questions[Math.min(selectedQuestion, quiz.questions.length - 1)]?.id,
    };
    latestDraft.current = record;
    const save = () => {
      void saveQuizDraft(record).then((result) => {
        if (revision.current === current)
          setSaveStatus(
            result.ok
              ? 'Draft saved'
              : `Draft could not be saved (${result.errorName}). Keep this window open and try saving again.`,
          );
      });
    };
    const timer = window.setTimeout(save, 300);
    return () => window.clearTimeout(timer);
  }, [quiz, step, selectedQuestion]);

  useEffect(
    () => () => {
      const record = latestDraft.current;
      if (record) void saveQuizDraft({ ...record, updatedAt: new Date().toISOString() });
    },
    [],
  );

  const update = (next: QuizPackage) => {
    revision.current++;
    setQuiz(next);
    setSaveStatus('Saving draft…');
    setError('');
  };
  const go = (next: Step) => {
    if (next === step) return;
    revision.current++;
    setStep(next);
    setSaveStatus('Saving draft…');
    setError('');
  };
  const addPacket = (packet: AssignmentPacket) => {
    if (quiz.packets.length >= QUIZ_MAX_PACKETS) {
      setError(`Assignments support up to ${QUIZ_MAX_PACKETS} packets.`);
      return;
    }
    const packets = [...quiz.packets, packet];
    const candidates = generateAssignmentQuestions(packet, registry).slice(0, 20);
    update({
      ...quiz,
      packets,
      customProtocols: referencedQuizProtocols(packets, definitions),
      questions: [...quiz.questions, ...candidates].slice(0, QUIZ_MAX_QUESTIONS),
    });
  };
  const capture = (
    label: string,
    source: AssignmentPacket['source'],
    stack: Parameters<typeof snapshotAssignmentPacket>[2],
  ) => {
    try {
      addPacket(snapshotAssignmentPacket(label, source, stack, registry));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not add packet.');
    }
  };
  const questionIndex = Math.min(selectedQuestion, Math.max(0, quiz.questions.length - 1));
  const question = quiz.questions[questionIndex];
  const editQuestion = (next: AssignmentQuestion) =>
    update({
      ...quiz,
      questions: quiz.questions.map((item) => (item.id === next.id ? next : item)),
    });
  const moveQuestion = (offset: number) => {
    const questions = [...quiz.questions];
    const destination = questionIndex + offset;
    if (destination < 0 || destination >= questions.length) return;
    [questions[questionIndex], questions[destination]] = [
      questions[destination]!,
      questions[questionIndex]!,
    ];
    update({ ...quiz, questions });
    setSelectedQuestion(destination);
  };
  const diagnostics = useMemo(
    () => (step === 'review' ? reviewAssignment(quiz, registry) : []),
    [step, quiz, registry],
  );
  const download = () => {
    try {
      if (reviewAssignment(quiz, registry).some((item) => item.severity === 'error'))
        throw new Error('Resolve the validation errors before downloading.');
      const json = exportQuizPackage(quiz);
      const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = packageFilename(quiz.title);
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not export assignment.');
    }
  };

  return (
    <div className="grid gap-5">
      <nav aria-label="Assignment authoring steps" className="flex flex-wrap gap-2">
        {steps.map((item, index) => (
          <button
            key={item}
            className={`${button} ${step === item ? 'border-cyan-600 bg-zinc-800 font-semibold' : ''}`}
            aria-current={step === item ? 'step' : undefined}
            onClick={() => go(item)}
          >
            {index + 1}. {stepLabels[item]}
          </button>
        ))}
      </nav>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 ref={heading} tabIndex={-1} className="text-lg font-semibold">
          {stepLabels[step]}
        </h3>
        <p role="status" className="text-[12px] text-zinc-400">
          {saveStatus}
        </p>
      </div>
      {saveStatus.startsWith('Draft could not') && (
        <button className={button} onClick={() => update({ ...quiz })}>
          Retry saving draft
        </button>
      )}
      {error && (
        <p role="alert" className="text-rose-300">
          {error}
        </p>
      )}

      {step === 'details' && (
        <div className="grid gap-3">
          <p className="text-[13px] text-zinc-400">
            Choose your packets, review the generated questions, and tailor the assignment before
            downloading.
          </p>
          <label>
            Title
            <input
              className={input}
              value={quiz.title}
              onChange={(event) => update({ ...quiz, title: event.target.value })}
            />
          </label>
          <label>
            Description
            <textarea
              className={input}
              value={quiz.description}
              onChange={(event) => update({ ...quiz, description: event.target.value })}
            />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label>
              Educator
              <input
                className={input}
                value={quiz.educator}
                onChange={(event) => update({ ...quiz, educator: event.target.value })}
              />
            </label>
            <label>
              Course
              <input
                className={input}
                value={quiz.course}
                onChange={(event) => update({ ...quiz, course: event.target.value })}
              />
            </label>
          </div>
          <label>
            Feedback
            <select
              className={input}
              value={quiz.feedbackMode}
              onChange={(event) =>
                update({
                  ...quiz,
                  feedbackMode: event.target.value as QuizPackage['feedbackMode'],
                })
              }
            >
              <option value="instant">Instant</option>
              <option value="on-submit">After submission</option>
            </select>
          </label>
        </div>
      )}

      {step === 'packets' && (
        <div className="grid gap-4">
          <p className="text-[13px] text-zinc-400">
            Each selection copies the packet as it is now. Later Builder edits won’t change your
            assignment.
          </p>
          <button
            className={button}
            disabled={!layers.length}
            onClick={() =>
              capture('Builder packet', { kind: 'builder' }, { layers, trailingPayload })
            }
          >
            Add current Builder packet
          </button>
          <section aria-label="Saved packet sources" className="grid gap-2">
            <h4 className="font-semibold">Saved stacks</h4>
            {sourceStatus && <p>{sourceStatus}</p>}
            {!sourceStatus && !savedStacks.length && (
              <p className="text-[13px] text-zinc-400">
                No saved stacks yet. Save a packet in Stack Builder to use it here.
              </p>
            )}
            {savedStacks.map((saved) => (
              <button
                className={button}
                key={saved.id}
                onClick={() =>
                  capture(
                    saved.name,
                    { kind: 'saved-stack', id: saved.id, label: saved.name },
                    savedAssignmentStack(saved),
                  )
                }
              >
                Add saved stack: {saved.name}
              </button>
            ))}
          </section>
          <section aria-label="Scenario packet sources" className="grid gap-2">
            <h4 className="font-semibold">Composed scenario</h4>
            {scenario ? (
              <>
                <p className="text-[13px]">{scenario.name}</p>
                {scenario.steps.map((item, index) => (
                  <button
                    key={item.id}
                    className={button}
                    onClick={() =>
                      capture(
                        item.label,
                        {
                          kind: 'scenario',
                          id: `${scenario.id}/${item.id}`,
                          label: scenario.name,
                        },
                        item.stack,
                      )
                    }
                  >
                    Add scenario step {index + 1}: {item.label}
                  </button>
                ))}
              </>
            ) : (
              <p className="text-[13px] text-zinc-400">
                Save a composed scenario to select its steps here.
              </p>
            )}
          </section>
          <button className={button} onClick={loadSources}>
            Reload packet sources
          </button>
          <section aria-label="Selected assignment packets" className="grid gap-3">
            <h4 className="font-semibold">Selected packets ({quiz.packets.length})</h4>
            {quiz.packets.map((packet, index) => (
              <div
                key={packet.id}
                className="flex flex-wrap items-end gap-2 rounded-md border border-zinc-700 p-3"
              >
                <label className="min-w-0 flex-1">
                  Packet {index + 1} label
                  <input
                    className={input}
                    value={packet.label}
                    onChange={(event) =>
                      update({
                        ...quiz,
                        packets: quiz.packets.map((item) =>
                          item.id === packet.id ? { ...item, label: event.target.value } : item,
                        ),
                      })
                    }
                  />
                </label>
                <span className="text-[12px] text-zinc-400">
                  {
                    { builder: 'Builder', 'saved-stack': 'Saved stack', scenario: 'Scenario' }[
                      packet.source.kind
                    ]
                  }{' '}
                  · {packet.expectedBytes.length} bytes
                </span>
                <button
                  className={button}
                  aria-label={`Remove packet ${index + 1} and its questions`}
                  onClick={() => {
                    const packets = quiz.packets.filter((item) => item.id !== packet.id);
                    update({
                      ...quiz,
                      packets,
                      questions: quiz.questions.filter((item) => item.packetId !== packet.id),
                      customProtocols: referencedQuizProtocols(packets, definitions),
                    });
                  }}
                >
                  Remove
                </button>
              </div>
            ))}
          </section>
        </div>
      )}

      {step === 'questions' && (
        <div className="grid gap-4">
          <p className="text-[13px] text-zinc-400">
            Candidate questions were generated for each packet. Edit or remove them, or add your own
            multiple-choice question.
          </p>
          <button
            className={button}
            disabled={!quiz.packets.length || quiz.questions.length >= QUIZ_MAX_QUESTIONS}
            onClick={() => {
              const questions = [
                ...quiz.questions,
                createManualQuestion(quiz.packets[0]!, registry),
              ];
              update({ ...quiz, questions });
              setSelectedQuestion(questions.length - 1);
            }}
          >
            Add manual question
          </button>
          {!quiz.packets.length && <p>Select a packet before adding questions.</p>}
          <label>
            Question to edit
            <select
              className={input}
              value={question?.id ?? ''}
              disabled={!question}
              onChange={(event) => {
                revision.current++;
                setSaveStatus('Saving draft…');
                setSelectedQuestion(
                  quiz.questions.findIndex((item) => item.id === event.target.value),
                );
              }}
            >
              {!question && <option value="">No questions</option>}
              {quiz.questions.map((item, index) => (
                <option key={item.id} value={item.id}>
                  {index + 1}. {item.prompt || 'New question'}
                </option>
              ))}
            </select>
          </label>
          {question && (
            <>
              <QuestionEditor
                key={question.id}
                question={question}
                packets={quiz.packets}
                registry={registry}
                onChange={editQuestion}
              />
              <div className="flex flex-wrap gap-2">
                <button
                  className={button}
                  disabled={questionIndex === 0}
                  onClick={() => moveQuestion(-1)}
                >
                  Move question earlier
                </button>
                <button
                  className={button}
                  disabled={questionIndex === quiz.questions.length - 1}
                  onClick={() => moveQuestion(1)}
                >
                  Move question later
                </button>
                <button
                  className={button}
                  onClick={() =>
                    update({
                      ...quiz,
                      questions: quiz.questions.filter((item) => item.id !== question.id),
                    })
                  }
                >
                  Remove question
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {step === 'review' && (
        <section aria-label="Assignment validation" className="grid gap-3">
          <p>
            {quiz.packets.length} packets · {quiz.questions.length} questions ·{' '}
            {quiz.customProtocols.length} bundled custom protocols
          </p>
          <p className="text-[13px] text-zinc-400">
            Packet warnings may be intentional teaching material. Package errors must be resolved
            before export.
          </p>
          {diagnostics.length ? (
            <ul className="grid gap-2">
              {diagnostics.map((item, index) => (
                <li
                  key={index}
                  className={item.severity === 'error' ? 'text-rose-300' : 'text-amber-300'}
                >
                  {item.severity === 'error' ? 'Error' : 'Warning'}: {item.message}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-emerald-300">Ready to download. Package validation passed.</p>
          )}
          <button
            className={button}
            disabled={diagnostics.some((item) => item.severity === 'error')}
            onClick={download}
          >
            Download assignment
          </button>
        </section>
      )}

      <footer className="flex flex-wrap gap-2 border-t border-zinc-700 pt-4">
        <button
          className={button}
          onClick={async () => {
            const result = await saveQuizDraft({
              id: quiz.quizId,
              updatedAt: new Date().toISOString(),
              quiz,
              authoringStep: step,
              authoringQuestionId: question?.id,
            });
            if (result.ok) onBack();
            else
              setSaveStatus(
                `Draft could not be saved (${result.errorName}). Keep this window open and try saving again.`,
              );
          }}
        >
          Back to assignments
        </button>
        {step !== 'details' && (
          <button className={button} onClick={() => go(steps[steps.indexOf(step) - 1]!)}>
            Previous step
          </button>
        )}
        {step !== 'review' && (
          <button className={button} onClick={() => go(steps[steps.indexOf(step) + 1]!)}>
            Next step
          </button>
        )}
      </footer>
    </div>
  );
}

function QuestionEditor({
  question,
  packets,
  registry,
  onChange,
}: {
  question: AssignmentQuestion;
  packets: AssignmentPacket[];
  registry: Registry;
  onChange(value: AssignmentQuestion): void;
}) {
  const packet = packets.find((item) => item.id === question.packetId)!;
  const serialized = useMemo(
    () => serializeStack(packet.stack, registry),
    [packet.stack, registry],
  );
  const layer = packet.stack.layers[question.focus.layerIndex];
  const fields = registry.get(layer?.protocolId ?? '')?.fields ?? [];
  const focusLayer = (layerIndex: number) => {
    const layout = serialized.layers[layerIndex]!;
    onChange({
      ...question,
      focus: {
        layerIndex,
        byteRange: { offset: layout.byteOffset, length: layout.headerBytes },
      },
    });
  };
  return (
    <section
      aria-label="Question editor"
      className="grid gap-3 rounded-md border border-zinc-700 p-3"
    >
      <p className="text-[12px] text-zinc-400">
        {question.kind === 'multiple-choice'
          ? 'Manual multiple-choice question'
          : `Generated candidate: ${question.kind}`}
      </p>
      <label>
        Question packet
        <select
          className={input}
          value={packet.id}
          onChange={(event) => {
            const next = packets.find((item) => item.id === event.target.value)!;
            const layout = serializeStack(next.stack, registry).layers[0]!;
            onChange({
              ...question,
              packetId: next.id,
              focus: {
                layerIndex: 0,
                byteRange: {
                  offset: layout.byteOffset,
                  length: layout.headerBytes,
                },
              },
            });
          }}
        >
          {packets.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        Prompt
        <textarea
          className={input}
          value={question.prompt}
          onChange={(event) => onChange({ ...question, prompt: event.target.value })}
        />
      </label>
      <fieldset className="grid gap-2">
        <legend className="mb-2 font-semibold">Answer choices</legend>
        {question.choices.map((choice, index) => (
          <div key={choice.id} className="flex items-end gap-2">
            <label className="min-w-0 flex-1">
              Choice {index + 1}
              <input
                className={input}
                value={choice.label}
                onChange={(event) =>
                  onChange({
                    ...question,
                    choices: question.choices.map((item) =>
                      item.id === choice.id ? { ...item, label: event.target.value } : item,
                    ),
                  })
                }
              />
            </label>
            <button
              className={button}
              disabled={question.choices.length <= 2}
              aria-label={`Remove choice ${index + 1}`}
              onClick={() => {
                const choices = question.choices.filter((item) => item.id !== choice.id);
                onChange({
                  ...question,
                  choices,
                  correctChoiceId:
                    question.correctChoiceId === choice.id
                      ? choices[0]!.id
                      : question.correctChoiceId,
                });
              }}
            >
              Remove
            </button>
          </div>
        ))}
        <button
          className={button}
          disabled={question.choices.length >= 6}
          onClick={() =>
            onChange({
              ...question,
              choices: [...question.choices, { id: crypto.randomUUID(), label: '' }],
            })
          }
        >
          Add answer choice
        </button>
      </fieldset>
      <label>
        Correct answer
        <select
          className={input}
          value={question.correctChoiceId}
          onChange={(event) => onChange({ ...question, correctChoiceId: event.target.value })}
        >
          {question.choices.map((choice, index) => (
            <option key={choice.id} value={choice.id}>
              {index + 1}. {choice.label || 'Empty choice'}
            </option>
          ))}
        </select>
      </label>
      <label>
        Explanation
        <textarea
          className={input}
          value={question.explanation}
          onChange={(event) => onChange({ ...question, explanation: event.target.value })}
        />
      </label>
      <fieldset className="grid gap-3">
        <legend className="mb-2 font-semibold">Inspection target</legend>
        <label>
          Focus layer
          <select
            className={input}
            value={question.focus.layerIndex}
            onChange={(event) => focusLayer(Number(event.target.value))}
          >
            {packet.stack.layers.map((item, index) => (
              <option key={item.uid} value={index}>
                {index + 1}. {registry.get(item.protocolId)?.name ?? item.protocolId}
              </option>
            ))}
          </select>
        </label>
        <label>
          Focus field
          <select
            className={input}
            value={question.focus.fieldId ?? ''}
            onChange={(event) => {
              const fieldId = event.target.value;
              if (!fieldId) {
                focusLayer(question.focus.layerIndex);
                return;
              }
              const span = serialized.spans.find(
                (item) => item.layerUid === layer?.uid && item.fieldId === fieldId,
              )!;
              onChange({
                ...question,
                focus: {
                  ...question.focus,
                  fieldId,
                  byteRange: {
                    offset: Math.floor(span.bitOffset / 8),
                    length: Math.ceil(((span.bitOffset % 8) + span.bitLength) / 8),
                  },
                },
              });
            }}
          >
            <option value="">Whole layer</option>
            {fields
              .filter((field) =>
                serialized.spans.some(
                  (span) => span.layerUid === layer?.uid && span.fieldId === field.id,
                ),
              )
              .map((field) => (
                <option key={field.id} value={field.id}>
                  {field.name}
                </option>
              ))}
          </select>
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label>
            Focus byte offset
            <input
              className={input}
              type="number"
              min={0}
              value={question.focus.byteRange.offset}
              onChange={(event) =>
                onChange({
                  ...question,
                  focus: {
                    ...question.focus,
                    byteRange: {
                      ...question.focus.byteRange,
                      offset: event.target.value === '' ? -1 : Number(event.target.value),
                    },
                  },
                })
              }
            />
          </label>
          <label>
            Focus byte length
            <input
              className={input}
              type="number"
              min={0}
              value={question.focus.byteRange.length}
              onChange={(event) =>
                onChange({
                  ...question,
                  focus: {
                    ...question.focus,
                    byteRange: {
                      ...question.focus.byteRange,
                      length: event.target.value === '' ? -1 : Number(event.target.value),
                    },
                  },
                })
              }
            />
          </label>
        </div>
      </fieldset>
    </section>
  );
}
