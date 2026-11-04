import readline from "node:readline/promises";
import { stdin, stdout } from "node:process";

const phone = process.argv[2] ?? "+2348000000000";
const url = process.env.GATEWAY_URL ?? "http://localhost:3000/ussd";

async function main() {
  const rl = readline.createInterface({ input: stdin, output: stdout });
  const sessionId = `sim-${Date.now()}`;
  let text = "";
  for (;;) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ sessionId, serviceCode: "*384#", phoneNumber: phone, text }),
    });
    const body = await res.text();
    console.log(`\n${body.replace(/^(CON|END) /, "")}`);
    if (body.startsWith("END")) break;
    const input = await rl.question("> ");
    text = text ? `${text}*${input}` : input;
  }
  rl.close();
}
main();
