#!/usr/bin/env -S deno run -A
/**
 * E2E Test Runner Script
 * ======================
 * This script:
 * 1. Checks if the dev server is already running on port 8000
 * 2. If not, starts it in the background
 * 3. Waits for the server to be ready (liveness check)
 * 4. Runs the e2e tests
 * 5. Reports the results
 * 6. Cleans up server on exit (including Ctrl+C)
 *
 * Usage:
 *   deno task test:e2e           # Run all tests (desktop + mobile)
 *   deno task test:e2e:desktop   # Run desktop tests only
 *   deno task test:e2e:mobile    # Run mobile tests only
 *   deno task test:e2e:headed    # Run tests with visible browser
 */

const SITE_URL = "http://localhost:8000";
const LIVENESS_PATH = "/deco/_liveness";
const E2E_DIR = "./tests/e2e";
const MAX_LIVENESS_RETRIES = 60;
const LIVENESS_RETRY_DELAY = 1000;

// Global state for cleanup
let serverProcess: Deno.ChildProcess | null = null;
let serverStartedByUs = false;
let isCleaningUp = false;

function cleanup(exitCode: number = 1): void {
  if (isCleaningUp) return;
  isCleaningUp = true;

  if (serverProcess && serverStartedByUs) {
    console.log("\n🛑 Stopping dev server...");
    try {
      serverProcess.kill("SIGTERM");
    } catch {
      // Process may already be dead
    }
    // Give it a moment to terminate gracefully, then force kill
    setTimeout(() => {
      try {
        serverProcess?.kill("SIGKILL");
      } catch {
        // Ignore
      }
      Deno.exit(exitCode);
    }, 1000);
  } else {
    Deno.exit(exitCode);
  }
}

// Handle Ctrl+C and other termination signals
Deno.addSignalListener("SIGINT", () => {
  console.log("\n⚠️ Interrupted (Ctrl+C)");
  cleanup(130); // Standard exit code for SIGINT
});

Deno.addSignalListener("SIGTERM", () => {
  console.log("\n⚠️ Terminated");
  cleanup(143); // Standard exit code for SIGTERM
});

// Handle uncaught errors
globalThis.addEventListener("unhandledrejection", (event) => {
  console.error("❌ Unhandled error:", event.reason);
  cleanup(1);
});

async function isServerRunning(): Promise<boolean> {
  try {
    const res = await fetch(`${SITE_URL}${LIVENESS_PATH}`, {
      signal: AbortSignal.timeout(2000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function waitForServer(): Promise<boolean> {
  console.log("⏳ Waiting for server to be ready...");

  for (let i = 0; i < MAX_LIVENESS_RETRIES; i++) {
    if (await isServerRunning()) {
      console.log(`✅ Server is ready (attempt ${i + 1})`);
      return true;
    }
    await new Promise((r) => setTimeout(r, LIVENESS_RETRY_DELAY));
    if ((i + 1) % 10 === 0) {
      console.log(`   Still waiting... (${i + 1}/${MAX_LIVENESS_RETRIES})`);
    }
  }

  return false;
}

async function startServer(): Promise<Deno.ChildProcess> {
  console.log("🚀 Starting dev server...");

  const command = new Deno.Command("deno", {
    args: ["task", "dev"],
    stdout: "piped",
    stderr: "piped",
  });

  const process = command.spawn();

  // Log server output in background
  (async () => {
    const decoder = new TextDecoder();
    for await (const chunk of process.stdout) {
      const text = decoder.decode(chunk);
      if (text.includes("Fresh ready") || text.includes("Listening")) {
        console.log("   📡 Server started");
      }
    }
  })();

  // Consume stderr to prevent the pipe buffer from filling up and blocking the process
  (async () => {
    const decoder = new TextDecoder();
    for await (const chunk of process.stderr) {
      const text = decoder.decode(chunk);
      console.error(text);
    }
  })();

  return process;
}

async function runTests(headed: boolean = false, project?: string): Promise<boolean> {
  const projectLabel = project || "all";
  console.log(`\n🧪 Running e2e tests (${projectLabel})${headed ? " (headed mode)" : ""}...\n`);

  const args = ["test", "--"];
  if (project) {
    args.push(`--project=${project}`);
  }
  if (headed) {
    args.push("--headed");
  }

  const command = new Deno.Command("npm", {
    args,
    cwd: E2E_DIR,
    env: {
      ...Deno.env.toObject(),
      SITE_URL,
      HEADED: headed ? "true" : "false",
    },
    stdout: "inherit",
    stderr: "inherit",
  });

  const { code } = await command.output();
  return code === 0;
}

async function main() {
  const args = Deno.args;
  const headed = args.includes("--headed") || args.includes("-h");
  const skipServerCheck = args.includes("--skip-server-check");
  const mobileOnly = args.includes("--mobile");
  const desktopOnly = args.includes("--desktop");
  const project = mobileOnly ? "mobile-chrome" : desktopOnly ? "desktop-chrome" : undefined;

  try {
    // Check if server is already running
    if (!skipServerCheck) {
      const serverAlreadyRunning = await isServerRunning();

      if (serverAlreadyRunning) {
        console.log("✅ Dev server already running");
      } else {
        // Start the server
        serverProcess = await startServer();
        serverStartedByUs = true;

        // Wait for it to be ready
        const ready = await waitForServer();
        if (!ready) {
          console.error("❌ Server failed to start within timeout");
          cleanup(1);
          return;
        }
      }
    }

    // Run the tests
    const testsPassed = await runTests(headed, project);

    if (testsPassed) {
      console.log("\n✅ All tests passed!");
    } else {
      console.log("\n❌ Some tests failed");
    }

    cleanup(testsPassed ? 0 : 1);
  } catch (err) {
    console.error("❌ Error:", err);
    cleanup(1);
  }
}

main();
