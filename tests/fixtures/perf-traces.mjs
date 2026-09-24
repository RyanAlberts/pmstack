// Seeded synthetic traces for the performance test (not a test file itself).
import { rng } from '../../docs/studio/lib/index.mjs';

const CHANNELS = ['sms', 'web', 'voice'];
const PERSONAS = ['new patient', 'existing patient', 'parent', 'caregiver'];
const ASKS = ['move my cleaning to friday', 'cancel tuesday', 'do you take my insurance', 'can I talk to someone', 'book a checkup next week'];

/** n chat traces with tool calls and details, identical for the same seed. */
export function makeTraces(n = 20000, seed = 7) {
  const next = rng(seed);
  const pick = (list) => list[Math.floor(next() * list.length)];
  const traces = [];
  for (let i = 0; i < n; i++) {
    const id = `p-${String(i).padStart(5, '0')}`;
    const turns = 1 + Math.floor(next() * 4);
    const messages = [{ role: 'system', content: 'You are the scheduling assistant for a dental clinic.' }];
    for (let t = 0; t < turns; t++) {
      messages.push({ role: 'user', content: `${pick(ASKS)} (${i}.${t})` });
      if (next() < 0.5) {
        const callId = `${id}-c${t}`;
        messages.push({ role: 'assistant', content: '', tool_calls: [{ id: callId, type: 'function', function: { name: pick(['find_slots', 'get_patient', 'book_appointment']), arguments: '{"date":"2026-09-25"}' } }] });
        messages.push({ role: 'tool', tool_call_id: callId, content: '{"slots":["09:30","14:00"]}' });
      }
      messages.push({ role: 'assistant', content: `Friday has 9:30 AM or 2:00 PM open. Which works? (${t})` });
    }
    traces.push({ id, metadata: { channel: pick(CHANNELS), persona: pick(PERSONAS), version: i % 10 ? 'Version 1' : 'Version 2' }, messages });
  }
  return traces;
}
