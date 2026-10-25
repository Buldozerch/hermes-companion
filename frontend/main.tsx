import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource/jetbrains-mono/latin-400.css";
import "@fontsource/jetbrains-mono/latin-500.css";
import "@fontsource/jetbrains-mono/cyrillic-400.css";
import "@fontsource/jetbrains-mono/cyrillic-500.css";
import "./styles.css";
import App from "./App";
import { LocaleProvider } from "@/components/locale-provider";
import { SetupCredentialsProvider } from "@/components/setup-credentials";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <LocaleProvider>
      <SetupCredentialsProvider>
        <App />
      </SetupCredentialsProvider>
    </LocaleProvider>
  </React.StrictMode>,
);
