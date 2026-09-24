// A stand-in for a model command in the judge tests. It reads the prompt on standard input
// and answers Fail when the trace text says "BAD", else Pass.
// Usage: node fake-judge.mjs <single|batch|sleep|garbage|exit1|noread> [--model <name>]

const [mode = 'single', ...rest] = process.argv.slice(2);
const at = rest.indexOf('--model');
const model = at >= 0 ? rest[at + 1] : 'none';

async function readAll() {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return Buffer.concat(chunks).toString('utf8');
}

const verdictOf = (text) => (text.includes('BAD') ? 'Fail' : 'Pass');

if (mode === 'sleep') {
  setTimeout(() => {}, 60000);
} else if (mode === 'noread') {
  // Answer at once without reading the prompt, so a large prompt meets a closed pipe.
  process.stdout.write('[]');
  process.exit(0);
} else {
  const prompt = await readAll();
  if (mode === 'garbage') {
    process.stdout.write('I am not sure about this one.');
  } else if (mode === 'exit1') {
    process.stderr.write('boom: the model is unavailable\n');
    process.exit(1);
  } else if (mode === 'batch') {
    const out = [];
    const re = /<trace id="([^"]+)">([\s\S]*?)<\/trace>/g;
    let m;
    while ((m = re.exec(prompt))) out.push({ trace_id: m[1], critique: `Batch answer from ${model}.`, result: verdictOf(m[2]) });
    process.stdout.write('```json\n' + JSON.stringify(out) + '\n```');
  } else {
    process.stdout.write(`Here is my answer.\n{"critique": "Read the reply with ${model}.", "result": "${verdictOf(prompt)}"}`);
  }
}
