import * as readline from "node:readline";

export function ask(query: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(query, (ans) => {
    rl.close();
    resolve(ans);
  }));
}

export async function confirm(query: string, def = false): Promise<boolean> {
  const hint = def ? "Y/n" : "y/N";
  const ans = (await ask(`${query} [${hint}]: `)).trim().toLowerCase();
  if (!ans) return def;
  return ans === "y" || ans === "yes";
}

export async function multiselect(
  question: string,
  items: { name: string; desc: string }[]
): Promise<number[]> {
  console.log(question);
  items.forEach((it, i) => console.log(`  ${i + 1}. ${it.name} - ${it.desc}`));
  const ans = (await ask("Enter numbers (comma separated, blank = none): ")).trim();
  if (!ans) return [];
  const out: number[] = [];
  for (const part of ans.split(",")) {
    const n = parseInt(part.trim(), 10);
    if (!Number.isNaN(n) && n >= 1 && n <= items.length && !out.includes(n - 1)) {
      out.push(n - 1);
    }
  }
  return out;
}
