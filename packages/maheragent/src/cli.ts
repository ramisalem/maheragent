#!/usr/bin/env node
// Thin dispatcher. Routes the top-level command to the right package, lazily.
//   maheragent mcp                 -> @ramisalem/mcp
//   maheragent init|update|remove  -> @ramisalem/installer
//   maheragent <everything else>   -> @ramisalem/cli

async function main(argv: string[]): Promise<void> {
  const [cmd, ...rest] = argv;
  switch (cmd) {
    case "mcp": {
      const { startMcp } = await import("@ramisalem/mcp");
      await startMcp();
      return;
    }
    case "init":
    case "install":
    case "update":
    case "remove":
    case "uninstall": {
      const { runInstaller } = await import("@ramisalem/installer");
      await runInstaller(argv);
      return;
    }
    default: {
      const { runCli } = await import("@ramisalem/cli");
      await runCli(argv);
      return;
    }
  }
}

main(process.argv.slice(2)).catch((err) => {
  console.error(err);
  process.exit(1);
});
