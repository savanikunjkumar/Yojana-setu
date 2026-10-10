import type { NextQuestion } from '@sih/shared';

/**
 * The single most useful follow-up question, chosen by the API from the criteria
 * that are still UNKNOWN across otherwise-matching schemes.
 *
 * This is the hand-off point for the voice layer: it speaks `question` (or
 * `questionHi`), transcribes the answer into `field`, and re-runs the match.
 */
export function NextQuestionBanner({
  question,
  language,
  onFocusField,
}: {
  question: NextQuestion;
  /** BCP-47 tag from the language picker; decides which line gets top billing. */
  language: string;
  onFocusField: (field: string) => void;
}) {
  const hindiFirst = language.startsWith('hi');
  const primary = hindiFirst ? question.questionHi : question.question;
  const secondary = hindiFirst ? question.question : question.questionHi;

  return (
    <aside className="border-2 border-saffron/40 bg-saffron/[0.06] p-4 sm:p-5" aria-live="polite">
      <p className="label-caps text-saffron">
        Answer one more thing to settle {question.unlocks}{' '}
        {question.unlocks === 1 ? 'scheme' : 'schemes'}
      </p>

      <p
        lang={hindiFirst ? 'hi' : 'en'}
        className="mt-2 font-display text-lg font-bold leading-snug text-ink sm:text-xl"
      >
        {primary}
      </p>
      <p lang={hindiFirst ? 'en' : 'hi'} className="mt-1 font-display text-base text-ink-soft">
        {secondary}
      </p>

      <button
        type="button"
        onClick={() => onFocusField(question.field)}
        className="mt-3 min-h-[3rem] border-2 border-saffron px-4 font-sans font-semibold text-saffron transition-colors hover:bg-saffron hover:text-paper"
      >
        Answer it now
      </button>
    </aside>
  );
}
