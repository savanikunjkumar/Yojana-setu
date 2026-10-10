# Six-minute demo script

Exact click order, what to say, and what to do when the venue wifi dies.

**Before you walk up:** run `npm run demo:ready`. It must print `READY`. That one command starts
Postgres, verifies migrations, counts schemes, runs all 52 matcher assertions and checks the LLM
is reachable. If anything is red, fix it before you present, not during.

Have two tabs open: `http://localhost:3001` and `http://localhost:3001/data`.

---

## Why this order

The strongest moment goes first: **one click, and a 67-year-old widow in Madhya Pradesh sees the
widow pension at the top of her list, with the reason for every criterion and an honest badge
saying part of it is approximate.** That single screen contains the whole thesis — real data, a
deterministic match, an explanation, and a caveat we volunteered rather than hid.

Voice comes second, deliberately. It is the flashier moment but the fragile one: it needs a
microphone in a loud hall and a live network. Opening on something that always works buys you the
credibility to risk voice at minute two.

> If you have tested the mic in the actual room and it is quiet, swap beats 1 and 2. Otherwise
> don't.

---

## 0:00 – 0:35 · The problem

**Don't touch the laptop yet.** Say it to the judges, not the screen.

> "There are thousands of government schemes. Ask anyone here which ones they qualify for and
> they'll name two or three — the ones with advertising budgets. The rest may as well not exist.
> The barrier isn't eligibility, it's discovery.
>
> We scraped 149 real schemes off myScheme — 28 central, 121 state — and made them answerable in
> one question."

## 0:35 – 2:00 · The strongest moment: a real person, a real answer

Land on `http://localhost:3001`.

| Do                                                              | Say                                                                                                                                            |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Click **Kamala, 67** under "Try a ready-made profile"             | "Elderly widow, Madhya Pradesh, no land, income under fifty thousand."                                                                          |
| Let the results land (well under a second)                        | "Sixteen schemes she qualifies for, out of all 149 evaluated. That's one SQL query over the whole catalogue — no model decided this."           |
| Point at the **top card** — Indira Gandhi National Widow Pension  | "Top result is the widow pension. Not because we hard-coded her a demo answer — because it's the scheme that matched the most of her criteria." |
| Point at the **criterion chips** on the card                      | "Every criterion, individually: age passed, gender passed, state passed. If something failed, it says which one. Nobody gets a bare 'no'."      |
| Point at the **amber PROXY badge**                                | **This is the moment. Slow down.**                                                                                                              |

> "This badge is us telling on ourselves. This scheme actually selects on SECC deprivation
> criteria — landlessness, no adult earner, a kutcha house. We cannot ask an elderly woman those
> questions in a two-minute conversation. So we approximate it with an income ceiling, and then we
> say so, on the card. Ten schemes in the corpus are like this. We'd rather show an honest 'maybe'
> than a confident lie about someone's entitlement."

## 2:00 – 3:00 · Voice, in Hindi

Scroll to the voice console. Pick **हिन्दी** in the language selector.

| Do                          | Say                                                                                                              |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Press the mic, speak slowly | "मैं इकतालीस साल का किसान हूँ, बिहार के गया से, मेरे पास सवा हेक्टेयर ज़मीन है"                                   |
| Point at the profile panel filling in | "Age forty-one, occupation farmer, state Bihar, land 1.25 hectares — the fields highlight as they fill." |
| Point at the new results    | "And the matches changed underneath it. PM-KISAN is now top."                                                     |

Then the point most judges miss:

> "The model did exactly one job here: turning a sentence into five fields. It never saw a scheme
> and it never decided eligibility. That's still the SQL function. If the model hallucinates, the
> worst case is a wrong age we can correct in the form — not a citizen wrongly told they don't
> qualify for a pension."

**If it mishears a field:** don't fight it. Correct it in the form and say — *"and this is why
speaking and typing edit the same profile; voice is an input, not a separate system."* That
recovery reads as design, not as a save.

## 3:00 – 3:40 · The same engine, a different person

