import type { AssignmentChoice, AssignmentQuestion, QuizPackage } from './assignmentQuiz';

export interface StudentIdentity { name: string; email: string }
export interface QuizResponse { choiceId: string; answeredAt: string; locked: boolean }
export interface QuizAttempt {
  id: string; packageFingerprint: string; quiz: QuizPackage; identity: StudentIdentity;
  seed: number; responses: Record<string, QuizResponse>; currentPosition: number;
  startedAt: string; updatedAt: string; submittedAt?: string;
}
export interface AttemptScore { correct: number; total: number; percentage: number }
export interface QuestionReview { question: AssignmentQuestion; selected?: AssignmentChoice; correct: AssignmentChoice; verdict: 'correct' | 'incorrect' | 'unanswered' }
export interface PrintableQuizResult {
  student: StudentIdentity; quiz: Pick<QuizPackage, 'quizId' | 'title' | 'educator' | 'course'>;
  startedAt: string; submittedAt: string; score: AttemptScore; questions: QuestionReview[];
  attemptId: string; packageFingerprint: string; disclosure: string;
}

export function validateIdentity(identity: StudentIdentity): boolean {
  return identity.name.trim().length > 0 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identity.email.trim());
}

export function createAttempt(quiz: QuizPackage, packageFingerprint: string, identity: StudentIdentity, now = new Date().toISOString(), seed = randomSeed()): QuizAttempt {
  if (!validateIdentity(identity)) throw new Error('A student name and valid email are required.');
  return { id: crypto.randomUUID(), packageFingerprint, quiz, identity: { name: identity.name.trim(), email: identity.email.trim() }, seed, responses: {}, currentPosition: 0, startedAt: now, updatedAt: now };
}

/** Stable per attempt and question; author-defined question order is untouched. */
export function shuffledChoices(question: AssignmentQuestion, seed: number): AssignmentChoice[] {
  const rng = mulberry32(seed ^ hashString(question.id)); const choices = [...question.choices];
  for (let i = choices.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [choices[i], choices[j]] = [choices[j]!, choices[i]!]; }
  return choices;
}

export function answerQuestion(attempt: QuizAttempt, questionId: string, choiceId: string, now = new Date().toISOString()): QuizAttempt {
  if (attempt.submittedAt) return attempt;
  const question = attempt.quiz.questions.find((item) => item.id === questionId);
  if (!question || !question.choices.some((choice) => choice.id === choiceId)) throw new Error('Invalid quiz answer.');
  if (attempt.responses[questionId]?.locked) return attempt;
  const locked = attempt.quiz.feedbackMode === 'instant';
  return { ...attempt, responses: { ...attempt.responses, [questionId]: { choiceId, answeredAt: now, locked } }, updatedAt: now };
}

export function moveAttempt(attempt: QuizAttempt, position: number, now = new Date().toISOString()): QuizAttempt {
  const max = Math.max(0, attempt.quiz.questions.length - 1);
  return { ...attempt, currentPosition: Math.max(0, Math.min(max, Math.trunc(position))), updatedAt: now };
}

export function scoreAttempt(attempt: QuizAttempt): AttemptScore {
  const total = attempt.quiz.questions.length;
  const correct = attempt.quiz.questions.reduce((sum, question) => sum + (attempt.responses[question.id]?.choiceId === question.correctChoiceId ? 1 : 0), 0);
  return { correct, total, percentage: total === 0 ? 0 : Math.round((correct / total) * 100) };
}

export function submitAttempt(attempt: QuizAttempt, now = new Date().toISOString()): QuizAttempt {
  if (attempt.submittedAt) return attempt;
  return { ...attempt, submittedAt: now, updatedAt: now, responses: Object.fromEntries(Object.entries(attempt.responses).map(([id, response]) => [id, { ...response, locked: true }])) };
}

export function reviewAttempt(attempt: QuizAttempt): QuestionReview[] {
  if (attempt.quiz.feedbackMode === 'on-submit' && !attempt.submittedAt) return [];
  return attempt.quiz.questions.map((question) => {
    const selectedId = attempt.responses[question.id]?.choiceId; const selected = question.choices.find((choice) => choice.id === selectedId); const correct = question.choices.find((choice) => choice.id === question.correctChoiceId)!;
    return { question, ...(selected ? { selected } : {}), correct, verdict: !selected ? 'unanswered' : selected.id === correct.id ? 'correct' : 'incorrect' };
  });
}

export function buildPrintableResult(attempt: QuizAttempt): PrintableQuizResult {
  if (!attempt.submittedAt) throw new Error('Submit the attempt before creating a result.');
  return { student: attempt.identity, quiz: { quizId: attempt.quiz.quizId, title: attempt.quiz.title, educator: attempt.quiz.educator, course: attempt.quiz.course }, startedAt: attempt.startedAt, submittedAt: attempt.submittedAt, score: scoreAttempt(attempt), questions: reviewAttempt(attempt), attemptId: attempt.id, packageFingerprint: attempt.packageFingerprint, disclosure: 'This report was generated locally and is not cryptographically verified.' };
}

const randomSeed = () => crypto.getRandomValues(new Uint32Array(1))[0]!;
function hashString(value: string): number { let hash = 0; for (let i = 0; i < value.length; i++) hash = Math.imul(31, hash) + value.charCodeAt(i) | 0; return hash; }
function mulberry32(seed: number): () => number { return () => { seed |= 0; seed = seed + 0x6d2b79f5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

