if (process.argv.includes("--version")) {
  process.stdout.write("fake-copilot 1.0.0\n");
  process.exit(0);
}

const promptIndex = process.argv.indexOf("-p");
const prompt = promptIndex >= 0 ? process.argv[promptIndex + 1] : "";
if (prompt.includes("FAIL_REQUEST")) {
  process.stderr.write("synthetic failure\n");
  process.exit(2);
}

const slow = prompt.includes("SLOW_REQUEST");
process.stdout.write("first ");
setTimeout(() => {
  process.stdout.write("second");
  process.exit(0);
}, slow ? 250 : 10);