| Do                       | Say                                                                                                    |
| ------------------------ | ------------------------------------------------------------------------------------------------------ |
| Click **Priya, 19**      | "Same engine. SC student, UP. Top result: Post Matric Scholarship for Scheduled Caste Students."        |
| Click **Ramesh, 41**     | "Small farmer, Bihar. PM-KISAN and PM Awas come to the top. Eleven schemes, a completely different set." |
| Tick **"Also show schemes I just miss out on"** | "And this is the near-miss mode — schemes that failed on exactly one criterion, so you know what to change." |

> "Three people, three genuinely different answers, one query. Nothing here is a per-persona
> fixture."

## 3:40 – 4:30 · From "you qualify" to "here's how"

On any eligible card, click **Help me apply**.

> "Knowing you qualify is not the same as getting the benefit. This generates the document
> checklist for this specific scheme and this specific person, the portal link, and a printable
> summary they can carry to a CSC operator who fills the form for them."

Click **Print this summary** to show the print layout, then close the dialog.

## 4:30 – 5:20 · The honest slide

Switch to the `/data` tab.

| Do                                | Say                                                                                                                                               |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Point at **149**                   | "Every one matched on every search. No shortlist."                                                                                                   |
| Point at the **coverage bars**     | "Here's the part nobody puts on a slide. We extract an age bound from 50% of schemes. An income cap from 35%. Occupation from 26%."                  |
| Point at **land ceiling: 0%**      | "Zero. myScheme states land limits in acres and bighas inside prose, and our extractor refuses to guess a conversion it can't verify."               |
| Point at the **PROXY count: 10**   | "And the size of the caveat, published."                                                                                                             |

> "A missing rule never rejects anybody — it's reported as unverified and we ask one more
> question. Over-inclusion is recoverable. Wrongful exclusion isn't: you never learn the scheme
> existed, so you can't appeal it."

## 5:20 – 6:00 · Close

Back to the home tab.

> "Deterministic SQL decides eligibility, so every result is auditable and reproducible. The model
> only listens. Where the data model can't express a rule — 'SC/ST only if male' — we widen it and
> flag it rather than silently exclude someone. And where we approximate, we say we approximated.
>
> 149 schemes, thirteen languages targeted, and a worst-case voice turn of five seconds. Happy to
> go into any of it."

**Stop talking.** Leave the widow's result on screen — it's the best thing to be looking at during
Q&A.

---

## When the wifi dies

Offline mode serves a **recorded but genuine** path: real matches from the real scraped schemes,
produced by the real SQL matcher and captured by `capture-demo-snapshot.ts`. Nothing is invented.

```bash
# Ctrl-C the web app, then:
NEXT_PUBLIC_DEMO_OFFLINE=1 npm run dev
```

Everything in this script still works **except live voice** — the mic is honestly reported as
unavailable rather than pretending to listen. Beats affected:

| Beat                       | Offline                                                       |
| -------------------------- | --------------------------------------------------------------- |
| 0:35 personas, results      | Identical — recorded from the live system                        |
| 2:00 **voice**              | **Replaced.** Use the fallback line below                        |
| 3:00 persona contrast       | Identical                                                        |
| 3:40 application pack       | Works — the pack is in the snapshot                              |
| 4:30 `/data` page           | Works — the statistics are captured too                          |

**The voice fallback line**, said while clicking a persona instead:

> "We're offline right now, so I'm not going to fake a microphone. What you'd see is the transcript
> filling these same fields — the profile is the interface, and voice and typing write to it
> identically. Offline mode is deliberate, by the way: the last thing this should do in a village
> with one bar of signal is show a spinner."

That reframes the failure as a design position. It's a genuinely good answer.

## If something else breaks

| Symptom                    | Do this                                                                                    |
| -------------------------- | -------------------------------------------------------------------------------------------- |
| Voice turn hangs           | Wait — it self-cancels at 9 s and drops your transcript into the form pre-filled. Carry on.  |
| A panel shows an error box | It's an error boundary; the rest of the page is fine. Click "Try this panel again."          |
| Results are empty          | Press **Find my schemes** with an empty profile — an empty profile rules nothing out.        |
| API is down                | `npm run demo:ready` names what's missing. Failing that, restart in offline mode.            |
| Laptop rebooted            | `npm run demo:ready` brings Postgres back up from cold and re-verifies everything.           |
