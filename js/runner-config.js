/* runner-config.js — point the platform at the execution backend.

   Default is "/api" so it works on Vercel SAME-ORIGIN: the deployed site calls its own
   serverless functions (api/run.js, api/grade.js) with no separate server URL. Native
   Tier-4 execution + profiling light up automatically once the JUDGE0_* env vars are set
   in the Vercel project (see README "Execution backend (Vercel)").

   Override to an external hft-runner instance if you don't want to use the bundled
   functions, e.g.:  window.HFT_RUNNER_URL = "https://hft-runner.fly.dev";
   Pyodide Tier 1-3 quick-runs + in-browser perf always work regardless of this setting. */
window.HFT_RUNNER_URL = "/api";
