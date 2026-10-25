// Deterministic IPC fixture. Real installation behavior is tested separately on the VPS.
(() => {
  const report = { hostname: "qa-vps", osName: "Ubuntu 24.04 LTS", osId: "ubuntu", osVersion: "24.04", architecture: "x86_64", memoryMb: 1024, diskAvailableMb: 6000, cpuCount: 1, hasSystemd: true, canAdmin: true, hermesVersion: null, checkedAt: Math.floor(Date.now() / 1000) };
  const server = { id: "qa-server", name: "QA VPS", host: "203.0.113.10", port: 22, username: "root", report, setup: { provider: "openrouter", model: "provider/qa-model", telegram: false, browser: false, updateSystem: true } };
  const state = {
    connected: false, workspace: { servers: [server], activity: [] }, installCalls: 0, applyCalls: 0, authStatus: "pending", lastSecrets: null,
    remoteSetup: null, configuredCredentials: ["OPENROUTER_API_KEY"], revision: "revision-1", settingsReads: 0,
    authorizedProviders: [], preparedProviders: [], authActions: [], openedUrls: [], modelQueries: [], modelCatalog: {models:[],source:"provider",status:"empty",message:"",truncated:false}, modelDelay: 0,
    job: { jobId: null, state: "none", step: "", version: null, installedVersion: null, managed: false, serviceActive: false, serviceInstalled: false, apiHealthy: false, modelConfigured: false, rebootRequired: false, events: [] },
  };
  window.__QA__ = state;
  window.isTauri = true;
  window.__TAURI_INTERNALS__ = {
    transformCallback: () => 1,
    unregisterCallback: () => {},
    invoke: async (command, args = {}) => {
      switch (command) {
        case "check_companion_update": return structuredClone(state.companionUpdate ?? {currentVersion:"0.1.2",latestVersion:"0.1.2",available:false,canInstall:false,notes:""});
        case "install_companion_update":
          if(state.companionUpdateError) throw {code:"appUpdate",message:"The application update failed. Signature verification failed."};
          state.companionInstallCalls=(state.companionInstallCalls??0)+1;
          args.progress.onmessage({stage:"downloading",downloaded:512,total:1024});
          await new Promise(resolve=>setTimeout(resolve,500));
          args.progress.onmessage({stage:"installing",downloaded:1024,total:1024});
          await new Promise(resolve=>setTimeout(resolve,500));
          args.progress.onmessage({stage:"restarting",downloaded:1024,total:1024});
          return;
        case "check_hermes_update": return structuredClone(state.hermesUpdate ?? {currentVersion:"v9.8.7",latestVersion:"v9.8.7",available:false});
        case "update_hermes":
          state.hermesUpdateCalls=(state.hermesUpdateCalls??0)+1;
          Object.assign(state.job,{jobId:"00000000-0000-4000-8000-000000000088",operation:"update",state:"running",step:"backup"});
          return structuredClone(state.job);
        case "load_workspace": return structuredClone(state.workspace);
        case "connected_servers": return state.connected ? [server.id] : [];
        case "probe_host": return { fingerprint: "SHA256:qa-fixture", algorithm: "ssh-ed25519", status: "trusted", previousFingerprint: "SHA256:qa-fixture" };
        case "connect_server":
          if (state.rebootPending) throw {code:"rebootPending",message:"The server reboot is scheduled. Wait for the server to restart before reconnecting."};
          state.connected = true; return structuredClone(report);
        case "disconnect_server": state.connected = false; return;
        case "reboot_server":
          if (state.rebootError) throw {code:"reboot",message:"Could not schedule the server reboot. Check root or passwordless sudo access and systemd."};
          state.rebootCalls=(state.rebootCalls??0)+1;
          state.connected=false;
          state.rebootPending=true;
          state.job.rebootRequired=false;
          return;
        case "save_setup": Object.assign(server.setup, args.setup); return;
        case "get_plan": return { ready: true, blockers: [], warnings: ["Less than 8 GB of disk space is available. Installation may run out of space."], steps: [{ id: "install", title: "Install Hermes Agent", description: "Use the official installer and stable release channel." }] };
        case "get_deployment":
          if (state.deploymentError) throw {code:"connection",message:"The server status could not be refreshed."};
          return {...structuredClone(state.job), checkedAt:Math.floor(Date.now()/1000)+(state.serverClockOffset??0)};
        case "read_server_settings":
          state.settingsReads++;
          return {setup:structuredClone(state.remoteSetup ?? server.setup), configuredCredentials:structuredClone(state.configuredCredentials), modelConfigured:state.job.modelConfigured, authorizedProviders:structuredClone(state.authorizedProviders), preparedProviders:structuredClone(state.preparedProviders), revision:state.revision, warnings:[]};
        case "discover_provider_models": {
          state.modelQueries.push(structuredClone(args));
          const result = structuredClone(state.modelCatalog);
          if (state.modelDelay) await new Promise(resolve => setTimeout(resolve,state.modelDelay));
          return result;
        }
        case "prepare_provider":
          Object.assign(state.job,{jobId:"00000000-0000-4000-8000-000000000099",operation:"provider",state:"running",step:"configure"});
          return structuredClone(state.job);
        case "apply_server_settings":
          if (args.update.revision !== state.revision) throw {code:"settingsConflict",message:"The server settings changed. Reload them before applying your changes."};
          state.applyCalls++;
          state.lastSecrets=args.secrets;
          state.lastUpdate=args.update;
          state.remoteSetup=structuredClone(args.update.setup);
          state.configuredCredentials=[...new Set([...state.configuredCredentials, ...args.secrets.values.map(item=>item.name)])];
          state.revision+="-next";
          Object.assign(state.job,{jobId:"00000000-0000-4000-8000-"+String(state.applyCalls).padStart(12,"0"),operation:"configure",state:"running",step:"configure"});
          return structuredClone(state.job);
        case "start_deployment":
          state.installCalls++;
          state.lastSecrets = args.secrets;
          Object.assign(server.setup,{deferModelSetup:true,model:"",channels:[],telegram:false,tools:["file","memory","web","tts"]});
          Object.assign(state.job, { jobId: "00000000-0000-4000-8000-000000000001", state: "running", step: "install", version: "v9.8.7", managed: true, events: ["Resolving the latest stable Hermes release.", "Installing Hermes v9.8.7."] });
          Object.assign(state.job,{startedAt:Math.floor(Date.now()/1000)+(state.serverClockOffset??0)-120,outputUpdatedAt:Math.floor(Date.now()/1000)+(state.serverClockOffset??0)-60,checkedAt:Math.floor(Date.now()/1000)+(state.serverClockOffset??0)});
          return structuredClone(state.job);
        case "apply_setup":
          state.applyCalls++;
          state.lastSecrets=args.secrets;
          Object.assign(state.job,{operation:"configure",state:"running",step:"configure"});
          return structuredClone(state.job);
        case "provider_auth":
          state.authActions.push(structuredClone(args));
          if(args.action==="start") {
            state.authStatus="pending";
            if(args.provider==="antigravity-oauth") return {session_id:"1234567890abcdef1234567890abcdef",flow:"paste_code",verification_url:"https://accounts.google.com/o/oauth2/auth?state=qa-state&redirect_uri=https%3A%2F%2Fexample.google%2Fcallback",poll_interval:2,expires_in:60};
            return ["anthropic","openrouter"].includes(args.provider)
              ? {session_id:"1234567890abcdef1234567890abcdef",flow:"paste_code",verification_url:args.provider==="anthropic"?"https://claude.ai/oauth/authorize?state=qa-state-1234567890&code_challenge=qa-challenge":"https://openrouter.ai/auth?code_challenge=qa-challenge",poll_interval:2,expires_in:900}
              : {session_id:"qa-session-123456",flow:"device_code",user_code:"QA-1234",verification_url:"https://auth.openai.com/device",poll_interval:3};
          }
          if(args.action==="submit") { state.authStatus="approved"; return {status:"exchanging"}; }
          if(args.action==="poll") {
            if(state.authStatus==="approved") state.authorizedProviders=[...new Set([...state.authorizedProviders,args.provider])];
            return {status:state.authStatus};
          }
          return {};
        case "plugin:opener|open_url": state.openedUrls.push(args.url); return;
        case "manage_service":
          if (args.action === "stop") { state.job.serviceActive = false; state.job.apiHealthy = false; }
          else { state.job.serviceActive = true; state.job.apiHealthy = true; }
          return structuredClone(state.job);
        case "get_remote_logs":
          state.logsReads=(state.logsReads??0)+1;
          return state.remoteLogs ?? "Hermes service started.\nAPI_SERVER_KEY=[REDACTED]\n";
        default: throw { code: "fixture", message: "Unexpected IPC command in test fixture: " + command };
      }
    },
  };
})();
