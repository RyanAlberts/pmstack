# Reviewing traces

Reference for `pmstack-error-discovery`: what to tell the reviewer, how good notes read, how to coach, and how to read notes when grouping them. Examples come from the Maple Dental booking assistant (patients book, move, or cancel appointments by text, web chat, or phone).

## Briefing

Send the reviewer a short message with this content, in your own words, using the project's user word in place of {userLabel}:

- **Read** each trace the way the {userLabel} saw it. Press H to show the steps behind a reply (tool calls, look-ups) when you want to know what the AI saw.
- **Write the note first**, in the box at the top of the right panel: the first thing that went wrong, from the {userLabel}'s side, specific enough that a new teammate would understand it.
- **Then pick a verdict**: 1 Good, 2 Problem, 3 (or D) Not sure yet. It saves at once.
- **Optional**: pick the stage where it first went wrong, or hover a step and click "First thing that went wrong".
- **Move on** with Cmd+Enter (Ctrl+Enter on Windows and Linux). J and K step forward and back. U undoes your last change on this trace.
- **AI help waits** until you have reviewed 10 traces, so your own judgment sets the bar before any suggestion appears. Grouping help waits until 30.
- **Aim** for 100 reviewed traces, or until new failure modes stop appearing. Most people review 20 to 50 traces in about 30 minutes.

## Verdicts

| Verdict | Use it when |
|---|---|
| Good (1) | The {userLabel} got what they needed, even if something could be better. A short note on why is optional and feeds success modes. |
| Problem (2) | Anything let the {userLabel} down, including gaps outside the AI's control: a missing feature, a broken link, no way to reach a person. |
| Not sure yet (3 or D) | The reviewer cannot decide yet. The "Not sure yet" filter finds these traces later; they do not count as reviewed. |

Judge the whole trace by where the {userLabel} ended up. A reply can be polite and still lose the patient: "No problem, have a great day!" after the patient says Friday does not work is a Problem, because the assistant never offered another day. Test sessions and empty traces are Problems filed under "Not a product problem", which the funnel leaves out.

## Note rules

1. **The {userLabel}'s side.** Describe what they asked, saw, or had to do.
2. **The first thing that went wrong.** Stop there: later problems in the same trace usually follow from the first one.
3. **Specific.** Name the request, the time, the words, or the tool result, so a new teammate could picture it.
4. **What happened, not why.** Leave causes (the prompt, the model, the look-up) for after grouping.
5. **One or two sentences.** Shorthand is fine when a teammate could still read it.

## Weak and strong notes

| Weak note | Why it falls short | Strong note |
|---|---|---|
| Bad reply. | Nobody can group it or act on it. | Patient asked twice to talk to the front desk. The assistant kept offering cleaning times instead of transferring her. |
| find_slots returned stale data so the model made up a slot. | A guess at the cause, told from the system's side. | Offered Thursday at 3:30 PM, but the calendar check in the same trace listed 3:30 as booked. |
| Formatting off, a bit stiff, too long, and it booked the wrong time. | Four problems with no order; the one that hurt the patient is buried. | Booked Tuesday at 9:00 before the patient chose between 9:00 and 2:00. |

A useful Good note: "Asked which day she wanted before searching, then read back the day, time, and dentist."

## Picking the stage

Pick where the problem first shows, not why it happened. The patient asks for a person in their first message and the assistant answers with open times: the stage is "Hand off when needed", even though the visible slip is in the reply. The stage is optional. Picking a step in the trace sets it.

## Coaching

- Coach after every 10 reviews, in one short chat message. Quote one or two notes and offer a stronger version as an idea. Leave the reviewer's notes as they wrote them.
- Look for: Problem traces with no note; notes under 6 words; notes naming causes (prompt, model, retrieval, context window, the tool returned); notes listing several problems. Ask what the {userLabel} experienced first.
- When the reviewer asks "is this a problem?", ask what the {userLabel} needed and whether they got it. The verdict stays theirs.
- Stay quiet during the first 10 reviews so the reviewer settles into their own judgment.

## Grouping notes

- Group by what the {userLabel} experienced and by the fix it would need. Merge notes that share a fix; split look-alikes that need different fixes.
- One note can support more than one failure mode.
- Name each failure mode in the {userLabel}'s terms: "Ignores requests for a person", not "Escalation intent miss".
- Write the definition as one testable sentence starting "Fails when", so a new teammate could answer yes or no on any trace: "Fails when the patient asks for a person (front desk, a human, call me) and the assistant keeps handling the request instead of transferring."
- Success modes use "Passes when": "Passes when the reply restates the day, time, and dentist after a booking."
- Aim for fewer than 10 failure modes. More than 10 is hard to act on; merge the ones that share a fix.
